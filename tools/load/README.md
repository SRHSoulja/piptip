# Load and Race Test Harness

This test harness validates the PIPTip system under concurrent load, testing core flows for race conditions and invariant violations.

## Features

- **Single Tips Burst**: Concurrent tip creation with random amounts
- **Group Tips & Claims**: Parallel claim attempts with unique constraint testing  
- **Claim vs Expiry Race**: Concurrent claims while expiring group tips
- **Refund Idempotency**: Ensures multiple refund calls are safe
- **Integrity Checks**: Validates balance conservation and data consistency

## Usage

### Basic Run
```bash
npx tsx tests/load/loadTest.ts
```

### With Configuration
```bash
USERS=200 SINGLE_TIPS=1500 CONCURRENCY=75 npx tsx tests/load/loadTest.ts
```

### Alternative (ts-node)
```bash
TS_NODE_TRANSPILE_ONLY=1 ts-node tests/load/loadTest.ts
```

## Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `USERS` | 100 | Number of test users to create |
| `TOKENS` | 2 | Number of test tokens to create |
| `SINGLE_TIPS` | 1000 | Number of single tips to create |
| `GROUP_TIPS` | 100 | Number of group tips to create |
| `CLAIMERS_PER_GROUP` | 10-30 | Random range of claimers per group tip |
| `EXPIRE_COUNT` | 50 | Number of group tips to race expire vs claims |
| `CONCURRENCY` | 50 | Parallel operations per batch |

## Database Requirements

- Uses a non-production database (preferably with PgBouncer enabled)
- Requires clean database state at start
- Creates test data in isolated namespace (`load_test_*` prefixed IDs)

## Performance Thresholds

- ✅ 1,000 single tips complete ≤ 60s
- ✅ Group tip with 30 claims finalized ≤ 2s  
- ✅ 95th percentile query latency < 200ms
- ✅ No systematic outliers > 500ms

## Invariants Tested

1. **No Negative Balances**: All user balances ≥ 0 at all times
2. **Balance Conservation**: Total balances = initial funding + deposits - withdrawals
3. **Transaction Consistency**: Every completed tip has corresponding transaction
4. **Refund Safety**: Multiple refund calls are idempotent
5. **Claim Uniqueness**: Exactly one claim per (groupTipId, userId)
6. **Status Integrity**: Tips/claims end in exactly one terminal state

## Output

- Console progress with real-time stats
- Final JSON summary with performance metrics
- Failure details in `tests/load/failures-<timestamp>.json` if invariants fail
- Slow query log for operations > 300ms

## Implementation Notes

- Pure backend testing - no Discord UI
- Mocks external RPC calls for deterministic testing
- Uses existing service layer (no logic reimplementation)
- Short transactions with proper atomic sections
- Bounded random amounts to prevent overdrafts