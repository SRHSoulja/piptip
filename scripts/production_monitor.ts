// Production Monitoring Script - Real-time Performance Dashboard
import { enhancedRedisCache } from '../src/services/redis_enhanced.js';
import { dbPerformanceOptimizer } from '../src/services/db_performance_optimizer.js';
import { scalingManager } from '../src/services/scaling_manager.js';
import { cdnManager } from '../src/services/cdn_manager.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

interface SystemMetrics {
  timestamp: string;
  system: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cpuCount: number;
    totalMemory: number;
    freeMemory: number;
    uptime: number;
    loadAverage: number[];
  };
  cluster: {
    currentNodes: number;
    healthyNodes: number;
    cpuUsage: number;
    memoryUsage: number;
    connections: number;
  };
  redis: {
    connected: boolean;
    hitRate: number;
    totalKeys: number;
    memoryUsage: number;
    latency: number;
  };
  database: {
    activeConnections: number;
    slowQueries: number;
    cacheHitRatio: number;
    avgQueryTime: number;
    connectionPoolSize: number;
  };
  cdn: {
    enabled: boolean;
    provider: string;
    cacheHitRate?: number;
    assetsCount: number;
  };
  alerts: string[];
}

class ProductionMonitor {
  private alertThresholds = {
    cpuUsage: 85,
    memoryUsage: 90,
    redisLatency: 100,
    dbSlowQueries: 10,
    dbCacheHitRatio: 70,
    unhealthyNodes: 0.5 // 50% of nodes must be healthy
  };

  private metrics: SystemMetrics[] = [];
  private readonly MAX_METRICS_HISTORY = 1440; // 24 hours at 1-minute intervals

  /**
   * Start continuous monitoring
   */
  async startMonitoring(intervalMinutes: number = 1): Promise<void> {
    console.log('🚀 Starting Production Monitor...');
    console.log(`📊 Monitoring interval: ${intervalMinutes} minute(s)`);
    console.log('🔍 Use Ctrl+C to stop monitoring\n');

    // Initial metrics collection
    await this.collectAndDisplayMetrics();

    // Setup periodic monitoring
    const interval = setInterval(async () => {
      await this.collectAndDisplayMetrics();
    }, intervalMinutes * 60 * 1000);

    // Setup alert monitoring (more frequent)
    const alertInterval = setInterval(() => {
      this.checkCriticalAlerts();
    }, 30000); // Every 30 seconds

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🔄 Shutting down monitor...');
      clearInterval(interval);
      clearInterval(alertInterval);
      this.generateSummaryReport();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n🔄 Monitor terminated');
      clearInterval(interval);
      clearInterval(alertInterval);
      process.exit(0);
    });
  }

  /**
   * Collect comprehensive system metrics
   */
  private async collectMetrics(): Promise<SystemMetrics> {
    const os = require('os');

    const [
      clusterStats,
      redisStats,
      dbStats,
      cdnStats
    ] = await Promise.allSettled([
      this.getClusterStats(),
      this.getRedisStats(),
      this.getDatabaseStats(),
      this.getCDNStats()
    ]);

    const alerts: string[] = [];

    const metrics: SystemMetrics = {
      timestamp: new Date().toISOString(),
      system: {
        nodeVersion: process.version,
        platform: os.platform(),
        arch: os.arch(),
        cpuCount: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        uptime: os.uptime(),
        loadAverage: os.loadavg()
      },
      cluster: clusterStats.status === 'fulfilled' ? clusterStats.value : {
        currentNodes: 0,
        healthyNodes: 0,
        cpuUsage: 0,
        memoryUsage: 0,
        connections: 0
      },
      redis: redisStats.status === 'fulfilled' ? redisStats.value : {
        connected: false,
        hitRate: 0,
        totalKeys: 0,
        memoryUsage: 0,
        latency: 0
      },
      database: dbStats.status === 'fulfilled' ? dbStats.value : {
        activeConnections: 0,
        slowQueries: 0,
        cacheHitRatio: 0,
        avgQueryTime: 0,
        connectionPoolSize: 0
      },
      cdn: cdnStats.status === 'fulfilled' ? cdnStats.value : {
        enabled: false,
        provider: 'none',
        assetsCount: 0
      },
      alerts
    };

    // Generate alerts
    this.generateAlerts(metrics);

    return metrics;
  }

  /**
   * Collect and display metrics with formatted output
   */
  private async collectAndDisplayMetrics(): Promise<void> {
    try {
      const metrics = await this.collectMetrics();
      this.addMetricsToHistory(metrics);
      this.displayMetrics(metrics);
    } catch (error) {
      console.error('❌ Failed to collect metrics:', error);
    }
  }

  /**
   * Display formatted metrics
   */
  private displayMetrics(metrics: SystemMetrics): void {
    const timestamp = new Date(metrics.timestamp).toLocaleTimeString();

    // Clear screen and display header
    process.stdout.write('\\x1b[2J\\x1b[0f');
    console.log(`🚀 PIPTip Production Monitor - ${timestamp}`);
    console.log('═'.repeat(80));

    // System Information
    const memUsagePercent = ((metrics.system.totalMemory - metrics.system.freeMemory) / metrics.system.totalMemory * 100);
    console.log(`🖥️  System: Node ${metrics.system.nodeVersion} on ${metrics.system.platform}-${metrics.system.arch}`);
    console.log(`   Memory: ${this.formatBytes(metrics.system.totalMemory - metrics.system.freeMemory)}/${this.formatBytes(metrics.system.totalMemory)} (${memUsagePercent.toFixed(1)}%)`);
    console.log(`   Load: [${metrics.system.loadAverage.map(l => l.toFixed(2)).join(', ')}] | Uptime: ${this.formatDuration(metrics.system.uptime * 1000)}`);

    // Cluster Status
    const healthyRatio = metrics.cluster.currentNodes > 0 ? metrics.cluster.healthyNodes / metrics.cluster.currentNodes : 0;
    const healthStatus = healthyRatio >= 0.8 ? '🟢' : healthyRatio >= 0.5 ? '🟡' : '🔴';
    console.log(`\\n${healthStatus} Cluster: ${metrics.cluster.healthyNodes}/${metrics.cluster.currentNodes} nodes healthy`);
    console.log(`   CPU: ${metrics.cluster.cpuUsage.toFixed(1)}% | Memory: ${metrics.cluster.memoryUsage.toFixed(1)}% | Connections: ${metrics.cluster.connections.toLocaleString()}`);

    // Redis Status
    const redisStatus = metrics.redis.connected ? '🟢' : '🔴';
    console.log(`\\n${redisStatus} Redis: ${metrics.redis.connected ? 'Connected' : 'Disconnected'}`);
    if (metrics.redis.connected) {
      console.log(`   Cache Hit Rate: ${metrics.redis.hitRate.toFixed(1)}% | Keys: ${metrics.redis.totalKeys.toLocaleString()}`);
      console.log(`   Memory: ${this.formatBytes(metrics.redis.memoryUsage)} | Latency: ${metrics.redis.latency.toFixed(1)}ms`);
    }

    // Database Status
    const dbStatus = metrics.database.activeConnections > 0 ? '🟢' : '🟡';
    console.log(`\\n${dbStatus} Database: ${metrics.database.activeConnections}/${metrics.database.connectionPoolSize} connections`);
    console.log(`   Cache Hit Ratio: ${metrics.database.cacheHitRatio.toFixed(1)}% | Avg Query: ${metrics.database.avgQueryTime.toFixed(1)}ms`);
    console.log(`   Slow Queries: ${metrics.database.slowQueries} in last period`);

    // CDN Status
    const cdnStatus = metrics.cdn.enabled ? '🟢' : '🟡';
    console.log(`\\n${cdnStatus} CDN: ${metrics.cdn.enabled ? 'Enabled' : 'Disabled'} (${metrics.cdn.provider})`);
    if (metrics.cdn.enabled && metrics.cdn.cacheHitRate) {
      console.log(`   Cache Hit Rate: ${metrics.cdn.cacheHitRate.toFixed(1)}% | Assets: ${metrics.cdn.assetsCount.toLocaleString()}`);
    }

    // Alerts
    if (metrics.alerts.length > 0) {
      console.log(`\\n🚨 Alerts:`);
      metrics.alerts.forEach(alert => console.log(`   ${alert}`));
    }

    // Performance Summary (last 5 minutes)
    this.displayPerformanceTrend();

    console.log('\\n' + '═'.repeat(80));
    console.log('⏱️  Next update in 1 minute | Press Ctrl+C to exit');
  }

  /**
   * Display performance trend
   */
  private displayPerformanceTrend(): void {
    if (this.metrics.length < 2) return;

    const recent = this.metrics.slice(-5); // Last 5 data points
    const avgCpu = recent.reduce((sum, m) => sum + m.cluster.cpuUsage, 0) / recent.length;
    const avgMemory = recent.reduce((sum, m) => sum + m.cluster.memoryUsage, 0) / recent.length;
    const avgRedisHitRate = recent.reduce((sum, m) => sum + m.redis.hitRate, 0) / recent.length;

    console.log(`\\n📈 5-Minute Trend:`);
    console.log(`   CPU: ${avgCpu.toFixed(1)}% avg | Memory: ${avgMemory.toFixed(1)}% avg | Redis Hit Rate: ${avgRedisHitRate.toFixed(1)}% avg`);
  }

  /**
   * Check for critical alerts that need immediate attention
   */
  private checkCriticalAlerts(): void {
    if (this.metrics.length === 0) return;

    const latest = this.metrics[this.metrics.length - 1];

    // Critical CPU usage
    if (latest.cluster.cpuUsage > 95) {
      console.log('\\n🚨🚨 CRITICAL ALERT: CPU usage above 95%');
    }

    // Critical memory usage
    if (latest.cluster.memoryUsage > 95) {
      console.log('\\n🚨🚨 CRITICAL ALERT: Memory usage above 95%');
    }

    // Redis disconnection
    if (!latest.redis.connected) {
      console.log('\\n🚨🚨 CRITICAL ALERT: Redis disconnected');
    }

    // No healthy nodes
    if (latest.cluster.healthyNodes === 0 && latest.cluster.currentNodes > 0) {
      console.log('\\n🚨🚨 CRITICAL ALERT: No healthy cluster nodes');
    }
  }

  /**
   * Generate alerts based on thresholds
   */
  private generateAlerts(metrics: SystemMetrics): void {
    // High CPU usage
    if (metrics.cluster.cpuUsage > this.alertThresholds.cpuUsage) {
      metrics.alerts.push(`🔥 High CPU usage: ${metrics.cluster.cpuUsage.toFixed(1)}%`);
    }

    // High memory usage
    if (metrics.cluster.memoryUsage > this.alertThresholds.memoryUsage) {
      metrics.alerts.push(`🧠 High memory usage: ${metrics.cluster.memoryUsage.toFixed(1)}%`);
    }

    // Redis issues
    if (!metrics.redis.connected) {
      metrics.alerts.push('📡 Redis disconnected');
    } else if (metrics.redis.latency > this.alertThresholds.redisLatency) {
      metrics.alerts.push(`⚡ High Redis latency: ${metrics.redis.latency.toFixed(1)}ms`);
    }

    // Database issues
    if (metrics.database.slowQueries > this.alertThresholds.dbSlowQueries) {
      metrics.alerts.push(`🐌 Many slow DB queries: ${metrics.database.slowQueries}`);
    }

    if (metrics.database.cacheHitRatio < this.alertThresholds.dbCacheHitRatio) {
      metrics.alerts.push(`📊 Low DB cache hit ratio: ${metrics.database.cacheHitRatio.toFixed(1)}%`);
    }

    // Cluster health
    const healthyRatio = metrics.cluster.currentNodes > 0 ? metrics.cluster.healthyNodes / metrics.cluster.currentNodes : 1;
    if (healthyRatio < this.alertThresholds.unhealthyNodes) {
      metrics.alerts.push(`⚕️ Unhealthy cluster: ${metrics.cluster.healthyNodes}/${metrics.cluster.currentNodes} nodes`);
    }
  }

  /**
   * Helper methods for data collection
   */
  private async getClusterStats() {
    return scalingManager.getScalingStats();
  }

  private getRedisStats() {
    const stats = enhancedRedisCache.getStats();
    return {
      connected: true, // Assume connected if we can get stats
      hitRate: stats.hitRate,
      totalKeys: stats.totalKeys,
      memoryUsage: stats.memoryUsage || 0,
      latency: stats.avgLatency || 0
    };
  }

  private async getDatabaseStats() {
    return await dbPerformanceOptimizer.getPerformanceStats();
  }

  private async getCDNStats() {
    return await cdnManager.getCDNStats();
  }

  /**
   * Add metrics to history and maintain size limit
   */
  private addMetricsToHistory(metrics: SystemMetrics): void {
    this.metrics.push(metrics);
    if (this.metrics.length > this.MAX_METRICS_HISTORY) {
      this.metrics.shift();
    }
  }

  /**
   * Generate summary report on exit
   */
  private generateSummaryReport(): void {
    if (this.metrics.length === 0) {
      console.log('\\n📊 No metrics collected');
      return;
    }

    const first = this.metrics[0];
    const last = this.metrics[this.metrics.length - 1];
    const duration = new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime();

    console.log('\\n📊 Monitor Session Summary:');
    console.log(`⏱️  Duration: ${this.formatDuration(duration)}`);
    console.log(`📈 Data Points: ${this.metrics.length}`);

    // Calculate averages
    const avgCpu = this.metrics.reduce((sum, m) => sum + m.cluster.cpuUsage, 0) / this.metrics.length;
    const avgMemory = this.metrics.reduce((sum, m) => sum + m.cluster.memoryUsage, 0) / this.metrics.length;
    const avgRedisHitRate = this.metrics.reduce((sum, m) => sum + m.redis.hitRate, 0) / this.metrics.length;

    console.log(`🖥️  Average CPU: ${avgCpu.toFixed(1)}%`);
    console.log(`🧠 Average Memory: ${avgMemory.toFixed(1)}%`);
    console.log(`📡 Average Redis Hit Rate: ${avgRedisHitRate.toFixed(1)}%`);

    // Count total alerts
    const totalAlerts = this.metrics.reduce((sum, m) => sum + m.alerts.length, 0);
    console.log(`🚨 Total Alerts: ${totalAlerts}`);

    console.log('\\n✅ Monitor session complete');
  }

  /**
   * Utility functions
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let value = bytes;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

// CLI interface
const monitor = new ProductionMonitor();

// Parse command line arguments
const args = process.argv.slice(2);
const intervalMinutes = args.includes('--interval') ?
  parseInt(args[args.indexOf('--interval') + 1]) || 1 : 1;

// Start monitoring
monitor.startMonitoring(intervalMinutes).catch((error) => {
  console.error('💥 Monitor failed to start:', error);
  process.exit(1);
});

export default monitor;