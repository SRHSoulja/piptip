# Post-Mainnet Launch Checklist v3.0 (Abstract zkSync Battle Plan)

## 🔍 Abstract zkSync-Specific Audit

### Identified Gaps & Additions:

### 1. L1 Data Cost Handling
```typescript
// Abstract zkSync publishes data to L1 Ethereum
class L1CostCalculator {
  async calculateTotalCost(txData: string): Promise<bigint> {
    // L2 execution cost
    const l2Gas = await provider.estimateGas(txData);
    const l2Price = await provider.getGasPrice();
    const l2Cost = l2Gas * l2Price;

    // L1 calldata cost (zkSync-specific)
    const l1DataCost = await provider.send('zks_estimateL1ToL2', [txData]);
    const l1GasPrice = await getL1GasPrice(); // From L1 Ethereum
    const l1Cost = BigInt(l1DataCost) * l1GasPrice;

    // Total cost includes both layers
    return l2Cost + l1Cost;
  }

  async shouldPublishBasedOnL1Cost(): Promise<boolean> {
    const l1GasPrice = await getL1GasPrice();
    // Abstract may batch, so L1 costs spike during congestion
    if (l1GasPrice > 200_000_000_000n) { // 200 gwei on L1
      console.log('⚠️ L1 Ethereum congested - delaying publish');
      return false;
    }
    return true;
  }
}
```

### 2. Reorg Protection
```typescript
// zkSync finality is different from L1
class ReorgProtection {
  private readonly SAFE_CONFIRMATIONS = 10; // zkSync blocks
  private readonly L1_SAFE_CONFIRMATIONS = 12; // Ethereum blocks

  async waitForFinality(txHash: string): Promise<void> {
    const receipt = await provider.getTransactionReceipt(txHash);

    // Wait for L2 confirmations
    while (true) {
      const currentBlock = await provider.getBlockNumber();
      if (currentBlock - receipt.blockNumber > this.SAFE_CONFIRMATIONS) {
        break;
      }
      await setTimeout(1000);
    }

    // Also check L1 batch inclusion (Abstract-specific)
    const l1BatchNumber = await provider.send('zks_getL1BatchNumber', []);
    const txBatch = await provider.send('zks_getL1BatchByTx', [txHash]);

    if (l1BatchNumber - txBatch.number < 2) {
      console.log('⏳ Waiting for L1 batch finality...');
      await setTimeout(30000); // L1 batches are ~30s apart
    }
  }
}
```

### 3. State Sync Monitoring
```typescript
// Abstract gateway nodes may have different views
class StateSyncMonitor {
  private readonly ENDPOINTS = [
    'https://api.mainnet.abs.xyz',
    'https://abstract-mainnet.g.alchemy.com/v2/***',
    'wss://api.mainnet.abs.xyz/ws'
  ];

  async checkConsensus(): Promise<boolean> {
    const blocks = await Promise.all(
      this.ENDPOINTS.map(url =>
        new ethers.JsonRpcProvider(url).getBlockNumber()
      )
    );

    const maxDiff = Math.max(...blocks) - Math.min(...blocks);
    if (maxDiff > 2) {
      console.warn(`⚠️ Gateway desync detected: ${maxDiff} blocks difference`);
      return false;
    }
    return true;
  }
}
```

## 🤖 Production Automation Matrix

| Component | Implementation | Frequency | Type |
|-----------|---------------|-----------|------|
| **Contract Health Check** | Kubernetes CronJob | Every 1 min | Real-time monitor |
| **Gas Price Monitor** | WebSocket listener | Continuous | Real-time monitor |
| **Snapshot Publishing** | SystemD timer | Every 6 hours | Cron job |
| **Database Validation** | PostgreSQL trigger | On every write | Real-time monitor |
| **L1 Cost Tracker** | Lambda function | Every 5 min | Cron job |
| **Reorg Detection** | WebSocket listener | Continuous | Real-time monitor |
| **Balance Alert** | CloudWatch alarm | Every 10 min | Cron job |
| **Circuit Breaker** | In-process | On every error | Real-time monitor |
| **Rollback Decision** | Manual runbook | On critical alert | Manual step |
| **Contract Migration** | Manual runbook | On bug discovery | Manual step |

### Recommended Stack:
```yaml
monitoring:
  - Grafana: Real-time dashboards
  - Prometheus: Metrics collection
  - AlertManager: Incident routing
  - PagerDuty: On-call escalation

automation:
  - GitHub Actions: Scheduled publishing
  - Kubernetes CronJobs: Health checks
  - AWS Lambda: Cost tracking
  - Datadog: Synthetic monitoring

infrastructure:
  - Railway: Main application
  - Alchemy: Primary RPC
  - QuickNode: Backup RPC
  - IPFS: Snapshot storage
```

## 📋 Detailed Deployment Checklist

### Phase 1: Contract Deployment & Verification

#### 1.1 Deploy Contract (zkSync-Aware)
```bash
# ⚠️ THIS IS THE ONLY COMMAND THAT USES GAS
NETWORK=mainnet npx hardhat run scripts/hardhat_deploy.js --network abstract-mainnet --confirm-mainnet
```
- [ ] Record contract address
- [ ] Record deployment TX hash
- [ ] Record block number
- [ ] Record gas used
- [ ] Wait for L2 finality (~2-3 seconds)

#### 1.2 Abstract-Specific Verification
```bash
# zkSync chains may have delayed state propagation
sleep 10  # Wait for gateway sync

# Verify contract exists with zkSync-specific check
curl -X POST https://api.mainnet.abs.xyz \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["<CONTRACT_ADDRESS>", "latest"],"id":1}'
```

#### 1.3 Explorer Verification
- Navigate to `https://explorer.abs.xyz/address/<contract_address>`
- Verify transaction status: "Verified" (not just "Success")
- Check L1 batch number recorded
- Note: Source verification requires zksolc version match

### Phase 2: Initial Testing

#### 2.1 Dry Test (No Gas)
```bash
NETWORK=mainnet npx tsx scripts/test_merkle_publisher.ts info
```
- [ ] Confirms mainnet network
- [ ] Shows correct contract address
- [ ] No errors connecting

#### 2.2 Generate Test Snapshot (No Gas)
```bash
NETWORK=mainnet npx tsx scripts/test_merkle_publisher.ts generate
```
- [ ] Record test merkle root
- [ ] Verify user count correct
- [ ] Check total balances match

### Phase 3: First Live Publish

#### 3.1 Pre-Publish Safety Check
```bash
NETWORK=mainnet npx tsx scripts/check_gas_prices.ts
```
- [ ] Gas price < threshold (e.g., 50 gwei)
- [ ] Wallet has sufficient ETH
- [ ] Database backup taken

#### 3.2 Publish First Snapshot
```bash
# ⚠️ THIS USES GAS - First real mainnet snapshot
NETWORK=mainnet npx tsx scripts/test_merkle_publisher.ts publish --confirm-mainnet
```
- [ ] Record TX hash
- [ ] Record gas used
- [ ] Record merkle root
- [ ] Confirm transaction success

### Phase 4: Event Monitoring

#### 4.1 Real-Time Event Listener
```typescript
// scripts/event_monitor.ts
import { WebSocketProvider } from "ethers";

async function monitorEvents() {
  const wsProvider = new WebSocketProvider(
    process.env.MAINNET_WS_URL || 'wss://api.mainnet.abs.xyz/ws'
  );

  const contract = new Contract(MAINNET_REGISTRY, ABI, wsProvider);

  contract.on("SnapshotPublished", async (merkleRoot, ipfsHash, timestamp, publisher) => {
    console.log(`📤 New snapshot: ${merkleRoot}`);
    await validateSnapshot(merkleRoot);
  });
}
```

### Phase 5: Gas Monitoring & Controls

#### 5.1 Set Gas Thresholds
```bash
# Configure in .env
MAINNET_MAX_GAS_PRICE=100  # gwei
MAINNET_MAX_GAS_PER_TX=500000
```

#### 5.2 Smart Gas Manager
```typescript
class GasManager {
  async shouldPublish(): Promise<boolean> {
    const gasPrice = await this.getGasPrice();
    const l1GasPrice = await this.getL1GasPrice();
    const totalCost = gasPrice + (l1GasPrice * 0.1);

    if (totalCost > this.MAX_GWEI) {
      console.log(`⛔ Gas too high: ${totalCost} gwei`);
      return false;
    }
    return true;
  }
}
```

### Phase 6: Enhanced Rollback Procedures

#### 6.1 Automated Circuit Breaker
```typescript
class CircuitBreaker {
  private failures = 0;
  private readonly MAX_FAILURES = 3;

  async onPublishError(error: Error) {
    this.failures++;

    if (error.message.includes('revert')) {
      await this.emergencyStop('Contract revert detected');
    } else if (this.failures >= this.MAX_FAILURES) {
      await this.emergencyStop(`${this.failures} consecutive failures`);
    }
  }

  async emergencyStop(reason: string) {
    console.error(`🚨 EMERGENCY STOP: ${reason}`);
    await prisma.appConfig.update({
      where: { id: 1 },
      data: { publishingEnabled: false }
    });
    await sendAlert(`EMERGENCY STOP: ${reason}`);
  }
}
```

#### 6.2 Worst-Case Scenario: Contract Bug After Publishing
```typescript
async function handleContractBug() {
  // Step 1: Immediate damage control
  await prisma.appConfig.update({
    where: { id: 1 },
    data: {
      publishingEnabled: false,
      withdrawalsEnabled: false,
      emergencyMode: true
    }
  });

  // Step 2: Deploy new contract if fixable
  if (isBugFixable()) {
    const newContract = await deployFixedContract();
    await migrateToNewContract(lastGoodSnapshot, newContract);
    process.env.MAINNET_REGISTRY_CONTRACT_ADDRESS = newContract;
  } else {
    await rollbackToTestnetOnly();
  }

  // Step 3: User communication
  await notifyAllUsers('System maintenance - snapshots temporarily paused');
}
```

## 🎭 Disaster Recovery Drill (Pre-Mainnet)

### "Operation Chaos" - Controlled Failure Exercise

#### Drill Scenario 1: Contract Bug Discovery
```bash
# Setup: Deploy to testnet with intentional bug
NETWORK=testnet npx hardhat run scripts/deploy_buggy_contract.js --network abstract-testnet

# Exercise steps:
1. Publish snapshot successfully
2. Discover "bug" (revert condition)
3. Trigger circuit breaker
4. Execute rollback procedure
5. Deploy fixed contract
6. Migrate state
7. Resume operations

# Success criteria:
- Circuit breaker activates < 1 minute
- Publishing stops automatically
- No data loss during migration
- Service restored < 30 minutes
```

#### Drill Scenario 2: Gateway Desync
```bash
# Exercise steps:
1. Start publishing routine
2. Introduce gateway lag
3. Detect desync condition
4. Switch to backup gateway
5. Reconcile any conflicts
6. Return to normal operations

# Success criteria:
- Desync detected < 30 seconds
- Automatic failover works
- No duplicate publishes
- Data consistency maintained
```

#### Drill Scenario 3: Gas Spike Crisis
```bash
# Setup: Mock gas price at 1000 gwei
export MOCK_GAS_PRICE=1000000000000

# Exercise steps:
1. Attempt publish with high gas
2. Circuit breaker prevents transaction
3. Queue builds up
4. Gas returns to normal
5. Batch processing clears queue
6. Verify all snapshots published

# Success criteria:
- No transactions sent > threshold
- Queue properly maintained
- Batch processing works
- No snapshots lost
```

## 🎯 Abstract Mainnet Battle Plan

### D-Day Checklist

#### T-24 Hours
- [ ] Run disaster recovery drill
- [ ] Verify all automation scripts
- [ ] Confirm team availability
- [ ] Take database backup

#### T-1 Hour
- [ ] Final testnet validation
- [ ] Check L1 Ethereum gas prices
- [ ] Verify wallet balance
- [ ] Start monitoring dashboard

#### T-0 Deploy
- [ ] Execute deployment with team watching
- [ ] Verify on multiple gateways
- [ ] Wait for L1 batch inclusion
- [ ] Update all references

#### T+1 Hour
- [ ] First snapshot published
- [ ] All monitors green
- [ ] Team celebrates 🎉

## 🔒 Gas Consumption Truth Table

| Command Type | RPC Method | Gas Used | Safe? |
|--------------|------------|----------|-------|
| `contract.owner()` | `eth_call` | **0** | ✅ |
| `contract.getLatestSnapshot()` | `eth_call` | **0** | ✅ |
| `contract.isValidSnapshot()` | `eth_call` | **0** | ✅ |
| `provider.getBalance()` | `eth_getBalance` | **0** | ✅ |
| `provider.getCode()` | `eth_getCode` | **0** | ✅ |
| `provider.getBlock()` | `eth_getBlockByNumber` | **0** | ✅ |
| `contract.publishSnapshot()` | `eth_sendTransaction` | **~150k** | ⚠️ |
| `contractFactory.deploy()` | `eth_sendTransaction` | **~1M** | ⚠️ |

**GUARANTEE: Only `eth_sendTransaction` consumes gas. All view functions and queries use `eth_call` which simulates execution without state changes or gas consumption.**

## 📱 Emergency Runbook

```yaml
Severity Levels:
  LOW: Gas spike, slow gateway
    Action: Wait and retry

  MEDIUM: Failed publishes, DB lag
    Action: Pause publishing, investigate

  HIGH: Contract revert, data mismatch
    Action: Emergency stop, rollback if needed

  CRITICAL: Contract bug, funds at risk
    Action: Full stop, deploy fix, migrate

Escalation Path:
  1. Automated monitoring detects issue
  2. Circuit breaker engages if threshold hit
  3. Alert sent to team
  4. Manual review and decision
  5. Execute recovery procedure
  6. Post-mortem and prevention

Recovery Time Objectives:
  - Detection: < 1 minute (automated)
  - Response: < 5 minutes (circuit breaker)
  - Resolution: < 1 hour (rollback)
  - Full Recovery: < 24 hours (new deployment)
```

## Key Metrics Dashboard

```typescript
interface MainnetDashboard {
  // Real-time (WebSocket)
  currentGasPrice: number;
  latestBlock: number;
  contractBalance: string;

  // Every minute (Cron)
  lastSnapshotAge: number;
  queuedSnapshots: number;
  gatewayHealth: 'GREEN' | 'YELLOW' | 'RED';

  // Every 5 minutes (Cron)
  l1GasPrice: number;
  l1BatchNumber: number;
  costProjection30d: number;

  // On-demand (Manual)
  rollbackReady: boolean;
  backupCurrent: boolean;
  teamOnCall: string;
}
```

---

**This v3.0 battle plan addresses all Abstract zkSync edge cases, provides clear automation vs manual boundaries, includes executive summaries for the team, and defines concrete disaster recovery drills to validate our safety systems before mainnet launch.** 🚀