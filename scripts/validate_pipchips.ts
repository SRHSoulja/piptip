// scripts/validate_pipchips.ts - Validate PIPChips balance consistency
import { prisma } from '../src/services/db.js';

const PIPCHIPS_TOKEN_ID = 2;

interface ValidationResult {
  userId: number;
  discordId: string;
  userBalance: bigint;
  derivedBalance: bigint;
  difference: bigint;
  percentDiff: number;
}

async function validatePIPChipsBalances() {
  const network = process.env.NETWORK || 'testnet';

  console.log('🔍 PIPChips Balance Validation');
  console.log(`   Network: ${network}\n`);

  // Get all users with PIPChips balance OR BalanceDelta activity
  const usersWithBalance = await prisma.user.findMany({
    where: { pipchipsBalance: { not: 0n } },
    select: {
      id: true,
      discordId: true,
      pipchipsBalance: true
    }
  });

  // Get all users with BalanceDelta activity
  const usersWithDeltas = await prisma.balanceDelta.findMany({
    where: { tokenId: PIPCHIPS_TOKEN_ID },
    distinct: ['userId'],
    select: { userId: true }
  });

  const userIdsWithDeltas = new Set(usersWithDeltas.map(d => d.userId).filter(id => id !== null) as number[]);

  // Get user details for those with deltas but no balance
  const additionalUsers = await prisma.user.findMany({
    where: {
      id: { in: Array.from(userIdsWithDeltas) },
      pipchipsBalance: 0n
    },
    select: {
      id: true,
      discordId: true,
      pipchipsBalance: true
    }
  });

  const users = [...usersWithBalance, ...additionalUsers];

  console.log(`📊 Found ${users.length} users with PIPChips activity\n`);

  const results: ValidationResult[] = [];
  const mismatches: ValidationResult[] = [];
  const tolerance = 1n; // Allow 1 PIPChip tolerance for rounding

  for (const user of users) {
    // Calculate derived balance from BalanceDelta records
    const balanceDeltas = await prisma.balanceDelta.findMany({
      where: {
        userId: user.id,
        tokenId: PIPCHIPS_TOKEN_ID
      },
      select: {
        amountDelta: true
      }
    });

    const derivedBalance = balanceDeltas.reduce((sum, delta) => {
      try {
        const deltaStr = delta.amountDelta.toString();
        // Handle scientific notation or very small numbers
        if (deltaStr.includes('e')) {
          console.warn(`   ⚠️  Skipping invalid delta: ${deltaStr} (scientific notation from old data)`);
          return sum;
        }
        const deltaInt = BigInt(deltaStr.split('.')[0]); // Remove any decimal part
        return sum + deltaInt;
      } catch (error) {
        console.warn(`   ⚠️  Error parsing delta ${delta.amountDelta}: ${error}`);
        return sum;
      }
    }, 0n);

    const userBalance = user.pipchipsBalance;
    const difference = userBalance > derivedBalance
      ? userBalance - derivedBalance
      : derivedBalance - userBalance;

    const percentDiff = userBalance === 0n
      ? (derivedBalance === 0n ? 0 : 100)
      : Number((difference * 10000n) / userBalance) / 100;

    const result: ValidationResult = {
      userId: user.id,
      discordId: user.discordId,
      userBalance,
      derivedBalance,
      difference,
      percentDiff
    };

    results.push(result);

    if (difference > tolerance) {
      mismatches.push(result);
    }
  }

  // Print results
  console.log('📈 Validation Results:\n');

  if (mismatches.length === 0) {
    console.log('✅ All balances match! PIPChips transaction log is consistent.\n');
  } else {
    console.log(`❌ Found ${mismatches.length} mismatches:\n`);

    for (const mismatch of mismatches) {
      console.log(`   User: ${mismatch.discordId} (ID: ${mismatch.userId})`);
      console.log(`   User Balance: ${mismatch.userBalance}`);
      console.log(`   Derived Balance: ${mismatch.derivedBalance}`);
      console.log(`   Difference: ${mismatch.difference} (${mismatch.percentDiff.toFixed(2)}%)`);
      console.log('');
    }
  }

  // Summary statistics
  console.log('📊 Summary:');
  console.log(`   Total users checked: ${results.length}`);
  console.log(`   Perfect matches: ${results.length - mismatches.length}`);
  console.log(`   Mismatches: ${mismatches.length}`);

  if (results.length > 0) {
    const totalUserBalance = results.reduce((sum, r) => sum + r.userBalance, 0n);
    const totalDerivedBalance = results.reduce((sum, r) => sum + r.derivedBalance, 0n);
    const totalDifference = totalUserBalance > totalDerivedBalance
      ? totalUserBalance - totalDerivedBalance
      : totalDerivedBalance - totalUserBalance;

    console.log(`   Total User Balance: ${totalUserBalance}`);
    console.log(`   Total Derived Balance: ${totalDerivedBalance}`);
    console.log(`   Total Difference: ${totalDifference}`);
  }

  // Check Transaction vs BalanceDelta counts
  console.log('\n🔍 Transaction Log Integrity:');

  const pipchipsTransactionCount = await prisma.transaction.count({
    where: { type: { startsWith: 'PIPCHIPS_' } }
  });

  const pipchipsBalanceDeltaCount = await prisma.balanceDelta.count({
    where: { tokenId: PIPCHIPS_TOKEN_ID }
  });

  console.log(`   PIPCHIPS Transactions: ${pipchipsTransactionCount}`);
  console.log(`   PIPCHIPS BalanceDeltas: ${pipchipsBalanceDeltaCount}`);

  if (pipchipsTransactionCount === pipchipsBalanceDeltaCount) {
    console.log('   ✅ Transaction and BalanceDelta counts match');
  } else {
    console.log(`   ⚠️  Mismatch: ${Math.abs(pipchipsTransactionCount - pipchipsBalanceDeltaCount)} difference`);
  }

  // Check for orphaned records (BalanceDeltas without a Transaction)
  const allDeltas = await prisma.balanceDelta.findMany({
    where: { tokenId: PIPCHIPS_TOKEN_ID },
    select: {
      id: true,
      transactionId: true
    }
  });

  const orphanedDeltas = allDeltas.filter(d => !d.transactionId).length;

  if (orphanedDeltas > 0) {
    console.log(`   ⚠️  Found ${orphanedDeltas} orphaned BalanceDeltas (no Transaction)`);
  } else {
    console.log('   ✅ No orphaned BalanceDeltas');
  }

  // Overall status
  console.log('\n' + '='.repeat(60));
  if (mismatches.length === 0 && pipchipsTransactionCount === pipchipsBalanceDeltaCount && orphanedDeltas === 0) {
    console.log('✅ PIPChips validation PASSED');
    console.log('   Transaction log is the single source of truth!');
  } else {
    console.log('⚠️  PIPChips validation found issues');
    console.log('   Review mismatches above and run migration if needed');
  }
  console.log('='.repeat(60));

  await prisma.$disconnect();

  // Exit with appropriate code
  process.exit(mismatches.length > 0 ? 1 : 0);
}

validatePIPChipsBalances().catch((error) => {
  console.error('❌ Validation failed:', error);
  process.exit(1);
});