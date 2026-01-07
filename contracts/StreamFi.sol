// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/**
 * @title StreamFi - Simple Payment Streaming Contract
 * @dev Modified to use ERC20 tokens instead of native currency
 */
contract StreamFi {
    IERC20 public token;
    
    struct Stream {
        uint256 id;
        address creator;
        uint256 hourlyRate; // Average rate per hour (for backward compatibility)
        uint256 duration; // Duration in hours
        uint256 startTime;
        uint256 endTime;
        address[] recipients;
        uint256 totalFunded;
        uint256 totalDistributed;
        bool isActive;
    }

    uint256 public streamCount;
    mapping(uint256 => Stream) public streams;
    mapping(uint256 => mapping(address => uint256)) public claimedAmounts;
    mapping(uint256 => mapping(address => uint256)) public recipientHourlyRates; // streamId => recipient => hourlyRate

    event StreamCreated(uint256 indexed streamId, address indexed creator, uint256 hourlyRate, uint256 duration);
    event StreamFunded(uint256 indexed streamId, address indexed creator, uint256 amount);
    event RewardClaimed(uint256 indexed streamId, address indexed recipient, uint256 amount);

    constructor(address _token) {
        token = IERC20(_token);
    }

    /**
     * @dev Create a new payment stream with individual hourly rates per recipient
     * @param hourlyRates Array of hourly rates (one per recipient, in wei)
     * @param duration Duration in hours
     * @param recipients Array of recipient addresses
     */
    function createStream(
        uint256[] memory hourlyRates,
        uint256 duration,
        address[] memory recipients
    ) external returns (uint256) {
        require(duration > 0, "Duration must be > 0");
        require(recipients.length > 0, "At least one recipient required");
        require(hourlyRates.length == recipients.length, "Rates and recipients arrays must match");

        // Validate all rates and recipients
        uint256 totalRates = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient address");
            require(hourlyRates[i] > 0, "Hourly rate must be > 0");
            totalRates += hourlyRates[i];
        }

        streamCount++;
        uint256 streamId = streamCount;

        // Calculate average hourly rate for backward compatibility
        uint256 avgHourlyRate = totalRates / recipients.length;

        // Store individual rates
        for (uint256 i = 0; i < recipients.length; i++) {
            recipientHourlyRates[streamId][recipients[i]] = hourlyRates[i];
        }

        streams[streamId] = Stream({
            id: streamId,
            creator: msg.sender,
            hourlyRate: avgHourlyRate,
            duration: duration,
            startTime: 0,
            endTime: 0,
            recipients: recipients,
            totalFunded: 0,
            totalDistributed: 0,
            isActive: false
        });

        emit StreamCreated(streamId, msg.sender, avgHourlyRate, duration);
        return streamId;
    }

    /**
     * @dev Create a new payment stream with single hourly rate (for backward compatibility)
     * @param hourlyRate Hourly rate for all recipients (in wei)
     * @param duration Duration in hours
     * @param recipients Array of recipient addresses
     */
    function createStreamSingleRate(
        uint256 hourlyRate,
        uint256 duration,
        address[] memory recipients
    ) external returns (uint256) {
        require(hourlyRate > 0, "Hourly rate must be > 0");
        require(duration > 0, "Duration must be > 0");
        require(recipients.length > 0, "At least one recipient required");

        // Create array of same rate for all recipients
        uint256[] memory hourlyRates = new uint256[](recipients.length);
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient address");
            hourlyRates[i] = hourlyRate;
        }

        // Inline the createStream logic to avoid forward reference
        uint256 totalRates = hourlyRate * recipients.length;
        streamCount++;
        uint256 streamId = streamCount;
        uint256 avgHourlyRate = totalRates / recipients.length;

        // Store individual rates
        for (uint256 i = 0; i < recipients.length; i++) {
            recipientHourlyRates[streamId][recipients[i]] = hourlyRate;
        }

        streams[streamId] = Stream({
            id: streamId,
            creator: msg.sender,
            hourlyRate: avgHourlyRate,
            duration: duration,
            startTime: 0,
            endTime: 0,
            recipients: recipients,
            totalFunded: 0,
            totalDistributed: 0,
            isActive: false
        });

        emit StreamCreated(streamId, msg.sender, avgHourlyRate, duration);
        return streamId;
    }

    /**
     * @dev Fund a stream with ERC20 tokens
     */
    function fundStream(uint256 streamId) external {
        Stream storage stream = streams[streamId];
        require(stream.id != 0, "Stream does not exist");
        require(stream.creator == msg.sender, "Only creator can fund");
        require(!stream.isActive, "Stream already funded");

        // Calculate total amount based on individual rates
        uint256 requiredAmount = 0;
        for (uint256 i = 0; i < stream.recipients.length; i++) {
            uint256 recipientRate = recipientHourlyRates[streamId][stream.recipients[i]];
            if (recipientRate == 0) {
                // Fallback to average rate if individual rate not set (backward compatibility)
                recipientRate = stream.hourlyRate;
            }
            requiredAmount += recipientRate * stream.duration;
        }
        
        // Transfer tokens from creator to contract
        require(
            token.transferFrom(msg.sender, address(this), requiredAmount),
            "Token transfer failed"
        );

        stream.totalFunded = requiredAmount;
        stream.startTime = block.timestamp;
        stream.endTime = block.timestamp + (stream.duration * 1 hours);
        stream.isActive = true;

        emit StreamFunded(streamId, msg.sender, requiredAmount);
    }

    /**
     * @dev Calculate accumulated reward for a recipient
     */
    function calculateReward(uint256 streamId, address recipient) public view returns (uint256) {
        Stream memory stream = streams[streamId];
        require(stream.id != 0, "Stream does not exist");
        require(stream.isActive, "Stream not active");

        // Check if recipient is in the stream
        bool isRecipient = false;
        for (uint256 i = 0; i < stream.recipients.length; i++) {
            if (stream.recipients[i] == recipient) {
                isRecipient = true;
                break;
            }
        }
        require(isRecipient, "Not a recipient");

        uint256 currentTime = block.timestamp < stream.endTime ? block.timestamp : stream.endTime;
        if (currentTime <= stream.startTime) return 0;

        uint256 elapsedSeconds = currentTime - stream.startTime;
        
        // Use individual rate if available, otherwise use average rate
        uint256 recipientRate = recipientHourlyRates[streamId][recipient];
        if (recipientRate == 0) {
            // Fallback to average rate if individual rate not set (backward compatibility)
            recipientRate = stream.hourlyRate;
        }
        
        uint256 reward = (elapsedSeconds * recipientRate) / 3600;
        uint256 claimed = claimedAmounts[streamId][recipient];

        return reward > claimed ? reward - claimed : 0;
    }

    /**
     * @dev Claim accumulated rewards
     */
    function claimReward(uint256 streamId) external {
        uint256 reward = calculateReward(streamId, msg.sender);
        require(reward > 0, "No rewards to claim");

        Stream storage stream = streams[streamId];
        claimedAmounts[streamId][msg.sender] += reward;
        stream.totalDistributed += reward;

        require(
            token.transfer(msg.sender, reward),
            "Token transfer failed"
        );

        emit RewardClaimed(streamId, msg.sender, reward);
    }

    /**
     * @dev Get stream details
     */
    function getStream(uint256 streamId) external view returns (
        address creator,
        uint256 hourlyRate,
        uint256 duration,
        uint256 startTime,
        uint256 endTime,
        address[] memory recipients,
        uint256 totalFunded,
        uint256 totalDistributed,
        bool isActive
    ) {
        Stream memory stream = streams[streamId];
        require(stream.id != 0, "Stream does not exist");
        return (
            stream.creator,
            stream.hourlyRate,
            stream.duration,
            stream.startTime,
            stream.endTime,
            stream.recipients,
            stream.totalFunded,
            stream.totalDistributed,
            stream.isActive
        );
    }

    /**
     * @dev Get individual hourly rate for a recipient
     * @param streamId ID of the stream
     * @param recipient Address of the recipient
     * @return Individual hourly rate for the recipient, or 0 if not set
     */
    function getRecipientHourlyRate(uint256 streamId, address recipient) external view returns (uint256) {
        uint256 rate = recipientHourlyRates[streamId][recipient];
        if (rate == 0) {
            // Return average rate if individual rate not set
            Stream memory stream = streams[streamId];
            require(stream.id != 0, "Stream does not exist");
            return stream.hourlyRate;
        }
        return rate;
    }
}











