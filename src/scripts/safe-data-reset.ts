// src/scripts/safe-data-reset.ts - EXTREMELY CAREFUL data reset for testing
console.log("🔧 Script file loaded - checking imports...");

import { config } from "dotenv";
import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { prisma } from "../services/db.js";
import * as readline from "readline";

// Load environment variables first
console.log("🔧 Loading environment variables...");
config();

console.log("🔧 Setting up paths...");
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BACKUP_DIR = join(__dirname, "../..", "backups");

console.log("🔧 All imports and setup complete!");

// SAFETY: Multiple confirmation prompts
const REQUIRED_CONFIRMATIONS = [
  "I understand this will delete all user data",
  "I have verified this is the correct database", 
  "I want to proceed with the reset",
  "FINAL CONFIRM - RESET DATA NOW"
];

interface ResetStats {
  usersDeleted: number;
  tipsDeleted: number;
  transactionsDeleted: number;
  balancesDeleted: number;
  groupTipsDeleted: number;
  matchesDeleted: number;
  backupFilename?: string;
}

class SafeDataReset {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  private async prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }

  private async confirmationFlow(): Promise<boolean> {
    console.log(`
🚨 CRITICAL DATA RESET OPERATION 🚨

This will PERMANENTLY DELETE all user data including:
- All users and their balances
- All tips (direct and group)
- All transactions and matches  
- All notifications and claims

PRESERVED (system config):
- Tokens and their settings
- Approved servers
- Admin configuration
- Tier definitions
- Application settings

⚠️  THIS CANNOT BE UNDONE (except from backup) ⚠️
`);

    // Show current database stats first
    await this.showCurrentStats();

    for (const confirmation of REQUIRED_CONFIRMATIONS) {
      const response = await this.prompt(`\nType exactly: "${confirmation}"\n> `);
      if (response !== confirmation) {
        console.log("❌ Confirmation failed. Operation cancelled.");
        return false;
      }
    }

    return true;
  }

  private async showCurrentStats() {
    try {
      const [users, tips, transactions, balances, groupTips, matches] = await Promise.all([
        prisma.user.count(),
        prisma.tip.count(), 
        prisma.transaction.count(),
        prisma.userBalance.count(),
        prisma.groupTip.count(),
        prisma.match.count()
      ]);

      console.log(`
📊 CURRENT DATABASE STATS:
- Users: ${users}
- Tips: ${tips} 
- Transactions: ${transactions}
- Balances: ${balances}
- Group Tips: ${groupTips}
- Matches: ${matches}
`);
    } catch (error) {
      console.error("❌ Failed to get database stats:", error);
      throw error;
    }
  }

  private async createPreResetBackup(): Promise<string> {
    console.log("📦 Creating pre-reset backup...");
    
    try {
      // Ensure backup directory exists
      await mkdir(BACKUP_DIR, { recursive: true });
      
      // Create filename
      const timestamp = new Date();
      const dateStr = timestamp.toISOString().replace(/[:.]/g, '-');
      const filename = `piptip_reset_backup_${dateStr}.sql`;
      const filepath = join(BACKUP_DIR, filename);
      
      // Create a simple Prisma-based backup
      console.log("📦 Creating Prisma-based backup...");
      
      const [
        users, userBalances, tips, transactions, matches, 
        groupTips, groupTipClaims, tierMemberships, notifications,
        tokens, tiers, tierPrices, approvedServers, appConfig, ads
      ] = await Promise.all([
        prisma.user.findMany(),
        prisma.userBalance.findMany(),
        prisma.tip.findMany(),
        prisma.transaction.findMany(),
        prisma.match.findMany(),
        prisma.groupTip.findMany(),
        prisma.groupTipClaim.findMany(),
        prisma.tierMembership.findMany(),
        prisma.notification.findMany(),
        prisma.token.findMany(),
        prisma.tier.findMany(),
        prisma.tierPrice.findMany(),
        prisma.approvedServer.findMany(),
        prisma.appConfig.findMany(),
        prisma.ad.findMany()
      ]);
      
      // Create backup content
      const backupContent = [
        `-- PIPTip Database Backup (Pre-Reset)`,
        `-- Generated: ${timestamp.toISOString()}`,
        `-- Type: Full Data Backup for Safe Reset`,
        ``,
        `-- USERS: ${users.length} records`,
        JSON.stringify(users, null, 2),
        ``,
        `-- USER BALANCES: ${userBalances.length} records`, 
        JSON.stringify(userBalances, null, 2),
        ``,
        `-- TIPS: ${tips.length} records`,
        JSON.stringify(tips, null, 2),
        ``,
        `-- TRANSACTIONS: ${transactions.length} records`,
        JSON.stringify(transactions, null, 2),
        ``,
        `-- MATCHES: ${matches.length} records`,
        JSON.stringify(matches, null, 2),
        ``,
        `-- GROUP TIPS: ${groupTips.length} records`,
        JSON.stringify(groupTips, null, 2),
        ``,
        `-- GROUP TIP CLAIMS: ${groupTipClaims.length} records`,
        JSON.stringify(groupTipClaims, null, 2),
        ``,
        `-- TIER MEMBERSHIPS: ${tierMemberships.length} records`,
        JSON.stringify(tierMemberships, null, 2),
        ``,
        `-- NOTIFICATIONS: ${notifications.length} records`,
        JSON.stringify(notifications, null, 2),
        ``,
        `-- SYSTEM CONFIG (PRESERVED)`,
        `-- TOKENS: ${tokens.length} records`,
        JSON.stringify(tokens, null, 2),
        ``,
        `-- TIERS: ${tiers.length} records`,
        JSON.stringify(tiers, null, 2),
        ``,
        `-- TIER PRICES: ${tierPrices.length} records`,
        JSON.stringify(tierPrices, null, 2),
        ``,
        `-- APPROVED SERVERS: ${approvedServers.length} records`,
        JSON.stringify(approvedServers, null, 2),
        ``,
        `-- APP CONFIG: ${appConfig.length} records`,
        JSON.stringify(appConfig, null, 2),
        ``,
        `-- ADS: ${ads.length} records`,
        JSON.stringify(ads, null, 2)
      ].join('\n');
      
      await writeFile(filepath, backupContent, 'utf8');
      
      const stats = await import('fs').then(fs => fs.statSync(filepath));
      const sizeKB = Math.round(stats.size / 1024);
      
      console.log(`✅ Pre-reset backup created: ${filename} (${sizeKB} KB)`);
      return filename;
    } catch (error) {
      console.error("❌ BACKUP FAILED - ABORTING RESET:", error);
      throw error;
    }
  }

  private async performReset(): Promise<ResetStats> {
    console.log("🔄 Starting data reset...");

    // Use transaction for atomicity
    return await prisma.$transaction(async (tx) => {
      // Delete in dependency order (children first, then parents)
      
      console.log("Deleting notifications...");
      await tx.notification.deleteMany();

      console.log("Deleting group tip claims...");
      const groupTipClaimsDeleted = await tx.groupTipClaim.deleteMany();

      console.log("Deleting group tips...");  
      const groupTipsDeleted = await tx.groupTip.deleteMany();

      console.log("Deleting tips...");
      const tipsDeleted = await tx.tip.deleteMany();

      console.log("Deleting matches...");
      const matchesDeleted = await tx.match.deleteMany();

      console.log("Deleting tier memberships...");
      await tx.tierMembership.deleteMany();

      console.log("Deleting user balances...");
      const balancesDeleted = await tx.userBalance.deleteMany();

      console.log("Deleting transactions...");
      const transactionsDeleted = await tx.transaction.deleteMany();

      console.log("Deleting processed deposits...");
      await tx.processedDeposit.deleteMany();

      console.log("Deleting webhook events...");
      await tx.webhookEvent.deleteMany();

      console.log("Deleting users...");
      const usersDeleted = await tx.user.deleteMany();

      return {
        usersDeleted: usersDeleted.count,
        tipsDeleted: tipsDeleted.count,
        transactionsDeleted: transactionsDeleted.count, 
        balancesDeleted: balancesDeleted.count,
        groupTipsDeleted: groupTipsDeleted.count,
        matchesDeleted: matchesDeleted.count
      };
    });
  }

  async execute(): Promise<void> {
    try {
      console.log("🤖 PIPTip Safe Data Reset Tool");
      console.log("===============================");

      // Step 1: Get confirmations
      const confirmed = await this.confirmationFlow();
      if (!confirmed) {
        console.log("Operation cancelled by user.");
        return;
      }

      // Step 2: Create backup
      const backupFilename = await this.createPreResetBackup();

      // Step 3: Final chance to abort
      const finalConfirm = await this.prompt("\n⚠️  FINAL WARNING: Type 'DELETE ALL DATA' to proceed: ");
      if (finalConfirm !== "DELETE ALL DATA") {
        console.log("❌ Final confirmation failed. Operation cancelled.");
        return;
      }

      // Step 4: Perform reset
      const stats = await this.performReset();
      stats.backupFilename = backupFilename;

      // Step 5: Show results
      console.log(`
✅ DATA RESET COMPLETED SUCCESSFULLY

📊 DELETION SUMMARY:
- Users deleted: ${stats.usersDeleted}
- Tips deleted: ${stats.tipsDeleted}
- Transactions deleted: ${stats.transactionsDeleted}
- Balances deleted: ${stats.balancesDeleted}  
- Group tips deleted: ${stats.groupTipsDeleted}
- Matches deleted: ${stats.matchesDeleted}

💾 BACKUP LOCATION: ${stats.backupFilename}

🔄 The bot is now in a fresh state for testing.

⚠️  IMPORTANT: 
- All users will need to re-register (/pip register)
- All balances have been reset to zero
- System configuration (tokens, servers, tiers) is preserved
`);

    } catch (error) {
      console.error("💥 RESET FAILED:", error);
      console.log("Database should be unchanged. Check backup if needed.");
      throw error;
    } finally {
      this.rl.close();
      // Close Prisma connection
      await prisma.$disconnect();
      // Force exit to prevent hanging
      setTimeout(() => process.exit(0), 500);
    }
  }
}

// Debug the module detection
console.log("🔧 Debug - import.meta.url:", import.meta.url);
console.log("🔧 Debug - process.argv[1]:", process.argv[1]);
console.log("🔧 Debug - __filename:", __filename);

// Run the reset if called directly - use a more reliable check
const scriptPath = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && (
  process.argv[1] === scriptPath || 
  process.argv[1].endsWith('safe-data-reset.ts') ||
  process.argv[1].includes('safe-data-reset')
);

console.log("🔧 Debug - isMainModule:", isMainModule);

if (isMainModule) {
  console.log("🤖 PIPTip Safe Data Reset Tool - Starting...");
  
  (async () => {
    try {
      const resetTool = new SafeDataReset();
      await resetTool.execute();
    } catch (error) {
      console.error("💥 Script failed:", error);
      console.error("Stack trace:", error.stack);
      process.exit(1);
    }
  })();
} else {
  console.log("🔧 Script loaded as module, not executing main function");
}

export { SafeDataReset };