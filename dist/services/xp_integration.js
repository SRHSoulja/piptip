import { awardXP, XP_SOURCES } from "./penguin_levels.js";
import { createPenguinSuccess } from "../utils/penguin_messages.js";
async function awardMatchXP(discordId, result) {
  let xpAmount = 0;
  let source = "";
  switch (result) {
    case "win":
      xpAmount = XP_SOURCES.MATCH_WIN;
      source = "Match Victory";
      break;
    case "loss":
      xpAmount = XP_SOURCES.MATCH_LOSS;
      source = "Match Participation";
      break;
    case "tie":
      xpAmount = XP_SOURCES.MATCH_TIE;
      source = "Match Tie";
      break;
  }
  const xpResult = await awardXP(discordId, xpAmount, source);
  let message = "";
  if (xpResult.levelUp && xpResult.newLevel) {
    message = createPenguinSuccess(
      "\u{1F389} LEVEL UP! \u{1F389}",
      `Congratulations! You've reached **${xpResult.newLevel.title}** (Level ${xpResult.newLevel.level})!

${xpResult.newLevel.unlockMessage}

**New Benefits:**
${xpResult.newLevel.benefits.map((b) => `\u2022 ${b}`).join("\n")}`,
      { personality: "excited", emoji: xpResult.newLevel.emoji }
    );
  } else if (xpAmount > 0) {
    const resultEmojis = {
      win: "\u{1F3C6}",
      loss: "\u{1F427}",
      tie: "\u{1F91D}"
    };
    message = `${resultEmojis[result]} **+${xpAmount} XP** from ${source.toLowerCase()}!`;
  }
  return {
    xpAwarded: xpAmount,
    levelUp: xpResult.levelUp,
    newLevel: xpResult.newLevel,
    message
  };
}
async function awardTipXP(fromDiscordId, toDiscordId, isGroupTip = false) {
  const messages = [];
  const senderXpAmount = isGroupTip ? XP_SOURCES.GROUP_TIP_CREATE : XP_SOURCES.TIP_SENT;
  const senderResult = await awardXP(
    fromDiscordId,
    senderXpAmount,
    isGroupTip ? "Group Tip Creation" : "Tip Sent"
  );
  if (senderResult.levelUp && senderResult.newLevel) {
    messages.push(createPenguinSuccess(
      "\u{1F389} LEVEL UP! \u{1F389}",
      `Your generosity has been rewarded! You've reached **${senderResult.newLevel.title}**!
${senderResult.newLevel.unlockMessage}`,
      { personality: "excited", emoji: senderResult.newLevel.emoji }
    ));
  } else {
    messages.push(`\u{1F41F} **+${senderXpAmount} XP** for sharing fish with the colony!`);
  }
  let receiverXP = 0;
  let receiverLevelUp = false;
  if (toDiscordId && !isGroupTip) {
    const receiverResult = await awardXP(toDiscordId, XP_SOURCES.TIP_RECEIVED, "Tip Received");
    receiverXP = XP_SOURCES.TIP_RECEIVED;
    receiverLevelUp = receiverResult.levelUp || false;
    if (receiverResult.levelUp && receiverResult.newLevel) {
      messages.push(`\u{1F381} The recipient also leveled up to **${receiverResult.newLevel.title}**!`);
    }
  }
  return {
    senderXP: senderXpAmount,
    receiverXP,
    senderLevelUp: senderResult.levelUp || false,
    receiverLevelUp,
    messages
  };
}
async function awardGroupTipClaimXP(discordId) {
  const xpResult = await awardXP(discordId, XP_SOURCES.GROUP_TIP_CLAIM, "Group Tip Claim");
  let message = "";
  if (xpResult.levelUp && xpResult.newLevel) {
    message = createPenguinSuccess(
      "\u{1F389} LEVEL UP! \u{1F389}",
      `Claiming fish has helped you grow! You've reached **${xpResult.newLevel.title}**!
${xpResult.newLevel.unlockMessage}`,
      { personality: "excited", emoji: xpResult.newLevel.emoji }
    );
  } else {
    message = `\u{1F3A3} **+${XP_SOURCES.GROUP_TIP_CLAIM} XP** for claiming colony fish!`;
  }
  return {
    xpAwarded: XP_SOURCES.GROUP_TIP_CLAIM,
    levelUp: xpResult.levelUp,
    newLevel: xpResult.newLevel,
    message
  };
}
async function awardXPForGroupTipContribution(discordId) {
  const xpResult = await awardXP(discordId, XP_SOURCES.GROUP_TIP_CONTRIBUTE, "Group Tip Contribution");
  let message = "";
  if (xpResult.levelUp && xpResult.newLevel) {
    message = createPenguinSuccess(
      "\u{1F389} LEVEL UP! \u{1F389}",
      `Contributing to the colony has helped you grow! You've reached **${xpResult.newLevel.title}**!
${xpResult.newLevel.unlockMessage}`,
      { personality: "excited", emoji: xpResult.newLevel.emoji }
    );
  } else {
    message = `\u{1F41F} **+${XP_SOURCES.GROUP_TIP_CONTRIBUTE} XP** for adding fish to the colony!`;
  }
  return {
    xpAwarded: XP_SOURCES.GROUP_TIP_CONTRIBUTE,
    levelUp: xpResult.levelUp,
    newLevel: xpResult.newLevel,
    message
  };
}
async function awardXPForGroupTipClaim(discordId) {
  const xpResult = await awardXP(discordId, XP_SOURCES.GROUP_TIP_CLAIM, "Group Tip Claim");
  let message = "";
  if (xpResult.levelUp && xpResult.newLevel) {
    message = createPenguinSuccess(
      "\u{1F3A3} LEVEL UP FROM COLONY FISH! \u{1F3A3}",
      `Your claim earned you a LEVEL UP! You've reached **${xpResult.newLevel.title}**!
${xpResult.newLevel.unlockMessage}`,
      { personality: "excited", emoji: xpResult.newLevel.emoji }
    );
  } else {
    message = `\u{1F3A3} **+${XP_SOURCES.GROUP_TIP_CLAIM} XP** for claiming colony fish!`;
  }
  return {
    xpAwarded: XP_SOURCES.GROUP_TIP_CLAIM,
    levelUp: xpResult.levelUp,
    newLevel: xpResult.newLevel,
    message
  };
}
async function awardAchievementXP(discordId, achievementName) {
  const xpResult = await awardXP(discordId, XP_SOURCES.ACHIEVEMENT_UNLOCK, `Achievement: ${achievementName}`);
  let message = "";
  if (xpResult.levelUp && xpResult.newLevel) {
    message = createPenguinSuccess(
      "\u{1F389} DOUBLE CELEBRATION! \u{1F389}",
      `Your achievement earned you a LEVEL UP! You've reached **${xpResult.newLevel.title}**!
${xpResult.newLevel.unlockMessage}`,
      { personality: "excited", emoji: xpResult.newLevel.emoji }
    );
  } else {
    message = `\u{1F3C6} **+${XP_SOURCES.ACHIEVEMENT_UNLOCK} XP** bonus for earning an achievement!`;
  }
  return {
    xpAwarded: XP_SOURCES.ACHIEVEMENT_UNLOCK,
    levelUp: xpResult.levelUp,
    newLevel: xpResult.newLevel,
    message
  };
}
async function awardDepositXP(discordId, amount) {
  const xpResult = await awardXP(discordId, XP_SOURCES.DEPOSIT, "Deposit");
  let message = "";
  if (xpResult.levelUp && xpResult.newLevel) {
    message = createPenguinSuccess(
      "\u{1F389} LEVEL UP! \u{1F389}",
      `Building your fish reserves has paid off! You've reached **${xpResult.newLevel.title}**!
${xpResult.newLevel.unlockMessage}`,
      { personality: "excited", emoji: xpResult.newLevel.emoji }
    );
  } else {
    message = `\u{1F3E6} **+${XP_SOURCES.DEPOSIT} XP** for building your fish reserves!`;
  }
  return {
    xpAwarded: XP_SOURCES.DEPOSIT,
    levelUp: xpResult.levelUp,
    newLevel: xpResult.newLevel,
    message
  };
}
async function awardReferralXP(discordId, referredUser) {
  const xpResult = await awardXP(discordId, XP_SOURCES.REFERRAL, `Referral: ${referredUser}`);
  let message = "";
  if (xpResult.levelUp && xpResult.newLevel) {
    message = createPenguinSuccess(
      "\u{1F389} LEVEL UP! \u{1F389}",
      `Growing the colony has earned you a promotion! You've reached **${xpResult.newLevel.title}**!
${xpResult.newLevel.unlockMessage}`,
      { personality: "excited", emoji: xpResult.newLevel.emoji }
    );
  } else {
    message = `\u{1F465} **+${XP_SOURCES.REFERRAL} XP** for bringing ${referredUser} to the colony!`;
  }
  return {
    xpAwarded: XP_SOURCES.REFERRAL,
    levelUp: xpResult.levelUp,
    newLevel: xpResult.newLevel,
    message
  };
}
async function awardDailyLoginXP(discordId) {
  const xpResult = await awardXP(discordId, XP_SOURCES.DAILY_LOGIN, "Daily Login");
  let message = "";
  if (xpResult.levelUp && xpResult.newLevel) {
    message = createPenguinSuccess(
      "\u{1F389} LEVEL UP! \u{1F389}",
      `Your daily dedication has paid off! You've reached **${xpResult.newLevel.title}**!
${xpResult.newLevel.unlockMessage}`,
      { personality: "excited", emoji: xpResult.newLevel.emoji }
    );
  } else {
    message = `\u{1F305} **+${XP_SOURCES.DAILY_LOGIN} XP** for visiting the colony today!`;
  }
  return {
    xpAwarded: XP_SOURCES.DAILY_LOGIN,
    levelUp: xpResult.levelUp,
    newLevel: xpResult.newLevel,
    message
  };
}
export {
  awardAchievementXP,
  awardDailyLoginXP,
  awardDepositXP,
  awardGroupTipClaimXP,
  awardMatchXP,
  awardReferralXP,
  awardTipXP,
  awardXPForGroupTipClaim,
  awardXPForGroupTipContribution
};
//# sourceMappingURL=xp_integration.js.map
