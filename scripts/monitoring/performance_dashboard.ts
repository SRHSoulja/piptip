#!/usr/bin/env npx tsx
// scripts/monitoring/performance_dashboard.ts - Real-time performance monitoring for achievement system

import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { prisma } from '../../src/services/db.js';
import { getCache } from '../../src/services/cache.js';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';

interface PerformanceMetrics {
  timestamp: number;
  achievementChecks: {
    totalPerSecond: number;
    averageResponseTime: number;
    errorRate: number;
    operationBreakdown: Record<string, {
      count: number;
      avgTime: number;
      errors: number;
    }>;
  };
  database: {
    connectionPoolUtilization: number;
    activeConnections: number;
    slowQueries: number;
    queryTimes: {
      progressUpdate: number;
      achievementUnlock: number;
      leaderboardQuery: number;
      batchProcessing: number;
    };
  };
  cache: {
    hitRate: number;
    missRate: number;
    size: number;
    maxSize: number;
    memoryUsage: number;
    operations: {
      hits: number;
      misses: number;
      sets: number;
      deletes: number;
    };
  };
  tables: {
    userAchievementProgress: {
      rowCount: number;
      recentGrowth: number;
      avgRowSize: number;
    };
    userAchievement: {
      rowCount: number;
      recentGrowth: number;
    };
  };
  system: {
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
    uptime: number;
  };
}

interface Alert {
  id: string;
  timestamp: number;
  level: 'info' | 'warning' | 'error' | 'critical';
  category: 'performance' | 'database' | 'cache' | 'system';
  title: string;
  message: string;
  threshold?: number;
  currentValue?: number;
  resolved?: boolean;
}

class PerformanceMonitor {
  private app: express.Application;
  private server: any;
  private io: Server;
  private port: number = 3001;
  private metricsHistory: PerformanceMetrics[] = [];
  private alerts: Alert[] = [];
  private isRunning = false;
  private metricsInterval: NodeJS.Timeout | null = null;
  private cacheOperations = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0
  };

  // Performance thresholds for alerting
  private thresholds = {
    achievementResponseTime: 100, // ms
    errorRate: 5, // %
    connectionPoolUtilization: 80, // %
    slowQueryCount: 10, // per minute
    cacheHitRate: 70, // %
    memoryUsage: 85 // %
  };

  constructor(port?: number) {
    if (port) this.port = port;
    this.setupExpressApp();
    this.setupWebSocket();
    this.setupMonitoring();
  }

  private setupExpressApp(): void {
    this.app = express();
    this.server = createServer(this.app);

    this.app.use(express.static(join(__dirname, 'dashboard-ui')));
    this.app.use(express.json());

    // API endpoints
    this.app.get('/api/metrics/current', this.getCurrentMetrics.bind(this));
    this.app.get('/api/metrics/history', this.getMetricsHistory.bind(this));
    this.app.get('/api/alerts', this.getAlerts.bind(this));
    this.app.post('/api/alerts/:id/resolve', this.resolveAlert.bind(this));
    this.app.get('/api/health', this.getHealthStatus.bind(this));

    // Dashboard HTML
    this.app.get('/', (req, res) => {
      res.send(this.generateDashboardHTML());
    });

    console.log(`📊 Performance dashboard will be available at http://localhost:${this.port}`);
  }

  private setupWebSocket(): void {
    this.io = new Server(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    this.io.on('connection', (socket) => {
      console.log(`📡 Client connected: ${socket.id}`);

      // Send current metrics immediately
      this.getCurrentMetrics().then(metrics => {
        socket.emit('metrics', metrics);
      });

      // Send current alerts
      socket.emit('alerts', this.alerts.filter(a => !a.resolved));

      socket.on('disconnect', () => {
        console.log(`📡 Client disconnected: ${socket.id}`);
      });
    });
  }

  private setupMonitoring(): void {
    // Start collecting metrics every 5 seconds
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, 5000);

    console.log('🔍 Performance monitoring started');
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`🚀 Performance dashboard running on port ${this.port}`);
        this.isRunning = true;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    if (this.server) {
      this.server.close();
    }

    console.log('📊 Performance dashboard stopped');
  }

  private async collectMetrics(): Promise<void> {
    try {
      const metrics = await this.getCurrentMetrics();
      this.metricsHistory.push(metrics);

      // Keep only last 1000 entries (about 1.5 hours at 5s intervals)
      if (this.metricsHistory.length > 1000) {
        this.metricsHistory = this.metricsHistory.slice(-1000);
      }

      // Check for alerts
      this.checkAlerts(metrics);

      // Broadcast to connected clients
      this.io.emit('metrics', metrics);

    } catch (error) {
      console.error('Error collecting metrics:', error);
    }
  }

  private async getCurrentMetrics(): Promise<PerformanceMetrics> {
    const timestamp = Date.now();

    // Collect database metrics
    const [progressCount, achievementCount] = await Promise.all([
      prisma.userAchievementProgress.count().catch(() => 0),
      prisma.userAchievement.count().catch(() => 0)
    ]);

    // Get cache stats
    const cache = getCache();
    const cacheStats = (cache as any).getStats ? (cache as any).getStats() : {
      size: 0,
      maxSize: 1000,
      memoryUsage: 0,
      keys: []
    };

    // Calculate cache hit rate
    const totalCacheOps = this.cacheOperations.hits + this.cacheOperations.misses;
    const cacheHitRate = totalCacheOps > 0 ? (this.cacheOperations.hits / totalCacheOps) * 100 : 0;

    // System metrics
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // Simulated metrics (would come from actual monitoring in production)
    const metrics: PerformanceMetrics = {
      timestamp,
      achievementChecks: {
        totalPerSecond: this.calculateAchievementChecksPerSecond(),
        averageResponseTime: this.getAverageResponseTime(),
        errorRate: this.getErrorRate(),
        operationBreakdown: this.getOperationBreakdown()
      },
      database: {
        connectionPoolUtilization: this.getConnectionPoolUtilization(),
        activeConnections: this.getActiveConnections(),
        slowQueries: this.getSlowQueryCount(),
        queryTimes: {
          progressUpdate: 15 + Math.random() * 30,
          achievementUnlock: 25 + Math.random() * 50,
          leaderboardQuery: 40 + Math.random() * 80,
          batchProcessing: 150 + Math.random() * 300
        }
      },
      cache: {
        hitRate: cacheHitRate,
        missRate: 100 - cacheHitRate,
        size: cacheStats.size,
        maxSize: cacheStats.maxSize,
        memoryUsage: cacheStats.memoryUsage,
        operations: { ...this.cacheOperations }
      },
      tables: {
        userAchievementProgress: {
          rowCount: progressCount,
          recentGrowth: this.calculateTableGrowth('userAchievementProgress'),
          avgRowSize: 200
        },
        userAchievement: {
          rowCount: achievementCount,
          recentGrowth: this.calculateTableGrowth('userAchievement')
        }
      },
      system: {
        memoryUsage,
        cpuUsage,
        uptime: process.uptime()
      }
    };

    return metrics;
  }

  private calculateAchievementChecksPerSecond(): number {
    // Simulate achievement checks based on recent activity
    return 10 + Math.random() * 20; // 10-30 checks per second
  }

  private getAverageResponseTime(): number {
    // Simulate response time with some variance
    return 45 + Math.random() * 55; // 45-100ms
  }

  private getErrorRate(): number {
    // Simulate low error rate with occasional spikes
    return Math.random() < 0.95 ? Math.random() * 2 : Math.random() * 8; // Usually 0-2%, sometimes 0-8%
  }

  private getOperationBreakdown(): Record<string, { count: number; avgTime: number; errors: number }> {
    return {
      'progress_update': {
        count: Math.floor(Math.random() * 50) + 20,
        avgTime: 15 + Math.random() * 30,
        errors: Math.floor(Math.random() * 3)
      },
      'achievement_unlock': {
        count: Math.floor(Math.random() * 10) + 2,
        avgTime: 25 + Math.random() * 50,
        errors: Math.floor(Math.random() * 2)
      },
      'batch_processing': {
        count: Math.floor(Math.random() * 5) + 1,
        avgTime: 150 + Math.random() * 300,
        errors: Math.floor(Math.random() * 2)
      }
    };
  }

  private getConnectionPoolUtilization(): number {
    // Simulate connection pool usage
    return 30 + Math.random() * 40; // 30-70%
  }

  private getActiveConnections(): number {
    return Math.floor(Math.random() * 15) + 5; // 5-20 active connections
  }

  private getSlowQueryCount(): number {
    return Math.floor(Math.random() * 5); // 0-5 slow queries
  }

  private calculateTableGrowth(tableName: string): number {
    // Simulate table growth rate
    return Math.random() * 5; // 0-5% growth
  }

  private checkAlerts(metrics: PerformanceMetrics): void {
    const alerts: Alert[] = [];

    // Response time alert
    if (metrics.achievementChecks.averageResponseTime > this.thresholds.achievementResponseTime) {
      alerts.push({
        id: `response_time_${Date.now()}`,
        timestamp: Date.now(),
        level: metrics.achievementChecks.averageResponseTime > 200 ? 'error' : 'warning',
        category: 'performance',
        title: 'High Response Time',
        message: 'Achievement checks are taking longer than expected',
        threshold: this.thresholds.achievementResponseTime,
        currentValue: metrics.achievementChecks.averageResponseTime
      });
    }

    // Error rate alert
    if (metrics.achievementChecks.errorRate > this.thresholds.errorRate) {
      alerts.push({
        id: `error_rate_${Date.now()}`,
        timestamp: Date.now(),
        level: metrics.achievementChecks.errorRate > 10 ? 'critical' : 'warning',
        category: 'performance',
        title: 'High Error Rate',
        message: 'Achievement system experiencing elevated error rate',
        threshold: this.thresholds.errorRate,
        currentValue: metrics.achievementChecks.errorRate
      });
    }

    // Connection pool alert
    if (metrics.database.connectionPoolUtilization > this.thresholds.connectionPoolUtilization) {
      alerts.push({
        id: `connection_pool_${Date.now()}`,
        timestamp: Date.now(),
        level: metrics.database.connectionPoolUtilization > 90 ? 'critical' : 'warning',
        category: 'database',
        title: 'High Connection Pool Usage',
        message: 'Database connection pool utilization is high',
        threshold: this.thresholds.connectionPoolUtilization,
        currentValue: metrics.database.connectionPoolUtilization
      });
    }

    // Cache hit rate alert
    if (metrics.cache.hitRate < this.thresholds.cacheHitRate) {
      alerts.push({
        id: `cache_hit_rate_${Date.now()}`,
        timestamp: Date.now(),
        level: 'warning',
        category: 'cache',
        title: 'Low Cache Hit Rate',
        message: 'Cache performance is below expected threshold',
        threshold: this.thresholds.cacheHitRate,
        currentValue: metrics.cache.hitRate
      });
    }

    // Memory usage alert
    const memoryUsagePercent = (metrics.system.memoryUsage.heapUsed / metrics.system.memoryUsage.heapTotal) * 100;
    if (memoryUsagePercent > this.thresholds.memoryUsage) {
      alerts.push({
        id: `memory_usage_${Date.now()}`,
        timestamp: Date.now(),
        level: memoryUsagePercent > 95 ? 'critical' : 'warning',
        category: 'system',
        title: 'High Memory Usage',
        message: 'System memory usage is approaching limits',
        threshold: this.thresholds.memoryUsage,
        currentValue: memoryUsagePercent
      });
    }

    // Add new alerts and broadcast
    if (alerts.length > 0) {
      this.alerts.push(...alerts);
      this.io.emit('alerts', alerts);
    }

    // Auto-resolve old alerts (if conditions are back to normal)
    this.autoResolveAlerts(metrics);
  }

  private autoResolveAlerts(metrics: PerformanceMetrics): void {
    const resolvedAlerts = this.alerts.filter(alert => {
      if (alert.resolved) return false;

      let shouldResolve = false;

      switch (alert.category) {
        case 'performance':
          if (alert.title.includes('Response Time')) {
            shouldResolve = metrics.achievementChecks.averageResponseTime <= this.thresholds.achievementResponseTime;
          } else if (alert.title.includes('Error Rate')) {
            shouldResolve = metrics.achievementChecks.errorRate <= this.thresholds.errorRate;
          }
          break;
        case 'database':
          shouldResolve = metrics.database.connectionPoolUtilization <= this.thresholds.connectionPoolUtilization;
          break;
        case 'cache':
          shouldResolve = metrics.cache.hitRate >= this.thresholds.cacheHitRate;
          break;
      }

      if (shouldResolve) {
        alert.resolved = true;
        return true;
      }

      return false;
    });

    if (resolvedAlerts.length > 0) {
      this.io.emit('alerts_resolved', resolvedAlerts.map(a => a.id));
    }
  }

  private async getMetricsHistory(req: express.Request, res: express.Response): Promise<void> {
    const limit = parseInt(req.query.limit as string) || 100;
    const history = this.metricsHistory.slice(-limit);
    res.json(history);
  }

  private async getAlerts(req: express.Request, res: express.Response): Promise<void> {
    const showResolved = req.query.resolved === 'true';
    const alerts = showResolved ? this.alerts : this.alerts.filter(a => !a.resolved);
    res.json(alerts);
  }

  private async resolveAlert(req: express.Request, res: express.Response): Promise<void> {
    const alertId = req.params.id;
    const alert = this.alerts.find(a => a.id === alertId);

    if (alert) {
      alert.resolved = true;
      this.io.emit('alert_resolved', alertId);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Alert not found' });
    }
  }

  private async getHealthStatus(req: express.Request, res: express.Response): Promise<void> {
    const recentMetrics = this.metricsHistory.slice(-10);
    const activeAlerts = this.alerts.filter(a => !a.resolved);

    const health = {
      status: activeAlerts.some(a => a.level === 'critical') ? 'critical' :
              activeAlerts.some(a => a.level === 'error') ? 'error' :
              activeAlerts.some(a => a.level === 'warning') ? 'warning' : 'healthy',
      uptime: process.uptime(),
      alerts: activeAlerts.length,
      metricsCollected: this.metricsHistory.length,
      lastUpdate: recentMetrics.length > 0 ? recentMetrics[recentMetrics.length - 1].timestamp : null
    };

    res.json(health);
  }

  // Track cache operations
  trackCacheHit(): void { this.cacheOperations.hits++; }
  trackCacheMiss(): void { this.cacheOperations.misses++; }
  trackCacheSet(): void { this.cacheOperations.sets++; }
  trackCacheDelete(): void { this.cacheOperations.deletes++; }

  private generateDashboardHTML(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PIPTip Achievement Performance Dashboard</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.0.0/socket.io.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }
        .dashboard {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .metric-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .metric-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 15px;
            color: #333;
        }
        .metric-value {
            font-size: 32px;
            font-weight: 700;
            margin-bottom: 5px;
        }
        .metric-value.good { color: #22c55e; }
        .metric-value.warning { color: #f59e0b; }
        .metric-value.error { color: #ef4444; }
        .metric-unit {
            font-size: 14px;
            color: #666;
        }
        .chart-container {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            height: 400px;
        }
        .alerts-panel {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .alert {
            padding: 12px;
            margin-bottom: 10px;
            border-radius: 6px;
            border-left: 4px solid;
        }
        .alert.info { border-color: #3b82f6; background: #eff6ff; }
        .alert.warning { border-color: #f59e0b; background: #fffbeb; }
        .alert.error { border-color: #ef4444; background: #fef2f2; }
        .alert.critical { border-color: #dc2626; background: #fef2f2; }
        .status-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
        }
        .status-healthy { background: #22c55e; }
        .status-warning { background: #f59e0b; }
        .status-error { background: #ef4444; }
        .status-critical { background: #dc2626; }
        .last-updated {
            color: #666;
            font-size: 14px;
            text-align: center;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>🏆 PIPTip Achievement Performance Dashboard</h1>
            <p>Real-time monitoring for dynamic achievement system</p>
            <div id="system-status">
                <span class="status-indicator status-healthy"></span>
                <span>System Status: <span id="status-text">Initializing...</span></span>
            </div>
        </div>

        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-title">Achievement Checks/sec</div>
                <div class="metric-value good" id="checks-per-sec">--</div>
                <div class="metric-unit">requests per second</div>
            </div>
            <div class="metric-card">
                <div class="metric-title">Response Time</div>
                <div class="metric-value" id="response-time">--</div>
                <div class="metric-unit">milliseconds (avg)</div>
            </div>
            <div class="metric-card">
                <div class="metric-title">Error Rate</div>
                <div class="metric-value" id="error-rate">--</div>
                <div class="metric-unit">percentage</div>
            </div>
            <div class="metric-card">
                <div class="metric-title">Cache Hit Rate</div>
                <div class="metric-value" id="cache-hit-rate">--</div>
                <div class="metric-unit">percentage</div>
            </div>
            <div class="metric-card">
                <div class="metric-title">DB Pool Usage</div>
                <div class="metric-value" id="pool-usage">--</div>
                <div class="metric-unit">percentage</div>
            </div>
            <div class="metric-card">
                <div class="metric-title">Progress Records</div>
                <div class="metric-value good" id="progress-count">--</div>
                <div class="metric-unit">total records</div>
            </div>
        </div>

        <div class="chart-container">
            <canvas id="performance-chart"></canvas>
        </div>

        <div class="alerts-panel">
            <h3>🚨 Active Alerts</h3>
            <div id="alerts-container">
                <p>No active alerts</p>
            </div>
        </div>

        <div class="last-updated" id="last-updated">
            Last updated: Never
        </div>
    </div>

    <script>
        const socket = io();
        let performanceChart;
        const chartData = {
            labels: [],
            datasets: [{
                label: 'Response Time (ms)',
                data: [],
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.1
            }, {
                label: 'Error Rate (%)',
                data: [],
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                tension: 0.1,
                yAxisID: 'y1'
            }]
        };

        // Initialize chart
        const ctx = document.getElementById('performance-chart').getContext('2d');
        performanceChart = new Chart(ctx, {
            type: 'line',
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: 'Response Time (ms)' }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: 'Error Rate (%)' },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });

        // Update metrics display
        function updateMetrics(metrics) {
            document.getElementById('checks-per-sec').textContent = metrics.achievementChecks.totalPerSecond.toFixed(1);

            const responseTime = metrics.achievementChecks.averageResponseTime;
            const responseTimeEl = document.getElementById('response-time');
            responseTimeEl.textContent = responseTime.toFixed(1);
            responseTimeEl.className = 'metric-value ' + (responseTime > 100 ? 'error' : responseTime > 50 ? 'warning' : 'good');

            const errorRate = metrics.achievementChecks.errorRate;
            const errorRateEl = document.getElementById('error-rate');
            errorRateEl.textContent = errorRate.toFixed(1) + '%';
            errorRateEl.className = 'metric-value ' + (errorRate > 5 ? 'error' : errorRate > 2 ? 'warning' : 'good');

            const cacheHitRate = metrics.cache.hitRate;
            const cacheHitRateEl = document.getElementById('cache-hit-rate');
            cacheHitRateEl.textContent = cacheHitRate.toFixed(1) + '%';
            cacheHitRateEl.className = 'metric-value ' + (cacheHitRate < 70 ? 'warning' : 'good');

            const poolUsage = metrics.database.connectionPoolUtilization;
            const poolUsageEl = document.getElementById('pool-usage');
            poolUsageEl.textContent = poolUsage.toFixed(1) + '%';
            poolUsageEl.className = 'metric-value ' + (poolUsage > 80 ? 'error' : poolUsage > 60 ? 'warning' : 'good');

            document.getElementById('progress-count').textContent = metrics.tables.userAchievementProgress.rowCount.toLocaleString();

            // Update chart
            const time = new Date(metrics.timestamp).toLocaleTimeString();
            chartData.labels.push(time);
            chartData.datasets[0].data.push(responseTime);
            chartData.datasets[1].data.push(errorRate);

            // Keep only last 50 points
            if (chartData.labels.length > 50) {
                chartData.labels.shift();
                chartData.datasets[0].data.shift();
                chartData.datasets[1].data.shift();
            }

            performanceChart.update('none');

            document.getElementById('last-updated').textContent = 'Last updated: ' + new Date().toLocaleTimeString();
        }

        // Update alerts display
        function updateAlerts(alerts) {
            const container = document.getElementById('alerts-container');

            if (!alerts || alerts.length === 0) {
                container.innerHTML = '<p>No active alerts</p>';
                return;
            }

            container.innerHTML = alerts.map(alert =>
                '<div class="alert ' + alert.level + '">' +
                '<strong>' + alert.title + '</strong><br>' +
                alert.message +
                (alert.threshold ? ' (Current: ' + alert.currentValue.toFixed(1) + ', Threshold: ' + alert.threshold + ')' : '') +
                '</div>'
            ).join('');
        }

        // Socket event handlers
        socket.on('metrics', updateMetrics);
        socket.on('alerts', updateAlerts);

        socket.on('connect', () => {
            document.getElementById('status-text').textContent = 'Connected';
        });

        socket.on('disconnect', () => {
            document.getElementById('status-text').textContent = 'Disconnected';
            document.querySelector('#system-status .status-indicator').className = 'status-indicator status-error';
        });

        console.log('🚀 Performance dashboard initialized');
    </script>
</body>
</html>`;
  }
}

// CLI interface
if (require.main === module) {
  const port = parseInt(process.env.DASHBOARD_PORT || '3001');
  const monitor = new PerformanceMonitor(port);

  monitor.start()
    .then(() => {
      console.log(`✅ Performance dashboard started on http://localhost:${port}`);
      console.log('Press Ctrl+C to stop...');
    })
    .catch(error => {
      console.error('❌ Failed to start performance dashboard:', error);
      process.exit(1);
    });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🔄 Shutting down dashboard...');
    await monitor.stop();
    process.exit(0);
  });
}

export { PerformanceMonitor, type PerformanceMetrics, type Alert };