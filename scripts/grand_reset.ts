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
        tierMemberships
      ] = await Promise.all([
        tx.user.count(),
        tx.transaction.count(),
        tx.tip.count(),
        tx.groupTip.count(),
        tx.match.count(),
        tx.userBalance.count(),
        tx.tierMembership.count()
      ]);
      
      return { users, transactions, tips, groupTips, matches, userBalances, tierMemberships };
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
        webhookEvents: webhookEvents.count
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