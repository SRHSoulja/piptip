// src/services/alchemy_token_metadata.ts - Enhanced token metadata from Alchemy
import { JsonRpcProvider } from 'ethers';
import { ABSTRACT_RPC_URL } from '../config.js';
class AlchemyTokenMetadataService {
    provider;
    constructor() {
        this.provider = new JsonRpcProvider(ABSTRACT_RPC_URL);
    }
    /**
     * Test what Alchemy methods are available for token metadata
     */
    async exploreAvailableMethods(tokenAddress) {
        const errors = {};
        const results = {};
        const availableMethods = [];
        console.log(`🔍 Exploring Alchemy metadata for token: ${tokenAddress}`);
        // Test basic ERC20 methods (we know these work)
        try {
            const basicERC20 = await this.getBasicERC20Data(tokenAddress);
            results.basicERC20 = basicERC20;
            availableMethods.push('ERC20 basic methods');
        }
        catch (error) {
            errors.basicERC20 = error.message;
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
            }
            catch (error) {
                errors[method] = error.message;
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
            }
            catch (error) {
                errors[method] = error.message;
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
    async getBasicERC20Data(tokenAddress) {
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
        }
        catch (error) {
            throw new Error(`Failed to get basic ERC20 data: ${error.message}`);
        }
    }
    /**
     * Test Alchemy-specific methods
     */
    async testAlchemyMethod(method, tokenAddress) {
        try {
            let params;
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
        }
        catch (error) {
            console.warn(`❌ ${method} failed:`, error.message);
            throw error;
        }
    }
    /**
     * Try to get enhanced metadata from various sources
     */
    async getEnhancedTokenMetadata(tokenAddress) {
        // Start with basic data
        const basicData = await this.getBasicERC20Data(tokenAddress);
        const metadata = {
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
        }
        catch (error) {
            console.warn('Alchemy enhanced metadata not available:', error.message);
        }
        return metadata;
    }
    /**
     * Test a specific token and log all available data
     */
    async analyzeToken(tokenAddress) {
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
        }
        catch (error) {
            console.error('Analysis failed:', error);
        }
    }
}
export const alchemyTokenMetadata = new AlchemyTokenMetadataService();
