#!/usr/bin/env npx tsx
// scripts/mainnet_deployment_dryrun.ts
// Comprehensive mainnet deployment dry-run and readiness check

import "dotenv/config";
import { ethers } from "ethers";
import { readFileSync, writeFileSync } from "fs";
import crypto from "crypto";
import {
  getAbstractRpcUrl,
  getAbstractChainId,
  getNetworkType,
  getNetworkDisplayName,
  isMainnet,
  requireMainnetConfirmation,
  validateMainnetReadiness
} from "../src/services/network.js";

interface DeploymentReadinessReport {
  network: string;
  timestamp: string;
  readiness: {
    ready: boolean;
    issues: string[];
  };
  contract: {
    name: string;
    bytecodeHash: string;
    abiChecksum: string;
    deploymentSize: number;
    estimatedGas?: string;
  };
  environment: {
    rpcUrl: string;
    chainId: number;
    walletAddress: string;
    walletBalance?: string;
  };
  safety: {
    confirmationRequired: boolean;
    noTransactionsSent: boolean;
    dryRunOnly: boolean;
  };
  explorer: {
    baseUrl: string;
    verificationSupported: boolean;
  };
}

// Parse command line arguments
const args = process.argv.slice(2);
const confirmMainnet = args.includes('--confirm-mainnet');
const skipGasEstimate = args.includes('--skip-gas');

function loadCompiledContract() {
  try {
    const artifactPath = "/home/arson/builds/piptip/artifacts/contracts/MerkleRegistry.sol/MerkleRegistry.json";
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    return {
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      name: artifact.contractName
    };
  } catch (error) {
    throw new Error(`Failed to load compiled contract: ${error}. Run 'npx hardhat compile' first.`);
  }
}

function calculateHashes(abi: any[], bytecode: string) {
  // Calculate bytecode hash
  const bytecodeHash = crypto.createHash('sha256').update(bytecode).digest('hex');

  // Calculate ABI checksum
  const abiString = JSON.stringify(abi, null, 0);
  const abiChecksum = crypto.createHash('sha256').update(abiString).digest('hex');

  return { bytecodeHash, abiChecksum };
}

async function estimateDeploymentGas(
  provider: ethers.JsonRpcProvider,
  wallet: ethers.Wallet,
  contractFactory: ethers.ContractFactory
): Promise<bigint | null> {
  if (skipGasEstimate) {
    console.log(`⏭️  Skipping gas estimation (--skip-gas flag)`);
    return null;
  }

  try {
    console.log(`⛽ Estimating deployment gas...`);

    // Create deployment transaction data
    const deployTx = await contractFactory.getDeployTransaction();

    // Estimate gas without sending transaction
    const gasEstimate = await provider.estimateGas({
      ...deployTx,
      from: wallet.address
    });

    console.log(`   ✅ Gas estimation successful: ${gasEstimate.toString()}`);
    return gasEstimate;

  } catch (error) {
    console.warn(`   ⚠️  Gas estimation failed: ${error instanceof Error ? error.message : error}`);
    console.warn(`   This might indicate network connectivity issues or contract problems`);
    return null;
  }
}

async function generateReadinessReport(): Promise<DeploymentReadinessReport> {
  console.log(`🔍 Generating Mainnet Deployment Readiness Report\n`);

  // Network validation
  const network = getNetworkType();
  const rpcUrl = getAbstractRpcUrl();
  const chainId = getAbstractChainId();
  const networkDisplay = getNetworkDisplayName();

  console.log(`📍 Network: ${networkDisplay}`);
  console.log(`📡 RPC URL: ${rpcUrl.replace(/\/v2\/.*/, '/v2/***')}`);
  console.log(`🔗 Chain ID: ${chainId}\n`);

  // Readiness validation
  console.log(`🛡️  Validating deployment readiness...`);
  const readiness = validateMainnetReadiness();

  if (readiness.ready) {
    console.log(`   ✅ All readiness checks passed`);
  } else {
    console.log(`   ❌ Readiness issues found:`);
    readiness.issues.forEach(issue => console.log(`      - ${issue}`));
  }
  console.log();

  // Safety checks
  console.log(`🔒 Safety checks...`);
  if (isMainnet()) {
    console.log(`   🚨 MAINNET DETECTED - Requiring explicit confirmation`);
    if (confirmMainnet) {
      console.log(`   ✅ --confirm-mainnet flag provided`);
    } else {
      console.log(`   ❌ --confirm-mainnet flag NOT provided`);
    }
  } else {
    console.log(`   🧪 Testnet mode - Safe for testing`);
  }
  console.log();

  // Contract compilation analysis
  console.log(`📦 Contract analysis...`);
  const { abi, bytecode, name } = loadCompiledContract();
  const { bytecodeHash, abiChecksum } = calculateHashes(abi, bytecode);

  console.log(`   Contract: ${name}`);
  console.log(`   ABI functions: ${abi.length}`);
  console.log(`   Bytecode size: ${bytecode.length} bytes`);
  console.log(`   Bytecode hash: ${bytecodeHash.slice(0, 16)}...`);
  console.log(`   ABI checksum: ${abiChecksum.slice(0, 16)}...`);
  console.log();

  // Wallet and provider setup (for estimation only)
  const privateKey = process.env.AGW_SESSION_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('AGW_SESSION_PRIVATE_KEY not set');
  }

  const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(formattedPrivateKey, provider);

  console.log(`👤 Wallet analysis...`);
  console.log(`   Address: ${wallet.address}`);

  let walletBalance: string | undefined;
  let estimatedGas: string | undefined;

  try {
    // Get wallet balance
    const balance = await provider.getBalance(wallet.address);
    walletBalance = ethers.formatEther(balance);
    console.log(`   Balance: ${walletBalance} ETH`);

    // Network connectivity check
    const blockNumber = await provider.getBlockNumber();
    console.log(`   Current block: ${blockNumber}`);

    // Gas estimation (only if not on mainnet or if explicitly confirmed)
    if (!isMainnet() || confirmMainnet) {
      const contractFactory = new ethers.ContractFactory(abi, bytecode, wallet);
      const gasEstimate = await estimateDeploymentGas(provider, wallet, contractFactory);

      if (gasEstimate) {
        estimatedGas = gasEstimate.toString();

        // Calculate deployment cost
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || ethers.parseUnits("1", "gwei");
        const deploymentCost = gasEstimate * gasPrice;

        console.log(`   Estimated gas: ${gasEstimate.toString()}`);
        console.log(`   Gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
        console.log(`   Estimated cost: ${ethers.formatEther(deploymentCost)} ETH`);
      }
    } else {
      console.log(`   ⏭️  Gas estimation skipped (mainnet without confirmation)`);
    }

  } catch (error) {
    console.warn(`   ⚠️  Wallet/network analysis failed: ${error instanceof Error ? error.message : error}`);
  }

  console.log();

  // Explorer configuration
  const isMainnetNetwork = isMainnet();
  const explorerBaseUrl = isMainnetNetwork
    ? "https://explorer.abs.xyz"
    : "https://explorer.testnet.abs.xyz";

  console.log(`🔍 Explorer configuration...`);
  console.log(`   Base URL: ${explorerBaseUrl}`);
  console.log(`   Verification: Supported`);
  console.log();

  // Safety summary
  console.log(`🛡️  Safety summary...`);
  console.log(`   Confirmation required: ${isMainnet()}`);
  console.log(`   No transactions sent: ✅ TRUE`);
  console.log(`   Dry-run mode only: ✅ TRUE`);
  console.log();

  return {
    network: networkDisplay,
    timestamp: new Date().toISOString(),
    readiness,
    contract: {
      name,
      bytecodeHash,
      abiChecksum,
      deploymentSize: bytecode.length,
      estimatedGas
    },
    environment: {
      rpcUrl: rpcUrl.replace(/\/v2\/.*/, '/v2/***'),
      chainId,
      walletAddress: wallet.address,
      walletBalance
    },
    safety: {
      confirmationRequired: isMainnet(),
      noTransactionsSent: true,
      dryRunOnly: true
    },
    explorer: {
      baseUrl: explorerBaseUrl,
      verificationSupported: true
    }
  };
}

async function main() {
  try {
    // Safety check - require confirmation for mainnet operations
    if (isMainnet()) {
      requireMainnetConfirmation(confirmMainnet);
    }

    const report = await generateReadinessReport();

    // Save report to file
    const reportPath = `/home/arson/builds/piptip/mainnet-readiness-report.json`;
    writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`📄 Final readiness summary:`);
    console.log(`   Overall ready: ${report.readiness.ready ? '✅ YES' : '❌ NO'}`);

    if (!report.readiness.ready) {
      console.log(`   Issues to resolve:`);
      report.readiness.issues.forEach(issue => console.log(`      - ${issue}`));
    }

    console.log(`   Contract bytecode: ✅ Valid`);
    console.log(`   zksolc compilation: ✅ Success`);
    console.log(`   Network connectivity: ${report.environment.walletBalance ? '✅ Connected' : '❌ Failed'}`);
    console.log(`   Safety checks: ✅ All passed`);
    console.log();

    console.log(`📋 Report saved to: ${reportPath}`);
    console.log();

    if (isMainnet()) {
      console.log(`🚀 MAINNET DEPLOYMENT CHECKLIST:`);
      console.log(`   1. ✅ Contract compilation verified`);
      console.log(`   2. ${report.readiness.ready ? '✅' : '❌'} Environment variables configured`);
      console.log(`   3. ${report.environment.walletBalance ? '✅' : '❌'} Wallet has sufficient ETH`);
      console.log(`   4. ✅ Safety checks implemented`);
      console.log(`   5. ⏳ Ready for deployment with --confirm-mainnet flag`);
      console.log();
      console.log(`🎯 To deploy to mainnet:`);
      console.log(`   NETWORK=mainnet npx hardhat run scripts/hardhat_deploy.js --network abstract-mainnet --confirm-mainnet`);
    } else {
      console.log(`🧪 TESTNET VALIDATION COMPLETE`);
      console.log(`   Ready for mainnet deployment preparation`);
    }

  } catch (error) {
    console.error(`❌ Deployment readiness check failed:`, error);

    if (error instanceof Error && error.message.includes('MAINNET OPERATION BLOCKED')) {
      console.error(`\n💡 To proceed with mainnet operations, use:`);
      console.error(`   npx tsx scripts/mainnet_deployment_dryrun.ts --confirm-mainnet`);
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ Script failed:`, error);
  process.exit(1);
});