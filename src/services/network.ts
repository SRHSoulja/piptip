// Network resolver service - Auto-switches between mainnet/testnet based on NETWORK env var
// Provides unified access to ABSTRACT_RPC_URL and ABSTRACT_CHAIN_ID

export type NetworkType = 'mainnet' | 'testnet';

export interface NetworkConfig {
  rpcUrl: string;
  chainId: number;
  network: NetworkType;
}

/**
 * Get the current network type from environment
 * Defaults to 'mainnet' if NETWORK is not set or invalid
 */
export function getNetworkType(): NetworkType {
  const network = process.env.NETWORK?.toLowerCase();

  if (network === 'testnet') {
    return 'testnet';
  }

  // Default to mainnet for any other value (including undefined)
  return 'mainnet';
}

/**
 * Validate that required network environment variables are set
 */
function validateNetworkEnv(network: NetworkType): void {
  const missingVars: string[] = [];

  if (network === 'mainnet') {
    if (!process.env.MAINNET_RPC_URL) missingVars.push('MAINNET_RPC_URL');
    if (!process.env.MAINNET_CHAIN_ID) missingVars.push('MAINNET_CHAIN_ID');
  } else {
    if (!process.env.TESTNET_RPC_URL) missingVars.push('TESTNET_RPC_URL');
    if (!process.env.TESTNET_CHAIN_ID) missingVars.push('TESTNET_CHAIN_ID');
  }

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables for ${network}: ${missingVars.join(', ')}`);
  }
}

/**
 * Get network configuration based on current NETWORK environment variable
 */
export function getNetworkConfig(): NetworkConfig {
  const network = getNetworkType();

  validateNetworkEnv(network);

  if (network === 'testnet') {
    return {
      rpcUrl: process.env.TESTNET_RPC_URL!,
      chainId: parseInt(process.env.TESTNET_CHAIN_ID!, 10),
      network: 'testnet'
    };
  }

  // Mainnet configuration
  return {
    rpcUrl: process.env.MAINNET_RPC_URL!,
    chainId: parseInt(process.env.MAINNET_CHAIN_ID!, 10),
    network: 'mainnet'
  };
}

/**
 * Get the current RPC URL (replaces direct ABSTRACT_RPC_URL usage)
 */
export function getAbstractRpcUrl(): string {
  return getNetworkConfig().rpcUrl;
}

/**
 * Get the current chain ID (replaces direct ABSTRACT_CHAIN_ID usage)
 */
export function getAbstractChainId(): number {
  return getNetworkConfig().chainId;
}

/**
 * Check if currently running on mainnet
 */
export function isMainnet(): boolean {
  return getNetworkType() === 'mainnet';
}

/**
 * Check if currently running on testnet
 */
export function isTestnet(): boolean {
  return getNetworkType() === 'testnet';
}

/**
 * Get network display name for logging
 */
export function getNetworkDisplayName(): string {
  const config = getNetworkConfig();
  const emoji = config.network === 'mainnet' ? '🚀' : '🧪';
  return `${emoji} Abstract ${config.network.charAt(0).toUpperCase() + config.network.slice(1)} (Chain ID: ${config.chainId})`;
}

/**
 * Get registry contract address for current network
 */
export function getRegistryContractAddress(): string {
  const network = getNetworkType();

  if (network === 'testnet') {
    const address = process.env.TESTNET_REGISTRY_CONTRACT_ADDRESS;
    if (!address) {
      throw new Error('TESTNET_REGISTRY_CONTRACT_ADDRESS not set in environment');
    }
    return address;
  }

  // Mainnet
  const address = process.env.MAINNET_REGISTRY_CONTRACT_ADDRESS;
  if (!address) {
    throw new Error('MAINNET_REGISTRY_CONTRACT_ADDRESS not set in environment. Deploy to mainnet first.');
  }
  return address;
}

/**
 * Require explicit confirmation for mainnet operations
 * Throws an error if on mainnet without confirmation flag
 */
export function requireMainnetConfirmation(confirmationFlag?: boolean): void {
  if (isMainnet() && !confirmationFlag) {
    throw new Error(
      '🚨 MAINNET OPERATION BLOCKED!\n' +
      '   This operation will use REAL ETH on Abstract Mainnet.\n' +
      '   Pass --confirm-mainnet flag to proceed with mainnet deployment.\n' +
      '   ⚠️  Use testnet for development: NETWORK=testnet'
    );
  }
}

/**
 * Validate mainnet deployment readiness
 */
export function validateMainnetReadiness(): { ready: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check required environment variables
  if (!process.env.MAINNET_RPC_URL) {
    issues.push('MAINNET_RPC_URL not set');
  }

  if (!process.env.MAINNET_CHAIN_ID) {
    issues.push('MAINNET_CHAIN_ID not set');
  }

  if (!process.env.AGW_SESSION_PRIVATE_KEY) {
    issues.push('AGW_SESSION_PRIVATE_KEY not set');
  }

  if (!process.env.DATABASE_URL) {
    issues.push('DATABASE_URL not set for mainnet operations');
  }

  // Check that we're not accidentally using testnet addresses
  const mainnetRegistry = process.env.MAINNET_REGISTRY_CONTRACT_ADDRESS;
  const testnetRegistry = process.env.TESTNET_REGISTRY_CONTRACT_ADDRESS;

  if (mainnetRegistry && testnetRegistry && mainnetRegistry === testnetRegistry) {
    issues.push('MAINNET_REGISTRY_CONTRACT_ADDRESS matches testnet address - potential configuration error');
  }

  return {
    ready: issues.length === 0,
    issues
  };
}

/**
 * Get the database URL based on current network
 * Returns TEST_DATABASE_URL for testnet, DATABASE_URL for mainnet
 */
export function getDatabaseUrl(): string {
  const network = getNetworkType();

  if (network === 'testnet') {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL;
    if (!testDatabaseUrl) {
      console.warn('⚠️ TEST_DATABASE_URL not set for testnet. Using default DATABASE_URL.');
      console.warn('   This means testnet operations will use the production database!');
      console.warn('   Set TEST_DATABASE_URL to isolate testnet data.');
      return process.env.DATABASE_URL!;
    }
    return testDatabaseUrl;
  }

  return process.env.DATABASE_URL!;
}

/**
 * Get network information including database configuration
 */
export function getFullNetworkInfo() {
  return {
    network: getNetworkType(),
    chainId: getAbstractChainId(),
    rpcUrl: getAbstractRpcUrl(),
    databaseUrl: getDatabaseUrl().replace(/\/\/[^@]+@/, '//***:***@'), // Mask credentials
    displayName: getNetworkDisplayName()
  };
}

/**
 * Legacy compatibility - provides ABSTRACT_RPC_URL value
 * @deprecated Use getAbstractRpcUrl() instead
 * Note: Uses lazy evaluation to avoid module load-time errors
 */
let _cachedRpcUrl: string | undefined;
export function getLegacyAbstractRpcUrl(): string {
  if (!_cachedRpcUrl) {
    _cachedRpcUrl = getAbstractRpcUrl();
  }
  return _cachedRpcUrl;
}

// Lazy getter for backward compatibility
Object.defineProperty(exports, 'ABSTRACT_RPC_URL', {
  get: getLegacyAbstractRpcUrl,
  enumerable: true
});

/**
 * Legacy compatibility - provides ABSTRACT_CHAIN_ID value
 * @deprecated Use getAbstractChainId() instead
 * Note: Uses lazy evaluation to avoid module load-time errors
 */
let _cachedChainId: number | undefined;
export function getLegacyAbstractChainId(): number {
  if (!_cachedChainId) {
    _cachedChainId = getAbstractChainId();
  }
  return _cachedChainId;
}

// Lazy getter for backward compatibility
Object.defineProperty(exports, 'ABSTRACT_CHAIN_ID', {
  get: getLegacyAbstractChainId,
  enumerable: true
});

// Log network configuration on module load (with error handling)
try {
  const config = getNetworkConfig();
  console.log(`🌐 Network configured: ${getNetworkDisplayName()}`);
  console.log(`📡 RPC URL: ${config.rpcUrl.replace(/\/v2\/.*/, '/v2/***')}`); // Hide API key

  // Backward compatibility warning if old env vars are set
  if (process.env.ABSTRACT_RPC_URL && process.env.ABSTRACT_RPC_URL !== config.rpcUrl) {
    console.warn(`⚠️ ABSTRACT_RPC_URL is set but will be ignored. Using ${config.network} configuration instead.`);
  }

  if (process.env.ABSTRACT_CHAIN_ID && parseInt(process.env.ABSTRACT_CHAIN_ID) !== config.chainId) {
    console.warn(`⚠️ ABSTRACT_CHAIN_ID is set but will be ignored. Using ${config.network} configuration instead.`);
  }
} catch (error) {
  console.error(`❌ Network configuration error: ${error instanceof Error ? error.message : String(error)}`);
  console.error('⚠️  Please check your environment variables:');
  console.error(`   - NETWORK=${process.env.NETWORK || 'not set (defaults to mainnet)'}`);
  console.error(`   - For mainnet: MAINNET_RPC_URL and MAINNET_CHAIN_ID must be set`);
  console.error(`   - For testnet: TESTNET_RPC_URL and TESTNET_CHAIN_ID must be set`);
  throw error; // Re-throw to prevent startup with invalid config
}