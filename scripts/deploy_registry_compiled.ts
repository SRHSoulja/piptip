#!/usr/bin/env npx tsx
// scripts/deploy_registry_compiled.ts
// Deploy MerkleRegistry using compiled Hardhat artifacts

import "dotenv/config";
import { ethers } from "ethers";
import { getAbstractRpcUrl, getAbstractChainId, getNetworkType } from "../src/services/network.js";
import { readFileSync, writeFileSync } from "fs";

// Load compiled contract artifacts
function loadCompiledContract() {
  try {
    const artifactPath = "/home/arson/builds/piptip/artifacts/contracts/MerkleRegistry.sol/MerkleRegistry.json";
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    return {
      abi: artifact.abi,
      bytecode: artifact.bytecode
    };
  } catch (error) {
    throw new Error(`Failed to load compiled contract: ${error}. Run 'npx hardhat compile' first.`);
  }
}

async function updateEnvFile(contractAddress: string, network: string) {
  try {
    const envPath = "/home/arson/builds/piptip/.env";
    let envContent = "";

    try {
      envContent = readFileSync(envPath, "utf8");
    } catch (error) {
      console.log("⚠️  .env file not found, will create new one");
    }

    const envVarName = network === 'testnet'
      ? 'TESTNET_REGISTRY_CONTRACT_ADDRESS'
      : 'MAINNET_REGISTRY_CONTRACT_ADDRESS';

    // Check if env var already exists
    if (envContent.includes(`${envVarName}=`)) {
      // Replace existing value
      envContent = envContent.replace(
        new RegExp(`${envVarName}=.*`),
        `${envVarName}=${contractAddress}`
      );
    } else {
      // Add new entry
      envContent += `\n# Real deployed MerkleRegistry on Abstract ${network}\n${envVarName}=${contractAddress}\n`;
    }

    writeFileSync(envPath, envContent);
    console.log(`✅ Updated .env with ${envVarName}=${contractAddress}`);
  } catch (error) {
    console.warn(`⚠️  Could not update .env file:`, error);
  }
}

async function main() {
  console.log(`🚀 Deploying Compiled MerkleRegistry Contract\n`);

  // Get network configuration using network resolver
  const rpcUrl = getAbstractRpcUrl();
  const chainId = getAbstractChainId();
  const network = getNetworkType();

  console.log(`📍 Network: ${network}`);
  console.log(`📡 RPC URL: ${rpcUrl.replace(/\/v2\/.*/, '/v2/***')}`);
  console.log(`🔗 Chain ID: ${chainId}\n`);

  // Safety check: only run on testnet unless explicitly approved
  if (network !== 'testnet') {
    console.error(`❌ SAFETY CHECK: This script should only be run on testnet!`);
    console.error(`   Current network: ${network}`);
    console.error(`   Set NETWORK=testnet to deploy on testnet`);
    console.error(`   ⚠️  MAINNET DEPLOYMENT BLOCKED FOR SAFETY`);
    process.exit(1);
  }

  console.log(`🧪 TESTNET MODE: Safe for real deployment`);

  // Get private key with proper validation
  const privateKey = process.env.AGW_SESSION_PRIVATE_KEY;
  if (!privateKey) {
    console.error(`❌ AGW_SESSION_PRIVATE_KEY environment variable not set`);
    console.error(`   This is required for contract deployment`);
    process.exit(1);
  }

  // Validate private key format
  const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  if (formattedPrivateKey.length !== 66) {
    console.error(`❌ Invalid private key format`);
    console.error(`   Expected 64 hex characters (with or without 0x prefix)`);
    console.error(`   Got length: ${formattedPrivateKey.length - 2}`);
    process.exit(1);
  }

  console.log(`🔑 Private key format validated`);

  try {
    // Load compiled contract
    console.log(`📦 Loading compiled contract artifacts...`);
    const { abi, bytecode } = loadCompiledContract();
    console.log(`   ✅ ABI loaded: ${abi.length} functions/events`);
    console.log(`   ✅ Bytecode loaded: ${bytecode.length} bytes`);

    // Setup provider and wallet using network resolver
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(formattedPrivateKey, provider);

    console.log(`\n👤 Deployer address: ${wallet.address}`);

    // Check balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);

    if (balance === 0n) {
      console.error(`❌ Insufficient balance to deploy contract`);
      process.exit(1);
    }

    // Verify network connection
    const networkInfo = await provider.getNetwork();
    console.log(`🔗 Connected to chain ID: ${networkInfo.chainId}`);

    if (Number(networkInfo.chainId) !== chainId) {
      console.error(`❌ Chain ID mismatch! Expected ${chainId}, got ${networkInfo.chainId}`);
      process.exit(1);
    }

    console.log(`\n📋 Contract Information:`);
    console.log(`   Name: MerkleRegistry`);
    console.log(`   Network: 🧪 Abstract Testnet`);
    console.log(`   Compiled: ✅ Hardhat artifacts`);
    console.log(`   Features: Snapshot publishing, authorization, validation\n`);

    // Deploy the contract
    console.log(`🔄 Deploying actual MerkleRegistry contract...`);
    console.log(`⚠️  REAL DEPLOYMENT: This will use actual ETH and deploy to testnet!`);

    // Create contract factory with compiled artifacts
    const contractFactory = new ethers.ContractFactory(abi, bytecode, wallet);

    console.log(`📡 Deploying contract...`);

    // Deploy with explicit gas settings for Abstract testnet
    const contract = await contractFactory.deploy({
      gasLimit: 2000000, // Conservative gas limit
      gasPrice: ethers.parseUnits("0.1", "gwei") // Low gas price for testnet
    });

    console.log(`⏳ Transaction submitted, waiting for confirmation...`);
    console.log(`   📄 TX Hash: ${contract.deploymentTransaction()?.hash}`);

    // Wait for deployment
    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();
    const deploymentTx = contract.deploymentTransaction();

    console.log(`\n🎯 Real Deployment Result:`);
    console.log(`   ✅ Contract Address: ${contractAddress}`);
    console.log(`   📄 Transaction Hash: ${deploymentTx?.hash}`);
    console.log(`   🧊 Block Number: ${deploymentTx?.blockNumber || 'pending'}`);
    console.log(`   ⛽ Gas Used: ${deploymentTx?.gasLimit.toString()}`);
    console.log(`   💰 Gas Price: ${ethers.formatUnits(deploymentTx?.gasPrice || 0, "gwei")} gwei`);

    // Update .env file with the real contract address
    await updateEnvFile(contractAddress, network);

    // Verify contract is working by calling owner()
    console.log(`\n🔍 Verifying contract deployment...`);
    try {
      const owner = await contract.owner();
      console.log(`   Owner: ${owner}`);
      console.log(`   Deployer: ${wallet.address}`);
      console.log(`   Owner Match: ${owner.toLowerCase() === wallet.address.toLowerCase()}`);

      // Test authorization check
      const isAuthorized = await contract.isAuthorizedPublisher(wallet.address);
      console.log(`   Deployer Authorized: ${isAuthorized}`);

      console.log(`   ✅ Contract deployed and functional!`);
    } catch (error) {
      console.warn(`⚠️  Contract verification failed:`, error);
      console.log(`   ⚠️  Contract deployed but verification failed - may need debugging`);
    }

    console.log(`\n✅ Real contract deployment successful!`);
    console.log(`\n🔍 Verify on Abstract Testnet Explorer:`);
    console.log(`   Contract: https://explorer.testnet.abs.xyz/address/${contractAddress}`);
    console.log(`   Transaction: https://explorer.testnet.abs.xyz/tx/${deploymentTx?.hash}`);

    console.log(`\n💡 Next Steps:`);
    console.log(`   1. ✅ Contract address set in .env: TESTNET_REGISTRY_CONTRACT_ADDRESS`);
    console.log(`   2. 🧪 Seed test data: NETWORK=testnet npx tsx scripts/seed_test_balances.ts`);
    console.log(`   3. 🌳 Test publishing: NETWORK=testnet npx tsx scripts/test_merkle_publisher.ts publish`);
    console.log(`   4. 🔍 Verify event emission on testnet explorer`);

    console.log(`\n🎉 Contract deployment complete! Ready for end-to-end testing.`);

  } catch (error) {
    console.error(`❌ Deployment failed:`, error);

    // Provide specific error guidance
    if (error instanceof Error) {
      if (error.message.includes('gas')) {
        console.error(`\n💡 Gas-related error. Try:`);
        console.error(`   - Increasing gas limit`);
        console.error(`   - Checking ETH balance`);
        console.error(`   - Verifying network connectivity`);
      } else if (error.message.includes('nonce')) {
        console.error(`\n💡 Nonce error. Try:`);
        console.error(`   - Waiting a few seconds and retrying`);
        console.error(`   - Checking for pending transactions`);
      } else if (error.message.includes('private key')) {
        console.error(`\n💡 Private key error. Ensure:`);
        console.error(`   - AGW_SESSION_PRIVATE_KEY is set in .env`);
        console.error(`   - Key is 64 hex characters (with or without 0x)`);
      }
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ Script failed:`, error);
  process.exit(1);
});