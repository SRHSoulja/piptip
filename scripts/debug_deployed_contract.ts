#!/usr/bin/env npx tsx
// scripts/debug_deployed_contract.ts
// Debug deployed MerkleRegistry contract on Abstract testnet

import "dotenv/config";
import { ethers } from "ethers";
import { getAbstractRpcUrl, getAbstractChainId, getNetworkType } from "../src/services/network.js";
import { readFileSync } from "fs";

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
    throw new Error(`Failed to load compiled contract: ${error}`);
  }
}

async function main() {
  console.log(`🔍 Debugging Deployed MerkleRegistry Contract\n`);

  // Get network configuration
  const rpcUrl = getAbstractRpcUrl();
  const chainId = getAbstractChainId();
  const network = getNetworkType();

  console.log(`📍 Network: ${network}`);
  console.log(`📡 RPC URL: ${rpcUrl.replace(/\/v2\/.*/, '/v2/***')}`);
  console.log(`🔗 Chain ID: ${chainId}\n`);

  // Get deployed contract address
  const contractAddress = process.env.TESTNET_REGISTRY_CONTRACT_ADDRESS;
  if (!contractAddress) {
    console.error(`❌ TESTNET_REGISTRY_CONTRACT_ADDRESS not set in .env`);
    process.exit(1);
  }

  console.log(`🏠 Contract Address: ${contractAddress}`);

  // Also check the first address in case there are multiple entries
  const firstAddress = "0x916a5e9FdA509b520D27Bc205fb785aBA9eC71E3";
  const latestAddress = "0x9Fc2313F817C1e1975C6Ab494dbA3a5F105d8cE4";
  console.log(`🔍 Also checking first address: ${firstAddress}`);
  console.log(`🔍 Also checking latest deployment: ${latestAddress}`);

  // Get private key
  const privateKey = process.env.AGW_SESSION_PRIVATE_KEY;
  if (!privateKey) {
    console.error(`❌ AGW_SESSION_PRIVATE_KEY not set`);
    process.exit(1);
  }

  const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

  try {
    // Setup provider and wallet
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(formattedPrivateKey, provider);

    console.log(`👤 Caller address: ${wallet.address}`);

    // Check wallet balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);

    // Load contract artifacts
    const { abi } = loadCompiledContract();
    console.log(`📦 Loaded ABI with ${abi.length} functions/events\n`);

    // Connect to deployed contract (will be updated after code check)
    let contract = new ethers.Contract(contractAddress, abi, wallet);

    console.log(`🔍 Testing Contract Calls:\n`);

    // Test 1: Check if contract exists by getting code
    console.log(`1. 📋 Contract Code Check:`);
    const code = await provider.getCode(contractAddress);
    console.log(`   Code Length: ${code.length} bytes`);
    console.log(`   Has Code: ${code !== '0x'}`);

    // Also check the first address
    const firstCode = await provider.getCode(firstAddress);
    console.log(`   First Address Code Length: ${firstCode.length} bytes`);
    console.log(`   First Address Has Code: ${firstCode !== '0x'}`);

    // Check the latest deployment address
    const latestCode = await provider.getCode(latestAddress);
    console.log(`   Latest Address Code Length: ${latestCode.length} bytes`);
    console.log(`   Latest Address Has Code: ${latestCode !== '0x'}`);

    if (code === '0x' && firstCode === '0x' && latestCode === '0x') {
      console.error(`   ❌ No contract code at any address`);
      return;
    }

    // Use whichever address has code (prioritize latest)
    let workingAddress = contractAddress;
    let workingCode = code;
    if (latestCode !== '0x') {
      workingAddress = latestAddress;
      workingCode = latestCode;
    } else if (firstCode !== '0x') {
      workingAddress = firstAddress;
      workingCode = firstCode;
    }
    console.log(`   ✅ Using contract at: ${workingAddress}`);
    console.log(`   ✅ Contract code exists (${workingCode.length} bytes)\n`);

    // Update contract instance to use working address
    contract = new ethers.Contract(workingAddress, abi, wallet);

    // Test 2: Try basic view functions
    console.log(`2. 🔍 Basic View Function Tests:`);

    try {
      const owner = await contract.owner();
      console.log(`   Owner: ${owner}`);
      console.log(`   Owner Match: ${owner.toLowerCase() === wallet.address.toLowerCase()}`);
    } catch (error) {
      console.log(`   ❌ owner() failed:`, error instanceof Error ? error.message : error);
    }

    try {
      const isAuthorized = await contract.isAuthorizedPublisher(wallet.address);
      console.log(`   Is Authorized: ${isAuthorized}`);
    } catch (error) {
      console.log(`   ❌ isAuthorizedPublisher() failed:`, error instanceof Error ? error.message : error);
    }

    try {
      const [merkleRoot, ipfsHash, timestamp] = await contract.getLatestSnapshot();
      console.log(`   Latest Snapshot:`);
      console.log(`     Merkle Root: ${merkleRoot}`);
      console.log(`     IPFS Hash: ${ipfsHash}`);
      console.log(`     Timestamp: ${timestamp}`);
    } catch (error) {
      console.log(`   ❌ getLatestSnapshot() failed:`, error instanceof Error ? error.message : error);
    }

    console.log();

    // Test 3: Try a test publishSnapshot call (dry-run)
    console.log(`3. 🧪 Test publishSnapshot Call (Estimate Gas):`);

    const testMerkleRoot = "0x9c7bd3813dfb4e3ff175953555fccfedd11da95ad77979224b2b35e67e63f570";
    const testIpfsHash = "QmTestHash123";
    const testTimestamp = Math.floor(Date.now() / 1000);

    try {
      // Estimate gas for publishSnapshot
      const gasEstimate = await contract.publishSnapshot.estimateGas(
        testMerkleRoot,
        testIpfsHash,
        testTimestamp
      );
      console.log(`   ✅ Gas Estimate: ${gasEstimate.toString()}`);

      // Try a static call (view-only simulation)
      await contract.publishSnapshot.staticCall(
        testMerkleRoot,
        testIpfsHash,
        testTimestamp
      );
      console.log(`   ✅ Static call succeeded - function should work`);

    } catch (error) {
      console.log(`   ❌ publishSnapshot test failed:`, error instanceof Error ? error.message : error);

      // If it's a revert, try to decode the reason
      if (error instanceof Error && error.message.includes('revert')) {
        console.log(`   🔍 Analyzing revert reason...`);

        // Common revert reasons to check
        const commonReasons = [
          'Not authorized',
          'Invalid merkle root',
          'Already published',
          'Snapshot already exists'
        ];

        for (const reason of commonReasons) {
          if (error.message.includes(reason)) {
            console.log(`   💡 Likely reason: ${reason}`);
          }
        }
      }
    }

    console.log();

    // Test 4: Check if we can verify an existing snapshot
    console.log(`4. 🔍 Test Snapshot Verification:`);

    try {
      const isValid = await contract.isValidSnapshot(testMerkleRoot);
      console.log(`   Is Valid (${testMerkleRoot}): ${isValid}`);
    } catch (error) {
      console.log(`   ❌ isValidSnapshot() failed:`, error instanceof Error ? error.message : error);
    }

    console.log();

    // Test 5: Check network and contract state
    console.log(`5. 📊 Network & Contract State:`);

    const networkInfo = await provider.getNetwork();
    console.log(`   Connected Chain ID: ${networkInfo.chainId}`);
    console.log(`   Expected Chain ID: ${chainId}`);
    console.log(`   Chain ID Match: ${Number(networkInfo.chainId) === chainId}`);

    const blockNumber = await provider.getBlockNumber();
    console.log(`   Current Block: ${blockNumber}`);

    const gasPrice = await provider.getFeeData();
    console.log(`   Gas Price: ${ethers.formatUnits(gasPrice.gasPrice || 0, "gwei")} gwei`);

    console.log(`\n✅ Contract debugging complete!`);
    console.log(`\n💡 Summary:`);
    console.log(`   - Contract exists: ${code !== '0x'}`);
    console.log(`   - Can call view functions: Check results above`);
    console.log(`   - Ready for real publishSnapshot test`);

  } catch (error) {
    console.error(`❌ Debug failed:`, error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ Script failed:`, error);
  process.exit(1);
});