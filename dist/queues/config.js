import { Queue } from "bullmq";
import { Redis } from "ioredis";
const redisConfig = {
  port: parseInt(process.env.REDIS_PORT || "6379"),
  host: process.env.REDIS_HOST || "localhost",
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || "0"),
  // Connection pooling and reliability
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  enableOfflineQueue: false,
  lazyConnect: true,
  // Connection pool settings
  family: 4,
  keepAlive: 3e4,
  maxLoadingTimeout: 1e4,
  // Reconnection strategy
  reconnectOnError: (err) => {
    const targetError = "READONLY";
    return err.message.includes(targetError);
  }
};
const redis = new Redis(redisConfig);
import { logSystemHealth, logQueueHealth } from "../utils/logger.js";
const systemHealth = logSystemHealth();
redis.on("connect", () => {
  systemHealth.startup();
});
redis.on("error", (error) => {
  systemHealth.error(error, "redis-connection");
});
redis.on("ready", () => {
  systemHealth.ready();
});
redis.on("reconnecting", () => {
  systemHealth.startup();
});
async function checkRedisHealth() {
  try {
    await redis.ping();
    return true;
  } catch (error) {
    systemHealth.error(error, "redis-health-check");
    return false;
  }
}
const queueConfig = {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 100,
    // Keep last 100 completed jobs
    removeOnFail: 50,
    // Keep last 50 failed jobs
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2e3
    }
  }
};
const marketResolutionQueue = new Queue("market-resolution", {
  ...queueConfig,
  defaultJobOptions: {
    ...queueConfig.defaultJobOptions,
    attempts: 3,
    delay: 0,
    // Process immediately
    priority: 1
    // Highest priority
  }
});
const payoutQueue = new Queue("payouts", {
  ...queueConfig,
  defaultJobOptions: {
    ...queueConfig.defaultJobOptions,
    attempts: 5,
    delay: 0,
    priority: 2
  }
});
const reconciliationQueue = new Queue("reconciliation", {
  ...queueConfig,
  defaultJobOptions: {
    ...queueConfig.defaultJobOptions,
    attempts: 2,
    delay: 0,
    priority: 3
  }
});
const discordOutboxQueue = new Queue("discord-outbox", {
  ...queueConfig,
  defaultJobOptions: {
    ...queueConfig.defaultJobOptions,
    attempts: 10,
    delay: 0,
    priority: 4
  }
});
const deadLetterQueue = new Queue("dead-letter", {
  ...queueConfig,
  defaultJobOptions: {
    ...queueConfig.defaultJobOptions,
    attempts: 1,
    delay: 0,
    priority: 5,
    // Lowest priority
    removeOnComplete: false,
    // Keep for audit
    removeOnFail: false
  }
});
async function closeQueues() {
  systemHealth.shutdown();
  await Promise.all([
    marketResolutionQueue.close(),
    payoutQueue.close(),
    reconciliationQueue.close(),
    discordOutboxQueue.close(),
    deadLetterQueue.close()
    // Note: QueueScheduler removed in BullMQ v5+
    // Schedulers are handled automatically by Workers now
  ]);
  await redis.quit();
  systemHealth.shutdown();
}
async function getQueueHealth() {
  const queues = {
    "market-resolution": marketResolutionQueue,
    "payouts": payoutQueue,
    "reconciliation": reconciliationQueue,
    "discord-outbox": discordOutboxQueue,
    "dead-letter": deadLetterQueue
  };
  const health = {};
  for (const [name, queue] of Object.entries(queues)) {
    try {
      const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed()
      ]);
      health[name] = {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        healthy: true
      };
    } catch (error) {
      health[name] = {
        healthy: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  return {
    redis: await checkRedisHealth(),
    queues: health,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function initializeQueueMonitoring() {
  const queues = [marketResolutionQueue, payoutQueue, reconciliationQueue, discordOutboxQueue, deadLetterQueue];
  queues.forEach((queue) => {
    const queueHealth = logQueueHealth(queue.name);
    queue.on("error", (error) => {
      queueHealth.failed("unknown", error);
    });
  });
}
systemHealth.ready();
export {
  checkRedisHealth,
  closeQueues,
  deadLetterQueue,
  discordOutboxQueue,
  getQueueHealth,
  initializeQueueMonitoring,
  marketResolutionQueue,
  payoutQueue,
  reconciliationQueue,
  redis
};
//# sourceMappingURL=config.js.map
