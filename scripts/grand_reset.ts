#!/usr/bin/env tsx
// scripts/grand_reset.ts - Perform grand reset via CLI for fresh starts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function grandReset() {
  try {
    console.log('🚨 GRAND RESET: This will DELETE ALL user data, transactions, tips, and balances!');
    console.log('⚠️  This action is IRREVERSIBLE!');
    console.log('');
    
    // Show current stats before reset
    console.log('📊 Current database contents:');
    const stats = await prisma.$transaction(async (tx) => {
      const [
        users,
        transactions,
        tips,
        groupTips,
        matches,
        userBalances,
        tierMemberships,
        tournamentSessions,
        tournamentParticipants,
        activityFeedItems,
        pipchipsTransactions
      ] = await Promise.all([
        tx.user.count(),
        tx.transaction.count(),
        tx.tip.count(),
        tx.groupTip.count(),
        tx.match.count(),
        tx.userBalance.count(),
        tx.tierMembership.count(),
        tx.tournamentSession.count(),
        tx.tournamentParticipant.count(),
        tx.activityFeedItem.count(),
        tx.pipchipsTransaction.count()
      ]);

      return {
        users, transactions, tips, groupTips, matches, userBalances, tierMemberships,
        tournamentSessions, tournamentParticipants, activityFeedItems, pipchipsTransactions
      };
    });
    
    Object.entries(stats).forEach(([key, count]) => {
      console.log(`   ${key}: ${count}`);
    });
    
    const totalRecords = Object.values(stats).reduce((sum, count) => sum + count, 0);
    console.log(`   TOTAL RECORDS: ${totalRecords}`);
    console.log('');
    
    if (totalRecords === 0) {
      console.log('✅ Database is already empty - no reset needed');
      return;
    }
    
    console.log('💥 Performing grand reset...');
    
    // Delete in proper order to respect foreign key constraints
    const deletions = await prisma.$transaction(async (tx) => {
      // Delete dependent records first
      console.log('   🗑️  Deleting notifications...');
      const notifications = await tx.notification.deleteMany({});

      console.log('   🗑️  Deleting activity feed items...');
      const activityFeedItems = await tx.activityFeedItem.deleteMany({});

      console.log('   🗑️  Deleting PIPChips transactions...');
      const pipchipsTransactions = await tx.pipchipsTransaction.deleteMany({});

      console.log('   🗑️  Deleting tournament participants...');
      const tournamentParticipants = await tx.tournamentParticipant.deleteMany({});

      console.log('   🗑️  Deleting tournament sessions...');
      const tournamentSessions = await tx.tournamentSession.deleteMany({});

      console.log('   🗑️  Deleting group tip claims...');
      const groupTipClaims = await tx.groupTipClaim.deleteMany({});

      console.log('   🗑️  Deleting group tips...');
      const groupTips = await tx.groupTip.deleteMany({});

      console.log('   🗑️  Deleting tips...');
      const tips = await tx.tip.deleteMany({});

      console.log('   🗑️  Deleting matches...');
      const matches = await tx.match.deleteMany({});

      console.log('   🗑️  Deleting user balances...');
      const userBalances = await tx.userBalance.deleteMany({});

      console.log('   🗑️  Deleting tier memberships...');
      const tierMemberships = await tx.tierMembership.deleteMany({});

      console.log('   🗑️  Deleting transactions...');
      const transactions = await tx.transaction.deleteMany({});

      console.log('   🗑️  Deleting processed deposits...');
      const processedDeposits = await tx.processedDeposit.deleteMany({});

      console.log('   🗑️  Deleting webhook events...');
      const webhookEvents = await tx.webhookEvent.deleteMany({});

      // Delete users last (they're referenced by many tables)
      console.log('   🗑️  Deleting users...');
      const users = await tx.user.deleteMany({});

      // Reset auto-increment sequences to 1 (PostgreSQL specific)
      console.log('   🔄  Resetting auto-increment IDs to 1...');

      const sequenceResets = [
        'ALTER SEQUENCE "User_id_seq" RESTART WITH 1',
        'ALTER SEQUENCE "UserBalance_id_seq" RESTART WITH 1',
        'ALTER SEQUENCE "Transaction_id_seq" RESTART WITH 1',
        'ALTER SEQUENCE "Tip_id_seq" RESTART WITH 1',
        'ALTER SEQUENCE "GroupTip_id_seq" RESTART WITH 1',
        'ALTER SEQUENCE "GroupTipClaim_id_seq" RESTART WITH 1',
        'ALTER SEQUENCE "Match_id_seq" RESTART WITH 1',
        'ALTER SEQUENCE "TierMembership_id_seq" RESTART WITH 1',
        'ALTER SEQUENCE "Notification_id_seq" RESTART WITH 1',
        'ALTER SEQUENCE "ActivityFeedItem_id_seq" RESTART WITH 1',
        'ALTER SEQUENCE "PipchipsTransaction_id_seq" RESTART WITH 1',
        'ALTER SEQUENCE "TournamentParticipant_id_seq" RESTART WITH 1'
      ];

      for (const resetQuery of sequenceResets) {
        try {
          await tx.$executeRawUnsafe(resetQuery);
        } catch (error) {
          // Ignore errors for sequences that might not exist
          console.log(`     ⚠️  Sequence reset skipped: ${resetQuery.split('"')[1]}`);
        }
      }

      return {
        users: users.count,
        transactions: transactions.count,
        tips: tips.count,
        groupTips: groupTips.count,
        groupTipClaims: groupTipClaims.count,
        matches: matches.count,
        userBalances: userBalances.count,
        tierMemberships: tierMemberships.count,
        notifications: notifications.count,
        processedDeposits: processedDeposits.count,
        webhookEvents: webhookEvents.count,
        tournamentSessions: tournamentSessions.count,
        tournamentParticipants: tournamentParticipants.count,
        activityFeedItems: activityFeedItems.count,
        pipchipsTransactions: pipchipsTransactions.count
      };
    });

    const totalDeleted = Object.values(deletions).reduce((sum, count) => sum + count, 0);
    
    console.log('');
    console.log('✅ GRAND RESET COMPLETED!');
    console.log('📊 Records deleted:');
    Object.entries(deletions).forEach(([key, count]) => {
      if (count > 0) console.log(`   ${key}: ${count}`);
    });
    console.log(`   TOTAL DELETED: ${totalDeleted}`);
    console.log('');
    console.log('🎯 Database is now clean and ready for fresh start!');
    
  } catch (error) {
    console.error('❌ Grand reset failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  grandReset();
}

export { grandReset };