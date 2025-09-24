// Quick test to see what DexScreener provides for Abstract Chain tokens
const { JsonRpcProvider } = require('ethers');

async function testDexScreener() {
  console.log('🔍 Testing DexScreener API for Abstract Chain tokens...\n');

  // Test token addresses from your database
  const tokens = [
    { symbol: 'ABSTER', address: '0xc325b7e2736a5202bd860f5974d0aa375e57ede5' },
    // Add more tokens if you have them
  ];

  console.log('Testing tokens:', tokens.map(t => `${t.symbol} (${t.address})`).join(', '));
  console.log();

  // Test DexScreener token endpoint
  console.log('=== TESTING DEXSCREENER TOKEN ENDPOINT ===');

  const addresses = tokens.map(t => t.address).join(',');

  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${addresses}`;
    console.log(`Fetching: ${url}`);

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('\n✅ DexScreener Response:');
    console.log(JSON.stringify(data, null, 2));

    // Extract useful information
    if (data.pairs && Array.isArray(data.pairs)) {
      console.log('\n=== EXTRACTED PRICE DATA ===');

      data.pairs.forEach(pair => {
        if (pair.baseToken && pair.priceUsd) {
          const token = tokens.find(t =>
            t.address.toLowerCase() === pair.baseToken.address?.toLowerCase()
          );

          console.log(`${token?.symbol || 'UNKNOWN'}: $${pair.priceUsd}`);
          console.log(`  - DEX: ${pair.dexId}`);
          console.log(`  - Pair: ${pair.baseToken.symbol}/${pair.quoteToken?.symbol}`);
          console.log(`  - Liquidity: $${pair.liquidity?.usd || 'N/A'}`);
          console.log(`  - Volume 24h: $${pair.volume?.h24 || 'N/A'}`);
          console.log(`  - Price Change 24h: ${pair.priceChange?.h24 || 'N/A'}%`);
          console.log();
        }
      });
    } else {
      console.log('❌ No pairs found in response');
    }

  } catch (error) {
    console.error('❌ DexScreener API error:', error.message);
  }

  // Test search endpoint
  console.log('\n=== TESTING DEXSCREENER SEARCH ENDPOINT ===');

  for (const token of tokens) {
    try {
      const searchUrl = `https://api.dexscreener.com/latest/dex/search?q=${token.symbol}`;
      console.log(`Searching for: ${token.symbol}`);

      const response = await fetch(searchUrl, {
        headers: {
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.pairs && data.pairs.length > 0) {
          console.log(`✅ Found ${data.pairs.length} pairs for ${token.symbol}`);

          const exactMatch = data.pairs.find(p =>
            p.baseToken?.address?.toLowerCase() === token.address.toLowerCase()
          );

          if (exactMatch) {
            console.log(`  🎯 Exact match found: $${exactMatch.priceUsd}`);
          }
        } else {
          console.log(`❌ No pairs found for ${token.symbol}`);
        }
      } else {
        console.log(`❌ Search failed for ${token.symbol}: ${response.status}`);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      console.error(`❌ Search error for ${token.symbol}:`, error.message);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('DexScreener provides comprehensive DEX data including:');
  console.log('- Real-time USD prices');
  console.log('- Liquidity information');
  console.log('- 24h volume and price changes');
  console.log('- DEX platform identification');
  console.log('- No API key required!');
}

// Load environment variables
require('dotenv').config();

testDexScreener().catch(console.error);