require("@matterlabs/hardhat-zksync");
require("dotenv/config");

// Import network configuration
const getNetworkConfig = () => {
  const testnetRpcUrl = process.env.TESTNET_RPC_URL;
  const mainnetRpcUrl = process.env.MAINNET_RPC_URL;
  const testnetChainId = parseInt(process.env.TESTNET_CHAIN_ID || "11124");
  const mainnetChainId = parseInt(process.env.MAINNET_CHAIN_ID || "2741");
  const privateKey = process.env.AGW_SESSION_PRIVATE_KEY;

  if (!testnetRpcUrl || !mainnetRpcUrl) {
    throw new Error("Missing RPC URLs. Set TESTNET_RPC_URL and MAINNET_RPC_URL in .env");
  }

  if (!privateKey) {
    throw new Error("Missing private key. Set AGW_SESSION_PRIVATE_KEY in .env");
  }

  return {
    testnetRpcUrl,
    mainnetRpcUrl,
    testnetChainId,
    mainnetChainId,
    privateKey
  };
};

const config = {
  zksolc: {
    version: "1.5.0",
    settings: {
      optimizer: {
        enabled: true,
      },
    },
  },
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    // Abstract Testnet Configuration
    "abstract-testnet": {
      url: process.env.TESTNET_RPC_URL || "https://api.testnet.abs.xyz",
      ethNetwork: "sepolia",
      zksync: true,
      chainId: parseInt(process.env.TESTNET_CHAIN_ID || "11124"),
      accounts: process.env.AGW_SESSION_PRIVATE_KEY ? [`0x${process.env.AGW_SESSION_PRIVATE_KEY}`] : [],
    },
    // Abstract Mainnet Configuration (SAFETY: Should require explicit confirmation)
    "abstract-mainnet": {
      url: process.env.MAINNET_RPC_URL || "",
      ethNetwork: "mainnet",
      zksync: true,
      chainId: parseInt(process.env.MAINNET_CHAIN_ID || "2741"),
      accounts: process.env.AGW_SESSION_PRIVATE_KEY ? [`0x${process.env.AGW_SESSION_PRIVATE_KEY}`] : [],
    },
    // Local development
    hardhat: {
      chainId: 31337,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test/contracts",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 40000,
  },
};

// Safety check: Warn about mainnet deployment
if (process.argv.includes("--network") && process.argv.includes("abstract-mainnet")) {
  console.warn("⚠️  WARNING: You are about to deploy to ABSTRACT MAINNET!");
  console.warn("⚠️  This will use real ETH and deploy to production!");
  console.warn("⚠️  Make sure this is intentional!");
}

// Log network configuration on load
if (process.env.NODE_ENV !== "test") {
  try {
    const networkConfig = getNetworkConfig();
    console.log("🔧 Hardhat networks configured:");
    console.log(`   🧪 Testnet: Chain ${networkConfig.testnetChainId} (${networkConfig.testnetRpcUrl.replace(/\/v2\/.*/, '/v2/***')})`);
    console.log(`   🚀 Mainnet: Chain ${networkConfig.mainnetChainId} (${networkConfig.mainnetRpcUrl.replace(/\/v2\/.*/, '/v2/***')})`);
  } catch (error) {
    console.warn("⚠️  Network configuration incomplete:", error.message);
  }
}

module.exports = config;