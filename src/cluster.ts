// Production Cluster Entry Point - PIPTip Horizontal Scaling
import { scalingManager } from './services/scaling_manager.js';
import { enhancedRedisCache } from './services/redis_enhanced.js';
import { dbPerformanceOptimizer } from './services/db_performance_optimizer.js';
import { cdnManager } from './services/cdn_manager.js';
import cluster from 'cluster';
import os from 'os';

/**
 * Production cluster initialization with enterprise-grade scaling
 *
 * This is the entry point for production deployments that need to handle
 * millions of users across multiple server instances.
 *
 * Usage:
 * - npm run start:cluster (production cluster mode)
 * - NODE_ENV=production node dist/cluster.js
 */

class ProductionCluster {
  private startTime = Date.now();

  async initialize(): Promise<void> {
    console.log('🚀 Starting PIPTip Production Cluster...');
    console.log(`📊 System: ${os.cpus().length} CPUs, ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB RAM`);

    if (cluster.isPrimary) {
      await this.initializeMaster();
    } else {
      await this.initializeWorker();
    }
  }

  /**
   * Initialize master process for cluster coordination
   */
  private async initializeMaster(): Promise<void> {
    console.log(`🎯 Master process ${process.pid} initializing...`);

    // Initialize shared services on master
    await this.initializeSharedServices();

    // Setup cluster event listeners
    this.setupClusterEventHandlers();

    // Start performance monitoring
    this.startPerformanceMonitoring();

    console.log('✅ Production cluster master ready');
    console.log(`🏃 Startup time: ${Date.now() - this.startTime}ms`);
  }

  /**
   * Initialize worker process
   */
  private async initializeWorker(): Promise<void> {
    const workerId = cluster.worker?.id || 'unknown';
    console.log(`👷 Worker ${workerId} (PID: ${process.pid}) initializing...`);

    try {
      // Import and start the main application
      const app = await import('./index.js');

      // Worker-specific initialization
      process.title = `piptip-worker-${workerId}`;

      console.log(`✅ Worker ${workerId} ready`);

      // Send ready signal to master
      if (process.send) {
        process.send({
          type: 'worker_ready',
          workerId,
          pid: process.pid,
          startupTime: Date.now() - this.startTime
        });
      }

    } catch (error) {
      console.error(`❌ Worker ${workerId} failed to start:`, error);
      process.exit(1);
    }
  }

  /**
   * Initialize shared services (Redis, DB connections, etc.)
   */
  private async initializeSharedServices(): Promise<void> {
    try {
      console.log('🔧 Initializing shared services...');

      // Initialize Redis cluster
      console.log('📡 Connecting to Redis...');
      await enhancedRedisCache.testConnection();

      // Initialize database performance optimizer
      console.log('🗄️ Initializing database optimizer...');
      await dbPerformanceOptimizer.initialize();

      // Initialize CDN manager
      console.log('🌍 Initializing CDN manager...');
      const cdnStats = await cdnManager.getCDNStats();
      console.log(`🌍 CDN Status: ${cdnStats.enabled ? 'enabled' : 'disabled'} (${cdnStats.provider})`);

      console.log('✅ Shared services initialized');

    } catch (error) {
      console.error('❌ Failed to initialize shared services:', error);
      process.exit(1);
    }
  }

  /**
   * Setup cluster event handlers for monitoring and recovery
   */
  private setupClusterEventHandlers(): void {
    // Listen for worker messages
    scalingManager.on('health_update', (stats) => {
      console.log(`📊 Cluster Health: ${stats.healthyNodes}/${stats.totalNodes} nodes, CPU: ${stats.avgCpuUsage.toFixed(1)}%, Mem: ${stats.avgMemoryUsage.toFixed(1)}%`);
    });

    scalingManager.on('scale_up', ({ from, to }) => {
      console.log(`📈 Scaled up: ${from} → ${to} workers`);
    });

    scalingManager.on('scale_down', ({ from, to }) => {
      console.log(`📉 Scaled down: ${from} → ${to} workers`);
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      console.error('🚨 Uncaught Exception in master:', error);
      this.gracefulShutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('🚨 Unhandled Rejection in master:', reason);
      console.error('Promise:', promise);
    });
  }

  /**
   * Start performance monitoring and metrics collection
   */
  private startPerformanceMonitoring(): void {
    // Monitor cluster performance every 30 seconds
    setInterval(() => {
      const stats = scalingManager.getScalingStats();

      console.log(`📊 Cluster Metrics:
        • Nodes: ${stats.currentNodes} (${stats.healthyNodes} healthy)
        • CPU: ${stats.cpuUsage.toFixed(1)}%
        • Memory: ${stats.memoryUsage.toFixed(1)}%
        • Connections: ${stats.connections.toLocaleString()}
        • Uptime: ${Math.round(stats.uptime / 60)}m`
      );

      // Log Redis performance
      const redisStats = enhancedRedisCache.getStats();
      if (redisStats.hitRate > 0) {
        console.log(`📡 Redis Cache: ${redisStats.hitRate.toFixed(1)}% hit rate, ${redisStats.totalKeys.toLocaleString()} keys`);
      }

    }, 30000); // Every 30 seconds

    // Generate daily performance report
    setInterval(() => {
      this.generatePerformanceReport();
    }, 24 * 60 * 60 * 1000); // Daily
  }

  /**
   * Generate comprehensive performance report
   */
  private async generatePerformanceReport(): Promise<void> {
    try {
      const clusterStats = scalingManager.getScalingStats();
      const redisStats = enhancedRedisCache.getStats();
      const dbStats = await dbPerformanceOptimizer.getPerformanceStats();
      const cdnStats = await cdnManager.getCDNStats();

      const report = {
        timestamp: new Date().toISOString(),
        cluster: clusterStats,
        redis: redisStats,
        database: dbStats,
        cdn: cdnStats,
        uptime: Math.round(process.uptime() / 3600) // Hours
      };

      console.log(`📈 Daily Performance Report:
🏗️  Cluster: ${clusterStats.currentNodes} nodes, ${clusterStats.healthyNodes} healthy
📡 Redis: ${redisStats.hitRate.toFixed(1)}% cache hit rate
🗄️  Database: ${dbStats.slowQueries} slow queries, ${dbStats.cacheHitRatio.toFixed(1)}% cache hit
🌍 CDN: ${cdnStats.enabled ? cdnStats.cacheHitRate + '% hit rate' : 'disabled'}
⏱️  Uptime: ${report.uptime}h`);

      // In production, you might want to send this to a monitoring service
      // await sendToMonitoringService(report);

    } catch (error) {
      console.error('❌ Failed to generate performance report:', error);
    }
  }

  /**
   * Graceful shutdown handler
   */
  private async gracefulShutdown(): Promise<void> {
    console.log('🔄 Production cluster shutting down gracefully...');

    try {
      // Give workers time to finish current requests
      setTimeout(() => {
        console.log('⚠️ Force shutdown after timeout');
        process.exit(1);
      }, 30000);

      // Close shared services
      await enhancedRedisCache.close();
      await dbPerformanceOptimizer.close();

      console.log('✅ Production cluster shutdown complete');
      process.exit(0);

    } catch (error) {
      console.error('❌ Error during graceful shutdown:', error);
      process.exit(1);
    }
  }
}

// Start the production cluster
const productionCluster = new ProductionCluster();

productionCluster.initialize().catch((error) => {
  console.error('💥 Fatal error starting production cluster:', error);
  process.exit(1);
});

// Export for monitoring
export default productionCluster;