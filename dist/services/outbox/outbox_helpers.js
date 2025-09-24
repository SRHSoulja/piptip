import { outboxService } from './outbox_service.js';
/**
 * Helper to send market resolution notifications via outbox
 */
export async function queueMarketResolutionNotification(tx, marketId, marketData) {
    await outboxService.addMessage(tx, {
        aggregateId: marketId,
        aggregateType: 'MARKET',
        eventType: 'MARKET_RESOLVED',
        channelId: marketData.channelId,
        guildId: marketData.guildId,
        payload: {
            embeds: [{
                    title: '🎯 Market Resolved!',
                    description: `**${marketData.title}**`,
                    fields: [
                        {
                            name: '🏆 Winning Outcome',
                            value: marketData.outcome,
                            inline: true
                        },
                        {
                            name: '👑 Winners',
                            value: marketData.winnerCount.toString(),
                            inline: true
                        },
                        {
                            name: '💰 Total Pool',
                            value: `${marketData.totalPool} tokens`,
                            inline: true
                        }
                    ],
                    color: 0x00ff00, // Green
                    timestamp: new Date().toISOString(),
                }]
        },
        priority: 2, // High priority for market events
    });
}
/**
 * Helper to send payout notifications via outbox
 */
export async function queuePayoutNotification(tx, userId, payoutData) {
    await outboxService.addMessage(tx, {
        aggregateId: `payout_${payoutData.marketId}_${userId}`,
        aggregateType: 'PAYOUT',
        eventType: 'PAYOUT_COMPLETED',
        userId: userId,
        payload: {
            embeds: [{
                    title: '💰 Prediction Payout!',
                    description: `Congratulations! You won **${payoutData.amount} tokens** from your successful prediction! 🎉`,
                    fields: [
                        {
                            name: '📊 Market',
                            value: payoutData.marketTitle || payoutData.marketId,
                            inline: false
                        },
                        {
                            name: '💎 Amount Won',
                            value: `${payoutData.amount} tokens`,
                            inline: true
                        }
                    ],
                    color: 0xffd700, // Gold
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: 'Your balance has been updated automatically'
                    }
                }]
        },
        priority: 3, // Normal priority for individual notifications
    });
}
/**
 * Helper to send system alerts via outbox
 */
export async function queueSystemAlert(tx, alertData) {
    // Determine color based on severity
    const severityColors = {
        LOW: 0x17a2b8, // Blue
        MEDIUM: 0xffc107, // Yellow
        HIGH: 0xff6b35, // Orange
        CRITICAL: 0xdc3545 // Red
    };
    await outboxService.addMessage(tx, {
        aggregateId: `alert_${alertData.type}_${Date.now()}`,
        aggregateType: 'SYSTEM',
        eventType: `ALERT_${alertData.type}`,
        channelId: alertData.channelId,
        guildId: alertData.guildId,
        payload: {
            embeds: [{
                    title: `🚨 System Alert: ${alertData.severity}`,
                    description: alertData.message,
                    fields: alertData.details ? [
                        {
                            name: 'Details',
                            value: JSON.stringify(alertData.details, null, 2).substring(0, 1000),
                            inline: false
                        }
                    ] : [],
                    color: severityColors[alertData.severity],
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: `Alert Type: ${alertData.type}`
                    }
                }]
        },
        priority: alertData.severity === 'CRITICAL' ? 1 : alertData.severity === 'HIGH' ? 2 : 4,
    });
}
/**
 * Helper to send user notifications via outbox
 */
export async function queueUserNotification(tx, userId, notification) {
    // Color mapping for notification types
    const typeColors = {
        INFO: 0x17a2b8, // Blue
        SUCCESS: 0x28a745, // Green
        WARNING: 0xffc107, // Yellow
        ERROR: 0xdc3545 // Red
    };
    const payload = {
        embeds: [{
                title: `${getTypeEmoji(notification.type)} ${notification.title}`,
                description: notification.message,
                color: typeColors[notification.type],
                timestamp: new Date().toISOString(),
            }]
    };
    // Add action button if provided
    if (notification.actionButton) {
        payload.components = [{
                type: 1, // Action Row
                components: [{
                        type: 2, // Button
                        style: getButtonStyle(notification.actionButton.style),
                        label: notification.actionButton.label,
                        custom_id: notification.actionButton.customId,
                    }]
            }];
    }
    await outboxService.addMessage(tx, {
        aggregateId: `notification_${userId}_${Date.now()}`,
        aggregateType: 'USER',
        eventType: 'USER_NOTIFICATION',
        userId: userId,
        payload,
        priority: notification.type === 'ERROR' ? 2 : 5,
    });
}
/**
 * Helper to send bulk announcements via outbox
 */
export async function queueBulkAnnouncement(tx, channelIds, announcement) {
    const messageIds = [];
    for (const channelId of channelIds) {
        const messageId = await outboxService.addMessage(tx, {
            aggregateId: `announcement_${Date.now()}`,
            aggregateType: 'SYSTEM',
            eventType: 'BULK_ANNOUNCEMENT',
            channelId,
            payload: {
                embeds: [{
                        title: `📢 ${announcement.title}`,
                        description: announcement.message,
                        image: announcement.imageUrl ? { url: announcement.imageUrl } : undefined,
                        color: 0x7289da, // Discord blurple
                        timestamp: new Date().toISOString(),
                    }]
            },
            priority: 4, // Lower priority for announcements
        });
        messageIds.push(messageId);
    }
    return messageIds;
}
// Helper function to get emoji for notification types
function getTypeEmoji(type) {
    const emojis = {
        INFO: 'ℹ️',
        SUCCESS: '✅',
        WARNING: '⚠️',
        ERROR: '❌'
    };
    return emojis[type] || 'ℹ️';
}
// Helper function to convert button style to Discord button style number
function getButtonStyle(style) {
    const styles = {
        PRIMARY: 1,
        SECONDARY: 2,
        SUCCESS: 3,
        DANGER: 4
    };
    return styles[style] || 2; // Default to secondary
}
/**
 * Utility to check outbox health
 */
export async function getOutboxHealth() {
    const stats = await outboxService.getStats();
    return {
        pendingMessages: stats.messagesByStatus.PENDING || 0,
        failedMessages: (stats.messagesByStatus.FAILED || 0) + (stats.messagesByStatus.DLQ || 0),
        processingStatus: stats,
    };
}
console.log('🚀 Outbox helpers loaded for seamless integration');
