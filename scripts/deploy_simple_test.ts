#!/usr/bin/env npx tsx
// scripts/deploy_simple_test.ts
// Deploy SimpleTest contract to diagnose deployment issues

import "dotenv/config";
import { ethers } from "ethers";
import { getAbstractRpcUrl, getAbstractChainId, getNetworkType } from "../src/services/network.js";
import { readFileSync } from "fs";

// Load compiled contract artifacts
function loadCompiledContract() {
  try {
    const artifactPath = "/home/arson/builds/piptip/artifacts/contracts/SimpleTest.sol/SimpleTest.json";
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    return {
      abi: artifact.abi,
      bytecode: artifact.bytecode
    };
  } catch (error) {
    throw new Error(`Failed to load compiled contract: ${error}. Run 'npx hardhat compile' first.`);
  }
}

async function main() {
  console.log(`🧪 Deploying Simple Test Contract for Diagnosis\n`);

  // Get network configuration
  const rpcUrl = getAbstractRpcUrl();
  const chainId = getAbstractChainId();
  const network = getNetworkType();

  console.log(`📍 Network: ${network}`);
  console.log(`📡 RPC URL: ${rpcUrl.replace(/\/v2\/.*/, '/v2/***')}`);
  console.log(`🔗 Chain ID: ${chainId}\n`);

  // Get private key
  const privateKey = process.env.AGW_SESSION_PRIVATE_KEY;
  if (!privateKey) {
    console.error(`❌ AGW_SESSION_PRIVATE_KEY environment variable not set`);
    process.exit(1);
  }

  const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

  try {
    // Load compiled contract
    console.log(`📦 Loading compiled contract artifacts...`);
    const { abi, bytecode } = loadCompiledContract();
    console.log(`   ✅ ABI loaded: ${abi.length} functions/events`);
    console.log(`   ✅ Bytecode loaded: ${bytecode.length} bytes`);

    // Setup provider and wallet
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

    // Get current gas price
    const feeData = await provider.getFeeData();
    console.log(`⛽ Current gas price: ${ethers.formatUnits(feeData.gasPrice || 0, "gwei")} gwei`);

    // Deploy the contract with minimal gas settings
    console.log(`\n🔄 Deploying SimpleTest contract...`);
    const contractFactory = new ethers.ContractFactory(abi, bytecode, wallet);

    // Try deployment with automatic gas estimation
    console.log(`📡 Estimating gas...`);
    const deployTx = await contractFactory.getDeployTransaction();
    const gasEstimate = await provider.estimateGas(deployTx);
    console.log(`   Estimated gas: ${gasEstimate.toString()}`);

    // Deploy with estimated gas + 10% buffer
    const gasLimit = (gasEstimate * 110n) / 100n;
    console.log(`   Using gas limit: ${gasLimit.toString()}`);

    const contract = await contractFactory.deploy({
      gasLimit: gasLimit,
      gasPrice: feeData.gasPrice || ethers.parseUnits("1", "gwei")
    });

    console.log(`⏳ Transaction submitted, waiting for confirmation...`);
    console.log(`   📄 TX Hash: ${contract.deploymentTransaction()?.hash}`);

    // Wait for deployment
    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();
    const deploymentTx = contract.deploymentTransaction();

    console.log(`\n🎯 Deployment Result:`);
    console.log(`   ✅ Contract Address: ${contractAddress}`);
    console.log(`   📄 Transaction Hash: ${deploymentTx?.hash}`);
    console.log(`   🧊 Block Number: ${deploymentTx?.blockNumber || 'pending'}`);
    console.log(`   ⛽ Gas Used: ${deploymentTx?.gasLimit.toString()}`);

    // Test basic function call
    console.log(`\n🔍 Testing contract functionality...`);
    const value = await contract.getValue();
    console.log(`   getValue(): ${value}`);

    // Test state change
    console.log(`   Setting value to 100...`);
    const setTx = await contract.setValue(100);
    await setTx.wait();
    const newValue = await contract.getValue();
    console.log(`   New value: ${newValue}`);

    console.log(`\n✅ Simple contract deployment and testing successful!`);
    console.log(`\n🔍 Verify on Abstract Testnet Explorer:`);
    console.log(`   Contract: https://explorer.testnet.abs.xyz/address/${contractAddress}`);
    console.log(`   Transaction: https://explorer.testnet.abs.xyz/tx/${deploymentTx?.hash}`);

  } catch (error) {
    console.error(`❌ Deployment failed:`, error);

    if (error instanceof Error) {
      if (error.message.includes('insufficient funds')) {
        console.error(`\n💡 Insufficient ETH for deployment`);
      } else if (error.message.includes('gas')) {
        console.error(`\n💡 Gas-related error`);
      } else if (error.message.includes('revert')) {
        console.error(`\n💡 Transaction reverted`);
      }
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ Script failed:`, error);
  process.exit(1);
});