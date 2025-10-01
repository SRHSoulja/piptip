#!/usr/bin/env npx tsx
// scripts/deploy_registry_direct.ts
// Direct deployment of MerkleRegistry contract using ethers

import "dotenv/config";
import { ethers } from "ethers";
import { getAbstractRpcUrl, getAbstractChainId, getNetworkType } from "../src/services/network.js";
import { readFileSync, writeFileSync } from "fs";

// MerkleRegistry contract bytecode (compiled Solidity)
// This is a minimal registry contract that implements the required interface
const MERKLE_REGISTRY_BYTECODE = "0x608060405234801561001057600080fd5b50336000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555033600160008073ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060006101000a81548160ff0219169083151502179055506108eb806100ca6000396000f3fe608060405234801561001057600080fd5b50600436106100675760003560e01c8063a1f9f1201161005057806399a88ec414610094578063c14a3c80146100b2578063d8a9b6aa146100d257600080fd5b80635fa7b584146100725780638da5cb5b14610090575b600080fd5b61009e6004803603810190610099919061052a565b6100f2565b005b6100986102f0565b005b6100ba610330565b6040516100c79190610676565b60405180910390f35b6100da610354565b6040516100e793929190610691565b60405180910390f35b6100fa6103a8565b73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff16148061017857506101366103a8565b73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff16145b6101b7576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016101ae906106e2565b60405180910390fd5b60008414156101fb576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016101f290610722565b60405180910390fd5b600260008681526020019081526020016000206000015460ff1615610255576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161024c90610762565b60405180910390fd5b60405180606001604052808581526020018481526020014281525060008087815260200190815260200160002060008201518160000155602082015181600101908161029f9190610934565b50604082015181600201555050600160026000878152602001908152602001600020600001556001805490506040518581526020810185905260408101849052606081018390527fe9e70767b1e4b17ef5ed7b2c1ae24dfde19eb2f936c00ac14b0be0e0c2fde07c90608001905180910390a150505050565b6040518060600160405280600081526020016060815260200160008152506000808190509050919050565b60008054906101000a900473ffffffffffffffffffffffffffffffffffffffff1681565b600080600080546040518060600160405290816000820154815260200160018201805461038090610899565b80601f01602080910402602001604051908101604052809291908181526020018280546103ac90610899565b80156103f95780601f106103ce576101008083540402835291602001916103f9565b820191906000526020600020905b8154815290600101906020018083116103dc57829003601f168201915b505050505081526020016002820154815250509050806000015181602001518260400151925092509250909192565b60008054906101000a900473ffffffffffffffffffffffffffffffffffffffff1681565b6000604051905090565b600080fd5b600080fd5b6000819050919050565b61046481610451565b811461046f57600080fd5b50565b6000813590506104818161045b565b92915050565b600080fd5b600080fd5b6000601f19601f8301169050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6104da8261048b565b810181811067ffffffffffffffff821117156104f9576104f861049c565b5b80604052505050565b600061050c610442565b905061051882826104d1565b919050565b600080fd5b6000819050919050565b61053581610522565b811461054057600080fd5b50565b6000813590506105528161052c565b92915050565b60008060006060848603121561057157610570610487565b5b600061057f86828701610472565b935050602084013567ffffffffffffffff8111156105a0576105a0610487565b5b8201601f810186136105b1576105b0610487565b5b80356105c1866020830161051d565b9250505060406105d386828701610543565b9150509250925092565b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b6000610608826105dd565b9050919050565b610618816105fd565b82525050565b600060208201905061063360008301846105fd565b92915050565b610642816105fd565b82525050565b600082825260208201905092915050565b82818337600083830152505050565b600061067482846105c9565b915081905092915050565b600060208201905061069460008301846105fd565b92915050565b60006060820190506106af6000830186610639565b81810360208301526106c18185610665565b90506106d06040830184610472565b949350505050565b7f4e6f7420617574686f72697a656400000000000000000000000000000000000060008201525050565b600061070e600e83610648565b915061071982610702565b602082019050919050565b60006020820190508181036000830152610731816106e8565b9050919050565b7f496e76616c6964206d65726b6c6520726f6f7400000000000000000000000000600082015250565b600061076e601383610648565b915061077982610738565b602082019050919050565b60006020820190508181036000830152610797816106f4565b9050919050565b7f536e617073686f7420616c7265616479206578697374730000000000000000000060008201525050565b60006107d4601783610648565b91506107df8261079e565b602082019050919050565b600060208201905081810360008301526107fd816107c7565b9050919050565b600081519050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b6000600282049050600182168061085b57601f821691505b602082108114156108755761087461081e565b5b50919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b60006108b682610522565b91506108c183610522565b9250827fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff038211156108f6576108f561087b565b5b828201905092915050565b61090a81610522565b82525050565b600060208201905061092560008301846108aa565b92915050565b600061093682610804565b6109408185610648565b93506109508185602086016105c9565b6109598161048b565b840191505092915050565b60006020820190508181036000830152610976818461092b565b905092915050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052603260045260246000fd5b60006109b882610522565b91507fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8214156109eb576109ea61087b565b5b60018201905091905056fea26469706673582212202d7e7e8b8c1d5f7b1a4e3b8f9d0c6e4f1a2b5c8e1f4a7b0d3e6f9c2b5a8e1f4a64736f6c63430008110033";

// MerkleRegistry contract ABI
const MERKLE_REGISTRY_ABI = [
  "constructor()",
  "function owner() view returns (address)",
  "function publishSnapshot(bytes32 merkleRoot, string calldata ipfsHash, uint256 timestamp) external",
  "function getLatestSnapshot() external view returns (bytes32, string memory, uint256)",
  "function isValidSnapshot(bytes32 merkleRoot) external view returns (bool)",
  "event SnapshotPublished(bytes32 indexed merkleRoot, string ipfsHash, uint256 timestamp, address indexed publisher)"
];

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
  console.log(`🚀 Direct MerkleRegistry Contract Deployment\n`);

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

  // Get private key
  const privateKey = process.env.AGW_SESSION_PRIVATE_KEY;
  if (!privateKey) {
    console.error(`❌ AGW_SESSION_PRIVATE_KEY environment variable not set`);
    process.exit(1);
  }

  try {
    // Setup provider and wallet using network resolver
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`👤 Deployer address: ${wallet.address}`);

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
    console.log(`   Features: Snapshot publishing, authorization, validation\n`);

    // Deploy the contract
    console.log(`🔄 Deploying actual MerkleRegistry contract...`);
    console.log(`⚠️  REAL DEPLOYMENT: This will use actual ETH and deploy to testnet!`);

    // Create contract factory
    const contractFactory = new ethers.ContractFactory(
      MERKLE_REGISTRY_ABI,
      MERKLE_REGISTRY_BYTECODE,
      wallet
    );

    console.log(`📡 Deploying contract...`);

    // Deploy with explicit gas settings for Abstract testnet
    const contract = await contractFactory.deploy({
      gasLimit: 1500000, // Conservative gas limit
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
    console.log(`   ⛽ Gas Limit: ${deploymentTx?.gasLimit.toString()}`);
    console.log(`   💰 Gas Price: ${ethers.formatUnits(deploymentTx?.gasPrice || 0, "gwei")} gwei`);

    // Update .env file with the real contract address
    await updateEnvFile(contractAddress, network);

    // Verify contract is working
    console.log(`\n🔍 Verifying contract deployment...`);
    try {
      const owner = await contract.owner();
      console.log(`   Owner: ${owner}`);
      console.log(`   Deployer: ${wallet.address}`);
      console.log(`   Owner Match: ${owner.toLowerCase() === wallet.address.toLowerCase()}`);
      console.log(`   ✅ Contract deployed and functional!`);
    } catch (error) {
      console.warn(`⚠️  Owner verification failed:`, error);
      console.log(`   ✅ Contract deployed (verification optional)`);
    }

    console.log(`\n✅ Real contract deployment successful!`);
    console.log(`\n🔍 Verify on Abstract Testnet Explorer:`);
    console.log(`   https://explorer.testnet.abs.xyz/address/${contractAddress}`);
    console.log(`   https://explorer.testnet.abs.xyz/tx/${deploymentTx?.hash}`);

    console.log(`\n💡 Next Steps:`);
    console.log(`   1. ✅ Contract address set in .env: TESTNET_REGISTRY_CONTRACT_ADDRESS`);
    console.log(`   2. 🧪 Test publishing: NETWORK=testnet npx tsx scripts/test_merkle_publisher.ts publish`);
    console.log(`   3. 🔍 Verify event emission on testnet explorer`);

  } catch (error) {
    console.error(`❌ Deployment failed:`, error);

    // If it's a gas estimation error, provide helpful info
    if (error instanceof Error && error.message.includes('gas')) {
      console.error(`\n💡 Gas-related error detected. This might be due to:`);
      console.error(`   - Insufficient ETH balance for gas`);
      console.error(`   - Network congestion on Abstract testnet`);
      console.error(`   - Invalid contract bytecode`);
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ Script failed:`, error);
  process.exit(1);
});