#!/usr/bin/env npx tsx
// scripts/check_account_type.ts
// Check if the address is an EOA or smart contract

import "dotenv/config";
import { ethers } from "ethers";
import { getAbstractRpcUrl, getAbstractChainId, getNetworkType } from "../src/services/network.js";

async function main() {
  console.log(`🔍 Checking Account Type\n`);

  // Get network configuration
  const rpcUrl = getAbstractRpcUrl();
  const chainId = getAbstractChainId();
  const network = getNetworkType();

  console.log(`📍 Network: ${network}`);
  console.log(`📡 RPC URL: ${rpcUrl.replace(/\/v2\/.*/, '/v2/***')}`);
  console.log(`🔗 Chain ID: ${chainId}\n`);

  // Get private key and derive address
  const privateKey = process.env.AGW_SESSION_PRIVATE_KEY;
  if (!privateKey) {
    console.error(`❌ AGW_SESSION_PRIVATE_KEY environment variable not set`);
    process.exit(1);
  }

  const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

  try {
    // Setup provider and wallet
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(formattedPrivateKey, provider);

    console.log(`👤 Address: ${wallet.address}`);

    // Check balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);

    // Check if address has contract code
    console.log(`\n🔍 Account Analysis:`);
    const code = await provider.getCode(wallet.address);
    console.log(`   Code Length: ${code.length} bytes`);
    console.log(`   Has Contract Code: ${code !== '0x'}`);

    if (code !== '0x') {
      console.log(`   📋 Contract Code: ${code.slice(0, 100)}...`);
      console.log(`   ❌ This is a SMART CONTRACT address, not an EOA!`);
      console.log(`   💡 Smart contracts cannot initiate transactions on their own`);
    } else {
      console.log(`   ✅ This is an EOA (Externally Owned Account)`);
    }

    // Get nonce to see transaction history
    const nonce = await provider.getTransactionCount(wallet.address);
    console.log(`   📊 Transaction Count (Nonce): ${nonce}`);

    // Check latest block to understand network state
    const blockNumber = await provider.getBlockNumber();
    console.log(`   🧊 Current Block: ${blockNumber}`);

    // Get network info
    const networkInfo = await provider.getNetwork();
    console.log(`   🔗 Network Chain ID: ${networkInfo.chainId}`);
    console.log(`   🏷️  Network Name: ${networkInfo.name}`);

    // If Abstract uses Account Abstraction, try to see if we can get account info
    console.log(`\n🔍 Abstract Account Analysis:`);

    // Abstract might use Account Abstraction (EIP-4337)
    // Check if this is an Abstract Smart Account
    try {
      // Try to call a typical smart account function
      const call = {
        to: wallet.address,
        data: "0x" // Empty data for account check
      };

      await provider.call(call);
      console.log(`   📞 Call Test: Passed`);
    } catch (error) {
      console.log(`   📞 Call Test Failed:`, error instanceof Error ? error.message : error);
    }

    // On Abstract, accounts might be smart accounts by default
    console.log(`\n💡 Analysis Results:`);
    if (code !== '0x') {
      console.log(`   🚨 ISSUE IDENTIFIED: Using smart contract address for transactions`);
      console.log(`   🔧 SOLUTION: You need to use an EOA address or Abstract Account methods`);
      console.log(`   📝 On Abstract, you might need to use Account Abstraction patterns`);
      console.log(`   🔗 Check Abstract docs for account management`);
    } else {
      console.log(`   ✅ Account type is correct (EOA)`);
      console.log(`   🤔 The deployment error might be due to other factors`);
    }

  } catch (error) {
    console.error(`❌ Account check failed:`, error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ Script failed:`, error);
  process.exit(1);
});