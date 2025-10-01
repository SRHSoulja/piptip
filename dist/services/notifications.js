import { EmbedBuilder } from "discord.js";
const notificationQueue = [];
let isProcessing = false;
let discordClient = null;
function queueAchievementNotifications(discordId, achievements, context) {
  if (achievements.length === 0) return;
  const existingIndex = notificationQueue.findIndex((n) => n.discordId === discordId);
  if (existingIndex !== -1) {
    notificationQueue[existingIndex].achievements.push(...achievements);
  } else {
    notificationQueue.push({ discordId, achievements, context });
  }
  if (!isProcessing) {
    processNotificationQueue();
  }
}
async function processNotificationQueue() {
  if (isProcessing || notificationQueue.length === 0) return;
  isProcessing = true;
  while (notificationQueue.length > 0) {
    const notification = notificationQueue.shift();
    if (!notification) break;
    try {
      await sendAchievementNotification(notification);
      await new Promise((resolve) => setTimeout(resolve, 1e3));
    } catch (error) {
      console.error("Error sending achievement notification:", error);
    }
  }
  isProcessing = false;
}
async function sendAchievementNotification(notification) {
  try {
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
    const embed = new EmbedBuilder().setTitle("\u{1F389} Achievement Unlocked!").setColor(16766720).setThumbnail(user.displayAvatarURL()).setTimestamp();
    const achievementText = notification.achievements.map((achievement) => `\u{1F3C6} ${achievement}`).join("\n");
    embed.setDescription(achievementText);
    if (notification.context) {
      const contextText = getContextText(notification.context);
      embed.setFooter({ text: contextText });
    }
    try {
      await user.send({ embeds: [embed] });
      console.log(`Achievement notification sent to ${user.username}: ${notification.achievements.join(", ")}`);
    } catch (dmError) {
      console.log(`Could not DM achievement notification to ${user.username} (DMs disabled)`);
    }
  } catch (error) {
    console.error("Error in sendAchievementNotification:", error);
  }
}
function getContextText(context) {
  switch (context) {
    case "tip":
      return "Keep tipping to unlock more achievements! \u{1F4B0}";
    case "deposit":
      return "Thanks for funding your account! \u{1F3E6}";
    case "match":
      return "Great match! Keep playing to unlock more! \u{1F3AE}";
    case "referral":
      return "Thanks for spreading the word! \u{1F465}";
    default:
      return "Keep using PIPtip to unlock more achievements! \u{1F680}";
  }
}
function initializeNotificationSystem(client) {
  discordClient = client;
  console.log("Achievement notification system initialized");
}
function getDiscordClient() {
  return discordClient;
}
function getPendingNotificationCount(discordId) {
  const notification = notificationQueue.find((n) => n.discordId === discordId);
  return notification ? notification.achievements.length : 0;
}
function clearPendingNotifications(discordId) {
  const index = notificationQueue.findIndex((n) => n.discordId === discordId);
  if (index !== -1) {
    notificationQueue.splice(index, 1);
  }
}
export {
  clearPendingNotifications,
  getDiscordClient,
  getPendingNotificationCount,
  initializeNotificationSystem,
  queueAchievementNotifications
};
//# sourceMappingURL=notifications.js.map
