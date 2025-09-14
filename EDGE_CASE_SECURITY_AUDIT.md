# 🚨 CRITICAL EDGE CASE SECURITY VULNERABILITIES FOUND

## Executive Summary

**SECURITY LEVEL: HIGH RISK** - Multiple critical vulnerabilities discovered that could lead to:
- Financial exploitation via precision attacks
- Role-based benefit manipulation
- Race condition exploitation
- System resource exhaustion
- Database integrity compromise

---

## 🔴 CRITICAL VULNERABILITIES

### 1. **PRECISION OVERFLOW/UNDERFLOW ATTACKS** - SEVERITY: CRITICAL

**Location**: `/src/services/tip_processor.ts` (Lines 80-82, 126-128)
**Location**: `/src/services/token.ts` (Lines 82-84, 102-110)

**Vulnerability**:
```typescript
// VULNERABLE CODE:
const atomic = toAtomicDirect(data.amount, token.decimals);
const feeAtomic = (atomic * feeBps) / 10000n;
```

**Attack Scenarios**:

1. **Microscopic Amount Attack**:
   ```javascript
   // User tips 0.000000001 tokens with 18 decimals
   // This creates 1 atomic unit but fee calculation rounds to 0
   tip(0.000000001, "PENGU") // Fee = (1n * 100n) / 10000n = 0n
   // User sends tips with ZERO fees, breaking fee collection
   ```

2. **Maximum Value Overflow**:
   ```javascript
   // JavaScript Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991
   // With 18 decimals: parseUnits("9007199254740991", 18) causes overflow
   tip(9007199254740991, "PENGU") // System crash/undefined behavior
   ```

3. **Fee Calculation Underflow**:
   ```javascript
   // With very small fees and large exemption rates
   feeBpsNum = Math.round(100 * (1 - 0.99)) // = 1 BPS
   feeAtomic = (1n * 1n) / 10000n // = 0n (rounds down to zero)
   ```

**Impact**: Users can send unlimited tips with ZERO fees, draining house revenue.

---

### 2. **ROLE EVASION TIMING ATTACK** - SEVERITY: HIGH

**Location**: `/src/services/role_rake_benefits.ts` (Lines 84-108)

**Vulnerability**:
```typescript
// VULNERABLE: Only 10-minute hold time verification
const minimumRoleHoldTime = 10 * 60 * 1000; // 10 minutes
```

**Attack Scenarios**:

1. **Fresh Role Assignment Exploit**:
   ```javascript
   // User gets role assigned by friend/alt account
   // Immediately uses benefits within first database check
   // No hold time verification for first-time role assignments
   ```

2. **Database Race Condition**:
   ```javascript
   // User triggers role check before analytics record is created
   // System assumes "new role" and allows benefit immediately
   // Multiple rapid calls can bypass hold time entirely
   ```

3. **Cache Manipulation**:
   ```javascript
   // 5-minute cache means users can exploit during cache refresh window
   // Role removed/readded during cache refresh bypasses verification
   ```

**Impact**: Users can exploit role benefits immediately after assignment.

---

### 3. **WITHDRAWAL LIMITER BOUNDARY ATTACKS** - SEVERITY: HIGH

**Location**: `/src/services/withdrawal_limiter.ts` (Lines 74-84, 94-100)

**Vulnerability**:
```typescript
// VULNERABLE: Edge case boundary conditions
if (accountAgeDays < 1) {
  maxWithdrawalsPerDay = 1; // Exactly 0 days = new account limits?
} else if (amount < 10) {
  cooldownMinutes = 0; // 9.999999 = instant withdrawal
}
```

**Attack Scenarios**:

1. **Account Age Boundary Exploit**:
   ```javascript
   // Account created 23 hours 59 minutes ago
   // accountAgeDays = 0 (Math.floor truncation)
   // User gets new account restrictions despite being "established"
   ```

2. **Amount Boundary Gaming**:
   ```javascript
   // Multiple withdrawals of exactly 9.999999 tokens
   // Each gets instant cooldown (0 minutes)
   // User drains account rapidly with "small" amounts
   ```

3. **Progressive Cooldown Overflow**:
   ```javascript
   // After many withdrawals: cooldownMinutes += (recentCount - 1) * 30
   // No maximum cap - could result in years of cooldown
   ```

**Impact**: Users bypass withdrawal limits or face excessive penalties.

---

### 4. **BALANCE MANIPULATION VIA CONCURRENT OPERATIONS** - SEVERITY: CRITICAL

**Location**: `/src/interactions/buttons/matches.ts` (Lines 95-123)
**Location**: `/src/services/balances.ts` (Lines 141-143, 255-257)

**Vulnerability**:
```typescript
// RACE CONDITION: Lock check not atomic with balance debit
const lockResult = await tx.match.updateMany({
  where: { id: matchId, status: "OFFERED" },
  data: { status: "LOCKED" }
});
// WINDOW OF VULNERABILITY HERE
await debitTokenTx(tx, i.user.id, m.Token.id, wager, "MATCH_WAGER");
```

**Attack Scenarios**:

1. **Double-Spend Race Condition**:
   ```javascript
   // User rapidly joins multiple matches simultaneously
   // All pass the balance check before any debit occurs
   // User spends same balance multiple times
   ```

2. **Insufficient Balance Bypass**:
   ```javascript
   // User initiates withdrawal + match join + tip simultaneously
   // Balance checks happen concurrently before debits
   // User spends more than available balance
   ```

3. **Negative Balance Creation**:
   ```javascript
   const bal = toAtomic(ub.amount, decimals); // Read current balance
   // CONCURRENT OPERATION DEBITS BALANCE HERE
   const newBal = bal - total; // Now negative!
   if (newBal < 0n) throw new Error(); // Check AFTER calculation
   ```

**Impact**: Users can create negative balances, spending money they don't have.

---

### 5. **INPUT VALIDATION BYPASS** - SEVERITY: MEDIUM

**Location**: `/src/commands/pip_withdraw.ts` (Lines 85-92)

**Vulnerability**:
```typescript
// Missing validation for edge cases
where: {
  userId: user.id,
  amount: { gt: 0 } // Only filters positive, not malformed values
}
```

**Attack Scenarios**:

1. **Malformed Decimal Values**:
   ```javascript
   // Database stores "NaN", "Infinity", "undefined" as strings
   // Calculations with these values produce unexpected results
   ```

2. **Precision Loss Exploitation**:
   ```javascript
   // formatDecimal() truncates to 2 decimal places
   // User has 1.999999999 tokens, shows as "2" but can't withdraw 2
   ```

**Impact**: System confusion, failed operations, user frustration.

---

## 🔴 CRITICAL DATABASE INTEGRITY ISSUES

### 6. **ATOMIC VS DECIMAL STORAGE INCONSISTENCY** - SEVERITY: CRITICAL

**Identified Issue**: The system inconsistently stores values as atomic units vs decimal:

**Examples**:
```sql
-- INCONSISTENT STORAGE:
amountAtomic: Decimal   -- Should be string/bigint for atomic precision
totalAmount: Decimal    -- Human readable amounts mixed with atomic
```

**Problems**:
- Decimal precision loss for tokens with >15 decimals
- JavaScript Number precision issues with large atomic values
- Inconsistent formatting between atomic and decimal representations

---

## 🛠️ RECOMMENDED CRITICAL FIXES

### Fix 1: Precision Attack Prevention
```typescript
// SECURE VERSION:
export function toAtomicDirect(amount: number | string, decimals: number): bigint {
  // Validate input range
  const amountStr = String(amount);
  const num = Number(amountStr);

  if (!isFinite(num) || num < 0) {
    throw new Error("Invalid amount: must be positive finite number");
  }

  // Prevent overflow attacks
  if (num > 1e12) { // Reasonable maximum
    throw new Error("Amount too large");
  }

  // Prevent microscopic attacks
  const atomic = parseUnits(amountStr, decimals);
  if (atomic < BigInt(1000)) { // Minimum atomic threshold
    throw new Error("Amount too small");
  }

  return atomic;
}

// SECURE FEE CALCULATION:
const feeAtomic = (atomic * feeBps) / 10000n;
if (feeBps > 0n && feeAtomic === 0n) {
  // Force minimum fee of 1 atomic unit if fee rate > 0
  feeAtomic = 1n;
}
```

### Fix 2: Role Evasion Prevention
```typescript
// SECURE VERSION:
private static async verifyRoleHoldTime(
  discordUserId: string,
  guildId: string,
  roleId: string,
  minimumHoldTime: number
): Promise<boolean> {
  try {
    // SECURE: Check actual Discord role assignment timestamp
    const discord = getDiscordClient();
    const guild = await discord.guilds.fetch(guildId);
    const member = await guild.members.fetch(discordUserId);

    if (!member.roles.cache.has(roleId)) {
      return false; // Role no longer held
    }

    // Use Discord's role assignment audit log for true verification
    const auditLogs = await guild.fetchAuditLogs({
      type: AuditLogEvent.MemberRoleUpdate,
      user: member.user,
      limit: 10
    });

    const roleAssignment = auditLogs.entries.find(entry =>
      entry.changes?.some(change =>
        change.key === '$add' &&
        change.new?.some(role => role.id === roleId)
      )
    );

    if (!roleAssignment) {
      return false; // No audit trail = suspicious
    }

    const assignmentTime = roleAssignment.createdTimestamp;
    const holdTime = Date.now() - assignmentTime;

    return holdTime >= minimumHoldTime;

  } catch (error) {
    // FAIL SECURE: Deny benefits on verification error
    console.warn(`Role verification failed for security: ${error}`);
    return false;
  }
}
```

### Fix 3: Balance Race Condition Prevention
```typescript
// SECURE VERSION:
export async function debitTokenTx(
  tx: Tx,
  discordId: string,
  tokenId: number,
  amountAtomic: bigint,
  type: string,
  opts: any = {}
) {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");

  const user = await ensureUserTx(tx, discordId);

  // ATOMIC UPDATE with balance check in single operation
  const result = await tx.userBalance.updateMany({
    where: {
      userId: user.id,
      tokenId: tokenId,
      amount: { gte: toDecStr(amountAtomic + (opts.feeAtomic ?? 0n), decimals) }
    },
    data: {
      amount: {
        subtract: toDecStr(amountAtomic + (opts.feeAtomic ?? 0n), decimals)
      }
    }
  });

  if (result.count === 0) {
    throw new Error("Insufficient balance or concurrent operation");
  }

  // Log transaction...
}
```

---

## 🚨 IMMEDIATE ACTIONS REQUIRED

1. **Deploy hotfix patches** for precision attacks immediately
2. **Implement input validation** for all amount fields
3. **Add minimum atomic thresholds** to prevent microscopic attacks
4. **Review all concurrent balance operations** for race conditions
5. **Audit role verification system** for timing attacks
6. **Add comprehensive monitoring** for unusual patterns
7. **Implement circuit breakers** for system protection

---

## 🔍 ADDITIONAL EDGE CASES TO TEST

### Zero/Null/Undefined Scenarios:
- User balance exactly 0.000000000
- Null token references
- Undefined guild/channel IDs
- Empty string Discord IDs

### Boundary Value Testing:
- Account age exactly 0, 1, 7, 30 days
- Withdrawal amounts at exact cooldown thresholds (10, 100)
- Maximum BPS values (9999, 10000, 10001)
- Token decimals edge cases (0, 1, 18, 19+)

### Concurrency Edge Cases:
- Simultaneous identical operations
- Server restart during transaction
- Database timeout scenarios
- Memory exhaustion conditions

### Malicious Input Testing:
- SQL injection via note fields
- XSS in user-controlled strings
- Buffer overflow attempts
- Regular expression DoS attacks

---

**CRITICAL PRIORITY**: Address precision attacks and race conditions immediately to prevent financial loss.