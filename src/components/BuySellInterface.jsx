import { useState, useEffect } from 'react';
import { ethers } from 'ethers';

// Buy/Sell Contract ABI
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
  'event BuyRequestCreated(uint256 indexed requestId, address indexed user, uint256 fiatAmount, uint256 currencyType)',
  'event SellRequestCreated(uint256 indexed requestId, address indexed user, uint256 tokenAmount, uint256 currencyType)',
  'event RequestApproved(uint256 indexed requestId, address indexed admin)',
  'event RequestRejected(uint256 indexed requestId, address indexed admin)',
  'event RequestCancelled(uint256 indexed requestId, address indexed user)'
];

// Exchange rates
const EXCHANGE_RATES = {
  USD: 1,
  UGX: 3500, // 1 USD = 3500 UGX
  KES: 128   // 1 USD = 128 KES
};

// Token price in USD (example: 1 MNEE = 1 USD)
const TOKEN_PRICE_USD = 1;

// Status mapping
const REQUEST_STATUS = {
  0: 'Pending',
  1: 'Approved',
  2: 'Rejected',
  3: 'Cancelled'
};

function BuySellInterface({ account, isConnected, connectWallet }) {
  const [mode, setMode] = useState('buy'); // 'buy' or 'sell'
  const [currency, setCurrency] = useState('USD');
  const [amount, setAmount] = useState('');
  const [mobileNumber, setMobileNumber] = useState(''); // User's mobile number for offramp
  const [recipientWallet, setRecipientWallet] = useState(''); // Wallet to receive tokens for onramp
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [userRequests, setUserRequests] = useState([]);
  const [contract, setContract] = useState(null);
  const [contractVerified, setContractVerified] = useState(false);
  
  // Buy/Sell contract address (deployed on Ethereum Mainnet)
  const contractAddress = '0x69c29f93eBc486e98E66d901bA2C88B8FD5cBc67';
  
  // Admin and treasury addresses
  const ADMIN_MOBILE_NUMBER = '+256786430457'; // Admin number for onramp
  const TREASURY_WALLET = '0x12214E5538915d17394f2d2F0c3733e9a32e61c1'; // Treasury wallet for offramp

  useEffect(() => {
    if (isConnected && account && window.ethereum) {
      initializeContract();
    }
  }, [isConnected, account]);

  useEffect(() => {
    if (contract && account) {
      loadUserRequests();
      const interval = setInterval(() => {
        loadUserRequests();
      }, 3000); // Poll every 3 seconds
      return () => clearInterval(interval);
    }
  }, [contract, account]);

  const initializeContract = async () => {
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      // Check if contract exists at address
      const code = await provider.getCode(contractAddress);
      if (code === '0x' || code === '0x0') {
        setError(`No contract found at address ${contractAddress}. Please verify the Buy/Sell contract is deployed at this address.`);
        return;
      }
      
      const buySellContract = new ethers.Contract(contractAddress, BUY_SELL_ABI, signer);
      
      // Try to call a view function to verify the contract has the expected interface
      try {
        await buySellContract.admin();
        console.log('Contract verified - admin function exists');
      } catch (verifyErr) {
        console.error('Contract verification failed:', verifyErr);
        // Check if it's a different error (like access denied) vs function doesn't exist
        if (verifyErr.code === 'CALL_EXCEPTION' && !verifyErr.data) {
          setError(`Contract at ${contractAddress} does not have the expected Buy/Sell contract interface. The 'admin()' function is missing. Please verify this is the correct contract address.`);
        } else {
          setError(`Contract verification failed: ${verifyErr.message || 'Unknown error'}`);
        }
        return;
      }
      
      setContract(buySellContract);
      setContractVerified(true);
      setError(''); // Clear any previous errors
    } catch (err) {
      console.error('Error initializing contract:', err);
      setError(`Failed to connect to contract: ${err.message || 'Unknown error'}`);
    }
  };

  const loadUserRequests = async () => {
    if (!contract || !account) return;
    try {
      const requestIds = await contract.getUserRequests(account);
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
      setUserRequests(requests.sort((a, b) => b.id - a.id));
    } catch (err) {
      console.error('Error loading requests:', err);
    }
  };

  const calculateQuote = () => {
    if (!amount || parseFloat(amount) <= 0) {
      setQuote(null);
      return;
    }

    const fiatAmount = parseFloat(amount);
    const rate = EXCHANGE_RATES[currency];
    const usdAmount = fiatAmount / rate;
    
    if (mode === 'buy') {
      // Buying tokens: fiat -> tokens
      const tokenAmount = usdAmount / TOKEN_PRICE_USD;
      const fee = tokenAmount * 0.02; // 2% fee
      const tokensReceived = tokenAmount - fee;
      
      setQuote({
        fiatAmount,
        currency,
        tokenAmount,
        fee,
        tokensReceived,
        usdEquivalent: usdAmount
      });
    } else {
      // Selling tokens: tokens -> fiat
      const tokenAmount = fiatAmount; // User enters token amount
      const usdValue = tokenAmount * TOKEN_PRICE_USD;
      const fee = usdValue * 0.02; // 2% fee
      const fiatReceived = (usdValue - fee) * rate;
      
      setQuote({
        tokenAmount,
        fiatReceived,
        currency,
        fee,
        usdEquivalent: usdValue
      });
    }
  };

  useEffect(() => {
    calculateQuote();
  }, [amount, currency, mode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isConnected) {
      connectWallet();
      return;
    }

    if (!contract) {
      setError('Contract not initialized');
      return;
    }

    if (!quote) {
      setError('Please enter a valid amount');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const currencyType = currency === 'USD' ? 0 : currency === 'UGX' ? 1 : 2;
      
      if (mode === 'buy') {
        // Convert fiat amount to wei (assuming 18 decimals for fiat representation)
        const fiatAmountWei = ethers.parseEther(amount);
        
        // Determine recipient wallet: use provided address or connected wallet
        let recipientAddress = account;
        if (recipientWallet && recipientWallet.trim() !== '') {
          // Validate address
          if (!ethers.isAddress(recipientWallet.trim())) {
            throw new Error('Invalid recipient wallet address');
          }
          recipientAddress = recipientWallet.trim();
        }
        
        // Estimate gas first to catch errors early
        try {
          const gasEstimate = await contract.createBuyRequest.estimateGas(fiatAmountWei, currencyType, recipientAddress);
          console.log('Gas estimate:', gasEstimate.toString());
        } catch (gasErr) {
          console.error('Gas estimation failed:', gasErr);
          console.error('Full error object:', JSON.stringify(gasErr, null, 2));
          
          // Try to extract revert reason
          if (gasErr.reason) {
            throw new Error(`Transaction would fail: ${gasErr.reason}`);
          } else if (gasErr.data) {
            // Try to decode the revert reason
            try {
              const iface = new ethers.Interface(BUY_SELL_ABI);
              const decoded = iface.parseError(gasErr.data);
              throw new Error(`Transaction would fail: ${decoded.name}`);
            } catch (decodeErr) {
              // If we can't decode, check if it's a function not found error
              if (gasErr.code === 'CALL_EXCEPTION' && !gasErr.data) {
                throw new Error(`The contract at ${contractAddress} does not have the 'createBuyRequest' function. Please verify this is the correct Buy/Sell contract address.`);
              }
              throw new Error(`Transaction would fail. Check contract requirements (balance, approvals, etc.). Error: ${gasErr.message || 'Unknown'}`);
            }
          } else if (gasErr.code === 'CALL_EXCEPTION') {
            // This is likely a function not found or contract mismatch
            throw new Error(`Contract call failed. The contract at ${contractAddress} may not have the 'createBuyRequest' function, or the function signature doesn't match. Please verify the contract address and ABI.`);
          } else {
            throw new Error(`Transaction would fail: ${gasErr.message || 'Unknown error'}`);
          }
        }
        
        const tx = await contract.createBuyRequest(fiatAmountWei, currencyType, recipientAddress);
        await tx.wait();
        setSuccess(`Buy request created! Transaction: ${tx.hash}`);
      } else {
        // Convert token amount to wei
        const tokenAmountWei = ethers.parseEther(amount);
        
        // No pre-checks - user will send tokens manually after creating request
        // Just create the request directly
        const tx = await contract.createSellRequest(tokenAmountWei, currencyType, mobileNumber);
        await tx.wait();
        setSuccess(`Sell request created! Transaction: ${tx.hash}. Please send ${amount} MNEE tokens to ${TREASURY_WALLET} to complete your order.`);
      }
      
      setAmount('');
      setMobileNumber('');
      setRecipientWallet('');
      await loadUserRequests();
    } catch (err) {
      console.error('Error creating request:', err);
      
      // Better error messages
      let errorMessage = 'Failed to create request';
      if (err.reason) {
        errorMessage = err.reason;
      } else if (err.message) {
        errorMessage = err.message;
      } else if (err.code === 'CALL_EXCEPTION') {
        errorMessage = 'Contract call failed. The contract may not have this function, or the transaction would revert. Please verify the contract address and function signature.';
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (requestId) => {
    if (!contract) return;
    
    setLoading(true);
    setError('');
    
    try {
      const tx = await contract.cancelRequest(requestId);
      await tx.wait();
      setSuccess('Request cancelled successfully');
      await loadUserRequests();
    } catch (err) {
      console.error('Error cancelling request:', err);
      setError(err.message || 'Failed to cancel request');
    } finally {
      setLoading(false);
    }
  };

  const getCurrencySymbol = (type) => {
    return type === 0 ? 'USD' : type === 1 ? 'UGX' : 'KES';
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
          Buy/Sell MNEE Tokens
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '18px', marginBottom: '2rem' }}>
          Connect your wallet to buy or sell MNEE tokens with fiat currencies
        </p>
        <button
          onClick={connectWallet}
          style={{
            padding: '16px 32px',
            fontSize: '18px',
            background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            fontWeight: '600',
            boxShadow: 'var(--shadow-md)'
          }}
        >
          Connect Wallet
        </button>
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
      <div style={{ marginBottom: '3rem' }}>
        <h2 style={{ 
          fontSize: '48px', 
          marginBottom: '0.5rem',
          background: 'linear-gradient(135deg, #ffffff 0%, #a8b3d0 50%, #6366f1 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text'
        }}>
          Buy/Sell MNEE Tokens
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '18px' }}>
          Exchange MNEE tokens with fiat currencies via mobile money
        </p>
        {contract && !contractVerified && (
          <div style={{
            marginTop: '1rem',
            padding: '1rem',
            background: 'var(--warning-bg)',
            color: 'var(--warning)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--warning)',
            fontSize: '14px'
          }}>
            ⚠️ Contract verification pending. Please ensure the Buy/Sell contract is deployed at {contractAddress}
          </div>
        )}
      </div>

      {/* Mode Selection */}
      <div style={{ 
        display: 'flex', 
        gap: '1rem', 
        marginBottom: '3rem',
        background: 'var(--bg-card)',
        padding: '1rem',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)'
      }}>
        <button
          onClick={() => setMode('buy')}
          style={{
            flex: 1,
            padding: '24px',
            fontSize: '24px',
            fontWeight: '700',
            background: mode === 'buy' 
              ? 'linear-gradient(135deg, var(--success) 0%, #059669 100%)'
              : 'var(--bg-input)',
            color: mode === 'buy' ? 'white' : 'var(--text-secondary)',
            border: mode === 'buy' ? 'none' : '2px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            boxShadow: mode === 'buy' ? 'var(--shadow-glow)' : 'none'
          }}
        >
          🛒 Buy Tokens
        </button>
        <button
          onClick={() => setMode('sell')}
          style={{
            flex: 1,
            padding: '24px',
            fontSize: '24px',
            fontWeight: '700',
            background: mode === 'sell'
              ? 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)'
              : 'var(--bg-input)',
            color: mode === 'sell' ? 'white' : 'var(--text-secondary)',
            border: mode === 'sell' ? 'none' : '2px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            boxShadow: mode === 'sell' ? 'var(--shadow-glow)' : 'none'
          }}
        >
          💰 Sell Tokens
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        {/* Form Section */}
        <div style={{
          background: 'var(--bg-card)',
          padding: '2rem',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)'
        }}>
          <h3 style={{ fontSize: '32px', marginBottom: '2rem', color: 'var(--text-primary)' }}>
            {mode === 'buy' ? 'Buy MNEE Tokens' : 'Sell MNEE Tokens'}
          </h3>

          <form onSubmit={handleSubmit}>
            {/* Currency Selection */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ 
                display: 'block', 
                marginBottom: '0.5rem', 
                fontSize: '18px',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                style={{
                  width: '100%',
                  padding: '18px',
                  fontSize: '18px',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer'
                }}
              >
                <option value="USD">USD ($)</option>
                <option value="UGX">UGX (Ugandan Shilling)</option>
                <option value="KES">KES (Kenyan Shilling)</option>
              </select>
            </div>

            {/* Amount Input */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ 
                display: 'block', 
                marginBottom: '0.5rem', 
                fontSize: '18px',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                {mode === 'buy' ? 'Fiat Amount' : 'Token Amount (MNEE)'}
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={mode === 'buy' ? `Enter amount in ${currency}` : 'Enter MNEE amount'}
                min="0"
                step="0.01"
                required
                style={{
                  width: '100%',
                  padding: '18px',
                  fontSize: '18px',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  outline: 'none'
                }}
              />
            </div>

            {/* Buy Mode: Admin Number Info and Recipient Wallet */}
            {mode === 'buy' && (
              <>
                <div style={{ 
                  marginBottom: '1.5rem',
                  padding: '1rem',
                  background: 'var(--warning-bg)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--warning)'
                }}>
                  <div style={{ 
                    fontSize: '14px', 
                    color: 'var(--text-secondary)', 
                    marginBottom: '0.5rem' 
                  }}>
                    Send payment to:
                  </div>
                  <div style={{ 
                    fontSize: '18px', 
                    fontWeight: '700', 
                    color: 'var(--warning)',
                    fontFamily: 'var(--font-mono)'
                  }}>
                    {ADMIN_MOBILE_NUMBER}
                  </div>
                  <div style={{ 
                    fontSize: '12px', 
                    color: 'var(--text-muted)', 
                    marginTop: '0.5rem' 
                  }}>
                    After sending payment, admin will confirm and send tokens to your wallet
                  </div>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ 
                    display: 'block', 
                    marginBottom: '0.5rem', 
                    fontSize: '18px',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    Wallet Address to Receive Tokens
                  </label>
                  <input
                    type="text"
                    value={recipientWallet}
                    onChange={(e) => setRecipientWallet(e.target.value)}
                    placeholder={account ? `${account.slice(0, 6)}...${account.slice(-4)} (leave blank to use connected wallet)` : 'Enter wallet address'}
                    style={{
                      width: '100%',
                      padding: '18px',
                      fontSize: '18px',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      outline: 'none',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                  {account && (
                    <div style={{ 
                      fontSize: '14px', 
                      color: 'var(--text-secondary)', 
                      marginTop: '0.5rem' 
                    }}>
                      Connected: {account}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Sell Mode: Treasury Address Info and Mobile Number */}
            {mode === 'sell' && (
              <>
                <div style={{ 
                  marginBottom: '1.5rem',
                  padding: '1rem',
                  background: 'var(--primary-light)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--primary)'
                }}>
                  <div style={{ 
                    fontSize: '14px', 
                    color: 'var(--text-secondary)', 
                    marginBottom: '0.5rem' 
                  }}>
                    Send MNEE tokens to:
                  </div>
                  <div style={{ 
                    fontSize: '16px', 
                    fontWeight: '700', 
                    color: 'var(--primary)',
                    fontFamily: 'var(--font-mono)',
                    wordBreak: 'break-all'
                  }}>
                    {TREASURY_WALLET}
                  </div>
                  <div style={{ 
                    fontSize: '12px', 
                    color: 'var(--text-muted)', 
                    marginTop: '0.5rem' 
                  }}>
                    After sending tokens, admin will confirm and send cash to your mobile number
                  </div>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ 
                    display: 'block', 
                    marginBottom: '0.5rem', 
                    fontSize: '18px',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    Your Mobile Money Number
                  </label>
                  <input
                    type="text"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(e.target.value)}
                    placeholder="+256XXXXXXXXX"
                    required
                    style={{
                      width: '100%',
                      padding: '18px',
                      fontSize: '18px',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      outline: 'none'
                    }}
                  />
                </div>
              </>
            )}

            {/* Quote Preview */}
            {quote && (
              <div style={{
                background: 'var(--bg-input)',
                padding: '1.5rem',
                borderRadius: 'var(--radius-md)',
                marginBottom: '1.5rem',
                border: '1px solid var(--border)'
              }}>
                <h4 style={{ fontSize: '20px', marginBottom: '1rem', color: 'var(--text-primary)' }}>
                  Quote Preview
                </h4>
                {mode === 'buy' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Fiat Amount:</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>
                        {quote.fiatAmount.toFixed(2)} {quote.currency}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Token Amount:</span>
                      <span style={{ color: 'var(--success)', fontWeight: '600' }}>
                        {quote.tokenAmount.toFixed(4)} MNEE
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Fee (2%):</span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        -{quote.fee.toFixed(4)} MNEE
                      </span>
                    </div>
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      paddingTop: '0.5rem',
                      borderTop: '1px solid var(--border)',
                      marginTop: '0.5rem'
                    }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>You Receive:</span>
                      <span style={{ color: 'var(--success)', fontWeight: '700', fontSize: '20px' }}>
                        {quote.tokensReceived.toFixed(4)} MNEE
                      </span>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Token Amount:</span>
                      <span style={{ color: 'var(--primary)', fontWeight: '600' }}>
                        {quote.tokenAmount.toFixed(4)} MNEE
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Fee (2%):</span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        -{quote.fee.toFixed(2)} {quote.currency}
                      </span>
                    </div>
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      paddingTop: '0.5rem',
                      borderTop: '1px solid var(--border)',
                      marginTop: '0.5rem'
                    }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>You Receive:</span>
                      <span style={{ color: 'var(--success)', fontWeight: '700', fontSize: '20px' }}>
                        {quote.fiatReceived.toFixed(2)} {quote.currency}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || !quote}
              style={{
                width: '100%',
                padding: '20px',
                fontSize: '20px',
                fontWeight: '700',
                background: loading || !quote
                  ? 'var(--text-muted)'
                  : mode === 'buy'
                    ? 'linear-gradient(135deg, var(--success) 0%, #059669 100%)'
                    : 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: loading || !quote ? 'not-allowed' : 'pointer',
                boxShadow: 'var(--shadow-md)',
                transition: 'all 0.3s ease'
              }}
            >
              {loading ? 'Processing...' : mode === 'buy' ? 'Create Buy Request' : 'Create Sell Request'}
            </button>
          </form>

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

        {/* Orders Section */}
        <div style={{
          background: 'var(--bg-card)',
          padding: '2rem',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)'
        }}>
          <h3 style={{ fontSize: '32px', marginBottom: '2rem', color: 'var(--text-primary)' }}>
            My Orders
          </h3>

          {userRequests.length === 0 ? (
            <div style={{ 
              textAlign: 'center', 
              padding: '3rem',
              color: 'var(--text-secondary)',
              fontSize: '18px'
            }}>
              No orders yet. Create your first {mode === 'buy' ? 'buy' : 'sell'} request above.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {userRequests.map((request) => (
                <div
                  key={request.id}
                  style={{
                    background: 'var(--bg-input)',
                    padding: '1.5rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border)',
                    borderLeft: `4px solid ${
                      request.status === 0 ? 'var(--warning)' :
                      request.status === 1 ? 'var(--success)' :
                      request.status === 2 ? 'var(--error)' : 'var(--text-muted)'
                    }`
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div>
                      <div style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>
                        Request #{request.id}
                      </div>
                      <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                        {new Date(request.timestamp * 1000).toLocaleString()}
                      </div>
                    </div>
                    <div style={{
                      padding: '0.5rem 1rem',
                      borderRadius: 'var(--radius-sm)',
                      background: request.status === 0 ? 'var(--warning-bg)' :
                                  request.status === 1 ? 'var(--success-bg)' :
                                  request.status === 2 ? 'var(--error-bg)' : 'var(--bg-input)',
                      color: request.status === 0 ? 'var(--warning)' :
                             request.status === 1 ? 'var(--success)' :
                             request.status === 2 ? 'var(--error)' : 'var(--text-muted)',
                      fontWeight: '600'
                    }}>
                      {REQUEST_STATUS[request.status]}
                    </div>
                  </div>

                  <div style={{ marginBottom: '0.5rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Amount: </span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>
                      {parseFloat(request.amount).toFixed(4)} {getCurrencySymbol(request.currencyType)}
                    </span>
                  </div>

                  {request.recipientWallet && request.recipientWallet !== ethers.ZeroAddress ? (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Recipient Wallet: </span>
                      <span style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)', fontSize: '14px' }}>
                        {request.recipientWallet}
                      </span>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        Send payment to: <strong style={{ color: 'var(--warning)' }}>+256786430457</strong>
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Mobile: </span>
                      <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                        {request.mobileNumber}
                      </span>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        Send tokens to: <strong style={{ color: 'var(--primary)' }}>0x12214E5538915d17394f2d2F0c3733e9a32e61c1</strong>
                      </div>
                    </div>
                  )}

                  {request.adminNotes && (
                    <div style={{ 
                      marginTop: '1rem',
                      padding: '0.75rem',
                      background: 'var(--bg-card)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '14px',
                      color: 'var(--text-secondary)'
                    }}>
                      <strong>Admin Notes:</strong> {request.adminNotes}
                    </div>
                  )}

                  {request.status === 0 && (
                    <button
                      onClick={() => handleCancel(request.id)}
                      disabled={loading}
                      style={{
                        marginTop: '1rem',
                        padding: '0.75rem 1.5rem',
                        background: 'var(--error)',
                        color: 'white',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                        fontWeight: '600'
                      }}
                    >
                      Cancel Request
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default BuySellInterface;

