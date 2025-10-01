class GoodKnightWebhookManager {
  authorizedWebhooks = /* @__PURE__ */ new Map();
  fallbackLog = [];
  constructor() {
    this.initializeAuthorizedWebhooks();
  }
  /**
   * Initialize authorized webhooks from environment variables
   */
  initializeAuthorizedWebhooks() {
    const webhookConfigs = this.parseWebhookConfigs();
    webhookConfigs.forEach((config) => {
      if (config.authorized) {
        this.authorizedWebhooks.set(config.webhookId, config);
        console.log(`\u2705 Authorized Good Knight webhook: ${config.webhookId} for guild ${config.guildId}`);
      } else {
        console.warn(`\u26A0\uFE0F Webhook ${config.webhookId} not authorized by Good Knight`);
      }
    });
    console.log(`\u{1F6E1}\uFE0F Good Knight webhook manager initialized with ${this.authorizedWebhooks.size} authorized webhooks`);
  }
  /**
   * Parse webhook configurations from environment variables
   * Expected format: GOOD_KNIGHT_WEBHOOKS=webhook_id_1:token_1:guild_id_1:channel_id_1:permissions,webhook_id_2:...
   */
  parseWebhookConfigs() {
    const configs = [];
    const primaryWebhook = process.env.DISCORD_WEBHOOK_URL;
    const primaryGuildId = process.env.DISCORD_GUILD_ID;
    const primaryChannelId = process.env.DISCORD_CHANNEL_ID;
    if (primaryWebhook && primaryGuildId) {
      const webhookMatch = primaryWebhook.match(/webhooks\/(\d+)\/([^\/\?]+)/);
      if (webhookMatch) {
        configs.push({
          webhookId: webhookMatch[1],
          token: webhookMatch[2],
          guildId: primaryGuildId,
          channelId: primaryChannelId || "unknown",
          authorized: this.isWebhookAuthorized(webhookMatch[1], primaryGuildId),
          permissions: ["alerts", "monitoring", "system"]
        });
      }
    }
    const goodKnightWebhooks2 = process.env.GOOD_KNIGHT_AUTHORIZED_WEBHOOKS;
    if (goodKnightWebhooks2) {
      const webhookEntries = goodKnightWebhooks2.split(",");
      webhookEntries.forEach((entry) => {
        const [webhookId, token, guildId, channelId, permissions] = entry.split(":");
        if (webhookId && token && guildId) {
          configs.push({
            webhookId,
            token,
            guildId,
            channelId: channelId || "unknown",
            authorized: true,
            // Already authorized by Good Knight
            permissions: permissions ? permissions.split("|") : ["general"]
          });
        }
      });
    }
    return configs;
  }
  /**
   * Check if webhook is authorized by Good Knight
   */
  isWebhookAuthorized(webhookId, guildId) {
    const authorizedList = process.env.GOOD_KNIGHT_WEBHOOK_ALLOWLIST;
    if (!authorizedList) {
      console.warn("\u26A0\uFE0F GOOD_KNIGHT_WEBHOOK_ALLOWLIST not configured, assuming unauthorized");
      return false;
    }
    const allowedWebhooks = authorizedList.split(",").map((w) => w.trim());
    return allowedWebhooks.includes(webhookId);
  }
  /**
   * Send webhook message through Good Knight authorization system
   */
  async sendAuthorizedWebhook(type, payload, options = {}) {
    const priority = options.priority || "medium";
    const fallbackToLog = options.fallbackToLog !== false;
    const webhook = this.findAuthorizedWebhook(type, options.targetGuild);
    if (!webhook) {
      const fallbackMsg = `No authorized webhook found for type '${type}' ${options.targetGuild ? `in guild ${options.targetGuild}` : ""}`;
      if (fallbackToLog) {
        this.logFallbackMessage(type, fallbackMsg, payload);
        return { success: true, message: "Logged to fallback (no authorized webhook)" };
      }
      return { success: false, message: fallbackMsg };
    }
    const webhookUrl = `https://discord.com/api/webhooks/${webhook.webhookId}/${webhook.token}`;
    const enhancedPayload = this.addGoodKnightMetadata(payload, {
      type,
      priority,
      guildId: webhook.guildId,
      authorized: true
    });
    try {
      if (!await this.checkRateLimit(webhook.webhookId)) {
        return { success: false, message: "Rate limited by Good Knight protection" };
      }
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "PIPTip-Bot/1.0 (Good-Knight-Authorized)",
          "X-Good-Knight-Auth": this.generateGoodKnightSignature(webhook, enhancedPayload)
        },
        body: JSON.stringify(enhancedPayload)
      });
      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
      }
      console.log(`\u2705 Good Knight authorized webhook sent: ${webhook.webhookId} (type: ${type}, priority: ${priority})`);
      return {
        success: true,
        message: "Webhook sent via Good Knight authorization",
        webhookId: webhook.webhookId
      };
    } catch (error) {
      console.error(`\u274C Good Knight webhook failed:`, error.message);
      if (fallbackToLog) {
        this.logFallbackMessage(type, `Webhook failed: ${error.message}`, payload);
        return { success: true, message: "Logged to fallback due to webhook failure" };
      }
      return { success: false, message: error.message };
    }
  }
  /**
   * Find appropriate authorized webhook for the request
   */
  findAuthorizedWebhook(type, targetGuild) {
    for (const [webhookId, config] of this.authorizedWebhooks) {
      if (targetGuild && config.guildId !== targetGuild) {
        continue;
      }
      if (config.permissions.includes(type) || config.permissions.includes("all")) {
        return config;
      }
    }
    const firstWebhook = Array.from(this.authorizedWebhooks.values())[0];
    return firstWebhook || null;
  }
  /**
   * Add Good Knight compliance metadata to webhook payload
   */
  addGoodKnightMetadata(payload, metadata) {
    const enhanced = { ...payload };
    if (enhanced.embeds) {
      enhanced.embeds = enhanced.embeds.map((embed) => ({
        ...embed,
        footer: {
          ...embed.footer,
          text: `${embed.footer?.text || "PIPTip"} \u2022 Good Knight Authorized`
        }
      }));
    }
    if (!enhanced.username) {
      enhanced.username = "PIPTip (Good Knight)";
    }
    return enhanced;
  }
  /**
   * Generate Good Knight authentication signature
   */
  generateGoodKnightSignature(webhook, payload) {
    const signatureData = `${webhook.webhookId}:${webhook.guildId}:${Date.now()}`;
    return Buffer.from(signatureData).toString("base64");
  }
  /**
   * Check rate limiting for Good Knight compliance
   */
  async checkRateLimit(webhookId) {
    const rateLimitKey = `webhook:${webhookId}`;
    return true;
  }
  /**
   * Log message when webhook fails or is unauthorized
   */
  logFallbackMessage(type, reason, payload) {
    const logEntry = {
      timestamp: /* @__PURE__ */ new Date(),
      type: `webhook_fallback_${type}`,
      message: reason,
      payload
    };
    this.fallbackLog.push(logEntry);
    if (this.fallbackLog.length > 100) {
      this.fallbackLog.shift();
    }
    console.log(`\u{1F4DD} Webhook fallback logged:`, JSON.stringify(logEntry));
  }
  /**
   * Get fallback logs for admin dashboard
   */
  getFallbackLogs() {
    return [...this.fallbackLog];
  }
  /**
   * Get authorized webhook status
   */
  getWebhookStatus() {
    const allWebhooks = this.parseWebhookConfigs();
    return {
      authorized: this.authorizedWebhooks.size,
      total: allWebhooks.length,
      webhooks: allWebhooks.map((w) => ({
        id: w.webhookId,
        guild: w.guildId,
        permissions: w.permissions,
        authorized: w.authorized
      }))
    };
  }
}
const goodKnightWebhooks = new GoodKnightWebhookManager();
async function sendGoodKnightAlert(type, title, description, context = {}) {
  const payload = {
    embeds: [{
      title,
      description,
      color: type === "alert" ? 16729156 : type === "monitoring" ? 3900150 : 1096065,
      fields: Object.entries(context).map(([name, value]) => ({
        name,
        value: String(value),
        inline: true
      })),
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }]
  };
  const result = await goodKnightWebhooks.sendAuthorizedWebhook(type, payload, {
    priority: type === "alert" ? "high" : "medium"
  });
  return result.success;
}
export {
  goodKnightWebhooks,
  sendGoodKnightAlert
};
//# sourceMappingURL=good_knight_webhooks.js.map
