// Hardhat deployment script for BuySell contract on Ethereum Mainnet
// Run with: npx hardhat run scripts/deploy-buysell-mainnet.js --network ethereum

import hre from "hardhat";

async function main() {
  console.log("🚀 Deploying BuySell contract to Ethereum Mainnet...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Deploying with account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  if (balance === 0n) {
    console.error("❌ Error: Account has no ETH. Please fund the account with ETH.");
    process.exit(1);
  }

  // Configuration
  const MNEE_TOKEN_ADDRESS = "0x8ccedbAe4916b79da7F3F612EfB2EB93A2bFD6cF"; // MNEE on Ethereum Mainnet
  const ADMIN_WALLET = "0x12214E5538915d17394f2d2F0c3733e9a32e61c1"; // Admin wallet
  const TREASURY_WALLET = "0x12214E5538915d17394f2d2F0c3733e9a32e61c1"; // Treasury wallet (same as admin)

  console.log("📌 Configuration:");
  console.log("   MNEE Token Address:", MNEE_TOKEN_ADDRESS);
  console.log("   Admin Wallet:", ADMIN_WALLET);
  console.log("   Treasury Wallet:", TREASURY_WALLET);
  console.log("");

  // Verify token contract exists
  const tokenCode = await hre.ethers.provider.getCode(MNEE_TOKEN_ADDRESS);
  if (tokenCode === '0x' || tokenCode === '0x0') {
    console.error("❌ Error: MNEE token contract not found at", MNEE_TOKEN_ADDRESS);
    console.error("   Please verify the MNEE token address is correct for Ethereum Mainnet");
    process.exit(1);
  }
  console.log("✅ MNEE token contract verified\n");

  // Deploy BuySell contract
  console.log("📦 Deploying BuySell contract...");
  const BuySell = await hre.ethers.getContractFactory("BuySell");
  
  // Set gas limit for deployment
  const gasLimit = 2000000n; // 2 million gas should be sufficient for BuySell
  console.log("⛽ Using gas limit:", gasLimit.toString());
  
  const buySell = await BuySell.deploy(MNEE_TOKEN_ADDRESS, ADMIN_WALLET, TREASURY_WALLET, {
    gasLimit: gasLimit
  });

  console.log("⏳ Waiting for deployment transaction to be mined...");
  await buySell.waitForDeployment();
  const contractAddress = await buySell.getAddress();

  console.log("✅ BuySell contract deployed!");
  console.log("📍 Address:", contractAddress);
  console.log("🔗 Explorer:", `https://etherscan.io/address/${contractAddress}\n`);

  // Save deployment info
  const deploymentInfo = {
    network: "Ethereum Mainnet",
    chainId: 1,
    rpcUrl: "https://eth.llamarpc.com",
    explorerUrl: "https://etherscan.io",
    tokenAddress: MNEE_TOKEN_ADDRESS,
    tokenSymbol: "MNEE",
    contractName: "BuySell",
    contractAddress: contractAddress,
    adminAddress: ADMIN_WALLET,
    treasuryAddress: TREASURY_WALLET,
    deployerAddress: deployer.address,
    deploymentDate: new Date().toISOString()
  };

  console.log("💾 Deployment Info:");
  console.log(JSON.stringify(deploymentInfo, null, 2));
  console.log("\n🎉 BuySell deployment complete!\n");
  
  console.log("📋 Next steps:");
  console.log("1. Verify the contract on Etherscan:");
  console.log(`   npx hardhat verify --network ethereum ${contractAddress} "${MNEE_TOKEN_ADDRESS}" "${ADMIN_WALLET}" "${TREASURY_WALLET}"`);
  console.log("\n2. Update your frontend with the contract address:", contractAddress);
  console.log("3. Update src/components/BuySellInterface.jsx with the new contract address");
  console.log("4. Update src/components/BuySellAdmin.jsx with the new contract address\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

