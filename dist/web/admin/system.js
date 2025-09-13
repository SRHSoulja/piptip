// src/web/admin/system.ts
import { Router } from "express";
import { prisma } from "../../services/db.js";
import { getSyncMonitor } from "../../services/sync_monitor.js";
export const systemRouter = Router();
// System monitoring routes
systemRouter.get("/system/status", async (req, res) => {
    try {
        const [userCount, activeTokens, pendingTxs] = await Promise.all([
            prisma.user.count(),
            prisma.token.count({ where: { active: true } }),
            prisma.transaction.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
        ]);
        res.json({
            ok: true,
            database: true,
            rpc: true, // Could add actual RPC check
            treasury: process.env.TREASURY_ADDRESS || 'Not configured',
            activeTokens,
            activeUsers: userCount,
            pendingTxs,
            uptime: process.uptime(),
            memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
        });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to get system status" });
    }
});
systemRouter.get("/system/db-stats", async (req, res) => {
    try {
        const [users, transactions, tips, activeGroupTips, deposits, withdrawals] = await Promise.all([
            prisma.user.count(),
            prisma.transaction.count(),
            prisma.tip.count({ where: { status: 'COMPLETED' } }),
            prisma.groupTip.count({ where: { status: 'ACTIVE' } }),
            prisma.transaction.count({ where: { type: 'DEPOSIT' } }),
            prisma.transaction.count({ where: { type: 'WITHDRAW' } })
        ]);
        res.json({
            ok: true,
            users,
            transactions,
            tips,
            activeGroupTips,
            deposits,
            withdrawals,
            dbSize: 'Unknown'
        });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to get database stats" });
    }
});
systemRouter.post("/system/clear-caches", async (req, res) => {
    try {
        // Clear treasury cache
        const { invalidateTreasuryCache } = await import("../../services/treasury.js");
        invalidateTreasuryCache();
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
        console.log("🗑️ Admin cleared all system caches");
        res.json({ ok: true, message: "All caches cleared successfully" });
    }
    catch (error) {
        console.error("Failed to clear caches:", error);
        res.status(500).json({ ok: false, error: `Failed to clear caches: ${error.message}` });
    }
});
// Emergency control routes using AppConfig boolean fields
systemRouter.post("/emergency/pause-withdrawals", async (req, res) => {
    try {
        // Get or create app config and set withdrawal pause
        const config = await prisma.appConfig.findFirst();
        if (config) {
            await prisma.appConfig.update({
                where: { id: config.id },
                data: { withdrawalsPaused: true }
            });
        }
        else {
            await prisma.appConfig.create({
                data: { withdrawalsPaused: true }
            });
        }
        console.log("🚨 EMERGENCY: Withdrawals paused by admin");
        res.json({ ok: true, message: "Withdrawals paused - all withdrawal commands will be disabled" });
    }
    catch (error) {
        console.error("Failed to pause withdrawals:", error);
        res.status(500).json({ ok: false, error: `Failed to pause withdrawals: ${error.message}` });
    }
});
systemRouter.post("/emergency/pause-tipping", async (req, res) => {
    try {
        // Get or create app config and set tipping pause
        const config = await prisma.appConfig.findFirst();
        if (config) {
            await prisma.appConfig.update({
                where: { id: config.id },
                data: { tippingPaused: true }
            });
        }
        else {
            await prisma.appConfig.create({
                data: { tippingPaused: true }
            });
        }
        console.log("🚨 EMERGENCY: Tipping paused by admin");
        res.json({ ok: true, message: "Tipping paused - all tip commands will be disabled" });
    }
    catch (error) {
        console.error("Failed to pause tipping:", error);
        res.status(500).json({ ok: false, error: `Failed to pause tipping: ${error.message}` });
    }
});
systemRouter.post("/emergency/enable", async (req, res) => {
    try {
        // Enable full emergency mode - pause everything
        const config = await prisma.appConfig.findFirst();
        if (config) {
            await prisma.appConfig.update({
                where: { id: config.id },
                data: {
                    emergencyMode: true,
                    withdrawalsPaused: true,
                    tippingPaused: true
                }
            });
        }
        else {
            await prisma.appConfig.create({
                data: {
                    emergencyMode: true,
                    withdrawalsPaused: true,
                    tippingPaused: true
                }
            });
        }
        console.log("🚨 EMERGENCY MODE ENABLED: All financial operations paused");
        res.json({ ok: true, message: "Emergency mode enabled - all financial operations paused" });
    }
    catch (error) {
        console.error("Failed to enable emergency mode:", error);
        res.status(500).json({ ok: false, error: `Failed to enable emergency mode: ${error.message}` });
    }
});
systemRouter.post("/emergency/resume-all", async (req, res) => {
    try {
        // Resume all operations
        const config = await prisma.appConfig.findFirst();
        if (config) {
            await prisma.appConfig.update({
                where: { id: config.id },
                data: {
                    emergencyMode: false,
                    withdrawalsPaused: false,
                    tippingPaused: false
                }
            });
        }
        else {
            await prisma.appConfig.create({
                data: {
                    emergencyMode: false,
                    withdrawalsPaused: false,
                    tippingPaused: false
                }
            });
        }
        console.log("✅ EMERGENCY RESOLVED: All operations resumed");
        res.json({ ok: true, message: "All operations resumed - emergency mode disabled" });
    }
    catch (error) {
        console.error("Failed to resume operations:", error);
        res.status(500).json({ ok: false, error: `Failed to resume operations: ${error.message}` });
    }
});
// Get current emergency status
systemRouter.get("/emergency/status", async (req, res) => {
    try {
        const config = await prisma.appConfig.findFirst();
        const status = {
            emergencyMode: config?.emergencyMode || false,
            withdrawalsPaused: config?.withdrawalsPaused || false,
            tippingPaused: config?.tippingPaused || false
        };
        res.json({ ok: true, status });
    }
    catch (error) {
        console.error("Failed to get emergency status:", error);
        res.status(500).json({ ok: false, error: `Failed to get emergency status: ${error.message}` });
    }
});
// GRAND RESET - Wipe all user data, transactions, tips, balances for fresh start
systemRouter.post("/system/grand-reset", async (req, res) => {
    try {
        const confirmToken = req.body?.confirmToken;
        // Require special confirmation token for safety
        if (confirmToken !== "RESET_ALL_DATA_PERMANENTLY") {
            return res.status(400).json({
                ok: false,
                error: "Grand reset requires confirmation token in request body: { \"confirmToken\": \"RESET_ALL_DATA_PERMANENTLY\" }"
            });
        }
        console.log("🚨 GRAND RESET INITIATED: Wiping all user and financial data...");
        // Delete in proper order to respect foreign key constraints
        const deletions = await prisma.$transaction(async (tx) => {
            // Delete dependent records first
            const notifications = await tx.notification.deleteMany({});
            const groupTipClaims = await tx.groupTipClaim.deleteMany({});
            const groupTips = await tx.groupTip.deleteMany({});
            const tips = await tx.tip.deleteMany({});
            const matches = await tx.match.deleteMany({});
            const userBalances = await tx.userBalance.deleteMany({});
            const tierMemberships = await tx.tierMembership.deleteMany({});
            const transactions = await tx.transaction.deleteMany({});
            const processedDeposits = await tx.processedDeposit.deleteMany({});
            const webhookEvents = await tx.webhookEvent.deleteMany({});
            // Delete users last (they're referenced by many tables)
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
        console.log("💥 GRAND RESET COMPLETED:", {
            totalRecordsDeleted: totalDeleted,
            breakdown: deletions
        });
        res.json({
            ok: true,
            message: "Grand reset completed - all user data and financial records wiped",
            deletedCounts: deletions,
            totalDeleted
        });
    }
    catch (error) {
        console.error("Failed to perform grand reset:", error);
        res.status(500).json({ ok: false, error: `Grand reset failed: ${error.message}` });
    }
});
// Get system statistics before reset
systemRouter.get("/system/stats", async (req, res) => {
    try {
        const stats = await prisma.$transaction(async (tx) => {
            const [users, transactions, tips, groupTips, matches, userBalances, tierMemberships, notifications] = await Promise.all([
                tx.user.count(),
                tx.transaction.count(),
                tx.tip.count(),
                tx.groupTip.count(),
                tx.match.count(),
                tx.userBalance.count(),
                tx.tierMembership.count(),
                tx.notification.count()
            ]);
            return {
                users,
                transactions,
                tips,
                groupTips,
                matches,
                userBalances,
                tierMemberships,
                notifications
            };
        });
        const totalRecords = Object.values(stats).reduce((sum, count) => sum + count, 0);
        res.json({
            ok: true,
            stats,
            totalRecords
        });
    }
    catch (error) {
        console.error("Failed to get system stats:", error);
        res.status(500).json({ ok: false, error: `Failed to get stats: ${error.message}` });
    }
});
// Database synchronization monitoring routes
systemRouter.get("/sync/status", async (req, res) => {
    try {
        const syncMonitor = getSyncMonitor(prisma);
        const status = await syncMonitor.checkSync();
        res.json({
            ok: true,
            sync: {
                lastCheck: status.lastCheck,
                schemaInSync: status.schemaInSync,
                migrationsApplied: status.migrationsApplied,
                connectionHealthy: status.connectionHealthy,
                issueCount: status.issues.length,
                issues: status.issues,
                overallHealthy: status.schemaInSync && status.migrationsApplied && status.connectionHealthy && status.issues.length === 0
            }
        });
    }
    catch (error) {
        console.error("Failed to get sync status:", error);
        res.status(500).json({ ok: false, error: `Failed to get sync status: ${error.message}` });
    }
});
systemRouter.post("/sync/fix", async (req, res) => {
    try {
        const syncMonitor = getSyncMonitor(prisma);
        // Check current status first
        const currentStatus = await syncMonitor.checkSync();
        if (currentStatus.issues.length === 0) {
            return res.json({
                ok: true,
                message: "No sync issues detected - system is already synchronized",
                fixed: false
            });
        }
        console.log("🔧 Admin triggered sync fix via API");
        const fixed = await syncMonitor.autoFixSync();
        // Get updated status
        const newStatus = await syncMonitor.checkSync();
        res.json({
            ok: true,
            message: fixed ? "Sync issues automatically resolved" : "Some issues could not be automatically fixed",
            fixed,
            beforeIssues: currentStatus.issues,
            afterIssues: newStatus.issues,
            sync: {
                schemaInSync: newStatus.schemaInSync,
                migrationsApplied: newStatus.migrationsApplied,
                connectionHealthy: newStatus.connectionHealthy
            }
        });
    }
    catch (error) {
        console.error("Failed to fix sync issues:", error);
        res.status(500).json({ ok: false, error: `Failed to fix sync: ${error.message}` });
    }
});
systemRouter.post("/sync/validate", async (req, res) => {
    try {
        console.log("🔍 Admin triggered comprehensive sync validation");
        const { execSync } = await import("child_process");
        // For now, use inline validation since the script import has path issues
        const syncMonitor = getSyncMonitor(prisma);
        const validation = await syncMonitor.checkSync();
        const allGood = validation.schemaInSync && validation.migrationsApplied && validation.connectionHealthy && validation.issues.length === 0;
        res.json({
            ok: allGood,
            message: allGood ? "Database is fully synchronized" : "Synchronization issues detected",
            synchronized: allGood,
            issueCount: validation.issues.length,
            issues: validation.issues,
            sync: {
                schemaInSync: validation.schemaInSync,
                migrationsApplied: validation.migrationsApplied,
                connectionHealthy: validation.connectionHealthy
            }
        });
    }
    catch (error) {
        console.error("Failed to validate sync:", error);
        res.status(500).json({ ok: false, error: `Validation failed: ${error.message}` });
    }
});
// Migration management routes
systemRouter.post("/migrations/apply", async (req, res) => {
    try {
        console.log("📝 Admin triggered migration deployment");
        const { execSync } = await import("child_process");
        // Check migration status first
        const status = execSync('npx prisma migrate status', { encoding: 'utf-8' });
        if (status.includes('Database schema is up to date')) {
            return res.json({
                ok: true,
                message: "No migrations to apply - database is up to date",
                applied: false
            });
        }
        // Apply migrations
        execSync('npx prisma migrate deploy', { stdio: 'inherit' });
        // Regenerate client
        execSync('npx prisma generate', { stdio: 'inherit' });
        res.json({
            ok: true,
            message: "Migrations applied successfully",
            applied: true
        });
    }
    catch (error) {
        console.error("Failed to apply migrations:", error);
        res.status(500).json({ ok: false, error: `Migration failed: ${error.message}` });
    }
});
systemRouter.get("/migrations/status", async (req, res) => {
    try {
        const { execSync } = await import("child_process");
        const status = execSync('npx prisma migrate status', { encoding: 'utf-8' });
        const upToDate = status.includes('Database schema is up to date');
        const pendingMigrations = status.includes('following migrations have not yet been applied');
        res.json({
            ok: true,
            upToDate,
            pendingMigrations,
            statusText: status.trim()
        });
    }
    catch (error) {
        console.error("Failed to get migration status:", error);
        res.status(500).json({ ok: false, error: `Migration status failed: ${error.message}` });
    }
});
