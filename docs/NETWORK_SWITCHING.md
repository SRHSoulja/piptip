# Network Switching Guide

## Overview

PIPTip now supports automatic network switching between Abstract mainnet and testnet using a single `NETWORK` environment variable. This eliminates the need to manually change `ABSTRACT_RPC_URL` and `ABSTRACT_CHAIN_ID` when switching environments.

## Quick Start

### Environment Setup
```bash
# Set network type (mainnet or testnet)
NETWORK=mainnet

# Configure both networks (required)
MAINNET_RPC_URL=https://abstract-mainnet.g.alchemy.com/v2/your-key
MAINNET_CHAIN_ID=2741
TESTNET_RPC_URL=https://api.testnet.abs.xyz
TESTNET_CHAIN_ID=11124
```

### Switching Networks
```bash
# Switch to testnet
export NETWORK=testnet
npm restart

# Switch to mainnet
export NETWORK=mainnet
npm restart

# Default (no NETWORK set) = mainnet
unset NETWORK
npm restart
```

## Network Configuration

### Mainnet (Production)
```bash
NETWORK=mainnet
MAINNET_RPC_URL=https://abstract-mainnet.g.alchemy.com/v2/prod-key
MAINNET_CHAIN_ID=2741
```

**Capabilities:**
- Full production environment
- Real Abstract tokens (PENGU, ICE, PEBBLE)
- Real user funds and transactions
- Alchemy RPC for reliability and analytics

### Testnet (Development)
```bash
NETWORK=testnet
TESTNET_RPC_URL=https://api.testnet.abs.xyz
TESTNET_CHAIN_ID=11124
```

**Capabilities:**
- Safe testing environment
- Test tokens and faucet funds
- Same contract interfaces as mainnet
- Free transactions for development

## Environment Variables

### Required Variables
```bash
# Network selector
NETWORK=mainnet                    # "mainnet" or "testnet" (optional, defaults to mainnet)

# Mainnet configuration
MAINNET_RPC_URL=https://...        # Alchemy or other mainnet RPC
MAINNET_CHAIN_ID=2741             # Abstract mainnet chain ID

# Testnet configuration
TESTNET_RPC_URL=https://...        # Abstract testnet RPC
TESTNET_CHAIN_ID=11124            # Abstract testnet chain ID
```

### Deprecated Variables (Backward Compatible)
```bash
# These are now auto-resolved based on NETWORK
ABSTRACT_RPC_URL=...              # ⚠️ DEPRECATED: Use NETWORK + MAINNET_RPC_URL/TESTNET_RPC_URL
ABSTRACT_CHAIN_ID=...             # ⚠️ DEPRECATED: Use NETWORK + MAINNET_CHAIN_ID/TESTNET_CHAIN_ID
```

## Code Usage

### New Network Resolver (Recommended)
```typescript
import {
  getAbstractRpcUrl,
  getAbstractChainId,
  getNetworkType,
  isMainnet,
  isTestnet
} from './services/network.js';

// Get current network RPC URL
const rpcUrl = getAbstractRpcUrl();

// Get current chain ID
const chainId = getAbstractChainId();

// Check network type
if (isMainnet()) {
  console.log('Running on mainnet');
} else if (isTestnet()) {
  console.log('Running on testnet');
}

// Create provider with auto-resolved network
const provider = new JsonRpcProvider(getAbstractRpcUrl(), {
  chainId: getAbstractChainId(),
  name: 'abstract'
});
```

### Legacy Compatibility
```typescript
// These still work but are deprecated
import { ABSTRACT_RPC_URL, ABSTRACT_CHAIN_ID } from './config.js';

// These now resolve through the network service automatically
const provider = new JsonRpcProvider(ABSTRACT_RPC_URL, {
  chainId: ABSTRACT_CHAIN_ID
});
```

## Development Workflows

### Local Development
```bash
# .env.local
NETWORK=testnet
TESTNET_RPC_URL=https://api.testnet.abs.xyz
TESTNET_CHAIN_ID=11124

# Start development server
npm run dev
```

### Production Deployment
```bash
# .env.production
NETWORK=mainnet
MAINNET_RPC_URL=https://abstract-mainnet.g.alchemy.com/v2/prod-key
MAINNET_CHAIN_ID=2741

# Deploy to production
npm run build && npm start
```

### Testing Both Networks
```bash
# Test mainnet configuration
NETWORK=mainnet npm test

# Test testnet configuration
NETWORK=testnet npm test

# Test default (mainnet) fallback
unset NETWORK && npm test
```

## Network Detection

The system automatically logs the active network on startup:

```bash
🌐 Network configured: Abstract Mainnet (Chain ID: 2741)
📡 RPC URL: https://abstract-mainnet.g.alchemy.com/v2/***
```

### Validation Warnings
```bash
⚠️ NETWORK must be 'mainnet' or 'testnet', got: invalid
⚠️ ABSTRACT_RPC_URL is set but will be ignored. Using mainnet configuration instead.
⚠️ ABSTRACT_CHAIN_ID is set but will be ignored. Using mainnet configuration instead.
```

## Migration from Legacy Setup

### Step 1: Add New Environment Variables
```bash
# Add to your .env
NETWORK=mainnet
MAINNET_RPC_URL=https://abstract-mainnet.g.alchemy.com/v2/your-key
MAINNET_CHAIN_ID=2741
TESTNET_RPC_URL=https://api.testnet.abs.xyz
TESTNET_CHAIN_ID=11124

# Keep existing (will be ignored)
ABSTRACT_RPC_URL=https://abstract-mainnet.g.alchemy.com/v2/your-key
ABSTRACT_CHAIN_ID=2741
```

### Step 2: Test Network Switching
```bash
# Test mainnet
NETWORK=mainnet npm start

# Test testnet
NETWORK=testnet npm start

# Test default fallback
unset NETWORK && npm start
```

### Step 3: Remove Legacy Variables (Optional)
```bash
# After confirming everything works, remove:
# ABSTRACT_RPC_URL=...
# ABSTRACT_CHAIN_ID=...
```

## Troubleshooting

### Common Issues

**"Missing required environment variables"**
- Ensure both mainnet and testnet RPC URLs are set
- Check that chain IDs are valid numbers

**"NETWORK must be 'mainnet' or 'testnet'"**
- NETWORK must be exactly "mainnet" or "testnet" (case insensitive)
- Leave blank or unset for mainnet default

**RPC connection errors**
- Verify RPC URLs are correct for the selected network
- Check API keys for Alchemy endpoints
- Ensure firewall allows outbound HTTPS connections

### Debug Commands
```bash
# Check current network configuration
node -e "
import('./src/services/network.js').then(n => {
  console.log('Network:', n.getNetworkType());
  console.log('RPC URL:', n.getAbstractRpcUrl());
  console.log('Chain ID:', n.getAbstractChainId());
  console.log('Display:', n.getNetworkDisplayName());
});
"

# Validate environment
npm run validate-env

# Test network connectivity
curl -X POST -H "Content-Type: application/json" \\
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \\
  $MAINNET_RPC_URL
```

### Environment Validation
```bash
# The system validates network configuration on startup
npm start

# Look for these log messages:
✅ Environment validation passed
🌐 Network configured: Abstract Mainnet (Chain ID: 2741)
📡 RPC URL: https://abstract-mainnet.g.alchemy.com/v2/***
```

## Best Practices

### Production Setup
- Always set `NETWORK=mainnet` explicitly in production
- Use dedicated Alchemy API keys for mainnet
- Keep testnet credentials separate from production
- Monitor logs for network configuration warnings

### Development Setup
- Use `NETWORK=testnet` for all development work
- Keep mainnet credentials in secure environment files
- Test network switching in CI/CD pipelines
- Use different database for testnet vs mainnet

### Security Considerations
- Never commit mainnet API keys to version control
- Use different treasury addresses for testnet vs mainnet
- Validate network matches expected environment in critical operations
- Monitor for accidental network switches in production

## Network-Specific Features

### Mainnet Only
- Real token balances and transactions
- Production treasury management
- Live user deposits and withdrawals
- Alchemy analytics and monitoring

### Testnet Only
- Free test transactions
- Faucet tokens for development
- Safe contract testing
- Development treasury operations

### Both Networks
- Same contract interfaces and ABIs
- Identical deposit/withdrawal flows
- Full feature compatibility
- Same admin and user interfaces

---

## Summary

The new network switching system provides:

✅ **Easy Environment Switching** - Single `NETWORK` variable controls everything
✅ **Backward Compatibility** - Existing code continues working
✅ **Production Safety** - Clear separation between mainnet and testnet
✅ **Developer Experience** - Simple configuration and clear logging
✅ **Future Proof** - Easy to add new networks or configurations

**Set `NETWORK=mainnet` for production, `NETWORK=testnet` for development!**