// src/services/env_validator.ts - Environment variable validation

interface EnvConfig {
  required: string[];
  optional: string[];
}

const ENV_CONFIG: EnvConfig = {
  required: [
    'DISCORD_TOKEN',
    'DATABASE_URL',
    'MAINNET_RPC_URL',
    'MAINNET_CHAIN_ID',
    'TESTNET_RPC_URL',
    'TESTNET_CHAIN_ID',
    'TREASURY_AGW_ADDRESS',
    'AGW_SESSION_PRIVATE_KEY',
    // 'TOKEN_ADDRESS', // DEPRECATED: Now uses database-driven multi-token
    'ADMIN_SECRET',
    'INTERNAL_BEARER'
  ],
  optional: [
    'DISCORD_APPLICATION_ID',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'DISCORD_REDIRECT_URI',
    'DISCORD_WEBHOOK_URL',
    'GUILD_ID',
    'PORT',
    'NODE_ENV',
    'GIT_SHA',
    'ENABLE_METRICS',
    'SLOW_QUERY_THRESHOLD_MS',
    'ALERT_COOLDOWN_SECONDS',
    'PUBLIC_BASE_URL',
    'SESSION_SECRET',
    'HOUSE_FEE_BPS',
    'TIP_FEE_BPS',
    'WITHDRAWAL_FEE_BASIS_POINTS',
    'TIP_TAX_BASIS_POINTS',
    'GROUP_TIP_TAX_BASIS_POINTS',
    'WITHDRAW_MAX_PER_TX',
    'WITHDRAW_DAILY_CAP',
    'NETWORK', // Controls mainnet/testnet switching (defaults to mainnet)
    'TOKEN_ADDRESS', // DEPRECATED: Now optional for backward compatibility
    'TOKEN_DECIMALS',
    'ABSTRACT_RPC_URL', // DEPRECATED: Use NETWORK + MAINNET_RPC_URL/TESTNET_RPC_URL
    'ABSTRACT_CHAIN_ID', // DEPRECATED: Use NETWORK + MAINNET_CHAIN_ID/TESTNET_CHAIN_ID
    'MAINNET_REGISTRY_CONTRACT_ADDRESS', // For merkle snapshot publishing on mainnet
    'TESTNET_REGISTRY_CONTRACT_ADDRESS', // For merkle snapshot publishing on testnet
    'TEST_DATABASE_URL', // For testnet data isolation (optional)
    'PRISMA_CLIENT_ENGINE_TYPE'
  ]
};

export function validateEnvironment(): void {
  const missing: string[] = [];
  const warnings: string[] = [];
  
  // Check required variables
  for (const varName of ENV_CONFIG.required) {
    const value = process.env[varName];
    if (!value || value.trim() === '') {
      missing.push(varName);
    }
  }
  
  // Check for obvious placeholder values
  const placeholderPatterns = [
    /your_.+_here/i,
    /change.this/i,
    /example/i,
    /placeholder/i,
    /test_/i
  ];
  
  for (const varName of ENV_CONFIG.required) {
    const value = process.env[varName];
    if (value && placeholderPatterns.some(pattern => pattern.test(value))) {
      warnings.push(`${varName} appears to contain a placeholder value`);
    }
  }
  
  // Check database URL format
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && !dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    warnings.push('DATABASE_URL should start with postgresql:// or postgres://');
  }
  
  // Check network configuration
  const network = process.env.NETWORK?.toLowerCase();
  if (network && !['mainnet', 'testnet'].includes(network)) {
    warnings.push(`NETWORK must be 'mainnet' or 'testnet', got: ${network}`);
  }

  // Validate network-specific RPC and chain ID
  if (network === 'testnet' || !network) { // Default to mainnet if not set
    const rpcUrl = network === 'testnet' ? process.env.TESTNET_RPC_URL : process.env.MAINNET_RPC_URL;
    const chainId = network === 'testnet' ? process.env.TESTNET_CHAIN_ID : process.env.MAINNET_CHAIN_ID;

    if (rpcUrl && !rpcUrl.startsWith('http')) {
      warnings.push(`${network === 'testnet' ? 'TESTNET' : 'MAINNET'}_RPC_URL should start with http:// or https://`);
    }

    if (chainId && isNaN(parseInt(chainId))) {
      warnings.push(`${network === 'testnet' ? 'TESTNET' : 'MAINNET'}_CHAIN_ID should be a valid number`);
    }
  }

  // Check for production-specific requirements
  if (process.env.NODE_ENV === 'production') {
    // Ensure PgBouncer is configured for production
    if (dbUrl && !dbUrl.includes('pgbouncer=true')) {
      warnings.push('Production DATABASE_URL should include pgbouncer=true for connection pooling');
    }
    
    // Check for secure session secrets
    const sessionSecret = process.env.SESSION_SECRET;
    if (sessionSecret && sessionSecret.length < 32) {
      warnings.push('SESSION_SECRET should be at least 32 characters long in production');
    }
    
    const adminSecret = process.env.ADMIN_SECRET;
    if (adminSecret && adminSecret.length < 32) {
      warnings.push('ADMIN_SECRET should be at least 32 characters long in production');
    }
  }
  
  // Report results
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    for (const varName of missing) {
      console.error(`   ${varName}`);
    }
    console.error('\nCopy .env.example to .env and configure these variables.');
    process.exit(1);
  }
  
  if (warnings.length > 0) {
    console.warn('⚠️  Environment configuration warnings:');
    for (const warning of warnings) {
      console.warn(`   ${warning}`);
    }
    console.warn('');
  }
  
  console.log('✅ Environment validation passed');
}

export function getRequiredEnvVars(): string[] {
  return [...ENV_CONFIG.required];
}

export function getOptionalEnvVars(): string[] {
  return [...ENV_CONFIG.optional];
}