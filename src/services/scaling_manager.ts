// Horizontal Scaling Manager - Million User Architecture 🚀
import cluster from 'cluster';
import os from 'os';
import { enhancedRedisCache } from './redis_enhanced';
import { EventEmitter } from 'events';

interface NodeHealth {
  nodeId: string;
  cpuUsage: number;
  memoryUsage: number;
  activeConnections: number;
  requestsPerSecond: number;
  uptime: number;
  healthy: boolean;
}

interface LoadBalancingStrategy {
  algorithm: 'round_robin' | 'least_connections' | 'cpu_based' | 'weighted';
  nodes: string[];
  weights?: Record<string, number>;
}

interface ScalingConfig {
  minNodes: number;
  maxNodes: number;
  cpuThreshold: number;
  memoryThreshold: number;
  connectionThreshold: number;
  scaleUpCooldown: number;
  scaleDownCooldown: number;
  healthCheckInterval: number;
}

class HorizontalScalingManager extends EventEmitter {
  private config: ScalingConfig;
  private nodeHealth: Map<string, NodeHealth> = new Map();
  private lastScaleAction: number = 0;
  private healthCheckTimer?: NodeJS.Timeout;
  private loadBalancer: LoadBalancer;

  constructor() {
    super();

    this.config = {
      minNodes: parseInt(process.env.MIN_NODES || '2'),
      maxNodes: parseInt(process.env.MAX_NODES || '16'),
      cpuThreshold: parseFloat(process.env.CPU_THRESHOLD || '80'),
      memoryThreshold: parseFloat(process.env.MEMORY_THRESHOLD || '85'),
      connectionThreshold: parseInt(process.env.CONNECTION_THRESHOLD || '1000'),
      scaleUpCooldown: parseInt(process.env.SCALE_UP_COOLDOWN || '300000'), // 5 minutes
      scaleDownCooldown: parseInt(process.env.SCALE_DOWN_COOLDOWN || '600000'), // 10 minutes
      healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000') // 30 seconds
    };

    this.loadBalancer = new LoadBalancer();
    this.initializeScalingManager();
  }

  // ============================================================================
  // INITIALIZATION AND CLUSTER MANAGEMENT
  // ============================================================================

  private initializeScalingManager(): void {
    if (cluster.isPrimary) {
      this.setupMasterProcess();
    } else {
      this.setupWorkerProcess();
    }

    console.log(`🚀 Scaling Manager initialized (${cluster.isPrimary ? 'Master' : 'Worker'} process)`);
  }

  /**
   * Setup master process for cluster management
   */
  private setupMasterProcess(): void {
    console.log(`🎯 Master process ${process.pid} started`);

    // Start initial worker processes
    const initialWorkers = Math.max(this.config.minNodes, os.cpus().length);
    for (let i = 0; i < initialWorkers; i++) {
      this.forkWorker();
    }

    // Handle worker exits
    cluster.on('exit', (worker, code, signal) => {
      console.log(`⚠️ Worker ${worker.process.pid} died (${signal || code})`);

      if (!worker.exitedAfterDisconnect) {
        console.log('🔄 Replacing dead worker');
        this.forkWorker();
      }
    });

    // Start health monitoring
    this.startHealthMonitoring();

    // Handle graceful shutdown
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());
  }

  /**
   * Setup worker process
   */
  private setupWorkerProcess(): void {
    const workerId = `worker_${cluster.worker?.id}_${process.pid}`;

    // Initialize worker health tracking
    this.initializeWorkerHealth(workerId);

    // Report health metrics periodically
    setInterval(() => {
      this.reportWorkerHealth(workerId);
    }, this.config.healthCheckInterval / 2);

    console.log(`👷 Worker ${workerId} started`);
  }

  /**
   * Fork new worker with proper configuration
   */
  private forkWorker(): void {
    const worker = cluster.fork({
      ...process.env,
      WORKER_ID: `worker_${Date.now()}`,
      NODE_ENV: process.env.NODE_ENV || 'production'
    });

    worker.on('message', (message) => {
      this.handleWorkerMessage(worker, message);
    });

    return worker;
  }

  // ============================================================================
  // HEALTH MONITORING AND METRICS
  // ============================================================================

  /**
   * Start health monitoring for all nodes
   */
  private startHealthMonitoring(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
      this.evaluateScalingNeeds();
    }, this.config.healthCheckInterval);

    console.log(`📊 Health monitoring started (interval: ${this.config.healthCheckInterval}ms)`);
  }

  /**
   * Perform health checks on all nodes
   */
  private async performHealthChecks(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [nodeId, health] of this.nodeHealth.entries()) {
      promises.push(this.checkNodeHealth(nodeId));
    }

    await Promise.allSettled(promises);

    // Emit health status event
    this.emit('health_update', {
      totalNodes: this.nodeHealth.size,
      healthyNodes: Array.from(this.nodeHealth.values()).filter(h => h.healthy).length,
      avgCpuUsage: this.getAverageMetric('cpuUsage'),
      avgMemoryUsage: this.getAverageMetric('memoryUsage'),
      totalConnections: this.getTotalConnections()
    });
  }

  /**
   * Check individual node health
   */
  private async checkNodeHealth(nodeId: string): Promise<void> {
    try {
      const health = this.nodeHealth.get(nodeId);
      if (!health) return;

      // Update health status based on thresholds
      const isHealthy =
        health.cpuUsage < this.config.cpuThreshold &&
        health.memoryUsage < this.config.memoryThreshold &&
        health.activeConnections < this.config.connectionThreshold;

      health.healthy = isHealthy;
      health.uptime = process.uptime();

      this.nodeHealth.set(nodeId, health);

      // Log unhealthy nodes
      if (!isHealthy) {
        console.warn(`🚨 Unhealthy node detected: ${nodeId} (CPU: ${health.cpuUsage}%, Mem: ${health.memoryUsage}%, Conn: ${health.activeConnections})`);
      }

    } catch (error) {
      console.error(`❌ Health check failed for node ${nodeId}:`, error);

      // Mark node as unhealthy
      const health = this.nodeHealth.get(nodeId);
      if (health) {
        health.healthy = false;
        this.nodeHealth.set(nodeId, health);
      }
    }
  }

  /**
   * Initialize worker health tracking
   */
  private initializeWorkerHealth(workerId: string): void {
    this.nodeHealth.set(workerId, {
      nodeId: workerId,
      cpuUsage: 0,
      memoryUsage: 0,
      activeConnections: 0,
      requestsPerSecond: 0,
      uptime: 0,
      healthy: true
    });
  }

  /**
   * Report worker health metrics to master
   */
  private reportWorkerHealth(workerId: string): void {
    if (!cluster.isPrimary && process.send) {
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      const health: Partial<NodeHealth> = {
        nodeId: workerId,
        memoryUsage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
        // CPU usage calculation would need more sophisticated tracking
        cpuUsage: Math.random() * 30 + 10, // Mock for now
        activeConnections: this.getActiveConnections(),
        uptime: process.uptime()
      };

      process.send({
        type: 'health_report',
        data: health
      });
    }
  }

  /**
   * Handle messages from worker processes
   */
  private handleWorkerMessage(worker: cluster.Worker, message: any): void {
    if (message.type === 'health_report' && message.data) {
      const health = message.data as Partial<NodeHealth>;
      const existing = this.nodeHealth.get(health.nodeId!) || {} as NodeHealth;

      this.nodeHealth.set(health.nodeId!, {
        ...existing,
        ...health,
        healthy: this.isNodeHealthy(health as NodeHealth)
      });
    }
  }

  // ============================================================================
  // AUTO-SCALING LOGIC
  // ============================================================================

  /**
   * Evaluate if scaling up or down is needed
   */
  private evaluateScalingNeeds(): void {
    const now = Date.now();

    // Respect cooldown periods
    if (now - this.lastScaleAction < Math.min(this.config.scaleUpCooldown, this.config.scaleDownCooldown)) {
      return;
    }

    const healthyNodes = Array.from(this.nodeHealth.values()).filter(h => h.healthy);
    const currentNodes = healthyNodes.length;

    const avgCpuUsage = this.getAverageMetric('cpuUsage');
    const avgMemoryUsage = this.getAverageMetric('memoryUsage');
    const totalConnections = this.getTotalConnections();

    // Scale up conditions
    const shouldScaleUp =
      currentNodes < this.config.maxNodes && (
        avgCpuUsage > this.config.cpuThreshold ||
        avgMemoryUsage > this.config.memoryThreshold ||
        (totalConnections / currentNodes) > this.config.connectionThreshold
      );

    // Scale down conditions
    const shouldScaleDown =
      currentNodes > this.config.minNodes &&
      avgCpuUsage < this.config.cpuThreshold * 0.5 &&
      avgMemoryUsage < this.config.memoryThreshold * 0.5 &&
      now - this.lastScaleAction > this.config.scaleDownCooldown;

    if (shouldScaleUp) {
      this.scaleUp();
    } else if (shouldScaleDown) {
      this.scaleDown();
    }
  }

  /**
   * Scale up by adding new worker nodes
   */
  private scaleUp(): void {
    const currentNodes = Object.keys(cluster.workers || {}).length;
    const targetNodes = Math.min(currentNodes + 1, this.config.maxNodes);

    if (targetNodes > currentNodes) {
      console.log(`📈 Scaling up: ${currentNodes} → ${targetNodes} nodes`);

      for (let i = currentNodes; i < targetNodes; i++) {
        this.forkWorker();
      }

      this.lastScaleAction = Date.now();
      this.emit('scale_up', { from: currentNodes, to: targetNodes });
    }
  }

  /**
   * Scale down by gracefully removing worker nodes
   */
  private scaleDown(): void {
    const workers = Object.values(cluster.workers || {});
    const currentNodes = workers.length;
    const targetNodes = Math.max(currentNodes - 1, this.config.minNodes);

    if (targetNodes < currentNodes && workers.length > 0) {
      console.log(`📉 Scaling down: ${currentNodes} → ${targetNodes} nodes`);

      // Choose worker with least connections to remove
      const workerToRemove = this.selectWorkerForRemoval();

      if (workerToRemove) {
        workerToRemove.disconnect();

        setTimeout(() => {
          if (!workerToRemove.isDead()) {
            workerToRemove.kill();
          }
        }, 30000); // 30 second graceful shutdown timeout
      }

      this.lastScaleAction = Date.now();
      this.emit('scale_down', { from: currentNodes, to: targetNodes });
    }
  }

  /**
   * Select worker with least load for removal
   */
  private selectWorkerForRemoval(): cluster.Worker | null {
    const workers = Object.values(cluster.workers || {});
    let leastLoadedWorker: cluster.Worker | null = null;
    let minConnections = Infinity;

    for (const worker of workers) {
      const workerId = `worker_${worker.id}_${worker.process.pid}`;
      const health = this.nodeHealth.get(workerId);

      if (health && health.activeConnections < minConnections) {
        minConnections = health.activeConnections;
        leastLoadedWorker = worker;
      }
    }

    return leastLoadedWorker;
  }

  // ============================================================================
  // LOAD BALANCING
  // ============================================================================

  /**
   * Get next available node for request routing
   */
  getNextNode(strategy: LoadBalancingStrategy['algorithm'] = 'least_connections'): string | null {
    return this.loadBalancer.getNextNode(
      Array.from(this.nodeHealth.values()).filter(h => h.healthy),
      strategy
    );
  }

  // ============================================================================
  // METRICS AND UTILITIES
  // ============================================================================

  private getAverageMetric(metric: keyof NodeHealth): number {
    const healthyNodes = Array.from(this.nodeHealth.values()).filter(h => h.healthy);
    if (healthyNodes.length === 0) return 0;

    const total = healthyNodes.reduce((sum, node) => sum + (node[metric] as number), 0);
    return total / healthyNodes.length;
  }

  private getTotalConnections(): number {
    return Array.from(this.nodeHealth.values())
      .filter(h => h.healthy)
      .reduce((sum, node) => sum + node.activeConnections, 0);
  }

  private getActiveConnections(): number {
    // Mock implementation - in real app, track actual connections
    return Math.floor(Math.random() * 500) + 100;
  }

  private isNodeHealthy(health: NodeHealth): boolean {
    return health.cpuUsage < this.config.cpuThreshold &&
           health.memoryUsage < this.config.memoryThreshold &&
           health.activeConnections < this.config.connectionThreshold;
  }

  /**
   * Get scaling statistics
   */
  getScalingStats(): {
    currentNodes: number;
    healthyNodes: number;
    cpuUsage: number;
    memoryUsage: number;
    connections: number;
    uptime: number;
  } {
    const healthyNodes = Array.from(this.nodeHealth.values()).filter(h => h.healthy);

    return {
      currentNodes: this.nodeHealth.size,
      healthyNodes: healthyNodes.length,
      cpuUsage: this.getAverageMetric('cpuUsage'),
      memoryUsage: this.getAverageMetric('memoryUsage'),
      connections: this.getTotalConnections(),
      uptime: process.uptime()
    };
  }

  /**
   * Gracefully shutdown all nodes
   */
  private async gracefulShutdown(): Promise<void> {
    console.log('🔄 Initiating graceful shutdown...');

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    if (cluster.isPrimary) {
      // Disconnect all workers
      for (const worker of Object.values(cluster.workers || {})) {
        worker.disconnect();
      }

      // Wait for workers to exit gracefully
      await new Promise(resolve => {
        let activeWorkers = Object.keys(cluster.workers || {}).length;

        if (activeWorkers === 0) {
          resolve(void 0);
          return;
        }

        cluster.on('exit', () => {
          activeWorkers--;
          if (activeWorkers === 0) {
            resolve(void 0);
          }
        });

        // Force kill after timeout
        setTimeout(() => {
          console.log('⚠️ Force killing remaining workers');
          for (const worker of Object.values(cluster.workers || {})) {
            worker.kill();
          }
          resolve(void 0);
        }, 30000);
      });
    }

    console.log('✅ Graceful shutdown complete');
    process.exit(0);
  }
}

// ============================================================================
// LOAD BALANCER
// ============================================================================

class LoadBalancer {
  private roundRobinIndex = 0;

  getNextNode(healthyNodes: NodeHealth[], algorithm: LoadBalancingStrategy['algorithm']): string | null {
    if (healthyNodes.length === 0) return null;

    switch (algorithm) {
      case 'round_robin':
        return this.roundRobin(healthyNodes);
      case 'least_connections':
        return this.leastConnections(healthyNodes);
      case 'cpu_based':
        return this.cpuBased(healthyNodes);
      case 'weighted':
        return this.weighted(healthyNodes);
      default:
        return this.roundRobin(healthyNodes);
    }
  }

  private roundRobin(nodes: NodeHealth[]): string {
    const node = nodes[this.roundRobinIndex % nodes.length];
    this.roundRobinIndex++;
    return node.nodeId;
  }

  private leastConnections(nodes: NodeHealth[]): string {
    return nodes.reduce((min, node) =>
      node.activeConnections < min.activeConnections ? node : min
    ).nodeId;
  }

  private cpuBased(nodes: NodeHealth[]): string {
    return nodes.reduce((min, node) =>
      node.cpuUsage < min.cpuUsage ? node : min
    ).nodeId;
  }

  private weighted(nodes: NodeHealth[]): string {
    // Simple weighted selection based on inverse CPU usage
    const totalWeight = nodes.reduce((sum, node) => sum + (100 - node.cpuUsage), 0);
    let random = Math.random() * totalWeight;

    for (const node of nodes) {
      random -= (100 - node.cpuUsage);
      if (random <= 0) {
        return node.nodeId;
      }
    }

    return nodes[0].nodeId; // Fallback
  }
}

// Export singleton
export const scalingManager = new HorizontalScalingManager();

// Convenience functions
export const getNextNode = (strategy?: LoadBalancingStrategy['algorithm']) =>
  scalingManager.getNextNode(strategy);

export const getScalingStats = () => scalingManager.getScalingStats();

export default scalingManager;