// src/services/env_validator.ts - Environment variable validation

interface EnvConfig {
  required: string[];
  optional: string[];
}

const ENV_CONFIG: EnvConfig = {
  required: [
    'DISCORD_TOKEN',
    'DATABASE_URL',
    'ABSTRACT_RPC_URL',
    'TREASURY_AGW_ADDRESS',
    'AGW_SESSION_PRIVATE_KEY',
    'TOKEN_ADDRESS',
    'ADMIN_SECRET',
    'INTERNAL_BEARER'
  ],
  optional: [
    'DISCORD_APPLICATION_ID',
    'DISCORD_CLIENT_ID', 
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
    'TOKEN_DECIMALS',
    'ABSTRACT_CHAIN_ID',
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