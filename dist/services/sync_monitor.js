// src/services/sync_monitor.ts - Real-time Supabase-Prisma synchronization monitoring
import { execSync } from 'child_process';
class SyncMonitor {
    prisma;
    checkInterval = null;
    lastStatus = {
        lastCheck: new Date(),
        schemaInSync: false,
        migrationsApplied: false,
        connectionHealthy: false,
        issues: []
    };
    constructor(prisma) {
        this.prisma = prisma;
    }
    async checkSync() {
        const status = {
            lastCheck: new Date(),
            schemaInSync: false,
            migrationsApplied: false,
            connectionHealthy: false,
            issues: []
        };
        try {
            // Check database connection
            await this.prisma.$queryRaw `SELECT 1`;
            status.connectionHealthy = true;
        }
        catch (error) {
            status.issues.push(`Database connection failed: ${error.message}`);
        }
        // Check schema synchronization
        try {
            const diff = execSync('npx prisma db diff --exit-code --schema=./prisma/schema.prisma', {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
            status.schemaInSync = !diff.trim();
        }
        catch (error) {
            if (error.status === 2) {
                status.issues.push('Schema drift detected - Prisma schema differs from database');
            }
            else {
                status.issues.push(`Schema check failed: ${error.message}`);
            }
        }
        // Check migration status
        try {
            const migrationStatus = execSync('npx prisma migrate status', {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
            status.migrationsApplied = migrationStatus.includes('Database schema is up to date');
            if (!status.migrationsApplied) {
                status.issues.push('Pending migrations detected');
            }
        }
        catch (error) {
            status.issues.push(`Migration status check failed: ${error.message}`);
        }
        this.lastStatus = status;
        return status;
    }
    async autoFixSync() {
        console.log('🔧 Auto-fixing synchronization issues...');
        try {
            // Regenerate Prisma client
            console.log('   📦 Regenerating Prisma client...');
            execSync('npx prisma generate', { stdio: 'inherit' });
            // Apply pending migrations if safe
            if (!this.lastStatus.migrationsApplied) {
                console.log('   📝 Applying pending migrations...');
                try {
                    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
                }
                catch (error) {
                    console.warn('   ⚠️  Migration failed - manual intervention may be needed');
                    return false;
                }
            }
            // Verify fix worked
            const newStatus = await this.checkSync();
            const isFixed = newStatus.schemaInSync && newStatus.migrationsApplied && newStatus.connectionHealthy;
            if (isFixed) {
                console.log('   ✅ Sync issues automatically resolved');
            }
            else {
                console.log('   ❌ Could not automatically resolve all issues');
                newStatus.issues.forEach(issue => console.log(`      • ${issue}`));
            }
            return isFixed;
        }
        catch (error) {
            console.error('   ❌ Auto-fix failed:', error.message);
            return false;
        }
    }
    startMonitoring(intervalMinutes = 5) {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        console.log(`🔄 Starting sync monitoring (checking every ${intervalMinutes} minutes)`);
        // Initial check
        this.checkSync().then(status => {
            this.logStatus(status);
        }).catch(error => {
            console.error('Initial sync check failed:', error);
        });
        // Periodic checks
        this.checkInterval = setInterval(async () => {
            try {
                const status = await this.checkSync();
                // Only log if status changed or there are issues
                if (status.issues.length > 0 || this.hasStatusChanged(status)) {
                    this.logStatus(status);
                    // Auto-fix if issues detected and auto-fix is enabled
                    if (status.issues.length > 0 && process.env.AUTO_FIX_SYNC === 'true') {
                        await this.autoFixSync();
                    }
                }
            }
            catch (error) {
                console.error('Sync monitoring check failed:', error);
            }
        }, intervalMinutes * 60 * 1000);
    }
    stopMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            console.log('⏹️  Sync monitoring stopped');
        }
    }
    getLastStatus() {
        return this.lastStatus;
    }
    hasStatusChanged(newStatus) {
        return (this.lastStatus.schemaInSync !== newStatus.schemaInSync ||
            this.lastStatus.migrationsApplied !== newStatus.migrationsApplied ||
            this.lastStatus.connectionHealthy !== newStatus.connectionHealthy ||
            this.lastStatus.issues.length !== newStatus.issues.length);
    }
    logStatus(status) {
        const allGood = status.schemaInSync && status.migrationsApplied && status.connectionHealthy && status.issues.length === 0;
        if (allGood) {
            console.log('✅ Database sync status: All systems synchronized');
        }
        else {
            console.log('⚠️  Database sync status: Issues detected');
            console.log(`   Schema in sync: ${status.schemaInSync ? '✅' : '❌'}`);
            console.log(`   Migrations applied: ${status.migrationsApplied ? '✅' : '❌'}`);
            console.log(`   Connection healthy: ${status.connectionHealthy ? '✅' : '❌'}`);
            if (status.issues.length > 0) {
                console.log('   Issues:');
                status.issues.forEach(issue => console.log(`     • ${issue}`));
            }
        }
    }
}
// Singleton instance for application-wide use
let syncMonitorInstance = null;
export function getSyncMonitor(prisma) {
    if (!syncMonitorInstance) {
        syncMonitorInstance = new SyncMonitor(prisma);
    }
    return syncMonitorInstance;
}
export { SyncMonitor };
