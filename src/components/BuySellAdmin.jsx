import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { ERC20_ABI } from '../config/tokens';

// Buy/Sell Contract ABI (same as BuySellInterface)
const BUY_SELL_ABI = [
  'function createBuyRequest(uint256 fiatAmount, uint256 currencyType, address recipientWallet) external returns (uint256)',
  'function createSellRequest(uint256 tokenAmount, uint256 currencyType, string memory mobileNumber) external returns (uint256)',
  'function getRequest(uint256 requestId) external view returns (address user, uint256 amount, uint256 currencyType, uint256 status, string memory mobileNumber, address recipientWallet, uint256 timestamp, string memory adminNotes)',
  'function cancelRequest(uint256 requestId) external',
  'function getUserRequests(address user) external view returns (uint256[] memory)',
  'function approveRequest(uint256 requestId, string memory notes) external',
  'function rejectRequest(uint256 requestId, string memory notes) external',
  'function getPendingRequests() external view returns (uint256[] memory)',
  'function admin() external view returns (address)',
  'function treasuryWallet() external view returns (address)',
  'function token() external view returns (address)',
  'event BuyRequestCreated(uint256 indexed requestId, address indexed user, uint256 fiatAmount, uint256 currencyType)',
  'event SellRequestCreated(uint256 indexed requestId, address indexed user, uint256 tokenAmount, uint256 currencyType)',
  'event RequestApproved(uint256 indexed requestId, address indexed admin)',
  'event RequestRejected(uint256 indexed requestId, address indexed admin)',
  'event RequestCancelled(uint256 indexed requestId, address indexed user)'
];

const REQUEST_STATUS = {
  0: 'Pending',
  1: 'Approved',
  2: 'Rejected',
  3: 'Cancelled'
};

function BuySellAdmin({ account, isConnected }) {
  const [contract, setContract] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [allRequests, setAllRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [treasuryBalance, setTreasuryBalance] = useState(null);
  const [tokenContract, setTokenContract] = useState(null);
  const [tokenApproval, setTokenApproval] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [validationErrors, setValidationErrors] = useState({});

  // Buy/Sell contract address (deployed on Ethereum Mainnet)
  const contractAddress = '0x69c29f93eBc486e98E66d901bA2C88B8FD5cBc67';

  useEffect(() => {
    if (isConnected && account && window.ethereum) {
      initializeContract();
    }
  }, [isConnected, account]);

  useEffect(() => {
    if (contract && isAdmin) {
      // Load requests immediately
      loadPendingRequests();
      loadAllRequests();
      
      // Try to load treasury status, but don't block if it fails
      checkTreasuryStatus().catch(err => {
        console.warn('Treasury status check failed, continuing anyway:', err);
      });
      
      const interval = setInterval(() => {
        loadPendingRequests();
        loadAllRequests();
        // Try treasury status, but don't let errors break the polling
        checkTreasuryStatus().catch(err => {
          console.warn('Treasury status check failed during polling:', err);
        });
      }, 3000); // Auto-refresh every 3 seconds
      
      return () => clearInterval(interval);
    }
  }, [contract, isAdmin]);

  const initializeContract = async () => {
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const buySellContract = new ethers.Contract(contractAddress, BUY_SELL_ABI, signer);
      
      // Check if user is admin
      const adminAddress = await buySellContract.admin();
      const userIsAdmin = adminAddress.toLowerCase() === account.toLowerCase();
      
      setIsAdmin(userIsAdmin);
      setContract(buySellContract);

      if (userIsAdmin) {
        // Initialize token contract for balance checks
        try {
          const tokenAddress = await buySellContract.token();
          // Verify token contract exists
          const provider = new ethers.BrowserProvider(window.ethereum);
          const code = await provider.getCode(tokenAddress);
          
          if (code !== '0x' && code !== '0x0') {
            const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
            setTokenContract(token);
          } else {
            console.warn('Token contract not found at address:', tokenAddress);
            setTokenContract(null);
          }
        } catch (err) {
          console.warn('Error initializing token contract:', err);
          setTokenContract(null);
        }
      }
    } catch (err) {
      console.error('Error initializing contract:', err);
      setError('Failed to connect to contract');
    }
  };

  const loadPendingRequests = async () => {
    if (!contract) return;
    try {
      const requestIds = await contract.getPendingRequests();
      const requests = await Promise.all(
        requestIds.map(async (id) => {
          const request = await contract.getRequest(id);
          return {
            id: Number(id),
            user: request.user,
            amount: ethers.formatEther(request.amount),
            currencyType: Number(request.currencyType),
            status: Number(request.status),
            mobileNumber: request.mobileNumber,
            recipientWallet: request.recipientWallet,
            timestamp: Number(request.timestamp),
            adminNotes: request.adminNotes
          };
        })
      );
      setPendingRequests(requests.sort((a, b) => b.id - a.id));
    } catch (err) {
      console.error('Error loading pending requests:', err);
    }
  };

  const loadAllRequests = async () => {
    if (!contract) return;
    try {
      // Get all requests by checking a range (this is a simplified approach)
      // In production, you'd want to use events or a better indexing system
      const pendingIds = await contract.getPendingRequests();
      const allIds = [...pendingIds];
      
      // For now, we'll just show pending requests
      // You can extend this to fetch all requests if needed
      const requests = await Promise.all(
        allIds.map(async (id) => {
          const request = await contract.getRequest(id);
          return {
            id: Number(id),
            user: request.user,
            amount: ethers.formatEther(request.amount),
            currencyType: Number(request.currencyType),
            status: Number(request.status),
            mobileNumber: request.mobileNumber,
            recipientWallet: request.recipientWallet,
            timestamp: Number(request.timestamp),
            adminNotes: request.adminNotes
          };
        })
      );
      setAllRequests(requests.sort((a, b) => b.id - a.id));
    } catch (err) {
      console.error('Error loading all requests:', err);
    }
  };

  const checkTreasuryStatus = async () => {
    // Treasury status checking disabled - admin handles confirmations manually
    setTreasuryBalance('Manual');
    setTokenApproval('Manual');
  };

  const validateRequest = async (request) => {
    // Validation disabled - admin handles confirmations manually
    // No pre-flight checks, admin will verify everything manually
    return {};
  };

  const handleApprove = async (request) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // No pre-flight validation - admin handles confirmations manually
      const tx = await contract.approveRequest(request.id, adminNotes || 'Approved by admin');
      await tx.wait();
      
      setSuccess(`Request #${request.id} approved successfully!`);
      setSelectedRequest(null);
      setAdminNotes('');
      await loadPendingRequests();
      await loadAllRequests();
    } catch (err) {
      console.error('Error approving request:', err);
      setError(err.message || 'Failed to approve request');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async (request) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const tx = await contract.rejectRequest(request.id, adminNotes || 'Rejected by admin');
      await tx.wait();
      
      setSuccess(`Request #${request.id} rejected.`);
      setSelectedRequest(null);
      setAdminNotes('');
      await loadPendingRequests();
      await loadAllRequests();
    } catch (err) {
      console.error('Error rejecting request:', err);
      setError(err.message || 'Failed to reject request');
    } finally {
      setLoading(false);
    }
  };

  const getCurrencySymbol = (type) => {
    return type === 0 ? 'USD' : type === 1 ? 'UGX' : 'KES';
  };

  const getRequestType = (request) => {
    // Buy requests have recipientWallet set, sell requests have mobileNumber
    if (request.recipientWallet && request.recipientWallet !== ethers.ZeroAddress) {
      return 'Buy (Onramp)';
    } else if (request.mobileNumber && request.mobileNumber.length > 0) {
      return 'Sell (Offramp)';
    }
    return 'Unknown';
  };

  if (!isConnected) {
    return (
      <div style={{ 
        maxWidth: '1600px', 
        margin: '0 auto', 
        padding: '3rem 2rem',
        textAlign: 'center'
      }}>
        <h2 style={{ fontSize: '32px', marginBottom: '1rem', color: 'var(--text-primary)' }}>
          Admin Panel
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '18px' }}>
          Please connect your wallet to access the admin panel
        </p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={{ 
        maxWidth: '1600px', 
        margin: '0 auto', 
        padding: '3rem 2rem',
        textAlign: 'center'
      }}>
        <h2 style={{ fontSize: '32px', marginBottom: '1rem', color: 'var(--error)' }}>
          Access Denied
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '18px' }}>
          This panel is restricted to admin wallets only.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '0.5rem' }}>
          Connected: {account?.slice(0, 6)}...{account?.slice(-4)}
        </p>
      </div>
    );
  }

  return (
    <div style={{ 
      maxWidth: '1600px', 
      margin: '0 auto', 
      padding: '3rem 2rem',
      background: 'var(--bg-app)'
    }}>
      <div style={{ marginBottom: '3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ 
            fontSize: '48px', 
            marginBottom: '0.5rem',
            background: 'linear-gradient(135deg, #ffffff 0%, #a8b3d0 50%, #6366f1 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>
            Admin Panel
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '18px' }}>
            Manage buy/sell requests and monitor treasury status
          </p>
        </div>
        <button
          onClick={() => {
            loadPendingRequests();
            loadAllRequests();
            checkTreasuryStatus();
          }}
          disabled={loading}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: '600'
          }}
        >
          🔄 Refresh
        </button>
      </div>

      {/* Treasury Status */}
      <div style={{
        background: 'var(--bg-card)',
        padding: '1.5rem',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        marginBottom: '2rem',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '1rem'
      }}>
        <div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '0.5rem' }}>
            Treasury Balance
          </div>
          <div style={{ color: 'var(--text-primary)', fontSize: '24px', fontWeight: '700' }}>
            {treasuryBalance || 'Manual'}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '0.25rem' }}>
            Admin handles confirmations manually
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '0.5rem' }}>
            Token Approval
          </div>
          <div style={{ color: 'var(--text-primary)', fontSize: '24px', fontWeight: '700' }}>
            {tokenApproval || 'Manual'}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '0.25rem' }}>
            Admin handles confirmations manually
          </div>
        </div>
      </div>

      {/* Pending Requests */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '32px', color: 'var(--text-primary)' }}>
            Pending Requests
          </h3>
          {pendingRequests.length > 0 && (
            <div style={{
              padding: '0.5rem 1rem',
              background: 'var(--warning-bg)',
              color: 'var(--warning)',
              borderRadius: 'var(--radius-md)',
              fontWeight: '700',
              fontSize: '18px'
            }}>
              {pendingRequests.length} Pending
            </div>
          )}
        </div>

        {pendingRequests.length === 0 ? (
          <div style={{
            background: 'var(--bg-card)',
            padding: '3rem',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            textAlign: 'center',
            color: 'var(--text-secondary)',
            fontSize: '18px'
          }}>
            No pending requests
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {pendingRequests.map((request) => (
              <div
                key={request.id}
                style={{
                  background: 'var(--bg-card)',
                  padding: '2rem',
                  borderRadius: 'var(--radius-lg)',
                  border: '3px solid var(--warning)',
                  boxShadow: '0 0 20px rgba(245, 158, 11, 0.3)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                  <div>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                      Request #{request.id}
                    </div>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                      {new Date(request.timestamp * 1000).toLocaleString()}
                    </div>
                  </div>
                  <div style={{
                    padding: '0.75rem 1.5rem',
                    background: 'var(--warning-bg)',
                    color: 'var(--warning)',
                    borderRadius: 'var(--radius-md)',
                    fontWeight: '700',
                    fontSize: '18px'
                  }}>
                    {REQUEST_STATUS[request.status]}
                  </div>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '1rem',
                  marginBottom: '1.5rem',
                  padding: '1.5rem',
                  background: 'var(--bg-input)',
                  borderRadius: 'var(--radius-md)'
                }}>
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '0.25rem' }}>
                      User Address
                    </div>
                    <div style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '16px' }}>
                      {request.user}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '0.25rem' }}>
                      Amount
                    </div>
                    <div style={{ color: 'var(--primary)', fontSize: '20px', fontWeight: '700' }}>
                      {parseFloat(request.amount).toFixed(4)} {getCurrencySymbol(request.currencyType)}
                    </div>
                  </div>
                  {request.recipientWallet && request.recipientWallet !== ethers.ZeroAddress ? (
                    <>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '0.25rem' }}>
                          Recipient Wallet (Tokens will be sent here)
                        </div>
                        <div style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)', fontSize: '16px' }}>
                          {request.recipientWallet}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '0.25rem' }}>
                          Admin Mobile (User should send payment to)
                        </div>
                        <div style={{ color: 'var(--warning)', fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: '700' }}>
                          +256786430457
                        </div>
                      </div>
                    </>
                  ) : (
                    <div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '0.25rem' }}>
                        User Mobile Number (Cash will be sent here)
                      </div>
                      <div style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '16px' }}>
                        {request.mobileNumber || 'Not provided'}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '0.25rem' }}>
                      Type
                    </div>
                    <div style={{ color: 'var(--text-primary)', fontSize: '16px', fontWeight: '600' }}>
                      {getRequestType(request)}
                    </div>
                  </div>
                </div>

                {/* Admin Notes Input */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ 
                    display: 'block', 
                    marginBottom: '0.5rem', 
                    fontSize: '16px',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    Admin Notes
                  </label>
                  <textarea
                    value={selectedRequest?.id === request.id ? adminNotes : ''}
                    onChange={(e) => {
                      setSelectedRequest(request);
                      setAdminNotes(e.target.value);
                    }}
                    placeholder="Add notes for this request..."
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '16px',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      outline: 'none',
                      minHeight: '80px',
                      resize: 'vertical'
                    }}
                  />
                </div>


                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button
                    onClick={() => handleApprove(request)}
                    disabled={loading}
                    style={{
                      flex: 1,
                      padding: '16px',
                      fontSize: '18px',
                      fontWeight: '700',
                      background: loading ? 'var(--text-muted)' : 'linear-gradient(135deg, var(--success) 0%, #059669 100%)',
                      color: 'white',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      boxShadow: 'var(--shadow-md)'
                    }}
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => handleReject(request)}
                    disabled={loading}
                    style={{
                      flex: 1,
                      padding: '16px',
                      fontSize: '18px',
                      fontWeight: '700',
                      background: loading ? 'var(--text-muted)' : 'linear-gradient(135deg, var(--error) 0%, #dc2626 100%)',
                      color: 'white',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      boxShadow: 'var(--shadow-md)'
                    }}
                  >
                    ✗ Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div style={{
          marginTop: '1rem',
          padding: '1rem',
          background: 'var(--error-bg)',
          color: 'var(--error)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--error)'
        }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{
          marginTop: '1rem',
          padding: '1rem',
          background: 'var(--success-bg)',
          color: 'var(--success)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--success)'
        }}>
          {success}
        </div>
      )}
    </div>
  );
}

export default BuySellAdmin;

