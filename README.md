# Automatic Payment System dApp

A decentralized application for creating and managing automatic recurring payments using TST (Test Stablecoin) on Base Sepolia testnet.

## Features

- ✅ Create automatic payment schedules
- ✅ Add multiple recipient wallet addresses
- ✅ Set custom payment intervals (days, hours, minutes)
- ✅ Execute payments automatically or manually
- ✅ Track payment history and statistics
- ✅ Deactivate schedules anytime

## Quick Start

### 1. Deploy Contracts

First, deploy the PaymentSchedule contract:

```bash
# Set your private key
export PRIVATE_KEY=your_private_key_here

# Deploy PaymentSchedule contract
npx hardhat run scripts/deploy-payment-schedule.js --network baseSepolia
```

After deployment, copy the contract address and update it in `src/components/AutomaticPaymentDapp.jsx`:

```javascript
const [contractAddress, setContractAddress] = useState('YOUR_DEPLOYED_ADDRESS');
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run the App

```bash
npm run dev
```

### 4. Connect Wallet

1. Open the app in your browser
2. Connect MetaMask wallet
3. Make sure you're on **Base Sepolia** testnet
4. You should have TST tokens (mint them if needed)

## How It Works

### Creating a Payment Schedule

1. Click "Create Schedule" tab
2. Enter recipient wallet address
3. Set payment amount in TST
4. Set payment interval (days, hours, minutes)
5. Click "Create Schedule"
6. Approve token spending when prompted

### Managing Schedules

1. Click "Manage Schedules" tab
2. View all your active and inactive schedules
3. Execute payments manually when due
4. Deactivate schedules you no longer need

### Automatic Payments

- Payments can be executed by anyone when due
- The contract checks if payment is due based on the interval
- You need to maintain sufficient TST balance and allowance

## Smart Contracts

### TestStablecoin (TST)
- **Address**: `0x36Ae60Ba7Bb2Fe8106DF765F0729842aa06152e9`
- **Network**: Base Sepolia (Chain ID: 84532)
- Standard ERC-20 token with mint function

### PaymentSchedule
- Manages recurring payment schedules
- Executes payments automatically
- Tracks payment history

## Network Configuration

- **Network**: Base Sepolia Testnet
- **Chain ID**: 84532
- **RPC**: https://base-sepolia-rpc.publicnode.com
- **Explorer**: https://sepolia.basescan.org

## Project Structure

```
my-project/
├── contracts/
│   ├── TestStablecoin.sol          # TST token contract
│   └── PaymentSchedule.sol         # Payment scheduler contract
├── scripts/
│   ├── deploy.js                   # Deploy TST token
│   └── deploy-payment-schedule.js  # Deploy PaymentSchedule
├── src/
│   ├── components/
│   │   └── AutomaticPaymentDapp.jsx  # Main app component
│   ├── config/
│   │   └── tokens.js               # Token configuration
│   ├── hooks/
│   │   └── useToken.js             # Token interaction hook
│   └── App.jsx                     # Root component
└── hardhat.config.js              # Hardhat configuration
```

## Development

```bash
# Compile contracts
npx hardhat compile

# Run tests (if any)
npx hardhat test

# Deploy contracts
npx hardhat run scripts/deploy-payment-schedule.js --network baseSepolia

# Start dev server
npm run dev

# Build for production
npm run build
```

## Troubleshooting

### "RPC endpoint not found"
- Update Base Sepolia network in MetaMask with a working RPC URL
- See `TROUBLESHOOTING_RPC.md` for details

### "Insufficient balance"
- Mint TST tokens using the TestStablecoin contract
- Ensure you have enough TST for payments

### "Insufficient allowance"
- Approve the PaymentSchedule contract to spend your TST tokens
- The app will prompt you to approve when creating a schedule

## License

MIT
