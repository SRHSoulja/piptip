// scripts/migrate_pipchips.ts - Migrate existing PipchipsTransaction to Transaction + BalanceDelta
import { prisma } from '../src/services/db.js';
import { logCompleteTransaction } from '../src/services/tx_logger.js';
import { PipchipsTransactionType } from '@prisma/client';

const PIPCHIPS_TOKEN_ID = 2;
const BATCH_SIZE = 100;

// Map PipchipsTransactionType to Transaction operation
function mapPipchipsType(type: PipchipsTransactionType): string {
  switch (type) {
    case 'PREDICTION_BET': return 'PIPCHIPS_BET';
    case 'BET_WON': return 'PIPCHIPS_PAYOUT';
    case 'BET_REFUNDED': return 'PIPCHIPS_REFUND';
    case 'DAILY_BONUS':
    case 'STREAK_BONUS':
    case 'STARTING_BONUS':
      return 'PIPCHIPS_BONUS';
    case 'PURCHASE': return 'PIPCHIPS_PURCHASE';
    default: return 'PIPCHIPS_OTHER';
  }
}

// Get reason for BalanceDelta
function getBalanceDeltaReason(type: PipchipsTransactionType, isCredit: boolean): string {
  if (isCredit) {
    switch (type) {
      case 'BET_WON': return 'prediction_won';
      case 'BET_REFUNDED': return 'prediction_refunded';
      case 'DAILY_BONUS': return 'daily_bonus';
      case 'STREAK_BONUS': return 'streak_bonus';
      case 'STARTING_BONUS': return 'welcome_bonus';
      case 'PURCHASE': return 'pipchips_purchase';
      default: return 'pipchips_credit';
    }
  } else {
    switch (type) {
      case 'PREDICTION_BET': return 'prediction_bet';
      default: return 'pipchips_debit';
    }
  }
}

async function migratePipchipsTransactions(confirmMainnet: boolean = false) {
  const network = process.env.NETWORK || 'testnet';

  console.log('🔄 PIPChips Migration Script');
  console.log(`   Network: ${network}`);
  console.log(`   Batch size: ${BATCH_SIZE}\n`);

  // Safety check for mainnet
  if (network === 'mainnet' && !confirmMainnet) {
    console.error('❌ MAINNET DETECTED: This script will modify production data!');
    console.error('   Run with --confirm-mainnet flag if you are absolutely sure.');
    console.error('   Example: NETWORK=mainnet npx tsx scripts/migrate_pipchips.ts --confirm-mainnet');
    process.exit(1);
  }

  if (network === 'mainnet') {
    console.log('⚠️  MAINNET MODE: Proceeding with production data migration');
    console.log('   Waiting 5 seconds... Press Ctrl+C to abort\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Get all PipchipsTransactions
  const totalCount = await prisma.pipchipsTransaction.count();
  console.log(`📊 Found ${totalCount} PipchipsTransaction records\n`);

  if (totalCount === 0) {
    console.log('✅ No records to migrate');
    await prisma.$disconnect();
    return;
  }

  // Check for existing migrated transactions (idempotency)
  const existingMigrated = await prisma.transaction.count({
    where: {
      idempotencyKey: { startsWith: 'pipchips_migrate_' }
    }
  });

  console.log(`📝 Already migrated: ${existingMigrated} records`);
  console.log(`🔄 Remaining to migrate: ${totalCount - existingMigrated} records\n`);

  let processed = 0;
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches
  while (processed < totalCount) {
    const batch = await prisma.pipchipsTransaction.findMany({
      skip: processed,
      take: BATCH_SIZE,
      orderBy: { createdAt: 'asc' }
    });

    console.log(`\n📦 Processing batch ${Math.floor(processed / BATCH_SIZE) + 1} (${batch.length} records)...`);

    for (const pipchipsTx of batch) {
      try {
        const idempotencyKey = `pipchips_migrate_${pipchipsTx.id}`;

        // Check if already migrated
        const existing = await prisma.transaction.findUnique({
          where: { idempotencyKey }
        });

        if (existing) {
          skipped++;
          processed++;
          continue;
        }

        // Get user by discordId
        const user = await prisma.user.findUnique({
          where: { discordId: pipchipsTx.userId },
          select: { id: true }
        });

        if (!user) {
          console.log(`   ⏭️  Skipping pipchipsTx ${pipchipsTx.id} - no user found for discordId: ${pipchipsTx.userId}`);
          skipped++;
          processed++;
          continue;
        }

        const userId = user.id;

        // Migrate to unified Transaction + BalanceDelta system
        await prisma.$transaction(async (tx) => {
          const operation = mapPipchipsType(pipchipsTx.transactionType);
          const isCredit = pipchipsTx.amount > 0n;
          const reason = getBalanceDeltaReason(pipchipsTx.transactionType, isCredit);

          await logCompleteTransaction(tx, {
            source: 'BOT',
            operation,
            userId,
            idempotencyKey,
            opRef: pipchipsTx.referenceId || undefined,
            metadata: {
              migrated: true,
              originalPipchipsTxId: pipchipsTx.id,
              originalCreatedAt: pipchipsTx.createdAt.toISOString(),
              description: pipchipsTx.description,
              balanceAfter: pipchipsTx.balanceAfter.toString()
            },
            balanceChanges: [
              {
                tokenId: PIPCHIPS_TOKEN_ID,
                userId,
                amountDelta: pipchipsTx.amount,
                reason
              }
            ],
            status: 'CONFIRMED'
          });
        });

        migrated++;
      } catch (error) {
        console.error(`   ❌ Error migrating pipchipsTx ${pipchipsTx.id}:`, error);
        errors++;
      }

      processed++;

      // Progress update every 10 records
      if (processed % 10 === 0) {
        process.stdout.write(`\r   Progress: ${processed}/${totalCount} (${Math.floor((processed / totalCount) * 100)}%)`);
      }
    }

    console.log(`\n   ✅ Batch complete: ${migrated - (processed - batch.length)} migrated, ${skipped - (processed - batch.length - migrated)} skipped`);
  }

  console.log(`\n✅ Migration Complete!`);
  console.log(`   Total processed: ${processed}`);
  console.log(`   Migrated: ${migrated}`);
  console.log(`   Skipped (already migrated): ${skipped}`);
  console.log(`   Errors: ${errors}`);

  // Validation check
  console.log(`\n🔍 Running validation check...`);

  const totalTransactions = await prisma.transaction.count({
    where: { type: { startsWith: 'PIPCHIPS_' } }
  });

  const totalBalanceDeltas = await prisma.balanceDelta.count({
    where: { tokenId: PIPCHIPS_TOKEN_ID }
  });

  console.log(`   Transactions (PIPCHIPS_*): ${totalTransactions}`);
  console.log(`   BalanceDeltas (token ${PIPCHIPS_TOKEN_ID}): ${totalBalanceDeltas}`);

  if (totalTransactions !== totalBalanceDeltas) {
    console.log(`   ⚠️  Mismatch: Transaction count doesn't match BalanceDelta count`);
  } else {
    console.log(`   ✅ Transaction and BalanceDelta counts match`);
  }

  await prisma.$disconnect();
}

// Parse command line arguments
const args = process.argv.slice(2);
const confirmMainnet = args.includes('--confirm-mainnet');

migratePipchipsTransactions(confirmMainnet).catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});