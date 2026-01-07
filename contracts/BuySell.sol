// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/**
 * @title BuySell
 * @dev Contract for onramp/offramp functionality - buying and selling TST tokens with fiat
 */
contract BuySell {
    IERC20 public token;
    address public admin;
    address public treasuryWallet;
    
    // Currency types: 0 = USD, 1 = UGX, 2 = KES
    enum CurrencyType { USD, UGX, KES }
    
    // Request status
    enum RequestStatus { Pending, Approved, Rejected, Cancelled }
    
    struct Request {
        address user;
        uint256 amount; // Fiat amount for buy, token amount for sell
        CurrencyType currencyType;
        RequestStatus status;
        string mobileNumber; // Admin number for buy, user number for sell
        address recipientWallet; // Wallet to receive tokens (for buy requests)
        uint256 timestamp;
        string adminNotes;
        bool isBuyRequest; // true for buy, false for sell
    }
    
    mapping(uint256 => Request) public requests;
    mapping(address => uint256[]) public userRequests;
    uint256 public requestCount;
    
    // Events
    event BuyRequestCreated(uint256 indexed requestId, address indexed user, uint256 fiatAmount, CurrencyType currencyType, address recipientWallet);
    event SellRequestCreated(uint256 indexed requestId, address indexed user, uint256 tokenAmount, CurrencyType currencyType, string mobileNumber);
    event RequestApproved(uint256 indexed requestId, address indexed admin, string notes);
    event RequestRejected(uint256 indexed requestId, address indexed admin, string notes);
    event RequestCancelled(uint256 indexed requestId, address indexed user);
    event TokensTransferred(uint256 indexed requestId, address indexed to, uint256 amount);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    constructor(address _token, address _admin, address _treasuryWallet) {
        require(_token != address(0), "Invalid token address");
        require(_admin != address(0), "Invalid admin address");
        require(_treasuryWallet != address(0), "Invalid treasury address");
        
        token = IERC20(_token);
        admin = _admin;
        treasuryWallet = _treasuryWallet;
        requestCount = 0;
    }
    
    /**
     * @dev Create a buy request (onramp - fiat to tokens)
     * @param fiatAmount Amount in fiat currency (scaled to 18 decimals)
     * @param currencyType Currency type (0=USD, 1=UGX, 2=KES)
     * @param recipientWallet Wallet address to receive tokens (use address(0) for msg.sender)
     */
    function createBuyRequest(
        uint256 fiatAmount,
        uint256 currencyType,
        address recipientWallet
    ) external returns (uint256) {
        require(fiatAmount > 0, "Amount must be greater than 0");
        require(currencyType <= 2, "Invalid currency type");
        
        // If recipientWallet is zero address, use msg.sender
        address tokenRecipient = recipientWallet == address(0) ? msg.sender : recipientWallet;
        
        requestCount++;
        requests[requestCount] = Request({
            user: msg.sender,
            amount: fiatAmount,
            currencyType: CurrencyType(currencyType),
            status: RequestStatus.Pending,
            mobileNumber: "", // Admin number (stored separately, not in request)
            recipientWallet: tokenRecipient,
            timestamp: block.timestamp,
            adminNotes: "",
            isBuyRequest: true
        });
        
        userRequests[msg.sender].push(requestCount);
        
        emit BuyRequestCreated(requestCount, msg.sender, fiatAmount, CurrencyType(currencyType), tokenRecipient);
        
        return requestCount;
    }
    
    /**
     * @dev Create a sell request (offramp - tokens to fiat)
     * @param tokenAmount Amount of tokens to sell
     * @param currencyType Currency type (0=USD, 1=UGX, 2=KES)
     * @param mobileNumber Mobile money number for receiving fiat
     */
    function createSellRequest(
        uint256 tokenAmount,
        uint256 currencyType,
        string memory mobileNumber
    ) external returns (uint256) {
        require(tokenAmount > 0, "Amount must be greater than 0");
        require(currencyType <= 2, "Invalid currency type");
        require(bytes(mobileNumber).length > 0, "Mobile number required");
        // No balance/allowance check - user will send tokens manually to treasury wallet
        
        requestCount++;
        requests[requestCount] = Request({
            user: msg.sender,
            amount: tokenAmount,
            currencyType: CurrencyType(currencyType),
            status: RequestStatus.Pending,
            mobileNumber: mobileNumber,
            recipientWallet: address(0), // Not used for sell requests
            timestamp: block.timestamp,
            adminNotes: "",
            isBuyRequest: false
        });
        
        userRequests[msg.sender].push(requestCount);
        
        emit SellRequestCreated(requestCount, msg.sender, tokenAmount, CurrencyType(currencyType), mobileNumber);
        
        return requestCount;
    }
    
    /**
     * @dev Approve a request (admin only)
     * @param requestId Request ID to approve
     * @param notes Admin notes
     */
    function approveRequest(uint256 requestId, string memory notes) external onlyAdmin {
        Request storage request = requests[requestId];
        require(request.status == RequestStatus.Pending, "Request not pending");
        require(request.user != address(0), "Invalid request");
        
        request.status = RequestStatus.Approved;
        request.adminNotes = notes;
        
        if (request.isBuyRequest) {
            // Buy request: Transfer tokens from treasury to recipient wallet
            // Calculate token amount (simplified: 1 USD = 1 TST, adjust for other currencies)
            uint256 tokenAmount = calculateTokenAmount(request.amount, request.currencyType);
            require(token.balanceOf(treasuryWallet) >= tokenAmount, "Insufficient treasury balance");
            require(token.allowance(treasuryWallet, address(this)) >= tokenAmount, "Insufficient treasury allowance");
            
            require(
                token.transferFrom(treasuryWallet, request.recipientWallet, tokenAmount),
                "Token transfer failed"
            );
            
            emit TokensTransferred(requestId, request.recipientWallet, tokenAmount);
        } else {
            // Sell request: Admin manually confirms tokens were received
            // No automatic transfer - user sends tokens manually to treasury wallet
            // Admin approves after confirming receipt
            emit TokensTransferred(requestId, treasuryWallet, request.amount);
        }
        
        emit RequestApproved(requestId, msg.sender, notes);
    }
    
    /**
     * @dev Reject a request (admin only)
     * @param requestId Request ID to reject
     * @param notes Admin notes
     */
    function rejectRequest(uint256 requestId, string memory notes) external onlyAdmin {
        Request storage request = requests[requestId];
        require(request.status == RequestStatus.Pending, "Request not pending");
        
        request.status = RequestStatus.Rejected;
        request.adminNotes = notes;
        
        emit RequestRejected(requestId, msg.sender, notes);
    }
    
    /**
     * @dev Cancel a request (user only)
     * @param requestId Request ID to cancel
     */
    function cancelRequest(uint256 requestId) external {
        Request storage request = requests[requestId];
        require(request.user == msg.sender, "Not your request");
        require(request.status == RequestStatus.Pending, "Request not pending");
        
        request.status = RequestStatus.Cancelled;
        
        emit RequestCancelled(requestId, msg.sender);
    }
    
    /**
     * @dev Get request details
     */
    function getRequest(uint256 requestId) external view returns (
        address user,
        uint256 amount,
        uint256 currencyType,
        uint256 status,
        string memory mobileNumber,
        address recipientWallet,
        uint256 timestamp,
        string memory adminNotes
    ) {
        Request memory request = requests[requestId];
        return (
            request.user,
            request.amount,
            uint256(request.currencyType),
            uint256(request.status),
            request.mobileNumber,
            request.recipientWallet,
            request.timestamp,
            request.adminNotes
        );
    }
    
    /**
     * @dev Get all request IDs for a user
     */
    function getUserRequests(address user) external view returns (uint256[] memory) {
        return userRequests[user];
    }
    
    /**
     * @dev Get all pending request IDs (admin view)
     */
    function getPendingRequests() external view returns (uint256[] memory) {
        uint256[] memory pending = new uint256[](requestCount);
        uint256 count = 0;
        
        for (uint256 i = 1; i <= requestCount; i++) {
            if (requests[i].status == RequestStatus.Pending) {
                pending[count] = i;
                count++;
            }
        }
        
        // Resize array
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = pending[i];
        }
        
        return result;
    }
    
    /**
     * @dev Calculate token amount from fiat amount
     * Simplified: 1 USD = 1 TST
     * For UGX: 1 USD = 3500 UGX, so divide by 3500
     * For KES: 1 USD = 128 KES, so divide by 128
     */
    function calculateTokenAmount(uint256 fiatAmount, CurrencyType currencyType) internal pure returns (uint256) {
        if (currencyType == CurrencyType.USD) {
            return fiatAmount; // 1:1 for USD
        } else if (currencyType == CurrencyType.UGX) {
            return fiatAmount / 3500; // 1 USD = 3500 UGX
        } else { // KES
            return fiatAmount / 128; // 1 USD = 128 KES
        }
    }
    
    /**
     * @dev Update treasury wallet (admin only)
     */
    function setTreasuryWallet(address _treasuryWallet) external onlyAdmin {
        require(_treasuryWallet != address(0), "Invalid address");
        treasuryWallet = _treasuryWallet;
    }
    
    /**
     * @dev Update admin (admin only)
     */
    function setAdmin(address _admin) external onlyAdmin {
        require(_admin != address(0), "Invalid address");
        admin = _admin;
    }
}

