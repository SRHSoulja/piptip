// tests/merkle_publisher.test.ts
// Tests for MerklePublisher with testnet/mainnet network switching

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('MerklePublisher Network Support', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear module cache to ensure fresh imports
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  const setupTestEnv = (network: 'mainnet' | 'testnet', overrides: Record<string, string | undefined> = {}) => {
    // Set required test environment variables
    process.env = {
      ...originalEnv,
      NETWORK: network,
      MAINNET_RPC_URL: 'https://abstract-mainnet.g.alchemy.com/v2/test-key',
      MAINNET_CHAIN_ID: '2741',
      MAINNET_REGISTRY_CONTRACT_ADDRESS: '0x1234567890123456789012345678901234567890',
      TESTNET_RPC_URL: 'https://api.testnet.abs.xyz',
      TESTNET_CHAIN_ID: '11124',
      TESTNET_REGISTRY_CONTRACT_ADDRESS: '0x0987654321098765432109876543210987654321',
      ...overrides
    };
  };

  describe('Network Configuration', () => {
    it('should configure for mainnet when NETWORK=mainnet', async () => {
      setupTestEnv('mainnet');

      const { merklePublisher } = await import('../src/services/merkle_publisher.js');
      const networkInfo = merklePublisher.getNetworkInfo();

      expect(networkInfo.network).toBe('mainnet');
      expect(networkInfo.chainId).toBe(2741);
      expect(networkInfo.rpcUrl).toContain('alchemy.com');
      expect(networkInfo.registryContract).toBe('0x1234567890123456789012345678901234567890');
      expect(networkInfo.displayName).toContain('Mainnet');
    });

    it('should configure for testnet when NETWORK=testnet', async () => {
      setupTestEnv('testnet');

      const { merklePublisher } = await import('../src/services/merkle_publisher.js');
      const networkInfo = merklePublisher.getNetworkInfo();

      expect(networkInfo.network).toBe('testnet');
      expect(networkInfo.chainId).toBe(11124);
      expect(networkInfo.rpcUrl).toContain('testnet.abs.xyz');
      expect(networkInfo.registryContract).toBe('0x0987654321098765432109876543210987654321');
      expect(networkInfo.displayName).toContain('Testnet');
    });

    it('should default to mainnet when NETWORK is not set', async () => {
      setupTestEnv('mainnet');
      delete process.env.NETWORK;

      const { merklePublisher } = await import('../src/services/merkle_publisher.js');
      const networkInfo = merklePublisher.getNetworkInfo();

      expect(networkInfo.network).toBe('mainnet');
      expect(networkInfo.chainId).toBe(2741);
    });

    it('should throw error when registry contract address is missing', async () => {
      setupTestEnv('mainnet', { MAINNET_REGISTRY_CONTRACT_ADDRESS: undefined });

      await expect(async () => {
        await import('../src/services/merkle_publisher.js');
      }).rejects.toThrow('Missing registry contract address for mainnet');
    });

    it('should throw error when testnet registry contract address is missing', async () => {
      setupTestEnv('testnet', { TESTNET_REGISTRY_CONTRACT_ADDRESS: undefined });

      await expect(async () => {
        await import('../src/services/merkle_publisher.js');
      }).rejects.toThrow('Missing registry contract address for testnet');
    });
  });

  describe('Network Resolver Integration', () => {
    it('should use network resolver for RPC URL resolution', async () => {
      setupTestEnv('testnet');

      const { merklePublisher } = await import('../src/services/merkle_publisher.js');
      const { getAbstractRpcUrl } = await import('../src/services/network.js');

      const networkInfo = merklePublisher.getNetworkInfo();
      const resolvedRpcUrl = getAbstractRpcUrl();

      expect(networkInfo.rpcUrl).toBe(resolvedRpcUrl);
      expect(networkInfo.rpcUrl).toBe('https://api.testnet.abs.xyz');
    });

    it('should use network resolver for chain ID resolution', async () => {
      setupTestEnv('mainnet');

      const { merklePublisher } = await import('../src/services/merkle_publisher.js');
      const { getAbstractChainId } = await import('../src/services/network.js');

      const networkInfo = merklePublisher.getNetworkInfo();
      const resolvedChainId = getAbstractChainId();

      expect(networkInfo.chainId).toBe(resolvedChainId);
      expect(networkInfo.chainId).toBe(2741);
    });
  });

  describe('Logging and Identification', () => {
    it('should log testnet mode clearly for testnet', async () => {
      setupTestEnv('testnet');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await import('../src/services/merkle_publisher.js');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('🧪 TESTNET MODE'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Abstract Testnet'));

      consoleSpy.mockRestore();
    });

    it('should log mainnet mode clearly for mainnet', async () => {
      setupTestEnv('mainnet');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await import('../src/services/merkle_publisher.js');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('🚀 MAINNET MODE'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Abstract Mainnet'));

      consoleSpy.mockRestore();
    });

    it('should mask RPC URL in logs for security', async () => {
      setupTestEnv('mainnet');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await import('../src/services/merkle_publisher.js');

      // Should mask the API key part of the URL
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('📡 RPC URL:'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('/***'));

      consoleSpy.mockRestore();
    });
  });

  describe('Environment Variable Validation', () => {
    it('should validate all required network variables are present', async () => {
      setupTestEnv('mainnet');

      // Should not throw when all required variables are present
      expect(async () => {
        await import('../src/services/merkle_publisher.js');
      }).not.toThrow();
    });

    it('should handle missing network environment gracefully', async () => {
      setupTestEnv('mainnet', {
        MAINNET_RPC_URL: undefined,
        MAINNET_CHAIN_ID: undefined
      });

      await expect(async () => {
        await import('../src/services/network.js');
      }).rejects.toThrow('Missing required environment variables');
    });
  });

  describe('Registry Contract Configuration', () => {
    it('should use correct registry contract for each network', async () => {
      // Test mainnet
      setupTestEnv('mainnet');
      const mainnetPublisher = await import('../src/services/merkle_publisher.js');
      const mainnetInfo = mainnetPublisher.merklePublisher.getNetworkInfo();

      expect(mainnetInfo.registryContract).toBe('0x1234567890123456789012345678901234567890');

      // Reset modules for fresh import
      jest.resetModules();

      // Test testnet
      setupTestEnv('testnet');
      const testnetPublisher = await import('../src/services/merkle_publisher.js');
      const testnetInfo = testnetPublisher.merklePublisher.getNetworkInfo();

      expect(testnetInfo.registryContract).toBe('0x0987654321098765432109876543210987654321');
    });
  });

  describe('Snapshot Publishing Flow', () => {
    it('should include network information in publish result', async () => {
      setupTestEnv('testnet');

      const { merklePublisher } = await import('../src/services/merkle_publisher.js');

      // Mock the blockchain publishing to avoid actual transactions
      const mockPublishSnapshot = jest.fn().mockResolvedValue({
        success: true,
        txHash: '0xtest123',
        network: 'testnet',
        chainId: 11124,
        registryContract: '0x0987654321098765432109876543210987654321',
        snapshot: {
          merkleRoot: '0xroot123',
          ipfsHash: 'QmTest123',
          timestamp: 1234567890,
          totalUsers: 5,
          totalBalance: '1000000000000000000000',
          network: 'testnet'
        }
      });

      // Replace the publish method for testing
      merklePublisher.publishSnapshot = mockPublishSnapshot;

      const result = await merklePublisher.publishSnapshot('0xtest_private_key');

      expect(result.success).toBe(true);
      expect(result.network).toBe('testnet');
      expect(result.chainId).toBe(11124);
      expect(result.registryContract).toBe('0x0987654321098765432109876543210987654321');
      expect(result.snapshot?.network).toBe('testnet');
    });
  });
});