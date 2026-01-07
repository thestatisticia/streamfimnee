import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { getActiveTokenConfig, ERC20_ABI } from '../config/tokens.js'

/**
 * Generic hook for interacting with any ERC-20 token
 * Works with MNEE token on Ethereum Mainnet
 */
export function useToken() {
  const [account, setAccount] = useState(null)
  const [provider, setProvider] = useState(null)
  const [signer, setSigner] = useState(null)
  const [balance, setBalance] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [chainId, setChainId] = useState(null)
  const [tokenInfo, setTokenInfo] = useState(null)

  // Get current token config
  const getTokenConfig = () => {
    return getActiveTokenConfig()
  }

  // Check if MetaMask is installed
  const checkMetaMask = () => {
    if (typeof window.ethereum !== 'undefined') {
      return true
    }
    setError('MetaMask is not installed. Please install MetaMask to continue.')
    return false
  }

  // Switch to correct network
  const switchNetwork = async () => {
    if (!window.ethereum) return false

    const tokenConfig = getTokenConfig()
    
    try {
      // Check current chain
      const currentChainId = await window.ethereum.request({
        method: 'eth_chainId'
      })
      
      const currentChainIdDecimal = parseInt(currentChainId, 16)
      
      if (currentChainIdDecimal === tokenConfig.chainId) {
        return true // Already on correct network
      }

      // Try to switch network
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${tokenConfig.chainId.toString(16)}` }]
        })
        return true
      } catch (switchError) {
        // Network doesn't exist, add it
        if (switchError.code === 4902) {
          // Provide multiple RPC URLs as fallbacks
          const rpcUrls = [
            tokenConfig.rpcUrl,
            'https://base-sepolia-rpc.publicnode.com',
            'https://sepolia.base.org',
            'https://base-sepolia.g.alchemy.com/v2/demo'
          ].filter(Boolean)
          
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${tokenConfig.chainId.toString(16)}`,
              chainName: tokenConfig.networkName,
              nativeCurrency: {
                name: 'ETH',
                symbol: 'ETH',
                decimals: 18
              },
              rpcUrls: rpcUrls,
              blockExplorerUrls: [tokenConfig.explorerUrl]
            }]
          })
          return true
        }
        throw switchError
      }
    } catch (err) {
      console.error('Network switch error:', err)
      setError(`Failed to switch to ${tokenConfig.networkName}. Please switch manually in MetaMask.`)
      return false
    }
  }

  // Connect to MetaMask
  const connectWallet = async () => {
    try {
      setError(null)
      setLoading(true)

      if (!checkMetaMask()) {
        return
      }

      // Switch to correct network
      const networkSwitched = await switchNetwork()
      if (!networkSwitched) {
        setLoading(false)
        return
      }

      // Request account access
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      })

      if (accounts.length === 0) {
        throw new Error('No accounts found')
      }

      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const address = await signer.getAddress()
      const network = await provider.getNetwork()

      setProvider(provider)
      setSigner(signer)
      setAccount(address)
      setChainId(Number(network.chainId))
      setIsConnected(true)

      // Load token info and balance
      await loadTokenInfo(provider)
      await loadBalance(provider, address)
    } catch (err) {
      setError(err.message || 'Failed to connect wallet')
      console.error('Connection error:', err)
    } finally {
      setLoading(false)
    }
  }

  // Disconnect wallet
  const disconnectWallet = () => {
    setAccount(null)
    setProvider(null)
    setSigner(null)
    setBalance(null)
    setIsConnected(false)
    setChainId(null)
    setTokenInfo(null)
    setError(null)
  }

  // Retry helper with exponential backoff
  const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
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
          err.code === 'CALL_EXCEPTION'
        
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

  // Load token info (name, symbol, decimals)
  const loadTokenInfo = async (providerInstance = provider) => {
    if (!providerInstance) return

    const tokenConfig = getTokenConfig()
    
    if (!tokenConfig.contractAddress) {
      setError(`Token contract address not configured. Please check config/tokens.js`)
      return
    }

    try {
      const contract = new ethers.Contract(
        tokenConfig.contractAddress,
        ERC20_ABI,
        providerInstance
      )

      // Use retry logic for token info calls
      const [name, symbol, decimals] = await retryWithBackoff(async () => {
        return await Promise.all([
          contract.name(),
          contract.symbol(),
          contract.decimals()
        ])
      }, 3, 2000)

      setTokenInfo({ name, symbol, decimals: Number(decimals) })
    } catch (err) {
      console.error('Error loading token info:', err)
      // Don't set error for token info failures, just log it
    }
  }

  // Load token balance
  const loadBalance = async (providerInstance = provider, address = account) => {
    if (!providerInstance || !address) return

    const tokenConfig = getTokenConfig()
    
    if (!tokenConfig.contractAddress) {
      setError(`Token contract address not configured. Please check config/tokens.js`)
      return
    }

    try {
      const contract = new ethers.Contract(
        tokenConfig.contractAddress,
        ERC20_ABI,
        providerInstance
      )

      // Use retry logic for balance call
      const balance = await retryWithBackoff(async () => {
        return await contract.balanceOf(address)
      }, 3, 2000) // 3 retries, starting with 2 second delay
      
      const decimals = tokenInfo?.decimals || tokenConfig.decimals
      const formattedBalance = ethers.formatUnits(balance, decimals)
      
      setBalance(formattedBalance)
      setError(null) // Clear error on success
    } catch (err) {
      console.error('Error loading balance:', err)
      
      // Provide more specific error messages
      if (err.code === -32002 || err.message?.includes('too many errors')) {
        setError('RPC endpoint rate limited. Please wait a moment and refresh, or try switching to a different RPC endpoint in MetaMask settings.')
      } else if (err.code === 'CALL_EXCEPTION' || err.message?.includes('missing revert data')) {
        // Check if contract exists
        try {
          const code = await providerInstance.getCode(tokenConfig.contractAddress)
          if (code === '0x' || code === '0x0') {
            setError(`Token contract not found at ${tokenConfig.contractAddress}. Please verify deployment.`)
          } else {
            setError('Failed to load balance. The RPC endpoint may be experiencing issues. Please try again in a moment.')
          }
        } catch {
          setError('Failed to load balance. Please check your network connection and ensure you\'re on Ethereum Sepolia.')
        }
      } else {
        setError('Failed to load balance. Make sure you\'re on the correct network.')
      }
    }
  }

  // Transfer tokens
  const transfer = async (toAddress, amount) => {
    if (!signer || !account) {
      throw new Error('Wallet not connected')
    }

    try {
      setLoading(true)
      setError(null)

      const tokenConfig = getTokenConfig()
      
      if (!tokenConfig.contractAddress) {
        throw new Error('Token contract address not configured')
      }

      const contract = new ethers.Contract(
        tokenConfig.contractAddress,
        ERC20_ABI,
        signer
      )

      const decimals = tokenInfo?.decimals || tokenConfig.decimals
      const amountWei = ethers.parseUnits(amount.toString(), decimals)
      
      const tx = await contract.transfer(toAddress, amountWei)
      await tx.wait()

      // Reload balance after transfer
      await loadBalance()

      return tx.hash
    } catch (err) {
      const errorMsg = err.message || 'Transfer failed'
      setError(errorMsg)
      throw new Error(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  // Mint tokens (not available for MNEE - it's a real stablecoin)
  const mint = async (toAddress, amount) => {
    if (!signer || !account) {
      throw new Error('Wallet not connected')
    }

    try {
      setLoading(true)
      setError(null)

      const tokenConfig = getTokenConfig()
      
      if (!tokenConfig.contractAddress) {
        throw new Error('Token contract address not configured')
      }

      const contract = new ethers.Contract(
        tokenConfig.contractAddress,
        ERC20_ABI,
        signer
      )

      const decimals = tokenInfo?.decimals || tokenConfig.decimals
      const amountWei = ethers.parseUnits(amount.toString(), decimals)
      
      const tx = await contract.mint(toAddress, amountWei)
      await tx.wait()

      // Reload balance after minting
      await loadBalance()

      return tx.hash
    } catch (err) {
      const errorMsg = err.message || 'Mint failed. You may not be the contract owner.'
      setError(errorMsg)
      throw new Error(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  // Get current network info
  const getNetworkInfo = () => {
    return getTokenConfig()
  }

  // Listen for account and chain changes
  useEffect(() => {
    if (typeof window.ethereum !== 'undefined') {
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length === 0) {
          setAccount(null)
          setProvider(null)
          setSigner(null)
          setBalance(null)
          setIsConnected(false)
        } else {
          connectWallet()
        }
      })

      window.ethereum.on('chainChanged', () => {
        window.location.reload()
      })
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeAllListeners('accountsChanged')
        window.ethereum.removeAllListeners('chainChanged')
      }
    }
  }, [])

  return {
    account,
    balance,
    isConnected,
    error,
    loading,
    chainId,
    tokenInfo,
    connectWallet,
    disconnectWallet,
    transfer,
    mint,
    loadBalance,
    getNetworkInfo,
    switchNetwork
  }
}

