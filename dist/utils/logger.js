import pino from "pino";
import { customAlphabet } from "nanoid";
import { AsyncLocalStorage } from "async_hooks";
const nanoid = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 12);
const createCorrelationId = () => `req_${nanoid()}`;
const correlationStore = new AsyncLocalStorage();
const logger = pino({
  name: "piptip-bot",
  level: process.env.LOG_LEVEL || "info",
  // Pretty print in development only
  transport: process.env.NODE_ENV === "development" ? {
    target: "pino-pretty",
    options: {
      colorize: true,
      ignore: "pid,hostname",
      translateTime: "SYS:standard",
      messageFormat: "{correlationId} {context} {msg}"
    }
  } : void 0,
  // Production formatters
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      host: bindings.hostname,
      service: "piptip-bot",
      version: process.env.npm_package_version || "unknown",
      environment: process.env.NODE_ENV || "development"
    })
  },
  // Redact sensitive information automatically
  redact: {
    paths: [
      // Auth & API keys
      "password",
      "token",
      "authorization",
      "api_key",
      "secret",
      "privateKey",
      "accessToken",
      "refreshToken",
      "sessionSecret",
      "jwtSecret",
      // Discord specific
      "discordToken",
      "botToken",
      "clientSecret",
      // Database & Redis
      "databaseUrl",
      "DATABASE_URL",
      "redisUrl",
      "REDIS_PASSWORD",
      // Headers
      "req.headers.authorization",
      'req.headers["x-api-key"]',
      "req.headers.cookie",
      // Nested sensitive fields
      "*.password",
      "*.token",
      "*.secret",
      "config.*.password",
      "config.*.token",
      "payload.*.password",
      "data.*.token"
    ],
    censor: "[REDACTED]",
    remove: true
    // Remove completely instead of censoring
  },
  // ISO timestamp
  timestamp: pino.stdTimeFunctions.isoTime,
  // Custom serializers for complex objects
  serializers: {
    error: pino.stdSerializers.err,
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      userId: req.userId,
      userAgent: req.get?.("user-agent"),
      ip: req.ip,
      correlationId: req.correlationId
    }),
    res: (res) => ({
      statusCode: res.statusCode,
      duration: res.responseTime || res.duration,
      headers: {
        "content-type": res.get?.("content-type"),
        "content-length": res.get?.("content-length")
      }
    }),
    interaction: (interaction) => ({
      id: interaction.id,
      type: interaction.type,
      commandName: interaction.commandName,
      userId: interaction.user?.id,
      username: interaction.user?.username,
      guildId: interaction.guildId,
      channelId: interaction.channelId
    }),
    job: (job) => ({
      id: job.id,
      name: job.name,
      queue: job.queueName,
      attempts: job.attemptsMade,
      delay: job.delay,
      timestamp: job.timestamp
    }),
    market: (market) => ({
      id: market.id,
      title: market.title,
      status: market.status,
      createdAt: market.createdAt,
      resolvedAt: market.resolvedAt,
      outcome: market.outcome
    }),
    balance: (balance) => ({
      userId: balance.userId,
      tokenId: balance.tokenId,
      amount: balance.amount,
      lastUpdated: balance.lastUpdated
    })
  },
  // Base context that's always included
  base: {
    service: "piptip-bot",
    deployment: process.env.RAILWAY_DEPLOYMENT_ID || "local",
    commit: process.env.RAILWAY_GIT_COMMIT_SHA?.substring(0, 7) || "unknown"
  }
});
const createLogger = (context, metadata) => {
  const store = correlationStore.getStore();
  return logger.child({
    context,
    correlationId: store?.correlationId || createCorrelationId(),
    userId: store?.userId || metadata?.userId,
    guildId: store?.guildId || metadata?.guildId,
    ...metadata
  });
};
const withCorrelation = (correlationId, metadata = {}, fn) => {
  return correlationStore.run({ correlationId, ...metadata }, fn);
};
const correlationMiddleware = (req, res, next) => {
  const correlationId = req.headers["x-correlation-id"] || createCorrelationId();
  req.correlationId = correlationId;
  res.setHeader("x-correlation-id", correlationId);
  withCorrelation(correlationId, { userId: req.userId }, () => {
    next();
  });
};
class PerfTimer {
  startTime;
  logger;
  constructor(logger2, operation) {
    this.logger = logger2.child({ operation });
    this.startTime = Date.now();
    this.logger.debug("Operation started");
  }
  end(metadata) {
    const duration = Date.now() - this.startTime;
    this.logger.info({ duration, ...metadata }, "Operation completed");
    return duration;
  }
  endWithError(error, metadata) {
    const duration = Date.now() - this.startTime;
    this.logger.error({ error, duration, ...metadata }, "Operation failed");
    return duration;
  }
}
const logDatabaseQuery = (operation) => {
  const log = createLogger("database");
  const timer = new PerfTimer(log, operation);
  return {
    success: (metadata) => timer.end(metadata),
    error: (error, metadata) => timer.endWithError(error, metadata)
  };
};
const logJobProcessing = (jobName, jobId) => {
  const log = createLogger("job-processor", { jobName, jobId });
  const timer = new PerfTimer(log, `process-${jobName}`);
  return {
    success: (result) => timer.end({ result }),
    error: (error) => timer.endWithError(error),
    logger: log
  };
};
const logDiscordInteraction = (interaction) => {
  const correlationId = `int_${interaction.id}`;
  const log = createLogger("discord-interaction", {
    interactionId: interaction.id,
    commandName: interaction.commandName,
    userId: interaction.user?.id,
    guildId: interaction.guildId
  });
  return {
    info: (message, metadata) => log.info({ interaction, ...metadata }, message),
    error: (message, error, metadata) => log.error({ interaction, error, ...metadata }, message),
    debug: (message, metadata) => log.debug({ interaction, ...metadata }, message),
    timer: () => new PerfTimer(log, `interaction-${interaction.commandName}`)
  };
};
const logMarketOperation = (operation, marketId) => {
  const log = createLogger("market-operation", { operation, marketId });
  const timer = new PerfTimer(log, operation);
  return {
    success: (result) => timer.end({ marketId, result }),
    error: (error, metadata) => timer.endWithError(error, { marketId, ...metadata }),
    logger: log
  };
};
const logFinancialOperation = (operation, userId, amount) => {
  const log = createLogger("financial-operation", {
    operation,
    userId: userId.substring(0, 8) + "***",
    // Partial masking for privacy
    hasAmount: !!amount
  });
  return {
    start: () => log.info({ operation }, "Financial operation started"),
    success: (metadata) => log.info({ operation, ...metadata }, "Financial operation completed"),
    error: (error, metadata) => log.error({ operation, error, ...metadata }, "Financial operation failed")
  };
};
const logSystemHealth = () => {
  const log = createLogger("system-health");
  return {
    startup: () => log.info("System starting up"),
    ready: () => log.info("System ready to accept requests"),
    shutdown: () => log.info("System shutting down gracefully"),
    error: (error, component) => log.error({ error, component }, "System component error"),
    metric: (name, value, unit) => log.info({ metric: name, value, unit }, "System metric")
  };
};
const logQueueHealth = (queueName) => {
  const log = createLogger("queue-health", { queue: queueName });
  return {
    status: (stats) => log.info({ queueName, stats }, "Queue status"),
    stalled: (jobId) => log.warn({ queueName, jobId }, "Job stalled"),
    failed: (jobId, error) => log.error({ queueName, jobId, error }, "Job failed")
  };
};
var logger_default = logger;
console.log("\u{1F680} Structured logging initialized with Pino");
export {
  PerfTimer,
  correlationMiddleware,
  correlationStore,
  createCorrelationId,
  createLogger,
  logger_default as default,
  logDatabaseQuery,
  logDiscordInteraction,
  logFinancialOperation,
  logJobProcessing,
  logMarketOperation,
  logQueueHealth,
  logSystemHealth,
  logger,
  withCorrelation
};
//# sourceMappingURL=logger.js.map
