# GitHub Setup Instructions

## ✅ Completed

1. **Removed Private Keys**
   - Updated `hardhat.config.js` to use environment variables instead of hardcoded keys
   - Updated `.gitignore` to exclude `.env` files and sensitive data

2. **Removed Unnecessary Files**
   - Deleted `StreamFiUnified.sol` (not needed - deployed separately)
   - Deleted `StreamingPayment.sol` (not used in main app)
   - Deleted `PaymentSchedule.sol` (not used in main app)
   - Deleted `TestStablecoin.sol` (using MNEE on mainnet)
   - Deleted all unnecessary deployment scripts
   - Deleted unused component files

3. **Kept Essential Files**
   - `contracts/StreamFi.sol` - Main streaming contract
   - `contracts/BuySell.sol` - Buy/Sell contract
   - `scripts/deploy-streamfi-mainnet.js` - StreamFi deployment
   - `scripts/deploy-buysell-mainnet.js` - BuySell deployment
   - All frontend components updated for MNEE

4. **Git Repository**
   - Initialized git repository
   - Committed all changes

## 🚀 Push to GitHub

### Option 1: Create New Repository on GitHub

1. Go to https://github.com/new
2. Create a new repository (e.g., `streamfi-mnee`)
3. **DO NOT** initialize with README, .gitignore, or license
4. Run these commands:

```bash
git remote add origin https://github.com/YOUR_USERNAME/streamfi-mnee.git
git branch -M main
git push -u origin main
```

### Option 2: Use Existing Repository

If you already have a GitHub repository:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

## ⚠️ Important: Environment Variables

Before deploying, create a `.env` file (this is already in `.gitignore`):

```env
PRIVATE_KEY=your_private_key_here
ETHEREUM_RPC_URL=https://eth.llamarpc.com
ADMIN_WALLET=0x12214E5538915d17394f2d2F0c3733e9a32e61c1
TREASURY_WALLET=0x12214E5538915d17394f2d2F0c3733e9a32e61c1
```

**Never commit the `.env` file!**

## 📋 What's Included

- ✅ StreamFi contract (deployed to mainnet)
- ✅ BuySell contract (deployed to mainnet)
- ✅ Frontend updated for MNEE token
- ✅ Mainnet deployment scripts
- ✅ No private keys in code
- ✅ Clean repository structure

## 📝 Deployment Addresses

- **StreamFi**: `0x65fEEd327e7d9a84df26446c48a46B42853cD074`
- **BuySell**: `0x69c29f93eBc486e98E66d901bA2C88B8FD5cBc67`
- **MNEE Token**: `0x8ccedbAe4916b79da7F3F612EfB2EB93A2bFD6cF`

