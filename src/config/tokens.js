// Token Configuration for StreamFi
// MNEE (MNEE USD Stablecoin) on Ethereum Mainnet

export const TOKEN_CONFIG = {
  mnee: {
    contractAddress: '0x8ccedbAe4916b79da7F3F612EfB2EB93A2bFD6cF', // MNEE on Ethereum Mainnet
    chainId: 1, // Ethereum Mainnet
    decimals: 18,
    symbol: 'MNEE',
    name: 'MNEE USD Stablecoin',
    rpcUrl: 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
    networkName: 'Ethereum Mainnet',
    isTestnet: false
  }
}

// Get active token config
export const getActiveTokenConfig = () => {
  return TOKEN_CONFIG.mnee
}

// ERC-20 ABI for MNEE token
export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  // Note: MNEE doesn't have a mint function (it's a real stablecoin)
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)'
]

