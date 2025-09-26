// Horizontal Scaling Manager - Million User Architecture 🚀
import cluster from 'cluster';
import os from 'os';
import { EventEmitter } from 'events';
class HorizontalScalingManager extends EventEmitter {
    config;
    nodeHealth = new Map();
    lastScaleAction = 0;
    healthCheckTimer;
    loadBalancer;
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
    initializeScalingManager() {
        if (cluster.isPrimary) {
            this.setupMasterProcess();
        }
        else {
            this.setupWorkerProcess();
        }
        console.log(`🚀 Scaling Manager initialized (${cluster.isPrimary ? 'Master' : 'Worker'} process)`);
    }
    /**
     * Setup master process for cluster management
     */
    setupMasterProcess() {
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
    setupWorkerProcess() {
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
    forkWorker() {
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
    startHealthMonitoring() {
        this.healthCheckTimer = setInterval(() => {
            this.performHealthChecks();
            this.evaluateScalingNeeds();
        }, this.config.healthCheckInterval);
        console.log(`📊 Health monitoring started (interval: ${this.config.healthCheckInterval}ms)`);
    }
    /**
     * Perform health checks on all nodes
     */
    async performHealthChecks() {
        const promises = [];
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
    async checkNodeHealth(nodeId) {
        try {
            const health = this.nodeHealth.get(nodeId);
            if (!health)
                return;
            // Update health status based on thresholds
            const isHealthy = health.cpuUsage < this.config.cpuThreshold &&
                health.memoryUsage < this.config.memoryThreshold &&
                health.activeConnections < this.config.connectionThreshold;
            health.healthy = isHealthy;
            health.uptime = process.uptime();
            this.nodeHealth.set(nodeId, health);
            // Log unhealthy nodes
            if (!isHealthy) {
                console.warn(`🚨 Unhealthy node detected: ${nodeId} (CPU: ${health.cpuUsage}%, Mem: ${health.memoryUsage}%, Conn: ${health.activeConnections})`);
            }
        }
        catch (error) {
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
    initializeWorkerHealth(workerId) {
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
    reportWorkerHealth(workerId) {
        if (!cluster.isPrimary && process.send) {
            const memoryUsage = process.memoryUsage();
            const cpuUsage = process.cpuUsage();
            const health = {
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
    handleWorkerMessage(worker, message) {
        if (message.type === 'health_report' && message.data) {
            const health = message.data;
            const existing = this.nodeHealth.get(health.nodeId) || {};
            this.nodeHealth.set(health.nodeId, {
                ...existing,
                ...health,
                healthy: this.isNodeHealthy(health)
            });
        }
    }
    // ============================================================================
    // AUTO-SCALING LOGIC
    // ============================================================================
    /**
     * Evaluate if scaling up or down is needed
     */
    evaluateScalingNeeds() {
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
        const shouldScaleUp = currentNodes < this.config.maxNodes && (avgCpuUsage > this.config.cpuThreshold ||
            avgMemoryUsage > this.config.memoryThreshold ||
            (totalConnections / currentNodes) > this.config.connectionThreshold);
        // Scale down conditions
        const shouldScaleDown = currentNodes > this.config.minNodes &&
            avgCpuUsage < this.config.cpuThreshold * 0.5 &&
            avgMemoryUsage < this.config.memoryThreshold * 0.5 &&
            now - this.lastScaleAction > this.config.scaleDownCooldown;
        if (shouldScaleUp) {
            this.scaleUp();
        }
        else if (shouldScaleDown) {
            this.scaleDown();
        }
    }
    /**
     * Scale up by adding new worker nodes
     */
    scaleUp() {
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
    scaleDown() {
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
    selectWorkerForRemoval() {
        const workers = Object.values(cluster.workers || {});
        let leastLoadedWorker = null;
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
    getNextNode(strategy = 'least_connections') {
        return this.loadBalancer.getNextNode(Array.from(this.nodeHealth.values()).filter(h => h.healthy), strategy);
    }
    // ============================================================================
    // METRICS AND UTILITIES
    // ============================================================================
    getAverageMetric(metric) {
        const healthyNodes = Array.from(this.nodeHealth.values()).filter(h => h.healthy);
        if (healthyNodes.length === 0)
            return 0;
        const total = healthyNodes.reduce((sum, node) => sum + node[metric], 0);
        return total / healthyNodes.length;
    }
    getTotalConnections() {
        return Array.from(this.nodeHealth.values())
            .filter(h => h.healthy)
            .reduce((sum, node) => sum + node.activeConnections, 0);
    }
    getActiveConnections() {
        // Mock implementation - in real app, track actual connections
        return Math.floor(Math.random() * 500) + 100;
    }
    isNodeHealthy(health) {
        return health.cpuUsage < this.config.cpuThreshold &&
            health.memoryUsage < this.config.memoryThreshold &&
            health.activeConnections < this.config.connectionThreshold;
    }
    /**
     * Get scaling statistics
     */
    getScalingStats() {
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
    async gracefulShutdown() {
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
    roundRobinIndex = 0;
    getNextNode(healthyNodes, algorithm) {
        if (healthyNodes.length === 0)
            return null;
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
    roundRobin(nodes) {
        const node = nodes[this.roundRobinIndex % nodes.length];
        this.roundRobinIndex++;
        return node.nodeId;
    }
    leastConnections(nodes) {
        return nodes.reduce((min, node) => node.activeConnections < min.activeConnections ? node : min).nodeId;
    }
    cpuBased(nodes) {
        return nodes.reduce((min, node) => node.cpuUsage < min.cpuUsage ? node : min).nodeId;
    }
    weighted(nodes) {
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
export const getNextNode = (strategy) => scalingManager.getNextNode(strategy);
export const getScalingStats = () => scalingManager.getScalingStats();
export default scalingManager;
