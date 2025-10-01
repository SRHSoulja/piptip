# 🚀 MAINNET DEPLOYMENT QUICKSTART

## Pre-Flight Checks ✅

- [ ] **Environment**: `NETWORK=mainnet` configured in `.env`
- [ ] **Wallet**: Has 0.01+ ETH on Abstract mainnet
- [ ] **Private Key**: `AGW_SESSION_PRIVATE_KEY` set
- [ ] **Backup**: Database snapshot taken
- [ ] **Team**: On-call engineer available
- [ ] **Gas Price**: Check L1 Ethereum < 200 gwei

## ⚠️ Safety Rules

### **NO GAS CONSUMPTION** without `--confirm-mainnet` flag:
- ✅ **Safe** (0 gas): `info`, `generate`, `verify`, `latest`, dry-run commands
- ⚠️ **Uses Gas**: Only `deploy` and `publish` with `--confirm-mainnet`

## Essential Commands 🎯

### 1️⃣ Dry Run (NO GAS)
```bash
# Validate everything without spending gas
npm run dryrun:mainnet
# OR
NETWORK=mainnet npx tsx scripts/mainnet_deployment_dryrun.ts --confirm-mainnet --skip-gas
```

### 2️⃣ Deploy Contract (USES GAS ~1M)
```bash
# Deploy MerkleRegistry to mainnet
npm run deploy:mainnet
# OR
NETWORK=mainnet npx hardhat run scripts/hardhat_deploy.js --network abstract-mainnet --confirm-mainnet
```

### 3️⃣ Update Environment
```bash
# After deployment, add contract address to .env
echo "MAINNET_REGISTRY_CONTRACT_ADDRESS=<deployed_address>" >> .env
```

### 4️⃣ Verify Deployment (NO GAS)
```bash
# Check contract connectivity
npm run health
# OR
NETWORK=mainnet npx tsx scripts/test_merkle_publisher.ts info
```

### 5️⃣ First Publish (USES GAS ~150k)
```bash
# Publish first snapshot to mainnet
npm run publish:mainnet
# OR
NETWORK=mainnet npx tsx scripts/test_merkle_publisher.ts publish --confirm-mainnet
```

## Monitoring & Verification 📊

### Explorer Links
- **Contract**: `https://explorer.abs.xyz/address/<CONTRACT_ADDRESS>`
- **Transaction**: `https://explorer.abs.xyz/tx/<TX_HASH>`

### Event Monitoring
```bash
# Start real-time event monitor
npm run monitor:events
```

### Health Check
```bash
# Check system health (NO GAS)
npm run health
```

## Emergency Procedures 🚨

| Issue | Action | Command |
|-------|--------|---------|
| **High gas** | Wait for lower prices | Check `https://l2fees.info` |
| **Publish fail** | Retry with backoff | `npm run publish:retry` |
| **Contract bug** | STOP ALL OPERATIONS | `npm run emergency:stop` |
| **Data mismatch** | Auto-reconcile | `npm run reconcile:mainnet` |

## Success Checklist ✅

After deployment, verify:
- [ ] Contract visible on explorer
- [ ] Owner address matches deployer
- [ ] First snapshot published successfully
- [ ] Events visible in transaction logs
- [ ] Database synchronized with chain
- [ ] Monitoring dashboard active

## Quick Reference 📋

```bash
# Commands that NEVER use gas (safe to run anytime):
npm run dryrun:mainnet     # Full readiness check
npm run health              # System health check
npm run monitor:events      # Watch for events

# Commands that USE GAS (require --confirm-mainnet):
npm run deploy:mainnet      # Deploy contract (~1M gas)
npm run publish:mainnet     # Publish snapshot (~150k gas)
```

## Escalation Path 📞

1. **Alert** → Slack #alerts channel
2. **Triage** → On-call engineer responds
3. **Escalate** → Team lead if HIGH/CRITICAL
4. **Resolve** → Follow runbook procedures
5. **Post-mortem** → Within 24 hours

---

**Remember: Only commands with `--confirm-mainnet` flag will use real ETH on mainnet!** 🔒