#!/usr/bin/env npx tsx
// scripts/deploy_hardhat.ts
// Deploy MerkleRegistry using Hardhat to Abstract testnet

import { ethers } from "hardhat";
import { getNetworkConfig } from "../src/services/network.js";
import { readFileSync, writeFileSync } from "fs";

async function updateEnvFile(contractAddress: string) {
  try {
    const envPath = "/home/arson/builds/piptip/.env";
    let envContent = "";

    try {
      envContent = readFileSync(envPath, "utf8");
    } catch (error) {
      console.log("⚠️  .env file not found, will create new one");
    }

    // Check if TESTNET_REGISTRY_CONTRACT_ADDRESS already exists
    if (envContent.includes("TESTNET_REGISTRY_CONTRACT_ADDRESS=")) {
      // Replace existing value
      envContent = envContent.replace(
        /TESTNET_REGISTRY_CONTRACT_ADDRESS=.*/,
        `TESTNET_REGISTRY_CONTRACT_ADDRESS=${contractAddress}`
      );
    } else {
      // Add new entry
      envContent += `\n# Real deployed MerkleRegistry on Abstract Testnet\nTESTNET_REGISTRY_CONTRACT_ADDRESS=${contractAddress}\n`;
    }

    writeFileSync(envPath, envContent);
    console.log(`✅ Updated .env with contract address: ${contractAddress}`);
  } catch (error) {
    console.warn(`⚠️  Could not update .env file:`, error);
  }
}

async function main() {
  console.log(`🚀 Deploying MerkleRegistry Contract with Hardhat\n`);

  // Get network configuration
  const networkConfig = getNetworkConfig();
  console.log(`📍 Network: ${networkConfig.network}`);
  console.log(`📡 RPC URL: ${networkConfig.rpcUrl.replace(/\/v2\/.*/, '/v2/***')}`);
  console.log(`🔗 Chain ID: ${networkConfig.chainId}\n`);

  // Safety check: only run on testnet
  if (networkConfig.network !== 'testnet') {
    console.error(`❌ SAFETY CHECK: This script should only be run on testnet!`);
    console.error(`   Current network: ${networkConfig.network}`);
    console.error(`   Set NETWORK=testnet to deploy on testnet`);
    process.exit(1);
  }

  console.log(`🧪 TESTNET MODE: Safe for real deployment`);

  try {
    // Get the deployer account
    const [deployer] = await ethers.getSigners();
    console.log(`👤 Deployer address: ${deployer.address}`);

    // Check balance
    const balance = await deployer.provider.getBalance(deployer.address);
    console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);

    if (balance === 0n) {
      console.error(`❌ Insufficient balance to deploy contract`);
      process.exit(1);
    }

    console.log(`\n📋 Contract Information:`);
    console.log(`   Name: MerkleRegistry`);
    console.log(`   Network: 🧪 Abstract Testnet`);
    console.log(`   Features: Snapshot publishing, authorization, validation\n`);

    // Deploy the contract
    console.log(`🔄 Deploying actual contract to Abstract testnet...`);
    console.log(`⚠️  REAL DEPLOYMENT: This will use actual ETH and deploy to testnet!`);

    const MerkleRegistry = await ethers.getContractFactory("MerkleRegistry");
    console.log(`📡 Deploying contract...`);

    const contract = await MerkleRegistry.deploy({
      gasLimit: 2000000, // Explicit gas limit
    });

    console.log(`⏳ Transaction submitted, waiting for confirmation...`);
    console.log(`   TX Hash: ${contract.deploymentTransaction()?.hash}`);

    // Wait for deployment
    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();
    const deploymentTx = contract.deploymentTransaction();

    console.log(`\n🎯 Real Deployment Result:`);
    console.log(`   ✅ Contract Address: ${contractAddress}`);
    console.log(`   📄 Transaction Hash: ${deploymentTx?.hash}`);
    console.log(`   🧊 Block Number: ${deploymentTx?.blockNumber || 'pending'}`);
    console.log(`   ⛽ Gas Limit: ${deploymentTx?.gasLimit.toString()}`);
    console.log(`   💰 Gas Price: ${ethers.formatUnits(deploymentTx?.gasPrice || 0, "gwei")} gwei`);

    // Update .env file with the real contract address
    await updateEnvFile(contractAddress);

    // Verify contract is working
    console.log(`\n🔍 Verifying contract deployment...`);
    const owner = await contract.owner();
    const isAuthorized = await contract.isAuthorizedPublisher(deployer.address);

    console.log(`   Owner: ${owner}`);
    console.log(`   Deployer: ${deployer.address}`);
    console.log(`   Deployer Authorized: ${isAuthorized}`);
    console.log(`   ✅ Contract deployed and functional!`);

    console.log(`\n✅ Real contract deployment successful!`);
    console.log(`\n💡 Next Steps:`);
    console.log(`   1. ✅ Contract address set in .env: TESTNET_REGISTRY_CONTRACT_ADDRESS`);
    console.log(`   2. 🧪 Test publishing: NETWORK=testnet npx tsx scripts/test_merkle_publisher.ts publish`);
    console.log(`   3. 🔍 Verify on-chain: Check transaction on Abstract testnet explorer`);

  } catch (error) {
    console.error(`❌ Deployment failed:`, error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ Script failed:`, error);
  process.exit(1);
});