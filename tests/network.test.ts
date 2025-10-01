// Network resolver unit tests
// Tests mainnet/testnet switching and environment validation

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('Network Resolver', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear network module cache to ensure fresh imports
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  const setupTestEnv = (overrides: Record<string, string | undefined> = {}) => {
    // Set required test environment variables
    process.env = {
      ...originalEnv,
      MAINNET_RPC_URL: 'https://abstract-mainnet.g.alchemy.com/v2/test-key',
      MAINNET_CHAIN_ID: '2741',
      TESTNET_RPC_URL: 'https://api.testnet.abs.xyz',
      TESTNET_CHAIN_ID: '11124',
      ...overrides
    };
  };

  describe('getNetworkType', () => {
    it('should return mainnet when NETWORK is not set', async () => {
      setupTestEnv();
      delete process.env.NETWORK;

      const { getNetworkType } = await import('../src/services/network.js');
      expect(getNetworkType()).toBe('mainnet');
    });

    it('should return mainnet when NETWORK=mainnet', async () => {
      setupTestEnv({ NETWORK: 'mainnet' });

      const { getNetworkType } = await import('../src/services/network.js');
      expect(getNetworkType()).toBe('mainnet');
    });

    it('should return testnet when NETWORK=testnet', async () => {
      setupTestEnv({ NETWORK: 'testnet' });

      const { getNetworkType } = await import('../src/services/network.js');
      expect(getNetworkType()).toBe('testnet');
    });

    it('should return mainnet for invalid NETWORK values', async () => {
      setupTestEnv({ NETWORK: 'invalid' });

      const { getNetworkType } = await import('../src/services/network.js');
      expect(getNetworkType()).toBe('mainnet');
    });

    it('should handle case insensitive NETWORK values', async () => {
      setupTestEnv({ NETWORK: 'TESTNET' });

      const { getNetworkType } = await import('../src/services/network.js');
      expect(getNetworkType()).toBe('testnet');
    });
  });

  describe('getNetworkConfig', () => {
    it('should return mainnet config when NETWORK=mainnet', async () => {
      setupTestEnv({ NETWORK: 'mainnet' });

      const { getNetworkConfig } = await import('../src/services/network.js');
      const config = getNetworkConfig();

      expect(config.network).toBe('mainnet');
      expect(config.rpcUrl).toBe('https://abstract-mainnet.g.alchemy.com/v2/test-key');
      expect(config.chainId).toBe(2741);
    });

    it('should return testnet config when NETWORK=testnet', async () => {
      setupTestEnv({ NETWORK: 'testnet' });

      const { getNetworkConfig } = await import('../src/services/network.js');
      const config = getNetworkConfig();

      expect(config.network).toBe('testnet');
      expect(config.rpcUrl).toBe('https://api.testnet.abs.xyz');
      expect(config.chainId).toBe(11124);
    });

    it('should default to mainnet when NETWORK is not set', async () => {
      setupTestEnv();
      delete process.env.NETWORK;

      const { getNetworkConfig } = await import('../src/services/network.js');
      const config = getNetworkConfig();

      expect(config.network).toBe('mainnet');
      expect(config.rpcUrl).toBe('https://abstract-mainnet.g.alchemy.com/v2/test-key');
      expect(config.chainId).toBe(2741);
    });

    it('should throw error when mainnet env vars are missing', async () => {
      setupTestEnv({ NETWORK: 'mainnet' });
      delete process.env.MAINNET_RPC_URL;

      const { getNetworkConfig } = await import('../src/services/network.js');
      expect(() => getNetworkConfig()).toThrow('Missing required environment variables for mainnet: MAINNET_RPC_URL');
    });

    it('should throw error when testnet env vars are missing', async () => {
      setupTestEnv({ NETWORK: 'testnet' });
      delete process.env.TESTNET_CHAIN_ID;

      const { getNetworkConfig } = await import('../src/services/network.js');
      expect(() => getNetworkConfig()).toThrow('Missing required environment variables for testnet: TESTNET_CHAIN_ID');
    });
  });

  describe('getAbstractRpcUrl', () => {
    it('should return mainnet RPC URL when NETWORK=mainnet', async () => {
      setupTestEnv({ NETWORK: 'mainnet' });

      const { getAbstractRpcUrl } = await import('../src/services/network.js');
      expect(getAbstractRpcUrl()).toBe('https://abstract-mainnet.g.alchemy.com/v2/test-key');
    });

    it('should return testnet RPC URL when NETWORK=testnet', async () => {
      setupTestEnv({ NETWORK: 'testnet' });

      const { getAbstractRpcUrl } = await import('../src/services/network.js');
      expect(getAbstractRpcUrl()).toBe('https://api.testnet.abs.xyz');
    });

    it('should default to mainnet RPC URL when NETWORK not set', async () => {
      setupTestEnv();
      delete process.env.NETWORK;

      const { getAbstractRpcUrl } = await import('../src/services/network.js');
      expect(getAbstractRpcUrl()).toBe('https://abstract-mainnet.g.alchemy.com/v2/test-key');
    });
  });

  describe('getAbstractChainId', () => {
    it('should return mainnet chain ID when NETWORK=mainnet', async () => {
      setupTestEnv({ NETWORK: 'mainnet' });

      const { getAbstractChainId } = await import('../src/services/network.js');
      expect(getAbstractChainId()).toBe(2741);
    });

    it('should return testnet chain ID when NETWORK=testnet', async () => {
      setupTestEnv({ NETWORK: 'testnet' });

      const { getAbstractChainId } = await import('../src/services/network.js');
      expect(getAbstractChainId()).toBe(11124);
    });

    it('should default to mainnet chain ID when NETWORK not set', async () => {
      setupTestEnv();
      delete process.env.NETWORK;

      const { getAbstractChainId } = await import('../src/services/network.js');
      expect(getAbstractChainId()).toBe(2741);
    });
  });

  describe('Network Type Helpers', () => {
    it('isMainnet should return true for mainnet', async () => {
      setupTestEnv({ NETWORK: 'mainnet' });

      const { isMainnet, isTestnet } = await import('../src/services/network.js');
      expect(isMainnet()).toBe(true);
      expect(isTestnet()).toBe(false);
    });

    it('isTestnet should return true for testnet', async () => {
      setupTestEnv({ NETWORK: 'testnet' });

      const { isMainnet, isTestnet } = await import('../src/services/network.js');
      expect(isMainnet()).toBe(false);
      expect(isTestnet()).toBe(true);
    });

    it('should default to mainnet when NETWORK not set', async () => {
      setupTestEnv();
      delete process.env.NETWORK;

      const { isMainnet, isTestnet } = await import('../src/services/network.js');
      expect(isMainnet()).toBe(true);
      expect(isTestnet()).toBe(false);
    });
  });

  describe('getNetworkDisplayName', () => {
    it('should return formatted mainnet display name', async () => {
      setupTestEnv({ NETWORK: 'mainnet' });

      const { getNetworkDisplayName } = await import('../src/services/network.js');
      expect(getNetworkDisplayName()).toBe('Abstract Mainnet (Chain ID: 2741)');
    });

    it('should return formatted testnet display name', async () => {
      setupTestEnv({ NETWORK: 'testnet' });

      const { getNetworkDisplayName } = await import('../src/services/network.js');
      expect(getNetworkDisplayName()).toBe('Abstract Testnet (Chain ID: 11124)');
    });
  });

  describe('Legacy Compatibility', () => {
    it('should provide ABSTRACT_RPC_URL for backward compatibility', async () => {
      setupTestEnv({ NETWORK: 'testnet' });

      const { ABSTRACT_RPC_URL } = await import('../src/services/network.js');
      expect(ABSTRACT_RPC_URL).toBe('https://api.testnet.abs.xyz');
    });

    it('should provide ABSTRACT_CHAIN_ID for backward compatibility', async () => {
      setupTestEnv({ NETWORK: 'testnet' });

      const { ABSTRACT_CHAIN_ID } = await import('../src/services/network.js');
      expect(ABSTRACT_CHAIN_ID).toBe(11124);
    });
  });

  describe('Environment Validation', () => {
    it('should validate chain ID is numeric', async () => {
      setupTestEnv({
        NETWORK: 'mainnet',
        MAINNET_CHAIN_ID: 'invalid'
      });

      const { getNetworkConfig } = await import('../src/services/network.js');

      // Should parse as NaN and handle gracefully
      const config = getNetworkConfig();
      expect(isNaN(config.chainId)).toBe(true);
    });

    it('should handle missing environment variables gracefully', async () => {
      setupTestEnv({ NETWORK: 'mainnet' });
      delete process.env.MAINNET_RPC_URL;
      delete process.env.MAINNET_CHAIN_ID;

      const { getNetworkConfig } = await import('../src/services/network.js');
      expect(() => getNetworkConfig()).toThrow('Missing required environment variables');
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle production mainnet configuration', async () => {
      setupTestEnv({
        NETWORK: 'mainnet',
        MAINNET_RPC_URL: 'https://abstract-mainnet.g.alchemy.com/v2/prod-key',
        MAINNET_CHAIN_ID: '2741'
      });

      const { getNetworkConfig, isMainnet } = await import('../src/services/network.js');
      const config = getNetworkConfig();

      expect(isMainnet()).toBe(true);
      expect(config.rpcUrl).toContain('alchemy.com');
      expect(config.chainId).toBe(2741);
    });

    it('should handle development testnet configuration', async () => {
      setupTestEnv({
        NETWORK: 'testnet',
        TESTNET_RPC_URL: 'https://api.testnet.abs.xyz',
        TESTNET_CHAIN_ID: '11124'
      });

      const { getNetworkConfig, isTestnet } = await import('../src/services/network.js');
      const config = getNetworkConfig();

      expect(isTestnet()).toBe(true);
      expect(config.rpcUrl).toContain('testnet.abs.xyz');
      expect(config.chainId).toBe(11124);
    });

    it('should gracefully fallback to mainnet for missing NETWORK', async () => {
      setupTestEnv();
      delete process.env.NETWORK;

      const { getNetworkType, getAbstractRpcUrl, getAbstractChainId } = await import('../src/services/network.js');

      expect(getNetworkType()).toBe('mainnet');
      expect(getAbstractRpcUrl()).toBe('https://abstract-mainnet.g.alchemy.com/v2/test-key');
      expect(getAbstractChainId()).toBe(2741);
    });
  });
});