import { outboxService } from "./outbox_service.js";
async function queueMarketResolutionNotification(tx, marketId, marketData) {
  await outboxService.addMessage(tx, {
    aggregateId: marketId,
    aggregateType: "MARKET",
    eventType: "MARKET_RESOLVED",
    channelId: marketData.channelId,
    guildId: marketData.guildId,
    payload: {
      embeds: [{
        title: "\u{1F3AF} Market Resolved!",
        description: `**${marketData.title}**`,
        fields: [
          {
            name: "\u{1F3C6} Winning Outcome",
            value: marketData.outcome,
            inline: true
          },
          {
            name: "\u{1F451} Winners",
            value: marketData.winnerCount.toString(),
            inline: true
          },
          {
            name: "\u{1F4B0} Total Pool",
            value: `${marketData.totalPool} tokens`,
            inline: true
          }
        ],
        color: 65280,
        // Green
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }]
    },
    priority: 2
    // High priority for market events
  });
}
async function queuePayoutNotification(tx, userId, payoutData) {
  await outboxService.addMessage(tx, {
    aggregateId: `payout_${payoutData.marketId}_${userId}`,
    aggregateType: "PAYOUT",
    eventType: "PAYOUT_COMPLETED",
    userId,
    payload: {
      embeds: [{
        title: "\u{1F4B0} Prediction Payout!",
        description: `Congratulations! You won **${payoutData.amount} tokens** from your successful prediction! \u{1F389}`,
        fields: [
          {
            name: "\u{1F4CA} Market",
            value: payoutData.marketTitle || payoutData.marketId,
            inline: false
          },
          {
            name: "\u{1F48E} Amount Won",
            value: `${payoutData.amount} tokens`,
            inline: true
          }
        ],
        color: 16766720,
        // Gold
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        footer: {
          text: "Your balance has been updated automatically"
        }
      }]
    },
    priority: 3
    // Normal priority for individual notifications
  });
}
async function queueSystemAlert(tx, alertData) {
  const severityColors = {
    LOW: 1548984,
    // Blue
    MEDIUM: 16761095,
    // Yellow
    HIGH: 16739125,
    // Orange
    CRITICAL: 14431557
    // Red
  };
  await outboxService.addMessage(tx, {
    aggregateId: `alert_${alertData.type}_${Date.now()}`,
    aggregateType: "SYSTEM",
    eventType: `ALERT_${alertData.type}`,
    channelId: alertData.channelId,
    guildId: alertData.guildId,
    payload: {
      embeds: [{
        title: `\u{1F6A8} System Alert: ${alertData.severity}`,
        description: alertData.message,
        fields: alertData.details ? [
          {
            name: "Details",
            value: JSON.stringify(alertData.details, null, 2).substring(0, 1e3),
            inline: false
          }
        ] : [],
        color: severityColors[alertData.severity],
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        footer: {
          text: `Alert Type: ${alertData.type}`
        }
      }]
    },
    priority: alertData.severity === "CRITICAL" ? 1 : alertData.severity === "HIGH" ? 2 : 4
  });
}
async function queueUserNotification(tx, userId, notification) {
  const typeColors = {
    INFO: 1548984,
    // Blue
    SUCCESS: 2664261,
    // Green
    WARNING: 16761095,
    // Yellow
    ERROR: 14431557
    // Red
  };
  const payload = {
    embeds: [{
      title: `${getTypeEmoji(notification.type)} ${notification.title}`,
      description: notification.message,
      color: typeColors[notification.type],
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }]
  };
  if (notification.actionButton) {
    payload.components = [{
      type: 1,
      // Action Row
      components: [{
        type: 2,
        // Button
        style: getButtonStyle(notification.actionButton.style),
        label: notification.actionButton.label,
        custom_id: notification.actionButton.customId
      }]
    }];
  }
  await outboxService.addMessage(tx, {
    aggregateId: `notification_${userId}_${Date.now()}`,
    aggregateType: "USER",
    eventType: "USER_NOTIFICATION",
    userId,
    payload,
    priority: notification.type === "ERROR" ? 2 : 5
  });
}
async function queueBulkAnnouncement(tx, channelIds, announcement) {
  const messageIds = [];
  for (const channelId of channelIds) {
    const messageId = await outboxService.addMessage(tx, {
      aggregateId: `announcement_${Date.now()}`,
      aggregateType: "SYSTEM",
      eventType: "BULK_ANNOUNCEMENT",
      channelId,
      payload: {
        embeds: [{
          title: `\u{1F4E2} ${announcement.title}`,
          description: announcement.message,
          image: announcement.imageUrl ? { url: announcement.imageUrl } : void 0,
          color: 7506394,
          // Discord blurple
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }]
      },
      priority: 4
      // Lower priority for announcements
    });
    messageIds.push(messageId);
  }
  return messageIds;
}
function getTypeEmoji(type) {
  const emojis = {
    INFO: "\u2139\uFE0F",
    SUCCESS: "\u2705",
    WARNING: "\u26A0\uFE0F",
    ERROR: "\u274C"
  };
  return emojis[type] || "\u2139\uFE0F";
}
function getButtonStyle(style) {
  const styles = {
    PRIMARY: 1,
    SECONDARY: 2,
    SUCCESS: 3,
    DANGER: 4
  };
  return styles[style] || 2;
}
async function getOutboxHealth() {
  const stats = await outboxService.getStats();
  return {
    pendingMessages: stats.messagesByStatus.PENDING || 0,
    failedMessages: (stats.messagesByStatus.FAILED || 0) + (stats.messagesByStatus.DLQ || 0),
    processingStatus: stats
  };
}
console.log("\u{1F680} Outbox helpers loaded for seamless integration");
export {
  getOutboxHealth,
  queueBulkAnnouncement,
  queueMarketResolutionNotification,
  queuePayoutNotification,
  queueSystemAlert,
  queueUserNotification
};
//# sourceMappingURL=outbox_helpers.js.map
