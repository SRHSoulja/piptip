// src/services/performance.ts - Performance monitoring utilities
class PerformanceMonitor {
    metrics = [];
    timers = new Map();
    maxMetrics = 1000; // Keep last 1000 metrics
    // Start timing an operation
    startTimer(operation) {
        this.timers.set(operation, Date.now());
    }
    // End timing and record metric
    endTimer(operation, metadata) {
        const startTime = this.timers.get(operation);
        if (!startTime) {
            console.warn(`⚠️ No timer found for operation: ${operation}`);
            return 0;
        }
        const duration = Date.now() - startTime;
        this.timers.delete(operation);
        // Record metric
        this.metrics.push({
            operation,
            duration,
            timestamp: new Date(),
            metadata
        });
        // Keep only last N metrics
        if (this.metrics.length > this.maxMetrics) {
            this.metrics = this.metrics.slice(-this.maxMetrics);
        }
        // Log slow operations
        if (duration > 100) {
            console.warn(`⚠️ Slow operation: ${operation} took ${duration}ms`, metadata);
        }
        return duration;
    }
    // Get metrics summary
    getMetricsSummary(operation) {
        const relevantMetrics = operation
            ? this.metrics.filter(m => m.operation === operation)
            : this.metrics;
        if (relevantMetrics.length === 0) {
            return {
                count: 0,
                avgDuration: 0,
                minDuration: 0,
                maxDuration: 0,
                p95Duration: 0,
                lastHour: 0
            };
        }
        const durations = relevantMetrics.map(m => m.duration).sort((a, b) => a - b);
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const lastHourMetrics = relevantMetrics.filter(m => m.timestamp.getTime() > oneHourAgo);
        return {
            count: relevantMetrics.length,
            avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
            minDuration: durations[0],
            maxDuration: durations[durations.length - 1],
            p95Duration: durations[Math.floor(durations.length * 0.95)],
            lastHour: lastHourMetrics.length
        };
    }
    // Get slow operations
    getSlowOperations(thresholdMs = 100) {
        return this.metrics
            .filter(m => m.duration > thresholdMs)
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 10);
    }
    // Clear metrics
    clear() {
        this.metrics = [];
        this.timers.clear();
    }
    // Export metrics for analysis
    exportMetrics() {
        return [...this.metrics];
    }
}
// Singleton instance
const monitor = new PerformanceMonitor();
// Export convenient functions
export function startTimer(operation) {
    monitor.startTimer(operation);
}
export function endTimer(operation, metadata) {
    return monitor.endTimer(operation, metadata);
}
export function getMetricsSummary(operation) {
    return monitor.getMetricsSummary(operation);
}
export function getSlowOperations(thresholdMs) {
    return monitor.getSlowOperations(thresholdMs);
}
// Async operation wrapper with automatic timing
export async function withTiming(operation, fn, metadata) {
    startTimer(operation);
    try {
        const result = await fn();
        endTimer(operation, { ...metadata, success: true });
        return result;
    }
    catch (error) {
        endTimer(operation, { ...metadata, success: false, error: String(error) });
        throw error;
    }
}
// Log performance report periodically
export function startPerformanceReporting(intervalMinutes = 5) {
    return setInterval(() => {
        console.log("\n📊 Performance Report:");
        const operations = [
            'leaderboard_query',
            'achievement_check',
            'profile_load',
            'tip_process',
            'deposit_process'
        ];
        for (const op of operations) {
            const summary = getMetricsSummary(op);
            if (summary.count > 0) {
                console.log(`  ${op}:`);
                console.log(`    Count: ${summary.count} (${summary.lastHour} in last hour)`);
                console.log(`    Avg: ${summary.avgDuration.toFixed(1)}ms`);
                console.log(`    P95: ${summary.p95Duration.toFixed(1)}ms`);
                console.log(`    Max: ${summary.maxDuration}ms`);
            }
        }
        const slowOps = getSlowOperations(200);
        if (slowOps.length > 0) {
            console.log("\n  ⚠️ Slowest operations:");
            for (const op of slowOps.slice(0, 5)) {
                console.log(`    ${op.operation}: ${op.duration}ms`);
            }
        }
        console.log(""); // Empty line for readability
    }, intervalMinutes * 60 * 1000);
}
export default monitor;
