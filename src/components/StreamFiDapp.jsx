import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ethers } from 'ethers';
import { useToken } from '../hooks/useToken';
import { TOKEN_CONFIG, ERC20_ABI } from '../config/tokens';
import './StreamingPaymentDapp.css';
import BuySellInterface from './BuySellInterface';
import BuySellAdmin from './BuySellAdmin';
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import { Pie, Bar } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

// StreamFi Contract ABI
const STREAMFI_ABI = [
  'function createStream(uint256[] hourlyRates, uint256 duration, address[] recipients) external returns (uint256)',
  'function createStreamSingleRate(uint256 hourlyRate, uint256 duration, address[] recipients) external returns (uint256)',
  'function fundStream(uint256 streamId) external',
  'function claimReward(uint256 streamId) external',
  'function calculateReward(uint256 streamId, address recipient) external view returns (uint256)',
  'function getStream(uint256 streamId) external view returns (address creator, uint256 hourlyRate, uint256 duration, uint256 startTime, uint256 endTime, address[] recipients, uint256 totalFunded, uint256 totalDistributed, bool isActive)',
  'function getRecipientHourlyRate(uint256 streamId, address recipient) external view returns (uint256)',
  'function streamCount() external view returns (uint256)',
  'function token() external view returns (address)',
  'event StreamCreated(uint256 indexed streamId, address indexed creator, uint256 hourlyRate, uint256 duration)',
  'event StreamFunded(uint256 indexed streamId, address indexed creator, uint256 amount)',
  'event RewardClaimed(uint256 indexed streamId, address indexed recipient, uint256 amount)'
];

function StreamFiDapp({ defaultTab = 'create' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { account, balance, isConnected, connectWallet, disconnectWallet, error: tokenError } = useToken();
  const [streamFiContract, setStreamFiContract] = useState(null);
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Determine active tab from route
  const getActiveTabFromRoute = () => {
    const path = location.pathname;
    if (path === '/create') return 'create';
    if (path === '/streams') return 'my-streams';
    if (path === '/claim') return 'claim';
    if (path === '/analytics') return 'analytics';
    if (path === '/buy-sell') return 'buy-sell';
    if (path === '/admin') return 'admin';
    return defaultTab;
  };
  
  const [activeTab, setActiveTab] = useState(getActiveTabFromRoute());
  const [needsApproval, setNeedsApproval] = useState(false);
  const [showFooter, setShowFooter] = useState(false);
  
  // Update active tab when route changes
  useEffect(() => {
    setActiveTab(getActiveTabFromRoute());
  }, [location.pathname, defaultTab]);

  // Handle scroll detection for footer
  useEffect(() => {
    if (!isConnected) {
      const handleScroll = () => {
        const scrollPosition = window.scrollY || window.pageYOffset;
        setShowFooter(scrollPosition > 100);
      };

      window.addEventListener('scroll', handleScroll);
      return () => window.removeEventListener('scroll', handleScroll);
    }
  }, [isConnected]);
  
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    const routes = {
      'create': '/create',
      'my-streams': '/streams',
      'claim': '/claim',
      'analytics': '/analytics',
      'buy-sell': '/buy-sell',
      'admin': '/admin'
    };
    navigate(routes[tab] || '/');
  };
  
  // Stream management state
  const [hiddenStreams, setHiddenStreams] = useState(() => {
    try {
      const stored = localStorage.getItem('streamfi_hidden_streams');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [pausedStreams, setPausedStreams] = useState(() => {
    try {
      const stored = localStorage.getItem('streamfi_paused_streams');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [pausePeriods, setPausePeriods] = useState(() => {
    try {
      const stored = localStorage.getItem('streamfi_pause_periods');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const [removedRecipients, setRemovedRecipients] = useState(() => {
    try {
      const stored = localStorage.getItem('streamfi_removed_recipients');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const [recipientRates, setRecipientRates] = useState(() => {
    try {
      const stored = localStorage.getItem('streamfi_recipient_rates');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Form state for creating stream
  const [hourlyRate, setHourlyRate] = useState('');
  const [durationType, setDurationType] = useState('custom'); // 'custom', 'week', 'month', 'quarter', 'year'
  const [duration, setDuration] = useState('24');
  const [recipients, setRecipients] = useState([{ address: '', amount: '' }]); // Array of {address, amount}
  const [showPreview, setShowPreview] = useState(false); // Stream preview toggle
  const [selectedTemplate, setSelectedTemplate] = useState(''); // Selected template ID
  const [unclaimedFundsDestination, setUnclaimedFundsDestination] = useState('creator'); // 'creator' or 'recipients'

  // Address book state
  const [savedRecipients, setSavedRecipients] = useState(() => {
    try {
      const stored = localStorage.getItem('streamfi_recipients');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [newRecipientName, setNewRecipientName] = useState('');
  const [newRecipientAddress, setNewRecipientAddress] = useState('');
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptData, setReceiptData] = useState(null);

  // Templates state
  const [templates, setTemplates] = useState(() => {
    try {
      const stored = localStorage.getItem('streamfi_templates');
      return stored ? JSON.parse(stored) : [
        {
          id: 'monthly-salary',
          name: 'Monthly Salary',
          hourlyRate: '10',
          durationType: 'month',
          description: 'Standard monthly salary payment'
        },
        {
          id: 'weekly-allowance',
          name: 'Weekly Allowance',
          hourlyRate: '5',
          durationType: 'week',
          description: 'Weekly allowance payment'
        },
        {
          id: 'project-payment',
          name: 'Project Payment',
          hourlyRate: '50',
          durationType: 'month',
          description: 'Project milestone payment'
        }
      ];
    } catch {
      return [];
    }
  });

  // Contract address - StreamFi deployed contract on Ethereum Mainnet
  const [contractAddress, setContractAddress] = useState('0x65fEEd327e7d9a84df26446c48a46B42853cD074');

  useEffect(() => {
    if (isConnected && account && contractAddress) {
      initializeContract();
    }
  }, [isConnected, account, contractAddress]);

  useEffect(() => {
    if (streamFiContract && account) {
      // Add a small delay before first load to avoid immediate RPC rate limits
      const initialDelay = setTimeout(() => {
        loadStreams();
      }, 1000);
      
      // Reload streams every 10 seconds to update balances (reduced frequency to avoid rate limits)
      const interval = setInterval(() => {
        loadStreams();
      }, 10000);
      
      return () => {
        clearTimeout(initialDelay);
        clearInterval(interval);
      };
    }
  }, [streamFiContract, account]);

  // Retry helper with exponential backoff
  const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 2000) => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn()
      } catch (err) {
        // Check if it's a rate limiting or RPC error
        const isRateLimitError = 
          err.code === -32002 || 
          err.message?.includes('too many errors') ||
          err.message?.includes('retrying') ||
          err.code === 'UNKNOWN_ERROR' ||
          (err.code === 'CALL_EXCEPTION' && err.message?.includes('could not coalesce'))
        
        if (isRateLimitError && i < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, i) // Exponential backoff
          console.warn(`RPC rate limit hit, retrying in ${delay}ms... (attempt ${i + 1}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }
        throw err
      }
    }
  }

  const initializeContract = async () => {
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      // Check if we're on the correct network (Ethereum Mainnet) with retry
      const network = await retryWithBackoff(async () => {
        return await provider.getNetwork();
      }, 3, 2000);
      
      const expectedChainId = 1n; // Ethereum Mainnet
      if (network.chainId !== expectedChainId) {
        setError(`Wrong network! Please switch to Ethereum Mainnet (Chain ID: ${expectedChainId}). Current: ${network.chainId}`);
        return;
      }
      
      // Check if contract exists at the address with retry
      const code = await retryWithBackoff(async () => {
        return await provider.getCode(contractAddress);
      }, 3, 2000);
      
      if (code === '0x' || code === '0x0') {
        setError(`No contract found at address ${contractAddress}. Please verify the contract is deployed on Ethereum Mainnet.`);
        return;
      }
      
      const contract = new ethers.Contract(contractAddress, STREAMFI_ABI, signer);
      setStreamFiContract(contract);
      console.log('StreamFi contract initialized:', contractAddress);
      setError(''); // Clear any previous errors
    } catch (err) {
      console.error('Error initializing contract:', err);
      
      // Provide more specific error messages
      if (err.code === -32002 || err.message?.includes('too many errors')) {
        setError('RPC endpoint rate limited. Please wait a moment and refresh the page, or try switching to a different RPC endpoint in MetaMask settings.');
      } else if (err.message?.includes('could not coalesce')) {
        setError('RPC endpoint is experiencing issues. Please wait a moment and try again, or switch to a different RPC endpoint in MetaMask.');
      } else {
        setError(`Failed to initialize contract: ${err.message || 'Unknown error'}`);
      }
    }
  };

  const loadStreams = async () => {
    if (!streamFiContract || !account) return;

    try {
      // Try to call streamCount with retry logic
      let count;
      try {
        count = await retryWithBackoff(async () => {
          return await streamFiContract.streamCount();
        }, 3, 2000);
      } catch (callError) {
        // Check if it's a rate limiting error
        if (callError.code === -32002 || callError.message?.includes('too many errors')) {
          setError('RPC endpoint rate limited. Please wait a moment and the streams will load automatically.');
          return;
        }
        
        // Check if it's a contract existence issue
        if (callError.code === 'CALL_EXCEPTION' || callError.message?.includes('missing revert data')) {
          const provider = new ethers.BrowserProvider(window.ethereum);
          try {
            const code = await retryWithBackoff(async () => {
              return await provider.getCode(contractAddress);
            }, 2, 2000);
            
            if (code === '0x' || code === '0x0') {
              setError(`Contract not found at ${contractAddress}. Please verify deployment on Ethereum Mainnet.`);
              return;
            }
          } catch {
            // If we can't check code, assume it's an RPC issue
            setError('RPC endpoint is experiencing issues. Please wait a moment and try again.');
            return;
          }
          // Contract exists but call failed - might be network issue
          setError('Failed to connect to contract. Please check your network connection and ensure you are on Ethereum Mainnet.');
          return;
        }
        throw callError;
      }
      
      const streamIds = [];
      for (let i = 1; i <= Number(count); i++) {
        streamIds.push(i);
      }

      const streamPromises = streamIds.map(async (id) => {
        try {
          const stream = await streamFiContract.getStream(id);
          const isCreator = stream.creator.toLowerCase() === account.toLowerCase();
          const isRecipient = stream.recipients.some(r => r.toLowerCase() === account.toLowerCase());

          // Calculate if stream is actually active
          const now = Math.floor(Date.now() / 1000);
          const endTime = Number(stream.endTime);
          const totalFunded = parseFloat(ethers.formatEther(stream.totalFunded));
          const totalDistributed = parseFloat(ethers.formatEther(stream.totalDistributed));
          
          // Stream is inactive if:
          // 1. Contract says it's not active
          // 2. End time has passed
          // 3. All funds have been distributed (within 0.0001 MNEE tolerance)
          const hasEnded = endTime > 0 && now >= endTime;
          const allDistributed = totalFunded > 0 && totalDistributed >= (totalFunded - 0.0001);
          const actuallyActive = stream.isActive && !hasEnded && !allDistributed;

          let accumulated = '0';
          if (isRecipient && actuallyActive) {
            try {
              // Use contract's calculateReward which now handles individual rates
              let reward = await streamFiContract.calculateReward(id, account);
              
              // Adjust for paused periods
              const streamIdStr = id.toString();
              const isPaused = pausedStreams.includes(streamIdStr);
              if (isPaused || pausePeriods[streamIdStr]) {
                const periods = pausePeriods[streamIdStr] || [];
                const now = Math.floor(Date.now() / 1000);
                let pausedSeconds = 0;
                
                // Calculate total paused time
                for (const period of periods) {
                  const pauseStart = period.start;
                  const pauseEnd = period.end !== null ? period.end : now;
                  pausedSeconds += (pauseEnd - pauseStart);
                }
                
                // Get recipient's individual rate from contract
                let hourlyRateWei;
                try {
                  const recipientRate = await streamFiContract.getRecipientHourlyRate(id, account);
                  hourlyRateWei = recipientRate;
                } catch (err) {
                  // Fallback to stream's average rate
                  hourlyRateWei = ethers.parseEther(stream.hourlyRate);
                }
                
                const pausedAmount = (BigInt(Math.floor(pausedSeconds)) * hourlyRateWei) / 3600n;
                
                // Subtract paused amount from reward
                if (reward > pausedAmount) {
                  reward = reward - pausedAmount;
                } else {
                  reward = 0n;
                }
              }
              
              accumulated = ethers.formatEther(reward);
            } catch (err) {
              console.warn('Error calculating reward:', err);
            }
          }

          return {
            id: id.toString(),
            creator: stream.creator,
            hourlyRate: ethers.formatEther(stream.hourlyRate),
            duration: Number(stream.duration),
            startTime: Number(stream.startTime),
            endTime: endTime,
            recipients: stream.recipients,
            totalFunded: ethers.formatEther(stream.totalFunded),
            totalDistributed: ethers.formatEther(stream.totalDistributed),
            isActive: actuallyActive, // Use calculated active status
            isCreator,
            isRecipient,
            accumulated
          };
        } catch (err) {
          console.warn(`Error loading stream ${id}:`, err);
          return null;
        }
      });

      const loadedStreams = await Promise.all(streamPromises);
      setStreams(loadedStreams.filter(s => s !== null));
      
      // Load individual rates from contract for all streams
      try {
        const updatedRates = { ...recipientRates };
        for (const stream of loadedStreams.filter(s => s !== null)) {
          const streamIdStr = stream.id;
          if (!updatedRates[streamIdStr]) {
            updatedRates[streamIdStr] = {};
          }
          // Load rates for all recipients in this stream
          for (const recipientAddr of stream.recipients) {
            try {
              const rate = await streamFiContract.getRecipientHourlyRate(streamIdStr, recipientAddr);
              updatedRates[streamIdStr][recipientAddr.toLowerCase()] = ethers.formatEther(rate);
            } catch (err) {
              // If individual rate not found or error, use average rate
              if (!updatedRates[streamIdStr][recipientAddr.toLowerCase()]) {
                updatedRates[streamIdStr][recipientAddr.toLowerCase()] = stream.hourlyRate;
              }
            }
          }
        }
        setRecipientRates(updatedRates);
        localStorage.setItem('streamfi_recipient_rates', JSON.stringify(updatedRates));
      } catch (err) {
        console.warn('Error loading recipient rates:', err);
      }
      
      setError(''); // Clear error on success
    } catch (err) {
      console.error('Error loading streams:', err);
      let errorMessage = 'Failed to load streams';
      
      if (err.code === 'CALL_EXCEPTION' || err.message?.includes('missing revert data')) {
        errorMessage = 'Contract call failed. Please ensure you are connected to Ethereum Mainnet network and the contract is deployed.';
      } else if (err.message) {
        errorMessage = `Failed to load streams: ${err.message}`;
      }
      
      setError(errorMessage);
    }
  };


  const addRecipient = () => {
    setRecipients([...recipients, { address: '', amount: '' }]);
  };

  const removeRecipient = (index) => {
    const newRecipients = recipients.filter((_, i) => i !== index);
    setRecipients(newRecipients.length > 0 ? newRecipients : [{ address: '', amount: '' }]);
  };

  const updateRecipient = (index, field, value) => {
    const newRecipients = [...recipients];
    newRecipients[index] = { ...newRecipients[index], [field]: value };
    setRecipients(newRecipients);
  };

  // Duration presets in hours
  const durationPresets = {
    week: 168,      // 7 days * 24 hours
    month: 720,     // 30 days * 24 hours
    quarter: 2160,  // 90 days * 24 hours
    year: 8760      // 365 days * 24 hours
  };

  const handleDurationTypeChange = (type) => {
    setDurationType(type);
    if (type !== 'custom') {
      setDuration(durationPresets[type].toString());
    } else {
      setDuration('24');
    }
  };

  // Address book functions
  const saveRecipient = () => {
    if (!newRecipientName.trim() || !ethers.isAddress(newRecipientAddress)) {
      setError('Please enter a valid name and address');
      return;
    }
    const newRecipient = {
      id: Date.now().toString(),
      name: newRecipientName.trim(),
      address: newRecipientAddress.toLowerCase(),
      createdAt: new Date().toISOString()
    };
    const updated = [...savedRecipients, newRecipient];
    setSavedRecipients(updated);
    localStorage.setItem('streamfi_recipients', JSON.stringify(updated));
    setNewRecipientName('');
    setNewRecipientAddress('');
    setShowAddressBook(false);
  };

  const deleteRecipient = (id) => {
    const updated = savedRecipients.filter(r => r.id !== id);
    setSavedRecipients(updated);
    localStorage.setItem('streamfi_recipients', JSON.stringify(updated));
  };

  const addRecipientFromBook = (address) => {
    const newRecipients = [...recipients];
    if (newRecipients[newRecipients.length - 1].address === '') {
      newRecipients[newRecipients.length - 1] = { address, amount: hourlyRate || '' };
    } else {
      newRecipients.push({ address, amount: hourlyRate || '' });
    }
    setRecipients(newRecipients);
  };

  // Template functions
  const applyTemplate = (template) => {
    setHourlyRate(template.hourlyRate);
    setDurationType(template.durationType);
    if (template.durationType !== 'custom') {
      setDuration(durationPresets[template.durationType].toString());
    } else {
      setDuration(template.duration || '24');
    }
    setSelectedTemplate(template.id);
    // Reset recipients to use default hourly rate
    setRecipients([{ address: '', amount: '' }]);
  };

  const saveAsTemplate = () => {
    if (!hourlyRate || !duration) {
      setError('Please fill in hourly rate and duration to save as template');
      return;
    }
    const templateName = prompt('Enter template name:');
    if (!templateName) return;
    
    const newTemplate = {
      id: Date.now().toString(),
      name: templateName,
      hourlyRate,
      durationType,
      duration: durationType === 'custom' ? duration : durationPresets[durationType].toString(),
      description: `Template: ${templateName}`
    };
    const updated = [...templates, newTemplate];
    setTemplates(updated);
    localStorage.setItem('streamfi_templates', JSON.stringify(updated));
    alert('Template saved!');
  };

  // Copy to clipboard utility
  const copyToClipboard = (text, label = 'Text') => {
    navigator.clipboard.writeText(text).then(() => {
      // Show temporary success message
      const originalError = error;
      setError(`${label} copied to clipboard!`);
      setTimeout(() => setError(originalError), 2000);
    }).catch(() => {
      setError(`Failed to copy ${label}`);
    });
  };

  // Stream management functions
  const toggleHideStream = (streamId) => {
    const streamIdStr = streamId.toString();
    const updated = hiddenStreams.includes(streamIdStr)
      ? hiddenStreams.filter(id => id !== streamIdStr)
      : [...hiddenStreams, streamIdStr];
    setHiddenStreams(updated);
    localStorage.setItem('streamfi_hidden_streams', JSON.stringify(updated));
  };

  const togglePauseStream = (streamId) => {
    const streamIdStr = streamId.toString();
    const stream = streams.find(s => s.id === streamIdStr);
    if (!stream || !stream.isActive) {
      setError('Can only pause active streams');
      return;
    }
    
    const isCurrentlyPaused = pausedStreams.includes(streamIdStr);
    const now = Math.floor(Date.now() / 1000);
    
    // Update pause periods
    const updatedPausePeriods = { ...pausePeriods };
    if (!updatedPausePeriods[streamIdStr]) {
      updatedPausePeriods[streamIdStr] = [];
    }
    
    if (isCurrentlyPaused) {
      // Resuming - close the last pause period
      const periods = updatedPausePeriods[streamIdStr];
      if (periods.length > 0 && periods[periods.length - 1].end === null) {
        periods[periods.length - 1].end = now;
      }
      const updated = pausedStreams.filter(id => id !== streamIdStr);
      setPausedStreams(updated);
      localStorage.setItem('streamfi_paused_streams', JSON.stringify(updated));
      setError('Stream resumed');
    } else {
      // Pausing - start a new pause period
      updatedPausePeriods[streamIdStr].push({ start: now, end: null });
      const updated = [...pausedStreams, streamIdStr];
      setPausedStreams(updated);
      localStorage.setItem('streamfi_paused_streams', JSON.stringify(updated));
      setError('Stream paused - payments will not accumulate during pause');
    }
    
    setPausePeriods(updatedPausePeriods);
    localStorage.setItem('streamfi_pause_periods', JSON.stringify(updatedPausePeriods));
  };

  const removeRecipientFromStream = (streamId, recipientAddress) => {
    const stream = streams.find(s => s.id === streamId.toString());
    if (!stream) return;
    
    if (stream.isActive) {
      setError('Cannot remove recipients from active streams. Create a new stream without this recipient.');
      return;
    }

    const key = `${streamId}_${recipientAddress.toLowerCase()}`;
    const isCurrentlyRemoved = removedRecipients[key];
    const updated = isCurrentlyRemoved 
      ? { ...removedRecipients }
      : { ...removedRecipients, [key]: true };
    
    if (isCurrentlyRemoved) {
      delete updated[key];
    }
    
    setRemovedRecipients(updated);
    localStorage.setItem('streamfi_removed_recipients', JSON.stringify(updated));
    setError(isCurrentlyRemoved 
      ? 'Recipient restored' 
      : 'Recipient marked as removed. Note: This is client-side only. Create a new stream to actually remove them.');
  };

  // Filter streams based on hidden state
  const getVisibleStreams = (streamList) => {
    return streamList.filter(s => !hiddenStreams.includes(s.id));
  };

  // Calculate analytics - user's streams
  const calculateAnalytics = () => {
    const myStreams = streams.filter(s => s.isCreator);
    const visibleStreams = getVisibleStreams(myStreams);
    const activeStreams = visibleStreams.filter(s => s.isActive);
    const pausedStreamsList = visibleStreams.filter(s => pausedStreams.includes(s.id) && s.isActive);
    
    const totalFunded = visibleStreams.reduce((sum, s) => sum + parseFloat(s.totalFunded || 0), 0);
    const totalDistributed = visibleStreams.reduce((sum, s) => sum + parseFloat(s.totalDistributed || 0), 0);
    const totalRecipients = visibleStreams.reduce((sum, s) => sum + s.recipients.length, 0);
    const totalStreams = visibleStreams.length;
    
    const avgStreamValue = totalStreams > 0 ? totalFunded / totalStreams : 0;
    const avgRecipientsPerStream = totalStreams > 0 ? totalRecipients / totalStreams : 0;
    
    // Calculate distribution rate
    const distributionRate = totalFunded > 0 ? (totalDistributed / totalFunded) * 100 : 0;
    
    // Calculate by time period
    const now = Date.now();
    const last24h = visibleStreams.filter(s => s.isActive && s.startTime && (now - s.startTime * 1000) < 86400000);
    const last7d = visibleStreams.filter(s => s.isActive && s.startTime && (now - s.startTime * 1000) < 604800000);
    const last30d = visibleStreams.filter(s => s.isActive && s.startTime && (now - s.startTime * 1000) < 2592000000);
    
    return {
      totalStreams,
      activeStreams: activeStreams.length,
      pausedStreams: pausedStreamsList.length,
      inactiveStreams: visibleStreams.filter(s => !s.isActive).length,
      totalFunded,
      totalDistributed,
      totalRemaining: totalFunded - totalDistributed,
      totalRecipients,
      avgStreamValue,
      avgRecipientsPerStream,
      distributionRate,
      streamsLast24h: last24h.length,
      streamsLast7d: last7d.length,
      streamsLast30d: last30d.length
    };
  };

  // Calculate overall app statistics (all streams)
  const calculateOverallStats = () => {
    const allStreams = streams;
    const allActiveStreams = allStreams.filter(s => s.isActive);
    const allPausedStreams = allStreams.filter(s => pausedStreams.includes(s.id) && s.isActive);
    
    const overallTotalFunded = allStreams.reduce((sum, s) => sum + parseFloat(s.totalFunded || 0), 0);
    const overallTotalDistributed = allStreams.reduce((sum, s) => sum + parseFloat(s.totalDistributed || 0), 0);
    const overallTotalRecipients = allStreams.reduce((sum, s) => sum + s.recipients.length, 0);
    const overallTotalStreams = allStreams.length;
    
    const overallAvgStreamValue = overallTotalStreams > 0 ? overallTotalFunded / overallTotalStreams : 0;
    const overallAvgRecipientsPerStream = overallTotalStreams > 0 ? overallTotalRecipients / overallTotalStreams : 0;
    const overallDistributionRate = overallTotalFunded > 0 ? (overallTotalDistributed / overallTotalFunded) * 100 : 0;
    
    // Calculate unique creators and recipients
    const uniqueCreators = new Set(allStreams.map(s => s.creator.toLowerCase()));
    const uniqueRecipients = new Set();
    allStreams.forEach(s => {
      s.recipients.forEach(r => uniqueRecipients.add(r.toLowerCase()));
    });
    
    // Calculate by time period for all streams
    const now = Date.now();
    const overallLast24h = allStreams.filter(s => s.isActive && s.startTime && (now - s.startTime * 1000) < 86400000);
    const overallLast7d = allStreams.filter(s => s.isActive && s.startTime && (now - s.startTime * 1000) < 604800000);
    const overallLast30d = allStreams.filter(s => s.isActive && s.startTime && (now - s.startTime * 1000) < 2592000000);
    
    return {
      totalStreams: overallTotalStreams,
      activeStreams: allActiveStreams.length,
      pausedStreams: allPausedStreams.length,
      inactiveStreams: allStreams.filter(s => !s.isActive).length,
      totalFunded: overallTotalFunded,
      totalDistributed: overallTotalDistributed,
      totalRemaining: overallTotalFunded - overallTotalDistributed,
      totalRecipients: overallTotalRecipients,
      uniqueCreators: uniqueCreators.size,
      uniqueRecipients: uniqueRecipients.size,
      avgStreamValue: overallAvgStreamValue,
      avgRecipientsPerStream: overallAvgRecipientsPerStream,
      distributionRate: overallDistributionRate,
      streamsLast24h: overallLast24h.length,
      streamsLast7d: overallLast7d.length,
      streamsLast30d: overallLast30d.length
    };
  };

  const analytics = calculateAnalytics();
  const overallStats = calculateOverallStats();

  // Calculate stream preview
  const calculateStreamPreview = () => {
    if (!duration || recipients.length === 0 || recipients[0].address.trim() === '') {
      return null;
    }
    const validRecipients = recipients.filter(r => r.address.trim() !== '');
    if (validRecipients.length === 0) return null;
    
    try {
      const durationHours = parseInt(duration) || 0;
      let totalAmount = 0n;
      const recipientAmounts = [];
      
      // Calculate total based on individual hourly rates or default hourly rate
      for (const recipient of validRecipients) {
        let totalRecipientAmount = 0n;
        if (recipient.amount && recipient.amount.trim() !== '') {
          // Use individual hourly rate - treat as MNEE per hour
          const hourlyRateWei = ethers.parseEther(recipient.amount);
          totalRecipientAmount = hourlyRateWei * BigInt(durationHours);
        } else if (hourlyRate && hourlyRate.trim() !== '') {
          // Use default hourly rate
          const hourlyRateWei = ethers.parseEther(hourlyRate);
          totalRecipientAmount = hourlyRateWei * BigInt(durationHours);
        } else {
          return null; // Need either individual hourly rate or default hourly rate
        }
        totalAmount += totalRecipientAmount;
        recipientAmounts.push(ethers.formatEther(totalRecipientAmount));
      }
      
      const totalAmountFormatted = ethers.formatEther(totalAmount);
      const now = Date.now();
      const endTime = now + (durationHours * 60 * 60 * 1000);
      
      return {
        hourlyRate: hourlyRate ? parseFloat(hourlyRate) : null,
        duration: durationHours,
        recipients: validRecipients.length,
        totalAmount: totalAmountFormatted,
        recipientAmounts,
        endDate: new Date(endTime),
        isValid: totalAmount > 0n && durationHours > 0 && validRecipients.length > 0
      };
    } catch {
      return null;
    }
  };

  const streamPreview = calculateStreamPreview();

  // Generate and show receipt in modal
  const showReceipt = (streamId, streamData, txHash, txReceipt) => {
    setReceiptData({ streamId, streamData, txHash, txReceipt });
    setShowReceiptModal(true);
  };

  // Generate receipt HTML content
  const generateReceiptContent = (streamId, streamData, txHash, txReceipt) => {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Stream Funding Receipt - Stream #${streamId}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      color: #333;
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #4CAF50;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      color: #4CAF50;
      margin: 0;
    }
    .receipt-info {
      background: #f5f5f5;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #ddd;
    }
    .info-row:last-child {
      border-bottom: none;
    }
    .label {
      font-weight: bold;
      color: #666;
    }
    .value {
      color: #333;
      word-break: break-all;
    }
    .section {
      margin: 20px 0;
    }
    .section h3 {
      color: #4CAF50;
      border-bottom: 2px solid #4CAF50;
      padding-bottom: 5px;
    }
    .recipients-list {
      background: #f9f9f9;
      padding: 15px;
      border-radius: 5px;
      margin-top: 10px;
    }
    .recipient-item {
      padding: 5px 0;
      font-family: monospace;
      font-size: 0.9em;
    }
    .total {
      background: #4CAF50;
      color: white;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
      font-size: 1.2em;
      font-weight: bold;
      margin-top: 20px;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      color: #666;
      font-size: 0.9em;
    }
    @media print {
      body {
        padding: 0;
      }
      .no-print {
        display: none;
      }
    }
    .print-btn {
      background: #4CAF50;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
      margin: 20px 0;
    }
    .print-btn:hover {
      background: #45a049;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>StreamFi Payment Receipt</h1>
    <p>Stream Funding Confirmation</p>
  </div>

  <div class="receipt-info">
    <div class="info-row">
      <span class="label">Receipt Date:</span>
      <span class="value">${new Date().toLocaleString()}</span>
    </div>
    <div class="info-row">
      <span class="label">Stream ID:</span>
      <span class="value">#${streamId}</span>
    </div>
    <div class="info-row">
      <span class="label">Transaction Hash:</span>
      <span class="value">${txHash}</span>
    </div>
    <div class="info-row">
      <span class="label">Block Number:</span>
      <span class="value">${txReceipt?.blockNumber || 'N/A'}</span>
    </div>
    <div class="info-row">
      <span class="label">Network:</span>
      <span class="value">Ethereum Mainnet</span>
    </div>
  </div>

  <div class="section">
    <h3>Stream Details</h3>
    <div class="info-row">
      <span class="label">Creator Address:</span>
      <span class="value">${streamData.creator}</span>
    </div>
    ${streamData.recipientsWithRates && streamData.recipientsWithRates.length > 0 && 
      streamData.recipientsWithRates.some(r => parseFloat(r.hourlyRate) !== parseFloat(streamData.hourlyRate)) 
      ? `
    <div class="info-row">
      <span class="label">Hourly Rates (Individual):</span>
      <span class="value"></span>
    </div>
    ${streamData.recipientsWithRates.map((r, idx) => `
      <div class="info-row" style="padding-left: 20px;">
        <span class="label">Recipient ${idx + 1} (${r.address.slice(0, 6)}...${r.address.slice(-4)}):</span>
        <span class="value">${parseFloat(r.hourlyRate).toFixed(4)} MNEE/hour</span>
      </div>
    `).join('')}
      `
      : `
    <div class="info-row">
      <span class="label">Hourly Rate:</span>
      <span class="value">${parseFloat(streamData.hourlyRate).toFixed(4)} MNEE/hour</span>
    </div>
      `
    }
    <div class="info-row">
      <span class="label">Duration:</span>
      <span class="value">${streamData.duration} hours (${(streamData.duration / 24).toFixed(1)} days)</span>
    </div>
    <div class="info-row">
      <span class="label">Number of Recipients:</span>
      <span class="value">${streamData.recipients.length}</span>
    </div>
    <div class="info-row">
      <span class="label">Start Time:</span>
      <span class="value">${new Date(streamData.startTime * 1000).toLocaleString()}</span>
    </div>
    <div class="info-row">
      <span class="label">End Time:</span>
      <span class="value">${new Date(streamData.endTime * 1000).toLocaleString()}</span>
    </div>
  </div>

  <div class="section">
    <h3>Recipients</h3>
    <div class="recipients-list">
      ${streamData.recipientsWithRates && streamData.recipientsWithRates.length > 0
        ? streamData.recipientsWithRates.map((r, idx) => `
          <div class="recipient-item">${idx + 1}. ${r.address} <strong>(${parseFloat(r.hourlyRate).toFixed(4)} MNEE/hour)</strong></div>
        `).join('')
        : streamData.recipients.map((addr, idx) => `
          <div class="recipient-item">${idx + 1}. ${addr}</div>
        `).join('')
      }
    </div>
  </div>

  <div class="section">
    <h3>Payment Summary</h3>
    <div class="info-row">
      <span class="label">Total Amount Funded:</span>
      <span class="value">${parseFloat(streamData.totalFunded).toFixed(4)} MNEE</span>
    </div>
    ${streamData.recipientsWithRates && streamData.recipientsWithRates.length > 0 && 
      streamData.recipientsWithRates.some(r => parseFloat(r.hourlyRate) !== parseFloat(streamData.hourlyRate))
      ? `
    <div class="info-row">
      <span class="label">Calculation (per recipient):</span>
      <span class="value"></span>
    </div>
    ${streamData.recipientsWithRates.map((r, idx) => {
      const recipientTotal = parseFloat(r.hourlyRate) * streamData.duration;
      return `
      <div class="info-row" style="padding-left: 20px;">
        <span class="label">Recipient ${idx + 1}:</span>
        <span class="value">${parseFloat(r.hourlyRate).toFixed(4)} MNEE/h × ${streamData.duration}h = ${recipientTotal.toFixed(4)} MNEE</span>
      </div>
      `;
    }).join('')}
      `
      : `
    <div class="info-row">
      <span class="label">Calculation:</span>
      <span class="value">${parseFloat(streamData.hourlyRate).toFixed(4)} MNEE/hour × ${streamData.duration} hours × ${streamData.recipients.length} recipients</span>
    </div>
      `
    }
  </div>

  <div class="total">
    Total Payment: ${parseFloat(streamData.totalFunded).toFixed(4)} MNEE
  </div>

  <div class="footer">
    <p>This is a digital receipt for your StreamFi payment stream funding.</p>
    <p>Transaction verified on Ethereum Mainnet</p>
    <p>Generated on ${new Date().toLocaleString()}</p>
  </div>

  <div class="no-print" style="text-align: center;">
    <button class="print-btn" onclick="window.print()">Print Receipt</button>
  </div>
</body>
</html>
    `;
    
  };

  const handleCreateStream = async (e) => {
    e.preventDefault();

    if (!isConnected || !account) {
      setError('Please connect your wallet');
      return;
    }

    if (!duration || recipients.length === 0 || recipients[0].address.trim() === '') {
      setError('Please fill in all fields');
      return;
    }

    try {
      setLoading(true);
      setError('');

      // Validate recipients
      const validRecipients = recipients.filter(r => r.address.trim() !== '');
      if (validRecipients.length === 0) {
        throw new Error('Please add at least one recipient');
      }

      // Validate addresses and amounts
      const recipientAddresses = [];
      let totalAmount = 0n;
      const durationHours = parseInt(duration) || 0;
      
      if (durationHours <= 0) {
        throw new Error('Duration must be greater than 0');
      }

      // Check if using individual amounts or hourly rate
      const hasIndividualAmounts = validRecipients.some(r => r.amount && r.amount.trim() !== '');
      const hasHourlyRate = hourlyRate && hourlyRate.trim() !== '';
      
      if (!hasIndividualAmounts && !hasHourlyRate) {
        throw new Error('Please provide either hourly rate or individual amounts for recipients');
      }

      // Prepare hourly rates array for contract
      const hourlyRatesArray = [];
      const individualRates = {}; // Store individual rates per recipient
      
      if (hasIndividualAmounts) {
        for (const recipient of validRecipients) {
          if (!ethers.isAddress(recipient.address)) {
            throw new Error(`Invalid recipient address: ${recipient.address}`);
          }
          if (!recipient.amount || recipient.amount.trim() === '') {
            throw new Error(`Please provide hourly rate for recipient: ${recipient.address}`);
          }
          recipientAddresses.push(recipient.address);
          // Treat recipient.amount as hourly rate (MNEE per hour)
          const hourlyRateWei = ethers.parseEther(recipient.amount);
          if (hourlyRateWei <= 0n) {
            throw new Error(`Hourly rate must be greater than 0 for recipient: ${recipient.address}`);
          }
          // Store individual rate for this recipient
          individualRates[recipient.address.toLowerCase()] = recipient.amount;
          hourlyRatesArray.push(hourlyRateWei);
          // Calculate total amount for this recipient: hourly rate * duration
          const recipientTotalAmount = hourlyRateWei * BigInt(durationHours);
          totalAmount += recipientTotalAmount;
        }
      } else {
        // Use hourly rate for all
        const hourlyRateWei = ethers.parseEther(hourlyRate);
        if (hourlyRateWei <= 0n) {
          throw new Error('Hourly rate must be greater than 0');
        }
        for (const recipient of validRecipients) {
          if (!ethers.isAddress(recipient.address)) {
            throw new Error(`Invalid recipient address: ${recipient.address}`);
          }
          recipientAddresses.push(recipient.address);
          // Store the same rate for all recipients
          individualRates[recipient.address.toLowerCase()] = hourlyRate;
          hourlyRatesArray.push(hourlyRateWei);
        }
        totalAmount = hourlyRateWei * BigInt(durationHours) * BigInt(validRecipients.length);
      }

      // Get provider and signer
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // Create stream with individual rates
      console.log('Creating stream:', { hourlyRates: hourlyRatesArray.map(r => r.toString()), durationHours, recipientAddresses });
      const tx = await streamFiContract.createStream(hourlyRatesArray, durationHours, recipientAddresses);
      console.log('Stream creation transaction:', tx.hash);

      await Promise.race([
        tx.wait(1),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Transaction timeout')), 120000)
        )
      ]);

      // Store individual rates for this stream (for UI display)
      const receipt = await tx.wait(1);
      const streamId = await streamFiContract.streamCount();
      const updatedRates = { ...recipientRates };
      updatedRates[streamId.toString()] = individualRates;
      setRecipientRates(updatedRates);
      localStorage.setItem('streamfi_recipient_rates', JSON.stringify(updatedRates));

      await loadStreams();

      // Reset form
      setHourlyRate('');
      setDurationType('custom');
      setDuration('24');
      setRecipients([{ address: '', amount: '' }]);
      setSelectedTemplate('');

      alert('Stream created successfully! Now fund it to activate.');
      handleTabChange('my-streams');
    } catch (err) {
      console.error('Error creating stream:', err);
      let errorMessage = 'Failed to create stream';

      if (err.code === 'ACTION_REJECTED' || err.code === 4001 || err?.info?.error?.code === 4001 || err.message?.includes('user rejected')) {
        errorMessage = 'Transaction cancelled by user';
      } else if (err.reason) {
        errorMessage = err.reason;
      } else if (err.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleFundStream = async (streamId) => {
    if (!isConnected || !account) {
      setError('Please connect your wallet');
      return;
    }

    try {
      setLoading(true);
      setError('');

      // Get stream details
      const stream = await streamFiContract.getStream(streamId);
      const requiredAmount = stream.hourlyRate * BigInt(stream.duration) * BigInt(stream.recipients.length);

      // Get provider and signer
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // Approve tokens
      const tokenConfig = TOKEN_CONFIG.mnee;
      const tokenContract = new ethers.Contract(
        tokenConfig.contractAddress,
        ERC20_ABI,
        signer
      );

      // Check and handle approval
      const currentAllowance = await tokenContract.allowance(account, contractAddress);
      if (currentAllowance < requiredAmount) {
        console.log('Approving tokens...');
        setNeedsApproval(true);

        try {
          // Estimate gas for approval
          let approveGasLimit = 100000n;
          try {
            const estimateGas = await tokenContract.approve.estimateGas(contractAddress, ethers.MaxUint256);
            approveGasLimit = estimateGas + (estimateGas / 5n);
          } catch (gasError) {
            console.warn('Gas estimation failed, using default');
          }

          const approveTx = await tokenContract.approve(contractAddress, ethers.MaxUint256, {
            gasLimit: approveGasLimit
          });
          console.log('Approval transaction sent:', approveTx.hash);

          try {
            await Promise.race([
              approveTx.wait(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Approval timeout')), 90000)
              )
            ]);
            console.log('Approval confirmed');
            setNeedsApproval(false);
          } catch (waitError) {
            console.warn('Approval wait failed:', waitError);
            await new Promise(resolve => setTimeout(resolve, 5000));
            const newAllowance = await tokenContract.allowance(account, contractAddress);
            if (newAllowance >= requiredAmount) {
              console.log('Approval succeeded despite wait error');
              setNeedsApproval(false);
            } else {
              await new Promise(resolve => setTimeout(resolve, 10000));
              const finalAllowance = await tokenContract.allowance(account, contractAddress);
              if (finalAllowance >= requiredAmount) {
                console.log('Approval succeeded after additional wait');
                setNeedsApproval(false);
              } else {
                throw new Error('Token approval is taking longer than expected. Please check MetaMask and try again.');
              }
            }
          }
        } catch (approveError) {
          console.error('Approval error:', approveError);
          setNeedsApproval(false);

          if (approveError.transaction || approveError.receipt) {
            console.log('Transaction was sent, checking if it succeeded...');
            for (let i = 0; i < 6; i++) {
              await new Promise(resolve => setTimeout(resolve, 5000));
              try {
                const checkAllowance = await tokenContract.allowance(account, contractAddress);
                if (checkAllowance >= requiredAmount) {
                  console.log('Approval succeeded after checking');
                  break;
                }
                if (i === 5) {
                  throw new Error('Token approval may have failed. Please check MetaMask and try again.');
                }
              } catch (checkError) {
                console.warn('Error checking allowance:', checkError);
              }
            }
          } else if (approveError.code === 'UNKNOWN_ERROR' || approveError.code === -32603) {
            console.log('RPC error during approval, checking if it succeeded...');
            let approvalConfirmed = false;
            for (let attempt = 0; attempt < 6; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 5000 + (attempt * 2000)));
              try {
                const checkAllowance = await tokenContract.allowance(account, contractAddress);
                if (checkAllowance >= requiredAmount) {
                  console.log('Approval succeeded despite RPC error');
                  approvalConfirmed = true;
                  break;
                }
              } catch (checkError) {
                console.warn('Error checking allowance:', checkError);
              }
            }

            if (!approvalConfirmed) {
              try {
                const finalAllowance = await tokenContract.allowance(account, contractAddress);
                if (finalAllowance >= requiredAmount) {
                  console.log('Approval confirmed on final check');
                  approvalConfirmed = true;
                }
              } catch (finalError) {
                console.error('Final allowance check failed:', finalError);
              }

              if (!approvalConfirmed) {
                throw new Error('Token approval failed due to RPC error. The transaction may have succeeded on-chain - please check MetaMask transaction history.');
              }
            }
          } else if (approveError.message && (approveError.message.includes('user rejected') || approveError.message.includes('rejected'))) {
            throw new Error('Approval was rejected. Please approve the transaction to continue.');
          } else {
            throw approveError;
          }
        }
      } else {
        console.log('Sufficient allowance already exists');
        setNeedsApproval(false);
      }

      // Pre-flight check: Simulate transaction
      try {
        await streamFiContract.fundStream.staticCall(streamId);
      } catch (simError) {
        console.error('Simulation failed:', simError);
        // Try to decode the error
        let reason = simError.reason || simError.shortMessage || simError.message;
        if (reason.includes("insufficient allowance")) reason = "Insufficient token allowance";
        if (reason.includes("insufficient balance")) reason = "Insufficient token balance";
        throw new Error(`Transaction will fail: ${reason}`);
      }

      // Fund stream
      console.log('Funding stream:', streamId);
      let gasEstimate;
      try {
        gasEstimate = await streamFiContract.fundStream.estimateGas(streamId);
        console.log('Gas estimate:', gasEstimate.toString());
      } catch (estimateError) {
        // Fallback gas limit if estimation fails but simulation passed (rare)
        console.warn('Gas estimation failed, using fallback:', estimateError);
        gasEstimate = 300000n;
      }


      const gasLimit = gasEstimate + (gasEstimate / 3n);
      const tx = await streamFiContract.fundStream(streamId, {
        gasLimit: gasLimit
      });
      console.log('Fund stream transaction:', tx.hash);

      const receipt = await Promise.race([
        tx.wait(1),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Transaction timeout')), 120000)
        )
      ]);

      await loadStreams();
      
      // Get updated stream data for receipt
      const updatedStream = await streamFiContract.getStream(streamId);
      
      // Get individual rates from contract
      const recipientsWithRates = [];
      for (const recipientAddr of updatedStream.recipients) {
        try {
          const rate = await streamFiContract.getRecipientHourlyRate(streamId, recipientAddr);
          recipientsWithRates.push({
            address: recipientAddr,
            hourlyRate: ethers.formatEther(rate)
          });
        } catch (err) {
          // Fallback to average rate if individual rate not found
          recipientsWithRates.push({
            address: recipientAddr,
            hourlyRate: ethers.formatEther(updatedStream.hourlyRate)
          });
        }
      }
      
      const streamData = {
        creator: updatedStream.creator,
        hourlyRate: ethers.formatEther(updatedStream.hourlyRate),
        duration: Number(updatedStream.duration),
        startTime: Number(updatedStream.startTime),
        endTime: Number(updatedStream.endTime),
        recipients: updatedStream.recipients,
        recipientsWithRates: recipientsWithRates,
        totalFunded: ethers.formatEther(updatedStream.totalFunded),
        totalDistributed: ethers.formatEther(updatedStream.totalDistributed),
        isActive: updatedStream.isActive
      };
      
      // Show receipt in modal with individual rates
      showReceipt(streamId, streamData, tx.hash, receipt);
      alert('Stream funded successfully!');
    } catch (err) {
      console.error('Error funding stream:', err);
      let errorMessage = 'Failed to fund stream';

      if (err.code === 'ACTION_REJECTED' || err.code === 4001 || err?.info?.error?.code === 4001 || err.message?.includes('user rejected')) {
        errorMessage = 'Transaction cancelled by user';
      } else if (err.reason) {
        errorMessage = err.reason;
      } else if (err.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleClaimReward = async (streamId) => {
    if (!isConnected || !account) {
      setError('Please connect your wallet');
      return;
    }

    try {
      setLoading(true);
      setError('');

      let gasEstimate;
      try {
        gasEstimate = await streamFiContract.claimReward.estimateGas(streamId);
        console.log('Gas estimate:', gasEstimate.toString());
      } catch (estimateError) {
        console.error('Gas estimation failed:', estimateError);
        throw new Error(estimateError.reason || 'No rewards to claim or transaction would fail.');
      }

      const gasLimit = gasEstimate + (gasEstimate / 10n);
      const tx = await streamFiContract.claimReward(streamId, {
        gasLimit: gasLimit
      });
      console.log('Claim reward transaction:', tx.hash);

      await Promise.race([
        tx.wait(1),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Transaction timeout')), 120000)
        )
      ]);

      await loadStreams();
      alert('Reward claimed successfully!');
    } catch (err) {
      console.error('Error claiming reward:', err);
      let errorMessage = 'Failed to claim reward';

      if (err.code === 'ACTION_REJECTED' || err.code === 4001 || err?.info?.error?.code === 4001 || err.message?.includes('user rejected')) {
        errorMessage = 'Transaction cancelled by user';
      } else if (err.reason) {
        errorMessage = err.reason;
      } else if (err.message) {
        errorMessage = err.message;
      } else if (err.code === 'UNKNOWN_ERROR' || err.code === -32603) {
        errorMessage = 'RPC error. The transaction may have succeeded - please check your balance and refresh.';
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="payment-dapp">
        <div className="header-nav">
          <div className="header-unified">
            <div className="logo-section">
              <h1>StreamFi</h1>
            </div>
            <div className="wallet-connection">
              <button 
                onClick={connectWallet} 
                className="connect-btn-nav"
                style={{
                  padding: '0.75rem 1.5rem',
                  fontSize: '1rem',
                  fontWeight: '600',
                  background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  boxShadow: '0 4px 16px rgba(99, 102, 241, 0.3)',
                  fontFamily: 'var(--font-sans)'
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 6px 20px rgba(99, 102, 241, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = '0 4px 16px rgba(99, 102, 241, 0.3)';
                }}
              >
                Connect Wallet
              </button>
            </div>
          </div>
        </div>
        <div style={{ 
          maxWidth: '1400px', 
          margin: '0 auto', 
          padding: '0 2rem',
          textAlign: 'center',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <div>
            <h1 style={{ 
              fontSize: '5.5rem', 
              marginBottom: '2rem',
              background: 'linear-gradient(135deg, #ffffff 0%, #a8b3d0 50%, #6366f1 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              fontWeight: '800',
              letterSpacing: '-0.04em',
              lineHeight: '1.1'
            }}>
              Decentralized Payment Streaming
            </h1>
            <p style={{ 
              color: 'var(--text-secondary)', 
              fontSize: '1.5rem', 
              marginBottom: '2rem',
              maxWidth: '800px',
              margin: '0 auto 2rem',
              lineHeight: '1.7',
              fontWeight: '400'
            }}>
              Automate token distributions with transparent, secure, and customizable payment streams. Perfect for payroll, subscriptions, and recurring payments.
            </p>
            <div style={{
              display: 'flex',
              gap: '1.5rem',
              justifyContent: 'center',
              flexWrap: 'wrap',
              marginTop: '3rem'
            }}>
              <div style={{
                padding: '1.5rem 2rem',
                background: 'rgba(21, 27, 51, 0.4)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                fontSize: '0.95rem',
                color: 'var(--text-secondary)'
              }}>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '0.5rem' }}>Secure</strong>
                Smart contract powered
              </div>
              <div style={{
                padding: '1.5rem 2rem',
                background: 'rgba(21, 27, 51, 0.4)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                fontSize: '0.95rem',
                color: 'var(--text-secondary)'
              }}>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '0.5rem' }}>Transparent</strong>
                Real-time tracking
              </div>
              <div style={{
                padding: '1.5rem 2rem',
                background: 'rgba(21, 27, 51, 0.4)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                fontSize: '0.95rem',
                color: 'var(--text-secondary)'
              }}>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '0.5rem' }}>Flexible</strong>
                Custom rates & recipients
              </div>
            </div>
          </div>
        </div>

        {/* Feature Cards Section - Below Hero */}
        <div style={{
          padding: '6rem 2rem',
          background: 'rgba(10, 14, 39, 0.3)'
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '2rem',
            maxWidth: '1200px',
            margin: '0 auto'
          }}>
            {/* Card 1 - Payment Streaming */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(21, 27, 51, 0.8) 0%, rgba(30, 41, 59, 0.8) 100%)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              padding: '2.5rem',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.2)',
              transition: 'all 0.3s ease',
              position: 'relative',
              overflow: 'hidden'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-4px)';
              e.currentTarget.style.boxShadow = '0 8px 32px rgba(99, 102, 241, 0.2)';
              e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 24px rgba(0, 0, 0, 0.2)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            }}
            >
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1.5rem',
                border: '1px solid rgba(99, 102, 241, 0.3)'
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#6366f1' }}>
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                </svg>
              </div>
              <h3 style={{ 
                fontSize: '1.5rem', 
                marginBottom: '1rem', 
                color: 'var(--text-primary)',
                fontWeight: '600',
                letterSpacing: '-0.01em'
              }}>
                Payment Streaming
              </h3>
              <p style={{ 
                color: 'var(--text-secondary)', 
                fontSize: '1rem', 
                lineHeight: '1.6',
                fontWeight: '400',
                margin: 0
              }}>
                Automated payment streams with customizable hourly rates. Ideal for salaries, subscriptions, and recurring payments.
              </p>
            </div>

            {/* Card 2 - Multi-Recipient */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(21, 27, 51, 0.8) 0%, rgba(30, 41, 59, 0.8) 100%)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              padding: '2.5rem',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.2)',
              transition: 'all 0.3s ease',
              position: 'relative',
              overflow: 'hidden'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-4px)';
              e.currentTarget.style.boxShadow = '0 8px 32px rgba(139, 92, 246, 0.2)';
              e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 24px rgba(0, 0, 0, 0.2)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            }}
            >
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(168, 85, 247, 0.2) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1.5rem',
                border: '1px solid rgba(139, 92, 246, 0.3)'
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#8b5cf6' }}>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <h3 style={{ 
                fontSize: '1.5rem', 
                marginBottom: '1rem', 
                color: 'var(--text-primary)',
                fontWeight: '600',
                letterSpacing: '-0.01em'
              }}>
                Multi-Recipient
              </h3>
              <p style={{ 
                color: 'var(--text-secondary)', 
                fontSize: '1rem', 
                lineHeight: '1.6',
                fontWeight: '400',
                margin: 0
              }}>
                Distribute payments to multiple recipients simultaneously with individual rate customization for each recipient.
              </p>
            </div>

            {/* Card 3 - Buy/Sell */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(21, 27, 51, 0.8) 0%, rgba(30, 41, 59, 0.8) 100%)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              padding: '2.5rem',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.2)',
              transition: 'all 0.3s ease',
              position: 'relative',
              overflow: 'hidden'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-4px)';
              e.currentTarget.style.boxShadow = '0 8px 32px rgba(245, 158, 11, 0.2)';
              e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 24px rgba(0, 0, 0, 0.2)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            }}
            >
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(217, 119, 6, 0.2) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1.5rem',
                border: '1px solid rgba(245, 158, 11, 0.3)'
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#f59e0b' }}>
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <h3 style={{ 
                fontSize: '1.5rem', 
                marginBottom: '1rem', 
                color: 'var(--text-primary)',
                fontWeight: '600',
                letterSpacing: '-0.01em'
              }}>
                Token Exchange
              </h3>
              <p style={{ 
                color: 'var(--text-secondary)', 
                fontSize: '1rem', 
                lineHeight: '1.6',
                fontWeight: '400',
                margin: 0
              }}>
                Seamless onramp and offramp functionality with fiat currency integration via mobile money for easy token exchange.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Navbar - Only visible after scrolling */}
        {showFooter && (
          <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'rgba(10, 14, 39, 0.95)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 -4px 24px rgba(0, 0, 0, 0.4)',
            zIndex: 100,
            padding: '1.25rem 0',
            transition: 'opacity 0.3s ease, transform 0.3s ease',
            opacity: showFooter ? 1 : 0,
            transform: showFooter ? 'translateY(0)' : 'translateY(100%)'
          }}>
            <div style={{
              maxWidth: '1200px',
              margin: '0 auto',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '3rem',
              padding: '0 2rem'
            }}>
              {/* X (Twitter) */}
              <a
                href="https://twitter.com/streamfi"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: 'rgba(21, 27, 51, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'var(--text-secondary)',
                  transition: 'all 0.3s ease',
                  textDecoration: 'none'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(29, 161, 242, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(29, 161, 242, 0.5)';
                  e.currentTarget.style.color = '#1da1f2';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(21, 27, 51, 0.6)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </a>

              {/* Telegram */}
              <a
                href="https://t.me/streamfi"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: 'rgba(21, 27, 51, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'var(--text-secondary)',
                  transition: 'all 0.3s ease',
                  textDecoration: 'none'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(37, 150, 190, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(37, 150, 190, 0.5)';
                  e.currentTarget.style.color = '#2596be';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(21, 27, 51, 0.6)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.166 1.816-1.03 6.509-1.455 8.627-.172.907-.512 1.209-.84 1.24-.712.062-1.25-.469-1.938-.919-1.078-.703-1.687-1.14-2.732-1.826-1.21-.78-.426-1.21.264-1.91.181-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.062 3.345-.479.329-.913.489-1.302.481-.428-.008-1.252-.241-1.865-.44-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.559.1.014.321.06.465.277.12.18.155.413.108.644z"/>
                </svg>
              </a>

              {/* Discord */}
              <a
                href="https://discord.gg/streamfi"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: 'rgba(21, 27, 51, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'var(--text-secondary)',
                  transition: 'all 0.3s ease',
                  textDecoration: 'none'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(88, 101, 242, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(88, 101, 242, 0.5)';
                  e.currentTarget.style.color = '#5865f2';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(21, 27, 51, 0.6)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
              </a>

              {/* Documentation */}
              <a
                href="https://docs.streamfi.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: 'rgba(21, 27, 51, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'var(--text-secondary)',
                  transition: 'all 0.3s ease',
                  textDecoration: 'none'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(99, 102, 241, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.5)';
                  e.currentTarget.style.color = '#6366f1';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(21, 27, 51, 0.6)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                </svg>
              </a>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="payment-dapp">
      {/* Unified Header with Navigation */}
      <div className="header-nav">
        <div className="header-unified">
          {/* Logo - Left */}
          <div className="logo-section">
            <h1>StreamFi</h1>
          </div>
          
          {/* Navigation - Center */}
          {isConnected && (
            <nav className="main-nav">
              <button
                className={`nav-item ${activeTab === 'create' ? 'active' : ''}`}
                onClick={() => handleTabChange('create')}
              >
                Create Stream
              </button>
              <button
                className={`nav-item ${activeTab === 'my-streams' ? 'active' : ''}`}
                onClick={() => handleTabChange('my-streams')}
              >
                My Streams
              </button>
              <button
                className={`nav-item ${activeTab === 'claim' ? 'active' : ''}`}
                onClick={() => handleTabChange('claim')}
              >
                Claim Rewards
              </button>
              <button
                className={`nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
                onClick={() => handleTabChange('analytics')}
              >
                Analytics
              </button>
              <button
                className={`nav-item ${activeTab === 'buy-sell' ? 'active' : ''}`}
                onClick={() => handleTabChange('buy-sell')}
              >
                Buy/Sell
              </button>
              <button
                className={`nav-item ${activeTab === 'admin' ? 'active' : ''}`}
                onClick={() => handleTabChange('admin')}
              >
                Admin
              </button>
            </nav>
          )}
          
          {/* Wallet Info - Right */}
          {isConnected && (
            <div className="wallet-connection">
              <div className="wallet-display">
                <span className="wallet-address">{account?.slice(0, 6)}...{account?.slice(-4)}</span>
                <span className="wallet-balance">{parseFloat(balance || 0).toFixed(4)} MNEE</span>
              </div>
              <button
                onClick={disconnectWallet}
                className="disconnect-btn"
                style={{
                  padding: '0.75rem 1.25rem',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  fontFamily: 'var(--font-sans)',
                  marginLeft: '0.75rem'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'rgba(239, 68, 68, 0.2)';
                  e.target.style.borderColor = 'rgba(239, 68, 68, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'rgba(239, 68, 68, 0.1)';
                  e.target.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                }}
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {needsApproval && (
        <div className="info-message">
          Approving Tokens... Please wait.
        </div>
      )}

      <div className="content">
        {activeTab === 'create' && (
          <div className="create-stream">
            <div className="section-header">
              <h2 style={{ background: 'linear-gradient(135deg, #ffffff 0%, #a8b3d0 50%, #6366f1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Create New Stream</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', marginTop: '0.5rem' }}>Set up a payment stream with customizable rates for each recipient</p>
            </div>
            
            {/* Template Selection */}
            {templates.length > 0 && (
              <div style={{ 
                marginBottom: '2rem', 
                padding: '1.5rem', 
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)',
                border: '1px solid var(--border)', 
                borderRadius: 'var(--radius-lg)',
                backdropFilter: 'blur(10px)'
              }}>
                <label style={{ 
                  fontWeight: '600', 
                  marginBottom: '1rem', 
                  display: 'block', 
                  fontSize: '1.1rem', 
                  fontFamily: 'var(--font-display)',
                  color: 'var(--text-primary)'
                }}>📋 Quick Templates</label>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                  {templates.map(template => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => applyTemplate(template)}
                      style={{
                        padding: '0.75rem 1.5rem',
                        background: selectedTemplate === template.id 
                          ? 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)' 
                          : 'var(--bg-input)',
                        color: selectedTemplate === template.id ? 'white' : 'var(--text-primary)',
                        border: selectedTemplate === template.id ? 'none' : '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        fontSize: '0.95rem',
                        fontWeight: '500',
                        transition: 'all 0.2s ease',
                        boxShadow: selectedTemplate === template.id ? 'var(--shadow-sm)' : 'none'
                      }}
                      onMouseEnter={(e) => {
                        if (selectedTemplate !== template.id) {
                          e.target.style.borderColor = 'var(--primary)';
                          e.target.style.background = 'var(--bg-card)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedTemplate !== template.id) {
                          e.target.style.borderColor = 'var(--border)';
                          e.target.style.background = 'var(--bg-input)';
                        }
                      }}
                    >
                      {template.name}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={saveAsTemplate}
                  style={{
                    padding: '0.6rem 1.2rem',
                    background: 'transparent',
                    border: '1px solid var(--primary)',
                    color: 'var(--primary)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    fontWeight: '500',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.background = 'var(--primary-light)';
                    e.target.style.color = 'var(--primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = 'transparent';
                    e.target.style.color = 'var(--primary)';
                  }}
                >
                  💾 Save Current as Template
                </button>
              </div>
            )}

            <form onSubmit={handleCreateStream} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="form-group" style={{ 
                background: 'rgba(21, 27, 51, 0.4)', 
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                padding: '1.5rem', 
                borderRadius: 'var(--radius-lg)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
              }}>
                <label style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.5rem',
                  marginBottom: '0.75rem',
                  fontSize: '1.1rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)'
                }}>
                  <span>💰</span>
                  Default Hourly Rate
                </label>
                <input
                  type="number"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  placeholder="e.g., 10 MNEE/hour"
                  step="0.01"
                  min="0"
                  style={{ fontSize: '1.1rem' }}
                />
                <small style={{ 
                  color: 'var(--text-muted)', 
                  fontSize: '0.85rem', 
                  display: 'block', 
                  marginTop: '0.5rem',
                  fontStyle: 'italic'
                }}>
                  Optional: Leave empty to set individual rates per recipient below
                </small>
              </div>

              <div className="form-group" style={{ 
                background: 'rgba(21, 27, 51, 0.4)', 
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                padding: '1.5rem', 
                borderRadius: 'var(--radius-lg)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
              }}>
                <label style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.5rem',
                  marginBottom: '0.75rem',
                  fontSize: '1.1rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)'
                }}>
                  <span>⏱️</span>
                  Stream Duration
                </label>
                <select
                  value={durationType}
                  onChange={(e) => handleDurationTypeChange(e.target.value)}
                  style={{ 
                    marginBottom: '0.75rem', 
                    padding: '1rem 1.25rem', 
                    fontSize: '1.1rem',
                    background: 'var(--bg-input)',
                    border: '2px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-primary)'
                  }}
                >
                  <option value="custom">Custom (hours)</option>
                  <option value="week">1 Week (168 hours)</option>
                  <option value="month">1 Month (720 hours)</option>
                  <option value="quarter">1 Quarter (2,160 hours)</option>
                  <option value="year">1 Year (8,760 hours)</option>
                </select>
                {durationType === 'custom' ? (
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    placeholder="24"
                    min="1"
                    required
                    style={{ 
                      width: '100%', 
                      padding: '1rem 1.25rem',
                      fontSize: '1.1rem'
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    value={`${duration} hours (${(parseFloat(duration) / 24).toFixed(1)} days)`}
                    disabled
                    style={{ 
                      width: '100%', 
                      padding: '1rem 1.25rem',
                      fontSize: '1.1rem',
                      background: 'var(--bg-input)', 
                      border: '2px solid var(--border)', 
                      cursor: 'not-allowed', 
                      color: 'var(--text-muted)',
                      borderRadius: 'var(--radius-md)'
                    }}
                  />
                )}
              </div>

              <div className="form-group" style={{ 
                background: 'rgba(21, 27, 51, 0.4)', 
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                padding: '1.5rem', 
                borderRadius: 'var(--radius-lg)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <label style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem',
                    fontSize: '1.1rem',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    margin: 0
                  }}>
                    <span>👥</span>
                    Recipients
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowAddressBook(!showAddressBook)}
                    style={{
                      padding: '0.6rem 1.2rem',
                      background: showAddressBook ? 'var(--primary)' : 'var(--bg-input)',
                      color: showAddressBook ? 'white' : 'var(--text-primary)',
                      border: `1px solid ${showAddressBook ? 'var(--primary)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: '500',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {showAddressBook ? '📖 Hide' : '📖 Show'} Address Book
                  </button>
                </div>

                {/* Address Book */}
                {showAddressBook && (
                  <div style={{ 
                    marginBottom: '1.5rem', 
                    padding: '1.5rem', 
                    background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%)',
                    borderRadius: 'var(--radius-lg)', 
                    border: '1px solid var(--border)',
                    backdropFilter: 'blur(10px)'
                  }}>
                    <h4 style={{ 
                      margin: '0 0 1rem 0', 
                      fontSize: '1.1rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}>
                      <span>📚</span>
                      Saved Recipients
                    </h4>
                    {savedRecipients.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                        {savedRecipients.map(recipient => (
                          <div key={recipient.id} style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center', 
                            padding: '1rem', 
                            background: 'var(--bg-card)', 
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border)',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = 'var(--primary)';
                            e.currentTarget.style.transform = 'translateX(4px)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'var(--border)';
                            e.currentTarget.style.transform = 'translateX(0)';
                          }}
                          >
                            <div>
                              <strong style={{ color: 'var(--text-primary)', fontSize: '1rem', display: 'block', marginBottom: '0.25rem' }}>{recipient.name}</strong>
                              <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                                {recipient.address.slice(0, 10)}...{recipient.address.slice(-8)}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button
                                type="button"
                                onClick={() => addRecipientFromBook(recipient.address)}
                                style={{ 
                                  padding: '0.5rem 1rem', 
                                  background: 'var(--success)', 
                                  color: 'white', 
                                  border: 'none', 
                                  borderRadius: 'var(--radius-sm)', 
                                  cursor: 'pointer', 
                                  fontSize: '0.85rem',
                                  fontWeight: '500',
                                  transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={(e) => e.target.style.transform = 'scale(1.05)'}
                                onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
                              >
                                ➕ Add
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteRecipient(recipient.id)}
                                style={{ 
                                  padding: '0.5rem 1rem', 
                                  background: 'var(--error-bg)', 
                                  color: 'var(--error)', 
                                  border: '1px solid var(--error)', 
                                  borderRadius: 'var(--radius-sm)', 
                                  cursor: 'pointer', 
                                  fontSize: '0.85rem',
                                  fontWeight: '500',
                                  transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={(e) => {
                                  e.target.style.background = 'var(--error)';
                                  e.target.style.color = 'white';
                                }}
                                onMouseLeave={(e) => {
                                  e.target.style.background = 'var(--error-bg)';
                                  e.target.style.color = 'var(--error)';
                                }}
                              >
                                🗑️ Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: '1rem', color: 'var(--text-muted)', margin: '0 0 1rem 0', fontStyle: 'italic' }}>No saved recipients yet</p>
                    )}
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                      <input
                        type="text"
                        value={newRecipientName}
                        onChange={(e) => setNewRecipientName(e.target.value)}
                        placeholder="Recipient name"
                        style={{ 
                          flex: '1', 
                          minWidth: '150px', 
                          padding: '0.75rem 1rem', 
                          border: '2px solid var(--border)', 
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--bg-input)',
                          color: 'var(--text-primary)',
                          fontSize: '0.95rem'
                        }}
                      />
                      <input
                        type="text"
                        value={newRecipientAddress}
                        onChange={(e) => setNewRecipientAddress(e.target.value)}
                        placeholder="0x..."
                        style={{ 
                          flex: '2', 
                          minWidth: '200px', 
                          padding: '0.75rem 1rem', 
                          border: '2px solid var(--border)', 
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--bg-input)',
                          color: 'var(--text-primary)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.95rem'
                        }}
                      />
                      <button
                        type="button"
                        onClick={saveRecipient}
                        style={{ 
                          padding: '0.75rem 1.5rem', 
                          background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)', 
                          color: 'white', 
                          border: 'none', 
                          borderRadius: 'var(--radius-md)', 
                          cursor: 'pointer',
                          fontSize: '0.95rem',
                          fontWeight: '600',
                          transition: 'all 0.2s ease',
                          boxShadow: 'var(--shadow-sm)'
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.transform = 'translateY(-2px)';
                          e.target.style.boxShadow = 'var(--shadow-md)';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.transform = 'translateY(0)';
                          e.target.style.boxShadow = 'var(--shadow-sm)';
                        }}
                      >
                        💾 Save
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {recipients.map((recipient, index) => (
                    <div key={index} style={{ 
                      padding: '1.25rem', 
                      background: 'var(--bg-input)', 
                      borderRadius: 'var(--radius-lg)',
                      border: '2px solid var(--border)',
                      transition: 'all 0.2s ease',
                      position: 'relative'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--primary)';
                      e.currentTarget.style.background = 'var(--bg-card)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.background = 'var(--bg-input)';
                    }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        <span style={{ 
                          fontSize: '1.2rem',
                          background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)',
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                          backgroundClip: 'text',
                          fontWeight: '600'
                        }}>
                          Recipient {index + 1}
                        </span>
                        {recipients.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRecipient(index)}
                            style={{ 
                              marginLeft: 'auto',
                              padding: '0.4rem 0.8rem', 
                              background: 'var(--error-bg)', 
                              color: 'var(--error)', 
                              border: '1px solid var(--error)',
                              borderRadius: 'var(--radius-sm)', 
                              cursor: 'pointer', 
                              fontSize: '0.85rem',
                              fontWeight: '500',
                              transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.target.style.background = 'var(--error)';
                              e.target.style.color = 'white';
                            }}
                            onMouseLeave={(e) => {
                              e.target.style.background = 'var(--error-bg)';
                              e.target.style.color = 'var(--error)';
                            }}
                          >
                            🗑️ Remove
                          </button>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div>
                          <label style={{ 
                            display: 'block', 
                            marginBottom: '0.5rem', 
                            fontSize: '0.9rem', 
                            color: 'var(--text-secondary)',
                            fontWeight: '500'
                          }}>
                            Wallet Address
                          </label>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <input
                              type="text"
                              value={recipient.address}
                              onChange={(e) => updateRecipient(index, 'address', e.target.value)}
                              placeholder="0x..."
                              required={index === 0}
                              className="recipient-address-input"
                              style={{ 
                                flex: 1,
                                padding: '0.875rem 1rem', 
                                fontSize: '1rem',
                                background: 'var(--bg-app)',
                                border: '2px solid var(--border)',
                                borderRadius: 'var(--radius-md)',
                                color: 'var(--text-primary)'
                              }}
                            />
                            {recipient.address && ethers.isAddress(recipient.address) && (
                              <button
                                type="button"
                                onClick={() => copyToClipboard(recipient.address, 'Address')}
                                style={{ 
                                  padding: '0.875rem 1rem', 
                                  background: 'var(--primary)', 
                                  color: 'white', 
                                  border: 'none', 
                                  borderRadius: 'var(--radius-md)', 
                                  cursor: 'pointer', 
                                  fontSize: '0.9rem',
                                  fontWeight: '500',
                                  transition: 'all 0.2s ease',
                                  whiteSpace: 'nowrap'
                                }}
                                title="Copy address"
                                onMouseEnter={(e) => {
                                  e.target.style.background = 'var(--primary-hover)';
                                  e.target.style.transform = 'scale(1.05)';
                                }}
                                onMouseLeave={(e) => {
                                  e.target.style.background = 'var(--primary)';
                                  e.target.style.transform = 'scale(1)';
                                }}
                              >
                                📋 Copy
                              </button>
                            )}
                          </div>
                        </div>
                        <div>
                          <label style={{ 
                            display: 'block', 
                            marginBottom: '0.5rem', 
                            fontSize: '0.9rem', 
                            color: 'var(--text-secondary)',
                            fontWeight: '500'
                          }}>
                            Hourly Rate (MNEE/hour)
                          </label>
                          <input
                            type="number"
                            value={recipient.amount}
                            onChange={(e) => updateRecipient(index, 'amount', e.target.value)}
                            placeholder={hourlyRate ? `Default: ${hourlyRate} MNEE/hour` : 'Enter hourly rate'}
                            step="0.01"
                            min="0"
                            style={{ 
                              width: '100%', 
                              padding: '0.875rem 1rem',
                              fontSize: '1rem',
                              background: 'var(--bg-app)',
                              border: '2px solid var(--border)',
                              borderRadius: 'var(--radius-md)',
                              color: 'var(--text-primary)'
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addRecipient}
                    style={{
                      padding: '1rem',
                      background: 'transparent',
                      border: '2px dashed var(--border)',
                      color: 'var(--text-secondary)',
                      borderRadius: 'var(--radius-lg)',
                      cursor: 'pointer',
                      fontSize: '1rem',
                      fontWeight: '500',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem'
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.borderColor = 'var(--primary)';
                      e.target.style.color = 'var(--primary)';
                      e.target.style.background = 'var(--primary-light)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.borderColor = 'var(--border)';
                      e.target.style.color = 'var(--text-secondary)';
                      e.target.style.background = 'transparent';
                    }}
                  >
                    <span style={{ fontSize: '1.2rem' }}>➕</span>
                    Add Recipient
                  </button>
                </div>
              </div>

              {/* Stream Preview */}
              {streamPreview && streamPreview.isValid && (
                <div style={{ 
                  marginBottom: '2rem', 
                  padding: '2rem', 
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(99, 102, 241, 0.15) 100%)', 
                  border: '2px solid var(--success)', 
                  borderRadius: 'var(--radius-xl)', 
                  boxShadow: 'var(--shadow-lg)',
                  backdropFilter: 'blur(10px)'
                }}>
                  <h4 style={{ 
                    margin: '0 0 1.5rem 0', 
                    color: 'var(--success)', 
                    fontSize: '1.75rem', 
                    fontFamily: 'var(--font-display)', 
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <span>📊</span>
                    Stream Preview
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
                    {streamPreview.hourlyRate !== null && (
                      <div>
                        <div style={{ fontSize: '1.2rem', color: 'var(--text-muted)', marginBottom: '8px', fontFamily: 'var(--font-display)' }}>Default Hourly Rate</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--success)' }}>{streamPreview.hourlyRate.toFixed(4)} MNEE/hour</div>
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: '1.2rem', color: 'var(--text-muted)', marginBottom: '8px', fontFamily: 'var(--font-display)' }}>Duration</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--success)' }}>{streamPreview.duration} hours</div>
                      <div style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>({(streamPreview.duration / 24).toFixed(1)} days)</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '1.2rem', color: 'var(--text-muted)', marginBottom: '8px', fontFamily: 'var(--font-display)' }}>Recipients</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--success)' }}>{streamPreview.recipients}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '1.2rem', color: 'var(--text-muted)', marginBottom: '8px', fontFamily: 'var(--font-display)' }}>Total Amount</div>
                      <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--success)' }}>{parseFloat(streamPreview.totalAmount).toFixed(4)} MNEE</div>
                    </div>
                  </div>
                  {streamPreview.recipientAmounts && streamPreview.recipientAmounts.length > 0 && (
                    <div style={{ marginTop: '20px', padding: '14px', backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-md)', fontSize: '1.1rem', border: '1px solid var(--border)' }}>
                      <strong style={{ fontFamily: 'var(--font-display)' }}>Per Recipient Details:</strong>
                      <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
                        {streamPreview.recipientAmounts.map((totalAmount, idx) => {
                          const recipientHourlyRate = recipients[idx]?.amount || hourlyRate || '0';
                          return (
                            <li key={idx} style={{ marginBottom: '4px' }}>
                              Recipient {idx + 1}: {parseFloat(recipientHourlyRate).toFixed(4)} MNEE/hour = {parseFloat(totalAmount).toFixed(4)} MNEE total
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  <div style={{ marginTop: '20px', padding: '14px', backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-md)', fontSize: '1.2rem', border: '1px solid var(--border)' }}>
                    <strong style={{ fontFamily: 'var(--font-display)' }}>Total:</strong> {parseFloat(streamPreview.totalAmount).toFixed(4)} MNEE
                  </div>
                  <div style={{ marginTop: '14px', fontSize: '1.1rem', color: 'var(--text-secondary)' }}>
                    Estimated end date: {streamPreview.endDate.toLocaleString()}
                  </div>
                  <div style={{ marginTop: '14px', padding: '12px', backgroundColor: 'rgba(255, 193, 7, 0.1)', borderRadius: 'var(--radius-md)', fontSize: '1rem', color: 'var(--warning)' }}>
                    <strong>Note:</strong> Unclaimed funds at stream end will be returned to the stream creator.
                  </div>
                </div>
              )}

              <button 
                type="submit" 
                disabled={loading} 
                style={{
                  width: '100%',
                  background: loading 
                    ? 'var(--bg-input)' 
                    : 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)',
                  color: loading ? 'var(--text-muted)' : 'white',
                  padding: '1.5rem',
                  borderRadius: 'var(--radius-lg)',
                  fontSize: '1.3rem',
                  fontWeight: '700',
                  marginTop: '1rem',
                  transition: 'all 0.3s ease',
                  boxShadow: loading ? 'none' : 'var(--shadow-md)',
                  fontFamily: 'var(--font-display)',
                  letterSpacing: '0.02em',
                  border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.75rem'
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.target.style.transform = 'translateY(-3px)';
                    e.target.style.boxShadow = 'var(--shadow-lg), var(--shadow-glow)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading) {
                    e.target.style.transform = 'translateY(0)';
                    e.target.style.boxShadow = 'var(--shadow-md)';
                  }
                }}
              >
                {loading ? (
                  <>
                    <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
                    Creating Stream...
                  </>
                ) : (
                  <>
                    <span>✨</span>
                    Create Stream
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'my-streams' && (
          <div className="my-streams">
            <div className="section-header">
              <h2>My Streams</h2>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '20px' }}>
              {hiddenStreams.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setHiddenStreams([]);
                    localStorage.setItem('streamfi_hidden_streams', JSON.stringify([]));
                  }}
                  style={{ padding: '6px 12px', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '12px' }}
                >
                  Show All ({hiddenStreams.length} hidden)
                </button>
              )}
            </div>
            {getVisibleStreams(streams.filter(s => s.isCreator)).length === 0 ? (
              <p>{streams.filter(s => s.isCreator).length === 0 ? 'No streams created yet.' : 'All streams are hidden. Click "Show All" to view them.'}</p>
            ) : (
              <div className="streams-list">
                {getVisibleStreams(streams.filter(s => s.isCreator)).map((stream) => {
                  const isPaused = pausedStreams.includes(stream.id);
                  const isHidden = hiddenStreams.includes(stream.id);
                  // Calculate progress for active streams
                  const totalFunded = parseFloat(stream.totalFunded);
                  const totalDistributed = parseFloat(stream.totalDistributed);
                  const progressPercent = totalFunded > 0 ? (totalDistributed / totalFunded) * 100 : 0;
                  const remaining = totalFunded - totalDistributed;
                  
                  // Calculate time remaining
                  let timeRemaining = null;
                  if (stream.isActive && stream.endTime) {
                    const now = Math.floor(Date.now() / 1000);
                    const remainingSeconds = stream.endTime - now;
                    if (remainingSeconds > 0) {
                      const days = Math.floor(remainingSeconds / 86400);
                      const hours = Math.floor((remainingSeconds % 86400) / 3600);
                      const minutes = Math.floor((remainingSeconds % 3600) / 60);
                      timeRemaining = { days, hours, minutes };
                    }
                  }

                  return (
                    <div key={stream.id} className="stream-card">
                      <div className="stream-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <h4>
                            Stream #{stream.id}
                            {isPaused && <span style={{ marginLeft: '8px', padding: '2px 8px', backgroundColor: '#FF9800', color: 'white', borderRadius: '3px', fontSize: '11px' }}>PAUSED</span>}
                          </h4>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(stream.id.toString(), 'Stream ID')}
                            style={{ padding: '2px 6px', marginLeft: '5px', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}
                            title="Copy Stream ID"
                          >
                            Copy ID
                          </button>
                        </div>
                        <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                          <span className={`status ${stream.isActive ? 'active' : 'inactive'}`}>
                            {stream.isActive 
                              ? (isPaused ? 'Paused' : 'Active') 
                              : (stream.endTime > 0 && Math.floor(Date.now() / 1000) >= stream.endTime 
                                  ? 'Ended' 
                                  : parseFloat(stream.totalFunded) > 0 && parseFloat(stream.totalDistributed) >= (parseFloat(stream.totalFunded) - 0.0001)
                                    ? 'Completed'
                                    : 'Not Funded')}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleHideStream(stream.id)}
                            style={{ padding: '4px 8px', backgroundColor: '#757575', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}
                            title={isHidden ? 'Show stream' : 'Hide stream'}
                          >
                            {isHidden ? '👁️' : '🙈'}
                          </button>
                          {stream.isActive && (
                            <button
                              type="button"
                              onClick={() => togglePauseStream(stream.id)}
                              style={{ padding: '4px 8px', backgroundColor: isPaused ? '#4CAF50' : '#FF9800', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}
                              title={isPaused ? 'Resume stream' : 'Pause stream (client-side)'}
                            >
                              {isPaused ? '▶️' : '⏸️'}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Progress Bar for Active Streams */}
                      {stream.isActive && (
                        <div style={{ marginBottom: '15px', padding: '12px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '1.1rem' }}>
                            <span>Progress: {progressPercent.toFixed(1)}%</span>
                            <span>{totalDistributed.toFixed(4)} / {totalFunded.toFixed(4)} MNEE</span>
                          </div>
                          <div style={{ width: '100%', height: '20px', backgroundColor: '#e0e0e0', borderRadius: '10px', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${Math.min(progressPercent, 100)}%`,
                                height: '100%',
                                backgroundColor: progressPercent > 80 ? '#4CAF50' : progressPercent > 50 ? '#FFC107' : '#2196F3',
                                transition: 'width 0.3s ease',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                fontSize: '11px',
                                fontWeight: 'bold'
                              }}
                            >
                              {progressPercent > 10 && `${progressPercent.toFixed(0)}%`}
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '1rem', color: '#666' }}>
                            <span>Remaining: {remaining.toFixed(4)} MNEE</span>
                            {timeRemaining && (
                              <span>
                                Ends in: {timeRemaining.days > 0 && `${timeRemaining.days}d `}
                                {timeRemaining.hours > 0 && `${timeRemaining.hours}h `}
                                {timeRemaining.minutes}m
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="stream-details">
                        <div className="detail">
                          <span className="label">Hourly Rate:</span>
                          <span className="value">
                            {(() => {
                              const streamRates = recipientRates[stream.id];
                              if (streamRates && Object.keys(streamRates).length > 0) {
                                // Show individual rates if available
                                const ratesList = Object.entries(streamRates).map(([addr, rate]) => 
                                  `${addr.slice(0, 6)}...${addr.slice(-4)}: ${parseFloat(rate).toFixed(4)} MNEE/h`
                                ).join(', ');
                                return ratesList.length > 50 ? 'Multiple rates (see recipients)' : ratesList;
                              }
                              return `${parseFloat(stream.hourlyRate).toFixed(4)} MNEE/hour`;
                            })()}
                          </span>
                        </div>
                        <div className="detail">
                          <span className="label">Duration:</span>
                          <span className="value">{stream.duration} hours</span>
                        </div>
                        <div className="detail">
                          <span className="label">Recipients:</span>
                          <span className="value">{stream.recipients.length}</span>
                        </div>
                        <div className="detail">
                          <span className="label">Total Funded:</span>
                          <span className="value">{parseFloat(stream.totalFunded).toFixed(4)} MNEE</span>
                        </div>
                        <div className="detail">
                          <span className="label">Total Distributed:</span>
                          <span className="value">{parseFloat(stream.totalDistributed).toFixed(4)} MNEE</span>
                        </div>
                        {!stream.isActive && stream.endTime > 0 && Math.floor(Date.now() / 1000) >= stream.endTime && remaining > 0.0001 && (
                          <div className="detail" style={{ padding: '10px', backgroundColor: 'rgba(255, 193, 7, 0.1)', borderRadius: 'var(--radius-md)', border: '1px solid var(--warning)' }}>
                            <span className="label" style={{ color: 'var(--warning)', fontWeight: 'bold' }}>Unclaimed Funds:</span>
                            <span className="value" style={{ color: 'var(--warning)', fontWeight: 'bold' }}>{remaining.toFixed(4)} MNEE</span>
                            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '5px' }}>
                              These funds remain in the contract. Recipients can still claim their accumulated rewards, but any unclaimed funds after the stream ends will remain locked in the contract.
                            </div>
                          </div>
                        )}
                        {stream.isActive && (
                          <div className="detail">
                            <span className="label">Ends:</span>
                            <span className="value">{new Date(stream.endTime * 1000).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                      <div className="recipients-list">
                        <strong>Recipients:</strong>
                        {stream.recipients.map((addr, idx) => {
                          const recipientKey = `${stream.id}_${addr.toLowerCase()}`;
                          const isRemoved = removedRecipients[recipientKey];
                          const streamRates = recipientRates[stream.id];
                          const individualRate = streamRates && streamRates[addr.toLowerCase()];
                          return (
                            <div key={idx} className="recipient-tag" style={{ display: 'flex', alignItems: 'center', gap: '5px', opacity: isRemoved ? 0.5 : 1 }}>
                              <span style={{ textDecoration: isRemoved ? 'line-through' : 'none' }}>
                                {addr.slice(0, 6)}...{addr.slice(-4)}
                                {individualRate && (
                                  <span style={{ marginLeft: '5px', color: 'var(--success)', fontSize: '10px', fontWeight: 'bold' }}>
                                    ({parseFloat(individualRate).toFixed(2)} MNEE/h)
                                  </span>
                                )}
                                {isRemoved && <span style={{ marginLeft: '5px', color: '#f44336', fontSize: '10px' }}>(Removed)</span>}
                              </span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(addr, 'Address')}
                                style={{ padding: '2px 6px', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}
                                title="Copy address"
                              >
                                Copy
                              </button>
                              {!stream.isActive && (
                                <button
                                  type="button"
                                  onClick={() => removeRecipientFromStream(stream.id, addr)}
                                  style={{ padding: '2px 6px', backgroundColor: isRemoved ? '#4CAF50' : '#f44336', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}
                                  title={isRemoved ? 'Mark as active' : 'Remove recipient (create new stream to apply)'}
                                >
                                  {isRemoved ? 'Restore' : 'Remove'}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                        {!stream.isActive && (
                          <button
                            onClick={() => handleFundStream(stream.id)}
                            disabled={loading}
                            className="action-btn"
                            style={{ flex: 1 }}
                          >
                            {loading ? 'Funding...' : 'Fund Stream'}
                          </button>
                        )}
                        {stream.isActive && (
                          <button
                            type="button"
                            onClick={() => {
                              const streamInfo = `Stream #${stream.id}\nHourly Rate: ${parseFloat(stream.hourlyRate).toFixed(4)} MNEE/hour\nDuration: ${stream.duration} hours\nRecipients: ${stream.recipients.length}\nTotal Funded: ${parseFloat(stream.totalFunded).toFixed(4)} MNEE\nEnds: ${new Date(stream.endTime * 1000).toLocaleString()}`;
                              copyToClipboard(streamInfo, 'Stream Info');
                            }}
                            style={{ padding: '8px 12px', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '12px' }}
                          >
                            Copy Stream Info
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'claim' && (
          <div className="claim-rewards">
            <div className="section-header">
              <h2>Claim Rewards</h2>
            </div>
            {streams.filter(s => s.isRecipient && s.isActive).length === 0 ? (
              <p style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>No active streams to claim from.</p>
            ) : (
              <div className="streams-list">
                {streams.filter(s => s.isRecipient && s.isActive).map((stream) => {
                  const accumulated = parseFloat(stream.accumulated || '0');
                  const totalFunded = parseFloat(stream.totalFunded);
                  const progressPercent = totalFunded > 0 ? (accumulated / totalFunded) * 100 : 0;
                  
                  // Calculate time remaining
                  let timeRemaining = null;
                  if (stream.endTime) {
                    const now = Math.floor(Date.now() / 1000);
                    const remainingSeconds = stream.endTime - now;
                    if (remainingSeconds > 0) {
                      const days = Math.floor(remainingSeconds / 86400);
                      const hours = Math.floor((remainingSeconds % 86400) / 3600);
                      const minutes = Math.floor((remainingSeconds % 3600) / 60);
                      timeRemaining = { days, hours, minutes };
                    }
                  }

                  return (
                    <div key={stream.id} className="stream-card">
                      <div className="stream-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <h4>Stream #{stream.id}</h4>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(stream.id.toString(), 'Stream ID')}
                            style={{ padding: '2px 6px', marginLeft: '5px', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}
                            title="Copy Stream ID"
                          >
                            Copy ID
                          </button>
                        </div>
                        <span className={`status ${stream.isActive ? 'active' : 'inactive'}`}>
                          {stream.isActive ? 'Active' : 'Ended'}
                        </span>
                      </div>

                      {/* Progress Indicator */}
                      <div style={{ marginBottom: '15px', padding: '14px', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)', border: '1px solid var(--primary)', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '1.2rem' }}>
                          <span style={{ fontWeight: 'bold', color: 'var(--primary)', fontFamily: 'var(--font-display)' }}>Your Accumulated: {accumulated.toFixed(4)} MNEE</span>
                          {timeRemaining && (
                            <span style={{ color: '#666' }}>
                              {timeRemaining.days > 0 && `${timeRemaining.days}d `}
                              {timeRemaining.hours > 0 && `${timeRemaining.hours}h `}
                              {timeRemaining.minutes}m left
                            </span>
                          )}
                        </div>
                        <div style={{ width: '100%', height: '15px', backgroundColor: '#bbdefb', borderRadius: '8px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${Math.min(progressPercent, 100)}%`,
                              height: '100%',
                              backgroundColor: '#1976d2',
                              transition: 'width 0.3s ease'
                            }}
                          />
                        </div>
                      </div>

                      <div className="stream-details">
                        <div className="detail">
                          <span className="label">Accumulated:</span>
                          <span className="value" style={{ fontWeight: 'bold', color: '#1976d2', fontSize: '16px' }}>{accumulated.toFixed(6)} MNEE</span>
                          {pausedStreams.includes(stream.id) && (
                            <div style={{ fontSize: '0.85rem', color: 'var(--warning)', marginTop: '4px' }}>
                              ⏸️ Stream is paused - rewards are not accumulating
                            </div>
                          )}
                        </div>
                        <div className="detail">
                          <span className="label">Hourly Rate:</span>
                          <span className="value">
                            {(() => {
                              const streamRates = recipientRates[stream.id];
                              const individualRate = streamRates && streamRates[account.toLowerCase()];
                              if (individualRate) {
                                return `${parseFloat(individualRate).toFixed(4)} MNEE/hour (your rate)`;
                              }
                              return `${parseFloat(stream.hourlyRate).toFixed(4)} MNEE/hour`;
                            })()}
                          </span>
                        </div>
                        <div className="detail">
                          <span className="label">Ends:</span>
                          <span className="value">{new Date(stream.endTime * 1000).toLocaleString()}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleClaimReward(stream.id)}
                        disabled={loading || accumulated <= 0}
                        className="action-btn"
                      >
                        {loading ? 'Claiming...' : `Claim ${accumulated.toFixed(4)} MNEE`}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="analytics-dashboard">
            <div className="section-header">
              <h2>Analytics Dashboard</h2>
            </div>

            {/* Overall App Statistics Section */}
            <div style={{ marginBottom: '40px', padding: '24px', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)', borderRadius: 'var(--radius-xl)', border: '2px solid var(--primary)' }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: '1.8rem', fontFamily: 'var(--font-display)', fontWeight: '700', color: 'var(--primary)' }}>🌐 Overall App Statistics</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
                <div>
                  <div style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Total Streams (All Users)</div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--primary)' }}>{overallStats.totalStreams}</div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {overallStats.activeStreams} active, {overallStats.inactiveStreams} inactive
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Total Funded (All Users)</div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--success)' }}>{overallStats.totalFunded.toFixed(2)}</div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '4px' }}>MNEE</div>
                </div>
                <div>
                  <div style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Total Distributed</div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--warning)' }}>{overallStats.totalDistributed.toFixed(2)}</div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '4px' }}>MNEE ({overallStats.distributionRate.toFixed(1)}%)</div>
                </div>
                <div>
                  <div style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Unique Creators</div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--accent)' }}>{overallStats.uniqueCreators}</div>
                </div>
                <div>
                  <div style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Unique Recipients</div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--accent)' }}>{overallStats.uniqueRecipients}</div>
                </div>
                <div>
                  <div style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Total Recipients</div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--accent)' }}>{overallStats.totalRecipients}</div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Avg: {overallStats.avgRecipientsPerStream.toFixed(1)} per stream
                  </div>
                </div>
              </div>
            </div>

            {/* User's Statistics Section */}
            <div style={{ marginBottom: '40px' }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: '1.5rem', fontFamily: 'var(--font-display)', fontWeight: '600', color: 'var(--text-primary)' }}>📊 Your Stream Statistics</h3>
            </div>
            
            {/* Overview Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '35px' }}>
              <div style={{ padding: '28px', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(139, 92, 246, 0.15) 100%)', borderRadius: 'var(--radius-xl)', border: '2px solid var(--primary)', boxShadow: 'var(--shadow-md)' }}>
                <div style={{ fontSize: '1.2rem', color: 'var(--text-muted)', marginBottom: '10px', fontFamily: 'var(--font-display)', fontWeight: '600' }}>Total Streams</div>
                <div style={{ fontSize: '2.75rem', fontWeight: 'bold', color: 'var(--primary)', fontFamily: 'var(--font-display)' }}>{analytics.totalStreams}</div>
                <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)', marginTop: '10px', fontFamily: 'var(--font-display)' }}>
                  {analytics.activeStreams} active, {analytics.inactiveStreams} inactive
                </div>
              </div>
              
              <div style={{ padding: '28px', background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(5, 150, 105, 0.15) 100%)', borderRadius: 'var(--radius-xl)', border: '2px solid var(--success)', boxShadow: 'var(--shadow-md)' }}>
                <div style={{ fontSize: '1.2rem', color: 'var(--text-muted)', marginBottom: '10px', fontFamily: 'var(--font-display)', fontWeight: '600' }}>Total Funded</div>
                <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: 'var(--success)', fontFamily: 'var(--font-display)' }}>{analytics.totalFunded.toFixed(2)}</div>
                <div style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginTop: '10px' }}>MNEE</div>
              </div>
              
              <div style={{ padding: '28px', background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.15) 100%)', borderRadius: 'var(--radius-xl)', border: '2px solid var(--warning)', boxShadow: 'var(--shadow-md)' }}>
                <div style={{ fontSize: '1.2rem', color: 'var(--text-muted)', marginBottom: '10px', fontFamily: 'var(--font-display)', fontWeight: '600' }}>Total Distributed</div>
                <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: 'var(--warning)', fontFamily: 'var(--font-display)' }}>{analytics.totalDistributed.toFixed(2)}</div>
                <div style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginTop: '10px' }}>MNEE ({analytics.distributionRate.toFixed(1)}%)</div>
              </div>
              
              <div style={{ padding: '28px', background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(124, 58, 237, 0.15) 100%)', borderRadius: 'var(--radius-xl)', border: '2px solid var(--accent)', boxShadow: 'var(--shadow-md)' }}>
                <div style={{ fontSize: '1.2rem', color: 'var(--text-muted)', marginBottom: '10px', fontFamily: 'var(--font-display)', fontWeight: '600' }}>Total Recipients</div>
                <div style={{ fontSize: '2.75rem', fontWeight: 'bold', color: 'var(--accent)', fontFamily: 'var(--font-display)' }}>{analytics.totalRecipients}</div>
                <div style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginTop: '10px' }}>
                  Avg: {analytics.avgRecipientsPerStream.toFixed(1)} per stream
                </div>
              </div>
            </div>

            {/* Charts Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px', marginBottom: '35px' }}>
              {/* Pie Chart - Stream Status Breakdown */}
              <div style={{ padding: '28px', backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
                <h4 style={{ margin: '0 0 24px 0', textAlign: 'center', fontSize: '1.6rem', fontFamily: 'var(--font-display)', fontWeight: '700' }}>Stream Status Distribution</h4>
                {analytics.totalStreams > 0 ? (
                  <div style={{ height: '400px', position: 'relative' }}>
                    <Pie
                      data={{
                        labels: ['Active', 'Paused', 'Inactive'],
                        datasets: [
                          {
                            label: 'Number of Streams',
                            data: [
                              analytics.activeStreams,
                              analytics.pausedStreams,
                              analytics.inactiveStreams
                            ],
                            backgroundColor: [
                              '#4CAF50',
                              '#FF9800',
                              '#757575'
                            ],
                            borderColor: [
                              '#2e7d32',
                              '#e65100',
                              '#424242'
                            ],
                            borderWidth: 2
                          }
                        ]
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        aspectRatio: 1.2,
                        plugins: {
                          legend: {
                            position: 'bottom',
                            labels: {
                              padding: 15,
                              font: {
                                size: 14
                              }
                            }
                          },
                          tooltip: {
                            callbacks: {
                              label: function(context) {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                return `${label}: ${value} (${percentage}%)`;
                              }
                            }
                          }
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>No streams data available</div>
                )}
              </div>

              {/* Bar Chart - Distribution Overview */}
              <div style={{ padding: '28px', backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
                <h4 style={{ margin: '0 0 24px 0', textAlign: 'center', fontSize: '1.6rem', fontFamily: 'var(--font-display)', fontWeight: '700' }}>Fund Distribution</h4>
                {analytics.totalFunded > 0 ? (
                  <div style={{ height: '400px', position: 'relative' }}>
                    <Bar
                      data={{
                        labels: ['Distributed', 'Remaining'],
                        datasets: [
                          {
                            label: 'MNEE Amount',
                            data: [
                              parseFloat(analytics.totalDistributed.toFixed(2)),
                              parseFloat(analytics.totalRemaining.toFixed(2))
                            ],
                            backgroundColor: [
                              '#4CAF50',
                              '#2196F3'
                            ],
                            borderColor: [
                              '#2e7d32',
                              '#1976d2'
                            ],
                            borderWidth: 2
                          }
                        ]
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        aspectRatio: 1.5,
                        plugins: {
                          legend: {
                            display: false
                          },
                          tooltip: {
                            callbacks: {
                              label: function(context) {
                                const value = context.parsed.y || 0;
                                const total = analytics.totalFunded;
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                return `${value.toFixed(2)} MNEE (${percentage}%)`;
                              }
                            }
                          }
                        },
                        scales: {
                          y: {
                            beginAtZero: true,
                            ticks: {
                              callback: function(value) {
                                return value.toFixed(2) + ' MNEE';
                              },
                              font: {
                                size: 12
                              }
                            }
                          },
                          x: {
                            ticks: {
                              font: {
                                size: 12
                              }
                            }
                          }
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>No funding data available</div>
                )}
              </div>
            </div>

            {/* Bar Chart - Time-based Activity */}
            <div style={{ padding: '28px', backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--border)', marginBottom: '35px', boxShadow: 'var(--shadow-md)' }}>
              <h4 style={{ margin: '0 0 24px 0', textAlign: 'center', fontSize: '1.6rem', fontFamily: 'var(--font-display)', fontWeight: '700' }}>Stream Activity Over Time</h4>
              <div style={{ height: '400px', position: 'relative' }}>
                <Bar
                  data={{
                    labels: ['Last 24 Hours', 'Last 7 Days', 'Last 30 Days'],
                    datasets: [
                      {
                        label: 'Active Streams',
                        data: [
                          analytics.streamsLast24h,
                          analytics.streamsLast7d,
                          analytics.streamsLast30d
                        ],
                        backgroundColor: [
                          '#2196F3',
                          '#4CAF50',
                          '#FF9800'
                        ],
                        borderColor: [
                          '#1976d2',
                          '#2e7d32',
                          '#e65100'
                        ],
                        borderWidth: 2
                      }
                    ]
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    aspectRatio: 2,
                    plugins: {
                      legend: {
                        display: false
                      },
                      tooltip: {
                        callbacks: {
                          label: function(context) {
                            return `Active Streams: ${context.parsed.y}`;
                          }
                        }
                      }
                    },
                    scales: {
                      y: {
                        beginAtZero: true,
                        ticks: {
                          stepSize: 1,
                          font: {
                            size: 12
                          }
                        }
                      },
                      x: {
                        ticks: {
                          font: {
                            size: 12
                          }
                        }
                      }
                    }
                  }}
                />
              </div>
            </div>

            {/* Additional Statistics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px', marginBottom: '30px' }}>
              <div style={{ padding: '20px', backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)', marginBottom: '10px' }}>Average Stream Value</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{analytics.avgStreamValue.toFixed(2)} MNEE</div>
              </div>
              
              <div style={{ padding: '20px', backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)', marginBottom: '10px' }}>Paused Streams</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#FF9800' }}>{analytics.pausedStreams}</div>
              </div>
              
              <div style={{ padding: '20px', backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)', marginBottom: '10px' }}>Hidden Streams</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#757575' }}>{hiddenStreams.length}</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'buy-sell' && (
          <BuySellInterface 
            account={account}
            isConnected={isConnected}
            connectWallet={connectWallet}
          />
        )}

        {activeTab === 'admin' && (
          <BuySellAdmin 
            account={account}
            isConnected={isConnected}
          />
        )}
      </div>

      {/* Receipt Modal */}
      {showReceiptModal && receiptData && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '20px'
        }} onClick={() => setShowReceiptModal(false)}>
          <div style={{
            backgroundColor: 'var(--bg-card)',
            borderRadius: 'var(--radius-xl)',
            padding: '30px',
            maxWidth: '800px',
            maxHeight: '90vh',
            overflow: 'auto',
            border: '2px solid var(--primary)',
            boxShadow: 'var(--shadow-lg)',
            position: 'relative'
          }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowReceiptModal(false)}
              style={{
                position: 'absolute',
                top: '15px',
                right: '15px',
                background: 'var(--error)',
                color: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '35px',
                height: '35px',
                cursor: 'pointer',
                fontSize: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ×
            </button>
            <div style={{ color: 'var(--text-primary)' }}>
              <div style={{ textAlign: 'center', borderBottom: '3px solid var(--success)', paddingBottom: '20px', marginBottom: '30px' }}>
                <h1 style={{ color: 'var(--success)', margin: 0, fontSize: '2rem' }}>StreamFi Payment Receipt</h1>
                <p style={{ marginTop: '10px', color: 'var(--text-secondary)' }}>Stream Funding Confirmation</p>
              </div>

              <div style={{ background: 'var(--bg-input)', padding: '20px', borderRadius: 'var(--radius-md)', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>Receipt Date:</span>
                  <span style={{ color: 'var(--text-primary)' }}>{new Date().toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>Stream ID:</span>
                  <span style={{ color: 'var(--text-primary)' }}>#{receiptData.streamId}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>Transaction Hash:</span>
                  <span style={{ color: 'var(--text-primary)', wordBreak: 'break-all', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>{receiptData.txHash}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>Block Number:</span>
                  <span style={{ color: 'var(--text-primary)' }}>{receiptData.txReceipt?.blockNumber || 'N/A'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                  <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>Network:</span>
                  <span style={{ color: 'var(--text-primary)' }}>Ethereum Mainnet</span>
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ color: 'var(--success)', borderBottom: '2px solid var(--success)', paddingBottom: '5px', marginBottom: '15px' }}>Stream Details</h3>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>Creator Address:</span>
                  <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>{receiptData.streamData.creator}</span>
                </div>
                {receiptData.streamData.recipientsWithRates && receiptData.streamData.recipientsWithRates.length > 0 && 
                 receiptData.streamData.recipientsWithRates.some(r => parseFloat(r.hourlyRate) !== parseFloat(receiptData.streamData.hourlyRate)) ? (
                  <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>Hourly Rates (Individual):</span>
                    <div style={{ marginTop: '8px', paddingLeft: '10px' }}>
                      {receiptData.streamData.recipientsWithRates.map((r, idx) => (
                        <div key={idx} style={{ padding: '4px 0', fontSize: '0.9rem' }}>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{r.address.slice(0, 6)}...{r.address.slice(-4)}:</span>
                          <span style={{ color: 'var(--text-primary)', marginLeft: '8px' }}>{parseFloat(r.hourlyRate).toFixed(4)} MNEE/hour</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>Hourly Rate:</span>
                    <span style={{ color: 'var(--text-primary)' }}>{parseFloat(receiptData.streamData.hourlyRate).toFixed(4)} MNEE/hour</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>Duration:</span>
                  <span style={{ color: 'var(--text-primary)' }}>{receiptData.streamData.duration} hours ({(receiptData.streamData.duration / 24).toFixed(1)} days)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>Number of Recipients:</span>
                  <span style={{ color: 'var(--text-primary)' }}>{receiptData.streamData.recipients.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>Start Time:</span>
                  <span style={{ color: 'var(--text-primary)' }}>{new Date(receiptData.streamData.startTime * 1000).toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                  <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>End Time:</span>
                  <span style={{ color: 'var(--text-primary)' }}>{new Date(receiptData.streamData.endTime * 1000).toLocaleString()}</span>
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ color: 'var(--success)', borderBottom: '2px solid var(--success)', paddingBottom: '5px', marginBottom: '15px' }}>Recipients</h3>
                <div style={{ background: 'var(--bg-input)', padding: '15px', borderRadius: 'var(--radius-md)' }}>
                  {receiptData.streamData.recipientsWithRates ? (
                    receiptData.streamData.recipientsWithRates.map((r, idx) => (
                      <div key={idx} style={{ padding: '5px 0', fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {idx + 1}. {r.address}
                        <span style={{ marginLeft: '10px', color: 'var(--success)', fontWeight: 'bold' }}>
                          ({parseFloat(r.hourlyRate).toFixed(4)} MNEE/hour)
                        </span>
                      </div>
                    ))
                  ) : (
                    receiptData.streamData.recipients.map((addr, idx) => (
                      <div key={idx} style={{ padding: '5px 0', fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {idx + 1}. {addr}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ color: 'var(--success)', borderBottom: '2px solid var(--success)', paddingBottom: '5px', marginBottom: '15px' }}>Payment Summary</h3>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>Total Amount Funded:</span>
                  <span style={{ color: 'var(--text-primary)' }}>{parseFloat(receiptData.streamData.totalFunded).toFixed(4)} MNEE</span>
                </div>
                {receiptData.streamData.recipientsWithRates && receiptData.streamData.recipientsWithRates.length > 0 && 
                 receiptData.streamData.recipientsWithRates.some(r => parseFloat(r.hourlyRate) !== parseFloat(receiptData.streamData.hourlyRate)) ? (
                  <div style={{ padding: '8px 0' }}>
                    <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>Calculation (per recipient):</span>
                    <div style={{ marginTop: '8px', paddingLeft: '10px' }}>
                      {receiptData.streamData.recipientsWithRates.map((r, idx) => {
                        const recipientTotal = parseFloat(r.hourlyRate) * receiptData.streamData.duration;
                        return (
                          <div key={idx} style={{ padding: '4px 0', fontSize: '0.9rem' }}>
                            <span style={{ fontFamily: 'var(--font-mono)' }}>{r.address.slice(0, 6)}...{r.address.slice(-4)}:</span>
                            <span style={{ color: 'var(--text-primary)', marginLeft: '8px' }}>
                              {parseFloat(r.hourlyRate).toFixed(4)} MNEE/h × {receiptData.streamData.duration}h = {recipientTotal.toFixed(4)} MNEE
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                    <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>Calculation:</span>
                    <span style={{ color: 'var(--text-primary)' }}>
                      {parseFloat(receiptData.streamData.hourlyRate).toFixed(4)} MNEE/hour × {receiptData.streamData.duration} hours × {receiptData.streamData.recipients.length} recipients
                    </span>
                  </div>
                )}
              </div>

              <div style={{ background: 'var(--success)', color: 'white', padding: '15px', borderRadius: 'var(--radius-md)', textAlign: 'center', fontSize: '1.2rem', fontWeight: 'bold', marginTop: '20px' }}>
                Total Payment: {parseFloat(receiptData.streamData.totalFunded).toFixed(4)} MNEE
              </div>
            </div>
            <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={() => {
                  const printWindow = window.open('', '_blank');
                  if (printWindow) {
                    printWindow.document.write(`
                      <!DOCTYPE html>
                      <html>
                      <head>
                        <title>Stream Funding Receipt - Stream #${receiptData.streamId}</title>
                        <style>
                          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }
                          .header { text-align: center; border-bottom: 3px solid #4CAF50; padding-bottom: 20px; margin-bottom: 30px; }
                          .header h1 { color: #4CAF50; margin: 0; }
                          .receipt-info { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
                          .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #ddd; }
                          .info-row:last-child { border-bottom: none; }
                          .label { font-weight: bold; color: #666; }
                          .value { color: #333; word-break: break-all; }
                          .section { margin: 20px 0; }
                          .section h3 { color: #4CAF50; border-bottom: 2px solid #4CAF50; padding-bottom: 5px; }
                          .recipients-list { background: #f9f9f9; padding: 15px; border-radius: 5px; margin-top: 10px; }
                          .recipient-item { padding: 5px 0; font-family: monospace; font-size: 0.9em; }
                          .total { background: #4CAF50; color: white; padding: 15px; border-radius: 8px; text-align: center; font-size: 1.2em; font-weight: bold; margin-top: 20px; }
                        </style>
                      </head>
                      <body>
                        ${generateReceiptContent(receiptData.streamId, receiptData.streamData, receiptData.txHash, receiptData.txReceipt)}
                      </body>
                      </html>
                    `);
                    printWindow.document.close();
                    setTimeout(() => printWindow.print(), 500);
                  }
                }}
                style={{
                  padding: '12px 24px',
                  backgroundColor: 'var(--primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: '600'
                }}
              >
                Print Receipt
              </button>
              <button
                onClick={() => setShowReceiptModal(false)}
                style={{
                  padding: '12px 24px',
                  backgroundColor: 'var(--text-muted)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: '600'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StreamFiDapp;

