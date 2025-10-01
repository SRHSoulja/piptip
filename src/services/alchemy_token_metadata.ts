// src/services/alchemy_token_metadata.ts - Enhanced token metadata from Alchemy

import { JsonRpcProvider } from 'ethers';
import { getAbstractRpcUrl } from './network.js';

interface AlchemyTokenMetadata {
  // Basic ERC20 data (what you already get)
  name: string;
  symbol: string;
  decimals: number;

  // Enhanced Alchemy data
  logo?: string;
  thumbnail?: string;
  totalSupply?: string;
  description?: string;
  website?: string;
  twitter?: string;
  discord?: string;
  telegram?: string;

  // Market data (if available)
  marketCap?: number;
  price?: number;
  priceChange24h?: number;
  volume24h?: number;

  // Chain specific
  contractAddress: string;
  verified?: boolean;
  blacklisted?: boolean;
}

class AlchemyTokenMetadataService {
  private provider: JsonRpcProvider;

  constructor() {
    this.provider = new JsonRpcProvider(getAbstractRpcUrl());
  }

  /**
   * Test what Alchemy methods are available for token metadata
   */
  async exploreAvailableMethods(tokenAddress: string): Promise<{
    basicData: any;
    alchemyEnhanced: any;
    availableMethods: string[];
    errors: Record<string, string>;
  }> {
    const errors: Record<string, string> = {};
    const results: any = {};
    const availableMethods: string[] = [];

    console.log(`🔍 Exploring Alchemy metadata for token: ${tokenAddress}`);

    // Test basic ERC20 methods (we know these work)
    try {
      const basicERC20 = await this.getBasicERC20Data(tokenAddress);
      results.basicERC20 = basicERC20;
      availableMethods.push('ERC20 basic methods');
    } catch (error) {
      errors.basicERC20 = (error as Error).message;
    }

    // Test Alchemy enhanced metadata methods
    const alchemyMethods = [
      'alchemy_getTokenMetadata',
      'alchemy_getTokenSupply',
      'alchemy_getTokenPrices',
      'alchemy_searchTokens',
      'alchemy_getTokenBalances'
    ];

    for (const method of alchemyMethods) {
      try {
        console.log(`Testing ${method}...`);
        const result = await this.testAlchemyMethod(method, tokenAddress);
        if (result) {
          results[method] = result;
          availableMethods.push(method);
        }
      } catch (error) {
        errors[method] = (error as Error).message;
      }
    }

    // Test generic JSON-RPC calls that might return token info
    const genericMethods = [
      'eth_call', // For contract calls
      'eth_getLogs', // For transfer events
      'net_version', // To confirm chain
    ];

    for (const method of genericMethods) {
      try {
        if (method === 'net_version') {
          const result = await this.provider.send('net_version', []);
          results[method] = result;
          availableMethods.push(method);
        }
      } catch (error) {
        errors[method] = (error as Error).message;
      }
    }

    return {
      basicData: results.basicERC20,
      alchemyEnhanced: { ...results },
      availableMethods,
      errors
    };
  }

  /**
   * Get basic ERC20 data (what you already have)
   */
  async getBasicERC20Data(tokenAddress: string) {
    const ERC20_ABI = [
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)",
      "function totalSupply() view returns (uint256)"
    ];

    try {
      const contract = new (await import('ethers')).Contract(tokenAddress, ERC20_ABI, this.provider);

      const [name, symbol, decimals, totalSupply] = await Promise.all([
        contract.name(),
        contract.symbol(),
        contract.decimals(),
        contract.totalSupply()
      ]);

      return {
        name,
        symbol,
        decimals: Number(decimals),
        totalSupply: totalSupply.toString(),
        contractAddress: tokenAddress
      };
    } catch (error) {
      throw new Error(`Failed to get basic ERC20 data: ${(error as Error).message}`);
    }
  }

  /**
   * Test Alchemy-specific methods
   */
  private async testAlchemyMethod(method: string, tokenAddress: string): Promise<any> {
    try {
      let params: any[];

      switch (method) {
        case 'alchemy_getTokenMetadata':
          params = [tokenAddress];
          break;
        case 'alchemy_getTokenSupply':
          params = [tokenAddress];
          break;
        case 'alchemy_getTokenPrices':
          params = [{ tokens: [tokenAddress] }];
          break;
        case 'alchemy_searchTokens':
          params = [{ query: tokenAddress }];
          break;
        case 'alchemy_getTokenBalances':
          // This needs an address to check, use treasury or zero address
          params = ['0x0000000000000000000000000000000000000000', [tokenAddress]];
          break;
        default:
          return null;
      }

      const result = await this.provider.send(method, params);
      console.log(`✅ ${method} returned:`, result);
      return result;

    } catch (error) {
      console.warn(`❌ ${method} failed:`, (error as Error).message);
      throw error;
    }
  }

  /**
   * Try to get enhanced metadata from various sources
   */
  async getEnhancedTokenMetadata(tokenAddress: string): Promise<AlchemyTokenMetadata> {
    // Start with basic data
    const basicData = await this.getBasicERC20Data(tokenAddress);

    const metadata: AlchemyTokenMetadata = {
      ...basicData,
      contractAddress: tokenAddress
    };

    // Try Alchemy enhanced methods
    try {
      const alchemyMeta = await this.provider.send('alchemy_getTokenMetadata', [tokenAddress]);
      if (alchemyMeta) {
        metadata.logo = alchemyMeta.logo;
        metadata.thumbnail = alchemyMeta.thumbnail;
        metadata.description = alchemyMeta.description;
        metadata.website = alchemyMeta.website;
        metadata.twitter = alchemyMeta.twitter;
        metadata.discord = alchemyMeta.discord;
        metadata.telegram = alchemyMeta.telegram;
        metadata.verified = alchemyMeta.verified;
        metadata.blacklisted = alchemyMeta.blacklisted;
      }
    } catch (error) {
      console.warn('Alchemy enhanced metadata not available:', (error as Error).message);
    }

    return metadata;
  }

  /**
   * Test a specific token and log all available data
   */
  async analyzeToken(tokenAddress: string): Promise<void> {
    console.log(`\n🔍 ANALYZING TOKEN: ${tokenAddress}\n`);

    try {
      const exploration = await this.exploreAvailableMethods(tokenAddress);

      console.log('📊 AVAILABLE METHODS:');
      exploration.availableMethods.forEach(method => {
        console.log(`✅ ${method}`);
      });

      console.log('\n❌ FAILED METHODS:');
      Object.entries(exploration.errors).forEach(([method, error]) => {
        console.log(`❌ ${method}: ${error}`);
      });

      console.log('\n📋 BASIC DATA:');
      console.log(JSON.stringify(exploration.basicData, null, 2));

      console.log('\n🔬 ENHANCED DATA:');
      Object.entries(exploration.alchemyEnhanced).forEach(([key, value]) => {
        if (key !== 'basicERC20') {
          console.log(`${key}:`, JSON.stringify(value, null, 2));
        }
      });

    } catch (error) {
      console.error('Analysis failed:', error);
    }
  }
}

export const alchemyTokenMetadata = new AlchemyTokenMetadataService();
export type { AlchemyTokenMetadata };