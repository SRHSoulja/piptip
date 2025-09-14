#!/usr/bin/env node

// scripts/state_consistency_validator.ts - Comprehensive state consistency validation
// Identifies impossible database states, race conditions, and financial integrity violations

import { PrismaClient } from '@prisma/client';
import { formatUnits, parseUnits } from 'ethers';

const prisma = new PrismaClient();

interface StateViolation {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  description: string;
  affectedRows: number;
  details?: any;
  recommendation: string;
  potentialImpact: string;
}

interface ValidationResult {
  checkName: string;
  passed: boolean;
  violations: StateViolation[];
  executionTime: number;
}

class StateConsistencyValidator {
  private results: ValidationResult[] = [];

  // ============= BALANCE CONSISTENCY & CONSERVATION OF FUNDS =============

  async validateBalanceConsistency(): Promise<ValidationResult> {
    const startTime = Date.now();
    const violations: StateViolation[] = [];

    console.log('\n🔍 Validating Balance Consistency & Conservation of Funds...');

    try {
      // 1. Check for negative balances (CRITICAL)
      const negativeBalances = await prisma.userBalance.findMany({
        where: { amount: { lt: 0 } },
        include: { User: true, Token: true }
      });

      if (negativeBalances.length > 0) {
        violations.push({
          severity: 'CRITICAL',
          category: 'Balance Conservation',
          description: 'Negative user balances detected',
          affectedRows: negativeBalances.length,
          details: negativeBalances.map(b => ({
            userId: b.userId,
            discordId: b.User.discordId,
            tokenSymbol: b.Token.symbol,
            amount: b.amount.toString()
          })),
          recommendation: 'Immediately audit balance operations and restore valid balances',
          potentialImpact: 'Users can withdraw more tokens than they own, draining treasury'
        });
      }

      // 2. Verify transaction conservation (total debits = total credits)
      const transactionSums = await prisma.$queryRaw<Array<{
        tokenId: number;
        symbol: string;
        totalCredits: string;
        totalDebits: string;
        netDifference: string;
      }>>`
        WITH transaction_sums AS (
          SELECT
            t.tokenId,
            tk.symbol,
            COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0) as total_credits,
            COALESCE(SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END), 0) as total_debits
          FROM "Transaction" t
          LEFT JOIN "Token" tk ON t.tokenId = tk.id
          WHERE t.tokenId IS NOT NULL
          GROUP BY t.tokenId, tk.symbol
        )
        SELECT
          tokenId,
          symbol,
          total_credits::text as "totalCredits",
          total_debits::text as "totalDebits",
          (total_credits - total_debits)::text as "netDifference"
        FROM transaction_sums
        WHERE ABS(total_credits - total_debits) > 0.001
      `;

      if (transactionSums.length > 0) {
        violations.push({
          severity: 'HIGH',
          category: 'Transaction Conservation',
          description: 'Transaction ledger shows imbalanced credits/debits',
          affectedRows: transactionSums.length,
          details: transactionSums,
          recommendation: 'Audit transaction recording logic and identify missing transactions',
          potentialImpact: 'Indicates potential double-spend or missing transaction records'
        });
      }

      // 3. Check balance vs transaction consistency
      const balanceDiscrepancies = await prisma.$queryRaw<Array<{
        userId: number;
        discordId: string;
        tokenId: number;
        symbol: string;
        currentBalance: string;
        transactionSum: string;
        difference: string;
      }>>`
        WITH user_transaction_sums AS (
          SELECT
            t.userId,
            u.discordId,
            t.tokenId,
            tk.symbol,
            COALESCE(SUM(t.amount), 0) as transaction_total
          FROM "Transaction" t
          LEFT JOIN "User" u ON t.userId = u.id
          LEFT JOIN "Token" tk ON t.tokenId = tk.id
          WHERE t.userId IS NOT NULL AND t.tokenId IS NOT NULL
          GROUP BY t.userId, u.discordId, t.tokenId, tk.symbol
        ),
        balance_comparison AS (
          SELECT
            uts.userId,
            uts.discordId,
            uts.tokenId,
            uts.symbol,
            COALESCE(ub.amount, 0) as current_balance,
            uts.transaction_total,
            (COALESCE(ub.amount, 0) - uts.transaction_total) as difference
          FROM user_transaction_sums uts
          LEFT JOIN "UserBalance" ub ON uts.userId = ub.userId AND uts.tokenId = ub.tokenId
        )
        SELECT
          userId,
          discordId,
          tokenId,
          symbol,
          current_balance::text as "currentBalance",
          transaction_total::text as "transactionSum",
          difference::text
        FROM balance_comparison
        WHERE ABS(difference) > 0.001
        LIMIT 20
      `;

      if (balanceDiscrepancies.length > 0) {
        violations.push({
          severity: 'HIGH',
          category: 'Balance-Transaction Consistency',
          description: 'User balances do not match transaction history',
          affectedRows: balanceDiscrepancies.length,
          details: balanceDiscrepancies,
          recommendation: 'Reconcile user balances with transaction records',
          potentialImpact: 'Users may have incorrect balances, affecting withdrawals and tips'
        });
      }

      // 4. Check for impossible atomic precision violations
      const precisionViolations = await prisma.$queryRaw<Array<{
        table: string;
        id: number;
        field: string;
        value: string;
        expectedPrecision: number;
        actualPrecision: number;
      }>>`
        SELECT
          'Tip' as table,
          id,
          'amountAtomic' as field,
          "amountAtomic"::text as value,
          18 as expectedPrecision,
          (LENGTH("amountAtomic"::text) - LENGTH(REPLACE("amountAtomic"::text, '.', '')) - 1) as actualPrecision
        FROM "Tip"
        WHERE "amountAtomic"::text ~ '\\.' AND LENGTH("amountAtomic"::text) - LENGTH(REPLACE("amountAtomic"::text, '.', '')) > 0
        UNION ALL
        SELECT
          'UserBalance' as table,
          id,
          'amount' as field,
          amount::text as value,
          18 as expectedPrecision,
          (LENGTH(amount::text) - LENGTH(REPLACE(amount::text, '.', '')) - 1) as actualPrecision
        FROM "UserBalance"
        WHERE amount::text ~ '\\.'
          AND LENGTH(amount::text) - LENGTH(REPLACE(amount::text, '.', '')) > 0
          AND (LENGTH(amount::text) - POSITION('.' in amount::text)) > 18
        LIMIT 10
      `;

      if (precisionViolations.length > 0) {
        violations.push({
          severity: 'MEDIUM',
          category: 'Atomic Precision',
          description: 'Detected non-atomic precision in supposedly atomic fields',
          affectedRows: precisionViolations.length,
          details: precisionViolations,
          recommendation: 'Ensure all atomic values are stored as integers without decimals',
          potentialImpact: 'Precision loss may lead to rounding errors in financial calculations'
        });
      }

    } catch (error) {
      violations.push({
        severity: 'CRITICAL',
        category: 'Balance Validation Error',
        description: 'Failed to validate balance consistency',
        affectedRows: 0,
        details: { error: error instanceof Error ? error.message : String(error) },
        recommendation: 'Fix database schema or query issues',
        potentialImpact: 'Unable to verify financial integrity'
      });
    }

    return {
      checkName: 'Balance Consistency',
      passed: violations.length === 0,
      violations,
      executionTime: Date.now() - startTime
    };
  }

  // ============= MATCH STATE MACHINE VALIDATION =============

  async validateMatchStates(): Promise<ValidationResult> {
    const startTime = Date.now();
    const violations: StateViolation[] = [];

    console.log('\n🎮 Validating Match State Transitions...');

    try {
      // 1. Check for impossible match states
      const impossibleStates = await prisma.match.findMany({
        where: {
          OR: [
            // Winner declared but match not settled
            { winnerUserId: { not: null }, status: { not: "SETTLED" } },
            // Settled match without moves
            { status: "SETTLED", OR: [{ challengerMove: null }, { joinerMove: null }] },
            // Match with winner but no joiner
            { winnerUserId: { not: null }, joinerId: null },
            // Wager is zero or negative
            { wagerAtomic: { lte: 0 } },
            // Pot less than 2x wager
            { AND: [{ potAtomic: { gt: 0 } }, { potAtomic: { lt: { multiply: ["wagerAtomic", 2] } } }] },
            // Rake greater than pot
            { AND: [{ rakeAtomic: { gt: 0 } }, { rakeAtomic: { gt: "potAtomic" } }] },
            // Future creation time
            { createdAt: { gt: new Date() } },
            // Expired offer still showing as offered
            { status: "OFFERED", offerDeadline: { lt: new Date() } }
          ]
        },
        include: { Challenger: true, Joiner: true, Token: true }
      });

      if (impossibleStates.length > 0) {
        violations.push({
          severity: 'CRITICAL',
          category: 'Match State Machine',
          description: 'Matches found in impossible states',
          affectedRows: impossibleStates.length,
          details: impossibleStates.map(m => ({
            matchId: m.id,
            status: m.status,
            wager: m.wagerAtomic.toString(),
            pot: m.potAtomic.toString(),
            rake: m.rakeAtomic.toString(),
            winnerId: m.winnerUserId,
            joinerId: m.joinerId,
            challengerMove: m.challengerMove,
            joinerMove: m.joinerMove,
            offerDeadline: m.offerDeadline
          })),
          recommendation: 'Fix match state machine logic and validate all state transitions',
          potentialImpact: 'Invalid match states could lead to incorrect payouts or stuck funds'
        });
      }

      // 2. Check for race condition indicators (multiple matches locked simultaneously)
      const suspiciousLocks = await prisma.$queryRaw<Array<{
        challengerId: number;
        lockCount: number;
        recentLocks: string;
      }>>`
        SELECT
          "challengerId",
          COUNT(*) as "lockCount",
          STRING_AGG("updatedAt"::text, ', ') as "recentLocks"
        FROM "Match"
        WHERE status = 'LOCKED'
          AND "updatedAt" > NOW() - INTERVAL '1 hour'
          AND "challengerId" IS NOT NULL
        GROUP BY "challengerId"
        HAVING COUNT(*) > 1
      `;

      if (suspiciousLocks.length > 0) {
        violations.push({
          severity: 'HIGH',
          category: 'Match Race Conditions',
          description: 'Multiple simultaneous locked matches detected',
          affectedRows: suspiciousLocks.length,
          details: suspiciousLocks,
          recommendation: 'Investigate match locking mechanism for race conditions',
          potentialImpact: 'Multiple users may join same match, causing double-debit'
        });
      }

      // 3. Validate match payout calculations
      const payoutErrors = await prisma.$queryRaw<Array<{
        id: number;
        status: string;
        wager: string;
        pot: string;
        rake: string;
        calculatedPot: string;
        calculatedRake: string;
        potDifference: string;
        rakeDifference: string;
      }>>`
        WITH match_calculations AS (
          SELECT
            m.id,
            m.status,
            m."wagerAtomic"::text as wager,
            m."potAtomic"::text as pot,
            m."rakeAtomic"::text as rake,
            (2 * m."wagerAtomic")::text as calculated_pot,
            CASE
              WHEN m.status = 'SETTLED' THEN
                ((2 * m."wagerAtomic" * COALESCE(ac."houseFeeBps", 200)) / 10000)::text
              ELSE '0'
            END as calculated_rake,
            (m."potAtomic" - (2 * m."wagerAtomic"))::text as pot_difference,
            CASE
              WHEN m.status = 'SETTLED' THEN
                (m."rakeAtomic" - ((2 * m."wagerAtomic" * COALESCE(ac."houseFeeBps", 200)) / 10000))::text
              ELSE '0'
            END as rake_difference
          FROM "Match" m
          CROSS JOIN (SELECT "houseFeeBps" FROM "AppConfig" ORDER BY id DESC LIMIT 1) ac
          WHERE m.status IN ('SETTLED', 'OFFERED')
        )
        SELECT
          id, status, wager, pot, rake,
          calculated_pot as "calculatedPot",
          calculated_rake as "calculatedRake",
          pot_difference as "potDifference",
          rake_difference as "rakeDifference"
        FROM match_calculations
        WHERE ABS(pot_difference::numeric) > 0.001
           OR (status = 'SETTLED' AND ABS(rake_difference::numeric) > 0.001)
        LIMIT 10
      `;

      if (payoutErrors.length > 0) {
        violations.push({
          severity: 'HIGH',
          category: 'Match Payout Calculations',
          description: 'Match pot/rake calculations do not match expected values',
          affectedRows: payoutErrors.length,
          details: payoutErrors,
          recommendation: 'Audit match payout calculation logic for consistency',
          potentialImpact: 'Incorrect payouts may give users more or less tokens than deserved'
        });
      }

    } catch (error) {
      violations.push({
        severity: 'CRITICAL',
        category: 'Match Validation Error',
        description: 'Failed to validate match states',
        affectedRows: 0,
        details: { error: error instanceof Error ? error.message : String(error) },
        recommendation: 'Fix database schema or query issues',
        potentialImpact: 'Unable to verify match state integrity'
      });
    }

    return {
      checkName: 'Match State Validation',
      passed: violations.length === 0,
      violations,
      executionTime: Date.now() - startTime
    };
  }

  // ============= ROLE BENEFIT STATE CONSISTENCY =============

  async validateRoleBenefits(): Promise<ValidationResult> {
    const startTime = Date.now();
    const violations: StateViolation[] = [];

    console.log('\n🎭 Validating Role Benefit State Consistency...');

    try {
      // 1. Check for benefit stacking violations
      const stackingViolations = await prisma.$queryRaw<Array<{
        userId: number;
        discordId: string;
        activeTiers: number;
        tierDetails: string;
      }>>`
        SELECT
          u.id as "userId",
          u."discordId",
          COUNT(tm.id) as "activeTiers",
          STRING_AGG(t.name || ' (expires: ' || tm."expiresAt"::text || ')', ', ') as "tierDetails"
        FROM "User" u
        JOIN "TierMembership" tm ON u.id = tm."userId"
        JOIN "Tier" t ON tm."tierId" = t.id
        WHERE tm.status = 'ACTIVE'
          AND tm."expiresAt" > NOW()
        GROUP BY u.id, u."discordId"
        HAVING COUNT(tm.id) > 1
      `;

      if (stackingViolations.length > 0) {
        violations.push({
          severity: 'MEDIUM',
          category: 'Benefit Stacking',
          description: 'Users with multiple active tier memberships detected',
          affectedRows: stackingViolations.length,
          details: stackingViolations,
          recommendation: 'Implement exclusive tier membership logic or ensure only best benefit applies',
          potentialImpact: 'Users may receive unintended benefit stacking, reducing fees excessively'
        });
      }

      // 2. Check for expired benefits still being applied
      const expiredBenefits = await prisma.tierMembership.findMany({
        where: {
          status: 'ACTIVE',
          expiresAt: { lt: new Date() }
        },
        include: { user: true, tier: true }
      });

      if (expiredBenefits.length > 0) {
        violations.push({
          severity: 'HIGH',
          category: 'Expired Benefits',
          description: 'Active tier memberships that have expired',
          affectedRows: expiredBenefits.length,
          details: expiredBenefits.map(tm => ({
            userId: tm.userId,
            discordId: tm.user.discordId,
            tierName: tm.tier.name,
            expiresAt: tm.expiresAt,
            status: tm.status
          })),
          recommendation: 'Implement automated cleanup for expired tier memberships',
          potentialImpact: 'Users may continue receiving benefits after expiration'
        });
      }

      // 3. Check for impossible benefit rates
      const impossibleRates = await prisma.$queryRaw<Array<{
        table: string;
        id: number;
        rateType: string;
        rateValue: number;
        label: string;
      }>>`
        SELECT 'Tier' as table, id, 'taxReduction' as rateType, "taxReductionBps", name as label
        FROM "Tier"
        WHERE "taxReductionBps" < 0 OR "taxReductionBps" > 10000
        UNION ALL
        SELECT 'Tier' as table, id, 'rakeReduction' as rateType, "rakeReductionBps", name as label
        FROM "Tier"
        WHERE "rakeReductionBps" < 0 OR "rakeReductionBps" > 10000
        UNION ALL
        SELECT 'RoleTaxExemption' as table, id, 'exemptionRate' as rateType, ("exemptionRate" * 100)::int, label
        FROM "RoleTaxExemption"
        WHERE "exemptionRate" < 0 OR "exemptionRate" > 100
        UNION ALL
        SELECT 'RoleRakeReduction' as table, id, 'rakeReduction' as rateType, "rakeReductionBps", label
        FROM "RoleRakeReduction"
        WHERE "rakeReductionBps" < 0 OR "rakeReductionBps" > 10000
      `;

      if (impossibleRates.length > 0) {
        violations.push({
          severity: 'HIGH',
          category: 'Invalid Benefit Rates',
          description: 'Benefit rates outside valid ranges detected',
          affectedRows: impossibleRates.length,
          details: impossibleRates,
          recommendation: 'Add database constraints to enforce valid benefit rate ranges',
          potentialImpact: 'Invalid rates could cause calculation errors or negative fees'
        });
      }

      // 4. Check for role benefit cache coherence issues
      const activeRoleReductions = await prisma.roleRakeReduction.count({
        where: {
          isActive: true,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } }
          ]
        }
      });

      const activeTaxExemptions = await prisma.roleTaxExemption.count({
        where: {
          isActive: true,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } }
          ]
        }
      });

      if (activeRoleReductions > 100 || activeTaxExemptions > 100) {
        violations.push({
          severity: 'MEDIUM',
          category: 'Role Benefit Scale',
          description: 'High number of active role benefits may impact cache performance',
          affectedRows: activeRoleReductions + activeTaxExemptions,
          details: { activeRoleReductions, activeTaxExemptions },
          recommendation: 'Consider implementing role benefit cleanup or pagination',
          potentialImpact: 'Performance degradation in benefit calculation'
        });
      }

    } catch (error) {
      violations.push({
        severity: 'CRITICAL',
        category: 'Role Benefit Validation Error',
        description: 'Failed to validate role benefit states',
        affectedRows: 0,
        details: { error: error instanceof Error ? error.message : String(error) },
        recommendation: 'Fix database schema or query issues',
        potentialImpact: 'Unable to verify benefit system integrity'
      });
    }

    return {
      checkName: 'Role Benefit Validation',
      passed: violations.length === 0,
      violations,
      executionTime: Date.now() - startTime
    };
  }

  // ============= USER STATE INTEGRITY =============

  async validateUserStates(): Promise<ValidationResult> {
    const startTime = Date.now();
    const violations: StateViolation[] = [];

    console.log('\n👤 Validating User State Integrity...');

    try {
      // 1. Check for duplicate wallet linkages
      const duplicateWallets = await prisma.$queryRaw<Array<{
        agwAddress: string;
        userCount: number;
        userIds: string;
        discordIds: string;
      }>>`
        SELECT
          "agwAddress",
          COUNT(*) as "userCount",
          STRING_AGG(id::text, ', ') as "userIds",
          STRING_AGG("discordId", ', ') as "discordIds"
        FROM "User"
        WHERE "agwAddress" IS NOT NULL
        GROUP BY "agwAddress"
        HAVING COUNT(*) > 1
      `;

      if (duplicateWallets.length > 0) {
        violations.push({
          severity: 'CRITICAL',
          category: 'Wallet Linkage',
          description: 'Multiple users linked to the same wallet address',
          affectedRows: duplicateWallets.length,
          details: duplicateWallets,
          recommendation: 'Enforce unique wallet constraint and resolve duplicate linkages',
          potentialImpact: 'Multiple Discord accounts could control same wallet funds'
        });
      }

      // 2. Check for banned users performing financial operations
      const bannedUserActivity = await prisma.$queryRaw<Array<{
        userId: number;
        discordId: string;
        bannedAt: Date;
        bannedReason: string;
        recentTips: number;
        recentMatches: number;
        recentWithdrawals: number;
      }>>`
        SELECT
          u.id as "userId",
          u."discordId",
          u."bannedAt",
          u."bannedReason",
          (SELECT COUNT(*) FROM "Tip" WHERE "fromUserId" = u.id AND "createdAt" > u."bannedAt") as "recentTips",
          (SELECT COUNT(*) FROM "Match" WHERE "challengerId" = u.id AND "createdAt" > u."bannedAt") as "recentMatches",
          (SELECT COUNT(*) FROM "Transaction" WHERE "userId" = u.id AND type = 'WITHDRAW' AND "createdAt" > u."bannedAt") as "recentWithdrawals"
        FROM "User" u
        WHERE u."isBanned" = true
          AND u."bannedAt" IS NOT NULL
        HAVING (SELECT COUNT(*) FROM "Tip" WHERE "fromUserId" = u.id AND "createdAt" > u."bannedAt") > 0
            OR (SELECT COUNT(*) FROM "Match" WHERE "challengerId" = u.id AND "createdAt" > u."bannedAt") > 0
            OR (SELECT COUNT(*) FROM "Transaction" WHERE "userId" = u.id AND type = 'WITHDRAW' AND "createdAt" > u."bannedAt") > 0
      `;

      if (bannedUserActivity.length > 0) {
        violations.push({
          severity: 'HIGH',
          category: 'Banned User Activity',
          description: 'Banned users have performed financial operations after ban',
          affectedRows: bannedUserActivity.length,
          details: bannedUserActivity,
          recommendation: 'Strengthen ban enforcement in all financial operation endpoints',
          potentialImpact: 'Banned users continue to access platform features'
        });
      }

      // 3. Check for user statistics inconsistencies
      const statInconsistencies = await prisma.$queryRaw<Array<{
        userId: number;
        discordId: string;
        recordedWins: number;
        actualWins: number;
        recordedLosses: number;
        actualLosses: number;
        recordedTies: number;
        actualTies: number;
      }>>`
        SELECT
          u.id as "userId",
          u."discordId",
          u.wins as "recordedWins",
          COALESCE(actual_wins.count, 0) as "actualWins",
          u.losses as "recordedLosses",
          COALESCE(actual_losses.count, 0) as "actualLosses",
          u.ties as "recordedTies",
          COALESCE(actual_ties.count, 0) as "actualTies"
        FROM "User" u
        LEFT JOIN (
          SELECT "winnerUserId" as user_id, COUNT(*) as count
          FROM "Match"
          WHERE status = 'SETTLED' AND "winnerUserId" IS NOT NULL
          GROUP BY "winnerUserId"
        ) actual_wins ON u.id = actual_wins.user_id
        LEFT JOIN (
          SELECT
            CASE WHEN "challengerId" = "winnerUserId" THEN "joinerId" ELSE "challengerId" END as user_id,
            COUNT(*) as count
          FROM "Match"
          WHERE status = 'SETTLED' AND "winnerUserId" IS NOT NULL
          GROUP BY CASE WHEN "challengerId" = "winnerUserId" THEN "joinerId" ELSE "challengerId" END
        ) actual_losses ON u.id = actual_losses.user_id
        LEFT JOIN (
          SELECT user_id, COUNT(*) as count FROM (
            SELECT "challengerId" as user_id FROM "Match" WHERE status = 'SETTLED' AND result = 'TIE'
            UNION ALL
            SELECT "joinerId" as user_id FROM "Match" WHERE status = 'SETTLED' AND result = 'TIE'
          ) ties GROUP BY user_id
        ) actual_ties ON u.id = actual_ties.user_id
        WHERE u.wins != COALESCE(actual_wins.count, 0)
           OR u.losses != COALESCE(actual_losses.count, 0)
           OR u.ties != COALESCE(actual_ties.count, 0)
        LIMIT 20
      `;

      if (statInconsistencies.length > 0) {
        violations.push({
          severity: 'MEDIUM',
          category: 'User Statistics',
          description: 'User win/loss/tie statistics do not match actual match results',
          affectedRows: statInconsistencies.length,
          details: statInconsistencies,
          recommendation: 'Implement statistics reconciliation and fix update logic',
          potentialImpact: 'Leaderboards and achievements may show incorrect data'
        });
      }

    } catch (error) {
      violations.push({
        severity: 'CRITICAL',
        category: 'User State Validation Error',
        description: 'Failed to validate user states',
        affectedRows: 0,
        details: { error: error instanceof Error ? error.message : String(error) },
        recommendation: 'Fix database schema or query issues',
        potentialImpact: 'Unable to verify user state integrity'
      });
    }

    return {
      checkName: 'User State Validation',
      passed: violations.length === 0,
      violations,
      executionTime: Date.now() - startTime
    };
  }

  // ============= RACE CONDITION DETECTION =============

  async validateRaceConditions(): Promise<ValidationResult> {
    const startTime = Date.now();
    const violations: StateViolation[] = [];

    console.log('\n⚡ Detecting Race Conditions and Concurrent State Mutations...');

    try {
      // 1. Check for simultaneous balance modifications
      const simultaneousBalanceChanges = await prisma.$queryRaw<Array<{
        userId: number;
        discordId: string;
        tokenId: number;
        symbol: string;
        concurrentTransactions: number;
        timeWindow: string;
        transactionTypes: string;
      }>>`
        WITH concurrent_transactions AS (
          SELECT
            t1."userId",
            u."discordId",
            t1."tokenId",
            tk.symbol,
            COUNT(*) as concurrent_count,
            MIN(t1."createdAt")::text || ' to ' || MAX(t1."createdAt")::text as time_window,
            STRING_AGG(DISTINCT t1.type, ', ') as transaction_types
          FROM "Transaction" t1
          JOIN "User" u ON t1."userId" = u.id
          LEFT JOIN "Token" tk ON t1."tokenId" = tk.id
          WHERE t1."createdAt" > NOW() - INTERVAL '24 hours'
            AND t1."userId" IS NOT NULL
            AND t1."tokenId" IS NOT NULL
          GROUP BY t1."userId", u."discordId", t1."tokenId", tk.symbol,
                   DATE_TRUNC('second', t1."createdAt")
          HAVING COUNT(*) > 2
        )
        SELECT * FROM concurrent_transactions
        ORDER BY concurrent_count DESC
        LIMIT 10
      `;

      if (simultaneousBalanceChanges.length > 0) {
        violations.push({
          severity: 'HIGH',
          category: 'Race Conditions',
          description: 'Multiple simultaneous balance modifications detected',
          affectedRows: simultaneousBalanceChanges.length,
          details: simultaneousBalanceChanges,
          recommendation: 'Implement proper transaction isolation and balance locking',
          potentialImpact: 'Concurrent modifications may lead to incorrect balances'
        });
      }

      // 2. Check for duplicate group tip claims
      const duplicateClaims = await prisma.$queryRaw<Array<{
        groupTipId: number;
        userId: number;
        discordId: string;
        claimCount: number;
        claimTimes: string;
      }>>`
        SELECT
          gtc."groupTipId",
          gtc."userId",
          u."discordId",
          COUNT(*) as "claimCount",
          STRING_AGG(gtc."createdAt"::text, ', ') as "claimTimes"
        FROM "GroupTipClaim" gtc
        JOIN "User" u ON gtc."userId" = u.id
        WHERE gtc."userId" IS NOT NULL
        GROUP BY gtc."groupTipId", gtc."userId", u."discordId"
        HAVING COUNT(*) > 1
      `;

      if (duplicateClaims.length > 0) {
        violations.push({
          severity: 'CRITICAL',
          category: 'Duplicate Claims',
          description: 'Users have claimed same group tip multiple times',
          affectedRows: duplicateClaims.length,
          details: duplicateClaims,
          recommendation: 'Implement unique constraints and atomic claim operations',
          potentialImpact: 'Users may claim group tips multiple times, draining pools'
        });
      }

      // 3. Check for match join race conditions
      const matchJoinRaces = await prisma.$queryRaw<Array<{
        matchId: number;
        challengerId: number;
        joinerId: number;
        joinerMove: string;
        lockTimestamp: Date;
        settleTimestamp: Date;
        timeDifference: number;
      }>>`
        SELECT
          m.id as "matchId",
          m."challengerId",
          m."joinerId",
          m."joinerMove",
          CASE WHEN m.status = 'LOCKED' THEN m."updatedAt" END as "lockTimestamp",
          CASE WHEN m.status = 'SETTLED' THEN m."updatedAt" END as "settleTimestamp",
          EXTRACT(EPOCH FROM (m."updatedAt" - m."createdAt")) as "timeDifference"
        FROM "Match" m
        WHERE m.status IN ('LOCKED', 'SETTLED')
          AND m."updatedAt" > NOW() - INTERVAL '1 hour'
          AND EXTRACT(EPOCH FROM (m."updatedAt" - m."createdAt")) < 1.0
        ORDER BY "timeDifference" ASC
        LIMIT 10
      `;

      if (matchJoinRaces.length > 0) {
        violations.push({
          severity: 'MEDIUM',
          category: 'Match Join Races',
          description: 'Matches settled very quickly, indicating possible race conditions',
          affectedRows: matchJoinRaces.length,
          details: matchJoinRaces,
          recommendation: 'Investigate match joining logic for proper atomic operations',
          potentialImpact: 'Multiple users may join same match or lose funds'
        });
      }

    } catch (error) {
      violations.push({
        severity: 'CRITICAL',
        category: 'Race Condition Detection Error',
        description: 'Failed to detect race conditions',
        affectedRows: 0,
        details: { error: error instanceof Error ? error.message : String(error) },
        recommendation: 'Fix database schema or query issues',
        potentialImpact: 'Unable to verify concurrent operation safety'
      });
    }

    return {
      checkName: 'Race Condition Detection',
      passed: violations.length === 0,
      violations,
      executionTime: Date.now() - startTime
    };
  }

  // ============= MAIN VALIDATION RUNNER =============

  async runAllValidations(): Promise<void> {
    console.log('🚨 PIPTip State Consistency Validator');
    console.log('=====================================');
    console.log('Checking for impossible database states and financial integrity violations...\n');

    this.results = await Promise.all([
      this.validateBalanceConsistency(),
      this.validateMatchStates(),
      this.validateRoleBenefits(),
      this.validateUserStates(),
      this.validateRaceConditions()
    ]);

    this.generateReport();
  }

  private generateReport(): void {
    const totalViolations = this.results.reduce((sum, result) => sum + result.violations.length, 0);
    const criticalViolations = this.results.reduce((sum, result) =>
      sum + result.violations.filter(v => v.severity === 'CRITICAL').length, 0);
    const highViolations = this.results.reduce((sum, result) =>
      sum + result.violations.filter(v => v.severity === 'HIGH').length, 0);

    console.log('\n' + '='.repeat(80));
    console.log('📊 STATE CONSISTENCY VALIDATION REPORT');
    console.log('='.repeat(80));

    // Summary
    console.log(`\n📈 Summary:`);
    console.log(`   Total Checks: ${this.results.length}`);
    console.log(`   Passed: ${this.results.filter(r => r.passed).length}`);
    console.log(`   Failed: ${this.results.filter(r => !r.passed).length}`);
    console.log(`   Total Violations: ${totalViolations}`);
    console.log(`   Critical: ${criticalViolations} | High: ${highViolations} | Medium: ${totalViolations - criticalViolations - highViolations}`);

    // Detailed results
    this.results.forEach(result => {
      const statusIcon = result.passed ? '✅' : '❌';
      console.log(`\n${statusIcon} ${result.checkName} (${result.executionTime}ms)`);

      if (result.violations.length > 0) {
        result.violations.forEach(violation => {
          const severityIcon = {
            'CRITICAL': '🚨',
            'HIGH': '⚠️',
            'MEDIUM': '🔶',
            'LOW': 'ℹ️'
          }[violation.severity];

          console.log(`   ${severityIcon} ${violation.severity}: ${violation.description}`);
          console.log(`      Category: ${violation.category}`);
          console.log(`      Affected Rows: ${violation.affectedRows}`);
          console.log(`      Impact: ${violation.potentialImpact}`);
          console.log(`      Fix: ${violation.recommendation}`);

          if (violation.details && violation.affectedRows <= 5) {
            console.log(`      Details: ${JSON.stringify(violation.details, null, 8)}`);
          }
          console.log('');
        });
      }
    });

    // Recommendations
    if (totalViolations > 0) {
      console.log('\n🔧 PRIORITY ACTIONS REQUIRED:');

      if (criticalViolations > 0) {
        console.log('\n🚨 CRITICAL - Immediate Action Required:');
        this.results.forEach(result => {
          result.violations
            .filter(v => v.severity === 'CRITICAL')
            .forEach(v => console.log(`   - ${v.description}: ${v.recommendation}`));
        });
      }

      if (highViolations > 0) {
        console.log('\n⚠️  HIGH - Address Soon:');
        this.results.forEach(result => {
          result.violations
            .filter(v => v.severity === 'HIGH')
            .forEach(v => console.log(`   - ${v.description}: ${v.recommendation}`));
        });
      }

      console.log('\n🎯 Next Steps:');
      console.log('   1. Fix CRITICAL violations immediately');
      console.log('   2. Address HIGH severity issues within 24 hours');
      console.log('   3. Plan remediation for MEDIUM issues');
      console.log('   4. Run this validator daily to prevent regressions');

      process.exit(1);
    } else {
      console.log('\n🎉 All state consistency checks passed!');
      console.log('   Database maintains valid states across all critical operations');
      console.log('   Financial integrity is preserved');
      console.log('   No race conditions or impossible states detected');
      process.exit(0);
    }
  }
}

// Main execution
async function main() {
  const validator = new StateConsistencyValidator();

  try {
    await validator.runAllValidations();
  } catch (error) {
    console.error('💥 Validation failed with error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle cleanup
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(1);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}