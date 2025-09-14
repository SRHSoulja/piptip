// src/services/notifications.ts - Achievement notification system
import type { Client, User } from "discord.js";
import { EmbedBuilder } from "discord.js";

// Queue for achievement notifications
interface AchievementNotification {
  discordId: string;
  achievements: string[];
  context?: string; // e.g., "tip", "deposit", "match"
}

const notificationQueue: AchievementNotification[] = [];
let isProcessing = false;

// Secure client storage using dependency injection
let discordClient: Client | null = null;

// Add achievement notifications to queue
export function queueAchievementNotifications(discordId: string, achievements: string[], context?: string) {
  if (achievements.length === 0) return;

  // Check if user already has pending notifications
  const existingIndex = notificationQueue.findIndex(n => n.discordId === discordId);

  if (existingIndex !== -1) {
    // Merge with existing notification
    notificationQueue[existingIndex].achievements.push(...achievements);
  } else {
    // Add new notification
    notificationQueue.push({ discordId, achievements, context });
  }

  // Start processing if not already running
  if (!isProcessing) {
    processNotificationQueue();
  }
}

// Process the notification queue
async function processNotificationQueue() {
  if (isProcessing || notificationQueue.length === 0) return;

  isProcessing = true;

  while (notificationQueue.length > 0) {
    const notification = notificationQueue.shift();
    if (!notification) break;

    try {
      await sendAchievementNotification(notification);

      // Small delay between notifications to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error("Error sending achievement notification:", error);
    }
  }

  isProcessing = false;
}

// Send achievement notification to user
async function sendAchievementNotification(notification: AchievementNotification) {
  try {
    // Use the injected Discord client
    if (!discordClient || !discordClient.user) {
      console.error("Discord client not available for achievement notifications");
      return;
    }

    const client = discordClient;

    const user = await client.users.fetch(notification.discordId).catch(() => null);
    if (!user) {
      console.error(`Could not fetch user ${notification.discordId} for achievement notification`);
      return;
    }

    // Create achievement notification embed
    const embed = new EmbedBuilder()
      .setTitle("🎉 Achievement Unlocked!")
      .setColor(0xFFD700) // Gold
      .setThumbnail(user.displayAvatarURL())
      .setTimestamp();

    // Format achievements
    const achievementText = notification.achievements
      .map(achievement => `🏆 ${achievement}`)
      .join("\n");

    embed.setDescription(achievementText);

    // Add context-specific footer
    if (notification.context) {
      const contextText = getContextText(notification.context);
      embed.setFooter({ text: contextText });
    }

    // Try to send as DM first, fallback to not sending if DMs are disabled
    try {
      await user.send({ embeds: [embed] });
      console.log(`Achievement notification sent to ${user.username}: ${notification.achievements.join(", ")}`);
    } catch (dmError) {
      // User has DMs disabled or blocked the bot - that's ok, just log it
      console.log(`Could not DM achievement notification to ${user.username} (DMs disabled)`);
    }

  } catch (error) {
    console.error("Error in sendAchievementNotification:", error);
  }
}

// Get context-specific footer text
function getContextText(context: string): string {
  switch (context) {
    case "tip":
      return "Keep tipping to unlock more achievements! 💰";
    case "deposit":
      return "Thanks for funding your account! 🏦";
    case "match":
      return "Great match! Keep playing to unlock more! 🎮";
    case "referral":
      return "Thanks for spreading the word! 👥";
    default:
      return "Keep using PIPtip to unlock more achievements! 🚀";
  }
}

// Initialize the notification system (call this when the bot starts)
export function initializeNotificationSystem(client: Client) {
  // Store client securely via dependency injection
  discordClient = client;

  console.log("Achievement notification system initialized");
}

// Get the current Discord client (for testing/debugging)
export function getDiscordClient(): Client | null {
  return discordClient;
}

// Get pending notification count for a user (useful for debugging)
export function getPendingNotificationCount(discordId: string): number {
  const notification = notificationQueue.find(n => n.discordId === discordId);
  return notification ? notification.achievements.length : 0;
}

// Clear all pending notifications for a user (useful for testing)
export function clearPendingNotifications(discordId: string) {
  const index = notificationQueue.findIndex(n => n.discordId === discordId);
  if (index !== -1) {
    notificationQueue.splice(index, 1);
  }
}