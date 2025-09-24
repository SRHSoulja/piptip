// Quick test to see what Alchemy RPC provides for token metadata
const { JsonRpcProvider } = require('ethers');

async function testAlchemy() {
  console.log('🔍 Testing Alchemy RPC capabilities...\n');

  // Your RPC URL from .env
  const provider = new JsonRpcProvider(process.env.ABSTRACT_RPC_URL || 'https://api.zan.top/node/v1/abstract/testnet/public');

  // Test token address (ABSTER from your DB)
  const tokenAddress = '0xc325b7e2736a5202bd860f5974d0aa375e57ede5';

  console.log(`Token: ${tokenAddress}\n`);

  // Test basic methods first
  console.log('=== BASIC RPC METHODS ===');

  try {
    const chainId = await provider.send('eth_chainId', []);
    console.log(`✅ Chain ID: ${chainId}`);
  } catch (e) {
    console.log(`❌ Chain ID failed: ${e.message}`);
  }

  try {
    const netVersion = await provider.send('net_version', []);
    console.log(`✅ Net Version: ${netVersion}`);
  } catch (e) {
    console.log(`❌ Net Version failed: ${e.message}`);
  }

  // Test Alchemy enhanced methods
  console.log('\n=== ALCHEMY ENHANCED METHODS ===');

  const alchemyMethods = [
    'alchemy_getTokenMetadata',
    'alchemy_getTokenBalances',
    'alchemy_getTokenAllowance',
    'alchemy_getAssetTransfers',
    'alchemy_getOwnersForToken',
    'alchemy_getTokensForOwner',
    'alchemy_searchTokens',
    'alchemy_getTokenPrices'
  ];

  for (const method of alchemyMethods) {
    try {
      let params;

      switch (method) {
        case 'alchemy_getTokenMetadata':
          params = [tokenAddress];
          break;
        case 'alchemy_getTokenBalances':
          params = ['0x0000000000000000000000000000000000000000', [tokenAddress]];
          break;
        case 'alchemy_getTokenAllowance':
          params = [tokenAddress, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000'];
          break;
        case 'alchemy_getAssetTransfers':
          params = [{
            fromBlock: '0x0',
            toBlock: 'latest',
            contractAddresses: [tokenAddress],
            category: ['erc20']
          }];
          break;
        case 'alchemy_getOwnersForToken':
          params = [tokenAddress];
          break;
        case 'alchemy_getTokensForOwner':
          params = ['0x0000000000000000000000000000000000000000'];
          break;
        case 'alchemy_searchTokens':
          params = [{ query: 'ABSTER' }];
          break;
        case 'alchemy_getTokenPrices':
          params = [{ tokens: [tokenAddress] }];
          break;
        default:
          params = [];
      }

      const result = await provider.send(method, params);
      console.log(`✅ ${method}:`, JSON.stringify(result, null, 2));

    } catch (e) {
      console.log(`❌ ${method}: ${e.message}`);
    }
  }

  // Test enhanced contract calls
  console.log('\n=== ENHANCED CONTRACT CALLS ===');

  const contractMethods = [
    { name: 'name', abi: 'function name() view returns (string)' },
    { name: 'symbol', abi: 'function symbol() view returns (string)' },
    { name: 'decimals', abi: 'function decimals() view returns (uint8)' },
    { name: 'totalSupply', abi: 'function totalSupply() view returns (uint256)' }
  ];

  try {
    const { Contract } = require('ethers');
    const contract = new Contract(tokenAddress, contractMethods.map(m => m.abi), provider);

    for (const method of contractMethods) {
      try {
        const result = await contract[method.name]();
        console.log(`✅ ${method.name}(): ${result}`);
      } catch (e) {
        console.log(`❌ ${method.name}(): ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`❌ Contract calls failed: ${e.message}`);
  }

  console.log('\n=== SUMMARY ===');
  console.log('Basic ERC20 data (name, symbol, decimals) should work.');
  console.log('Enhanced Alchemy methods depend on your RPC provider capabilities.');
  console.log('Check which methods returned valid data above to see what\'s available.');
}

// Load environment variables
require('dotenv').config();

testAlchemy().catch(console.error);