// scripts/hardhat_deploy.js
// Hardhat deployment script for Abstract with safety checks

// Since Hardhat uses CommonJS, we'll do the safety checks inline
const isMainnetNetwork = () => {
  const network = process.env.NETWORK?.toLowerCase();
  return network !== 'testnet'; // Default to mainnet
};

const requireMainnetConfirmation = (confirmationFlag) => {
  if (isMainnetNetwork() && !confirmationFlag) {
    throw new Error(
      '🚨 MAINNET OPERATION BLOCKED!\n' +
      '   This operation will use REAL ETH on Abstract Mainnet.\n' +
      '   Pass --confirm-mainnet flag to proceed with mainnet deployment.\n' +
      '   ⚠️  Use testnet for development: NETWORK=testnet'
    );
  }
};

const getNetworkDisplayName = () => {
  const emoji = isMainnetNetwork() ? '🚀' : '🧪';
  const chainId = isMainnetNetwork() ? '2741' : '11124';
  const networkName = isMainnetNetwork() ? 'Mainnet' : 'Testnet';
  return `${emoji} Abstract ${networkName} (Chain ID: ${chainId})`;
};

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const confirmMainnet = args.includes('--confirm-mainnet');

  // Safety check for mainnet deployments
  if (isMainnetNetwork()) {
    try {
      requireMainnetConfirmation(confirmMainnet);
    } catch (error) {
      console.error(error.message);
      console.error(`\n💡 To deploy to mainnet, use:`);
      console.error(`   npx hardhat run scripts/hardhat_deploy.js --network abstract-mainnet --confirm-mainnet`);
      process.exit(1);
    }
  }

  const networkName = getNetworkDisplayName();
  console.log(`🚀 Deploying MerkleRegistry to ${networkName}...`);

  if (isMainnetNetwork()) {
    console.log(`🚨 MAINNET DEPLOYMENT CONFIRMED - Using real ETH!`);
    console.log(`⏳ Starting deployment in 3 seconds...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Get the contract factory
  const MerkleRegistry = await ethers.getContractFactory("MerkleRegistry");

  console.log("📦 Deploying contract...");

  // Deploy the contract
  const merkleRegistry = await MerkleRegistry.deploy();

  // Wait for deployment to complete
  await merkleRegistry.waitForDeployment();

  const contractAddress = await merkleRegistry.getAddress();
  console.log("✅ MerkleRegistry deployed to:", contractAddress);

  // Test basic functionality
  console.log("🔍 Testing contract...");
  const owner = await merkleRegistry.owner();
  console.log("   Owner:", owner);

  const deployer = await ethers.provider.getSigner();
  const deployerAddress = await deployer.getAddress();
  console.log("   Deployer:", deployerAddress);
  console.log("   Owner Match:", owner.toLowerCase() === deployerAddress.toLowerCase());

  const isAuthorized = await merkleRegistry.isAuthorizedPublisher(deployerAddress);
  console.log("   Deployer Authorized:", isAuthorized);

  console.log("\n🎯 Deployment completed successfully!");
  console.log(`Contract Address: ${contractAddress}`);

  return contractAddress;
}

main()
  .then((address) => {
    console.log(`\n💾 Save this address to your .env file:`);
    console.log(`TESTNET_REGISTRY_CONTRACT_ADDRESS=${address}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });