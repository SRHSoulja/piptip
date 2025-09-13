import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = './backups';
  
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log('Creating backup...');

  // Export all your tables
  const [
    notifications, users, tiers, tierPrices, tierMemberships, matches,
    tips, groupTips, groupTipClaims, tokens, userBalances, processedDeposits,
    depositCursors, appConfigs, approvedServers, ads, transactions,
    webhookEvents, bioBrowses
  ] = await Promise.all([
    prisma.notification.findMany(),
    prisma.user.findMany(),
    prisma.tier.findMany(),
    prisma.tierPrice.findMany(),
    prisma.tierMembership.findMany(),
    prisma.match.findMany(),
    prisma.tip.findMany(),
    prisma.groupTip.findMany(),
    prisma.groupTipClaim.findMany(),
    prisma.token.findMany(),
    prisma.userBalance.findMany(),
    prisma.processedDeposit.findMany(),
    prisma.depositCursor.findMany(),
    prisma.appConfig.findMany(),
    prisma.approvedServer.findMany(),
    prisma.ad.findMany(),
    prisma.transaction.findMany(),
    prisma.webhookEvent.findMany(),
    prisma.bioBrowse.findMany()
  ]);
  
  const backup = {
    timestamp,
    metadata: {
      version: '1.0',
      totalRecords: notifications.length + users.length + tiers.length + 
                   tierPrices.length + tierMemberships.length + matches.length +
                   tips.length + groupTips.length + groupTipClaims.length + 
                   tokens.length + userBalances.length + processedDeposits.length +
                   depositCursors.length + appConfigs.length + approvedServers.length +
                   ads.length + transactions.length + webhookEvents.length + bioBrowses.length
    },
    data: {
      notifications, users, tiers, tierPrices, tierMemberships, matches,
      tips, groupTips, groupTipClaims, tokens, userBalances, processedDeposits,
      depositCursors, appConfigs, approvedServers, ads, transactions,
      webhookEvents, bioBrowses
    }
  };
  
  const filename = `backup-${timestamp}.json`;
  fs.writeFileSync(path.join(backupDir, filename), JSON.stringify(backup, null, 2));
  
  console.log(`✅ Backup created: ${filename}`);
  console.log(`📊 Total records: ${backup.metadata.totalRecords}`);
  
  await prisma.$disconnect();
}

createBackup().catch(console.error);