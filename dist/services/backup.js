import { spawn } from "child_process";
import { mkdir, writeFile, readdir, unlink } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { prisma } from "./db.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BACKUP_INTERVAL_MS = 60 * 60 * 1e3;
const MAX_BACKUP_FILES = 168;
const BACKUP_DIR = join(__dirname, "../..", "backups");
class BackupService {
  intervalId = null;
  isRunning = false;
  async start() {
    if (this.isRunning) {
      console.log("Backup service already running");
      return;
    }
    this.isRunning = true;
    console.log("\u{1F504} Starting automated backup service (hourly)");
    await this.ensureBackupDir();
    await this.createBackup();
    this.intervalId = setInterval(async () => {
      await this.createBackup();
    }, BACKUP_INTERVAL_MS);
    console.log("\u2705 Backup service started successfully");
  }
  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("\u{1F6D1} Backup service stopped");
  }
  async ensureBackupDir() {
    try {
      await mkdir(BACKUP_DIR, { recursive: true });
    } catch (error) {
      console.error("Failed to create backup directory:", error);
      throw error;
    }
  }
  async createBackup() {
    const timestamp = /* @__PURE__ */ new Date();
    const dateStr = timestamp.toISOString().replace(/[:.]/g, "-");
    const filename = `piptip_backup_${dateStr}.sql`;
    const filepath = join(BACKUP_DIR, filename);
    console.log(`\u{1F4E6} Creating database backup: ${filename}`);
    try {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error("DATABASE_URL not found in environment");
      }
      const url = new URL(databaseUrl);
      const dbName = url.pathname.substring(1);
      const host = url.hostname;
      const port = url.port || "5432";
      const username = url.username;
      const password = url.password;
      const backupData = await this.createPostgreSQLBackup({
        host,
        port,
        username,
        password,
        database: dbName
      });
      const metadata = [
        `-- PIPTip Database Backup`,
        `-- Generated: ${timestamp.toISOString()}`,
        `-- Database: ${dbName}`,
        `-- Host: ${host}`,
        `-- Backup Type: Full Schema + Data`,
        `-- `,
        ``
      ].join("\n");
      const fullBackup = metadata + backupData;
      await writeFile(filepath, fullBackup, "utf8");
      const stats = await import("fs").then((fs) => fs.statSync(filepath));
      const sizeKB = Math.round(stats.size / 1024);
      console.log(`\u2705 Backup created successfully: ${filename} (${sizeKB} KB)`);
      await this.cleanupOldBackups();
      await this.logBackupToDatabase(filename, sizeKB);
      return {
        success: true,
        filename,
        timestamp,
        size: sizeKB
      };
    } catch (error) {
      console.error(`\u274C Backup failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp
      };
    }
  }
  async createPostgreSQLBackup(config) {
    try {
      return await this.createPgDumpBackup(config);
    } catch (error) {
      console.warn("pg_dump not available, using Prisma-based backup:", error instanceof Error ? error.message : String(error));
      return await this.createPrismaBackup();
    }
  }
  async createPgDumpBackup(config) {
    return new Promise((resolve, reject) => {
      const args = [
        "--host",
        config.host,
        "--port",
        config.port,
        "--username",
        config.username,
        "--no-password",
        // Use PGPASSWORD env var
        "--verbose",
        "--clean",
        "--no-owner",
        "--no-privileges",
        "--format",
        "plain",
        config.database
      ];
      const pgDump = spawn("pg_dump", args, {
        env: {
          ...process.env,
          PGPASSWORD: config.password
        }
      });
      let output = "";
      let errorOutput = "";
      pgDump.stdout.on("data", (data) => {
        output += data.toString();
      });
      pgDump.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });
      pgDump.on("close", (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`pg_dump failed with code ${code}: ${errorOutput}`));
        }
      });
      pgDump.on("error", (error) => {
        reject(new Error(`Failed to start pg_dump: ${error.message}`));
      });
    });
  }
  async createPrismaBackup() {
    console.log("\u{1F4E6} Creating Prisma-based backup (fallback method)");
    const backup = [];
    backup.push("-- PIPtip Database Backup (Prisma-based)");
    backup.push(`-- Generated: ${(/* @__PURE__ */ new Date()).toISOString()}`);
    backup.push("-- Method: Prisma data export");
    backup.push("");
    try {
      const [
        users,
        tokens,
        userBalances,
        tips,
        groupTips,
        groupTipClaims,
        matches,
        transactions,
        tierMemberships,
        tiers,
        tierPrices,
        approvedServers,
        ads,
        appConfig
      ] = await Promise.all([
        prisma.user.findMany(),
        prisma.token.findMany(),
        prisma.userBalance.findMany(),
        prisma.tip.findMany(),
        prisma.groupTip.findMany(),
        prisma.groupTipClaim.findMany(),
        prisma.match.findMany(),
        prisma.transaction.findMany(),
        prisma.tierMembership.findMany(),
        prisma.tier.findMany(),
        prisma.tierPrice.findMany(),
        prisma.approvedServer.findMany(),
        prisma.ad.findMany(),
        prisma.appConfig.findMany()
      ]);
      backup.push("-- USERS");
      backup.push(`-- Total records: ${users.length}`);
      users.forEach((user) => {
        backup.push(`INSERT INTO users (id, discordId, agwAddress, wins, losses, ties, createdAt, updatedAt) VALUES (${user.id}, '${user.discordId}', ${user.agwAddress ? `'${user.agwAddress}'` : "NULL"}, ${user.wins}, ${user.losses}, ${user.ties}, '${user.createdAt.toISOString()}', '${user.updatedAt.toISOString()}');`);
      });
      backup.push("");
      backup.push("-- TOKENS");
      backup.push(`-- Total records: ${tokens.length}`);
      tokens.forEach((token) => {
        backup.push(`INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (${token.id}, '${token.address}', '${token.symbol}', ${token.decimals}, ${token.active}, ${token.minDeposit}, ${token.minWithdraw}, ${token.tipFeeBps || "NULL"}, ${token.houseFeeBps || "NULL"}, ${token.withdrawMaxPerTx || "NULL"}, ${token.withdrawDailyCap || "NULL"}, '${token.createdAt.toISOString()}', '${token.updatedAt.toISOString()}');`);
      });
      backup.push("");
      backup.push("-- USER_BALANCES");
      backup.push(`-- Total records: ${userBalances.length}`);
      userBalances.forEach((balance) => {
        backup.push(`INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (${balance.id}, ${balance.userId}, ${balance.tokenId}, ${balance.amount});`);
      });
      backup.push("");
      backup.push("-- TIPS");
      backup.push(`-- Total records: ${tips.length}`);
      tips.forEach((tip) => {
        backup.push(`INSERT INTO tips (id, fromUserId, toUserId, tokenId, amountAtomic, feeAtomic, taxAtomic, note, status, refundedAt, createdAt) VALUES (${tip.id}, ${tip.fromUserId || "NULL"}, ${tip.toUserId || "NULL"}, ${tip.tokenId}, ${tip.amountAtomic}, ${tip.feeAtomic}, ${tip.taxAtomic}, ${tip.note ? `'${tip.note.replace(/'/g, "''")}'` : "NULL"}, '${tip.status}', ${tip.refundedAt ? `'${tip.refundedAt.toISOString()}'` : "NULL"}, '${tip.createdAt.toISOString()}');`);
      });
      backup.push("");
      backup.push("-- TRANSACTIONS");
      backup.push(`-- Total records: ${transactions.length}`);
      transactions.forEach((tx) => {
        backup.push(`INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (${tx.id}, '${tx.type}', ${tx.userId || "NULL"}, ${tx.otherUserId || "NULL"}, ${tx.guildId ? `'${tx.guildId}'` : "NULL"}, ${tx.tokenId || "NULL"}, ${tx.amount}, ${tx.fee}, ${tx.txHash ? `'${tx.txHash}'` : "NULL"}, ${tx.metadata ? `'${tx.metadata.replace(/'/g, "''")}'` : "NULL"}, '${tx.createdAt.toISOString()}');`);
      });
      backup.push("");
      backup.push("-- MATCHES");
      backup.push(`-- Total records: ${matches.length}`);
      matches.forEach((match) => {
        backup.push(`INSERT INTO matches (id, status, wagerAtomic, potAtomic, tokenId, challengerId, joinerId, challengerMove, joinerMove, result, rakeAtomic, winnerUserId, messageId, channelId, offerDeadline, createdAt) VALUES (${match.id}, '${match.status}', ${match.wagerAtomic}, ${match.potAtomic}, ${match.tokenId}, ${match.challengerId || "NULL"}, ${match.joinerId || "NULL"}, ${match.challengerMove ? `'${match.challengerMove}'` : "NULL"}, ${match.joinerMove ? `'${match.joinerMove}'` : "NULL"}, ${match.result ? `'${match.result}'` : "NULL"}, ${match.rakeAtomic}, ${match.winnerUserId || "NULL"}, ${match.messageId ? `'${match.messageId}'` : "NULL"}, ${match.channelId ? `'${match.channelId}'` : "NULL"}, ${match.offerDeadline ? `'${match.offerDeadline.toISOString()}'` : "NULL"}, '${match.createdAt.toISOString()}');`);
      });
      backup.push("");
      backup.push("-- Summary");
      backup.push(`-- Users: ${users.length}`);
      backup.push(`-- Tokens: ${tokens.length}`);
      backup.push(`-- Tips: ${tips.length}`);
      backup.push(`-- Transactions: ${transactions.length}`);
      backup.push(`-- Matches: ${matches.length}`);
      backup.push(`-- Backup completed successfully`);
      return backup.join("\n");
    } catch (error) {
      throw new Error(`Prisma backup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async cleanupOldBackups() {
    try {
      const files = await readdir(BACKUP_DIR);
      const backupFiles = files.filter((f) => f.startsWith("piptip_backup_") && f.endsWith(".sql")).sort().reverse();
      if (backupFiles.length > MAX_BACKUP_FILES) {
        const filesToDelete = backupFiles.slice(MAX_BACKUP_FILES);
        console.log(`\u{1F5D1}\uFE0F Cleaning up ${filesToDelete.length} old backup files`);
        for (const file of filesToDelete) {
          await unlink(join(BACKUP_DIR, file));
          console.log(`   Deleted: ${file}`);
        }
      }
    } catch (error) {
      console.error("Failed to cleanup old backups:", error);
    }
  }
  async logBackupToDatabase(filename, sizeKB) {
    try {
      await prisma.transaction.create({
        data: {
          type: "SYSTEM_BACKUP",
          amount: sizeKB,
          fee: 0,
          metadata: `Automated backup: ${filename}`
        }
      });
    } catch (error) {
      console.error("Failed to log backup to database:", error);
    }
  }
  async getBackupStatus() {
    try {
      const files = await readdir(BACKUP_DIR);
      const backupFiles = files.filter((f) => f.startsWith("piptip_backup_") && f.endsWith(".sql")).sort().reverse();
      const recentBackups = await Promise.all(
        backupFiles.slice(0, 10).map(async (file) => {
          const filepath = join(BACKUP_DIR, file);
          const stats = await import("fs").then((fs) => fs.statSync(filepath));
          return {
            filename: file,
            size: Math.round(stats.size / 1024),
            created: stats.birthtime,
            modified: stats.mtime
          };
        })
      );
      return {
        isRunning: this.isRunning,
        backupDir: BACKUP_DIR,
        totalBackups: backupFiles.length,
        maxBackups: MAX_BACKUP_FILES,
        intervalMinutes: BACKUP_INTERVAL_MS / (60 * 1e3),
        recentBackups
      };
    } catch (error) {
      return {
        isRunning: this.isRunning,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  async createManualBackup() {
    console.log("\u{1F4E6} Creating manual backup...");
    return await this.createBackup();
  }
}
const backupService = new BackupService();
export {
  BackupService,
  backupService
};
//# sourceMappingURL=backup.js.map
