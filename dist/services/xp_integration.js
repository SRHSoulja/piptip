// src/services/xp_integration.ts - Integration layer for XP system with existing features
import { awardXP, XP_SOURCES } from "./penguin_levels.js";
import { createPenguinSuccess } from "../utils/penguin_messages.js";
// Award XP for match results
export async function awardMatchXP(discordId, result) {
    let xpAmount = 0;
    let source = "";
    switch (result) {
        case 'win':
            xpAmount = XP_SOURCES.MATCH_WIN;
            source = "Match Victory";
            break;
        case 'loss':
            xpAmount = XP_SOURCES.MATCH_LOSS;
            source = "Match Participation";
            break;
        case 'tie':
            xpAmount = XP_SOURCES.MATCH_TIE;
            source = "Match Tie";
            break;
    }
    const xpResult = await awardXP(discordId, xpAmount, source);
    let message = "";
    if (xpResult.levelUp && xpResult.newLevel) {
        message = createPenguinSuccess("🎉 LEVEL UP! 🎉", `Congratulations! You've reached **${xpResult.newLevel.title}** (Level ${xpResult.newLevel.level})!\n\n` +
            `${xpResult.newLevel.unlockMessage}\n\n` +
            `**New Benefits:**\n${xpResult.newLevel.benefits.map(b => `• ${b}`).join("\n")}`, { personality: 'excited', emoji: xpResult.newLevel.emoji });
    }
    else if (xpAmount > 0) {
        const resultEmojis = {
            win: "🏆",
            loss: "🐧",
            tie: "🤝"
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
// Award XP for tipping activities
export async function awardTipXP(fromDiscordId, toDiscordId, isGroupTip = false) {
    const messages = [];
    // Award XP to sender
    const senderXpAmount = isGroupTip ? XP_SOURCES.GROUP_TIP_CREATE : XP_SOURCES.TIP_SENT;
    const senderResult = await awardXP(fromDiscordId, senderXpAmount, isGroupTip ? "Group Tip Creation" : "Tip Sent");
    if (senderResult.levelUp && senderResult.newLevel) {
        messages.push(createPenguinSuccess("🎉 LEVEL UP! 🎉", `Your generosity has been rewarded! You've reached **${senderResult.newLevel.title}**!\n${senderResult.newLevel.unlockMessage}`, { personality: 'excited', emoji: senderResult.newLevel.emoji }));
    }
    else {
        messages.push(`🐟 **+${senderXpAmount} XP** for sharing fish with the colony!`);
    }
    // Award XP to receiver (if not group tip)
    let receiverXP = 0;
    let receiverLevelUp = false;
    if (toDiscordId && !isGroupTip) {
        const receiverResult = await awardXP(toDiscordId, XP_SOURCES.TIP_RECEIVED, "Tip Received");
        receiverXP = XP_SOURCES.TIP_RECEIVED;
        receiverLevelUp = receiverResult.levelUp || false;
        if (receiverResult.levelUp && receiverResult.newLevel) {
            messages.push(`🎁 The recipient also leveled up to **${receiverResult.newLevel.title}**!`);
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
// Award XP for group tip claims
export async function awardGroupTipClaimXP(discordId) {
    const xpResult = await awardXP(discordId, XP_SOURCES.GROUP_TIP_CLAIM, "Group Tip Claim");
    let message = "";
    if (xpResult.levelUp && xpResult.newLevel) {
        message = createPenguinSuccess("🎉 LEVEL UP! 🎉", `Claiming fish has helped you grow! You've reached **${xpResult.newLevel.title}**!\n${xpResult.newLevel.unlockMessage}`, { personality: 'excited', emoji: xpResult.newLevel.emoji });
    }
    else {
        message = `🎣 **+${XP_SOURCES.GROUP_TIP_CLAIM} XP** for claiming colony fish!`;
    }
    return {
        xpAwarded: XP_SOURCES.GROUP_TIP_CLAIM,
        levelUp: xpResult.levelUp,
        newLevel: xpResult.newLevel,
        message
    };
}
// Award XP for contributing to group tip
export async function awardXPForGroupTipContribution(discordId) {
    const xpResult = await awardXP(discordId, XP_SOURCES.GROUP_TIP_CONTRIBUTE, "Group Tip Contribution");
    let message = "";
    if (xpResult.levelUp && xpResult.newLevel) {
        message = createPenguinSuccess("🎉 LEVEL UP! 🎉", `Contributing to the colony has helped you grow! You've reached **${xpResult.newLevel.title}**!\n${xpResult.newLevel.unlockMessage}`, { personality: 'excited', emoji: xpResult.newLevel.emoji });
    }
    else {
        message = `🐟 **+${XP_SOURCES.GROUP_TIP_CONTRIBUTE} XP** for adding fish to the colony!`;
    }
    return {
        xpAwarded: XP_SOURCES.GROUP_TIP_CONTRIBUTE,
        levelUp: xpResult.levelUp,
        newLevel: xpResult.newLevel,
        message
    };
}
// Award XP for group tip claims
export async function awardXPForGroupTipClaim(discordId) {
    const xpResult = await awardXP(discordId, XP_SOURCES.GROUP_TIP_CLAIM, "Group Tip Claim");
    let message = "";
    if (xpResult.levelUp && xpResult.newLevel) {
        message = createPenguinSuccess("🎣 LEVEL UP FROM COLONY FISH! 🎣", `Your claim earned you a LEVEL UP! You've reached **${xpResult.newLevel.title}**!\n${xpResult.newLevel.unlockMessage}`, { personality: 'excited', emoji: xpResult.newLevel.emoji });
    }
    else {
        message = `🎣 **+${XP_SOURCES.GROUP_TIP_CLAIM} XP** for claiming colony fish!`;
    }
    return {
        xpAwarded: XP_SOURCES.GROUP_TIP_CLAIM,
        levelUp: xpResult.levelUp,
        newLevel: xpResult.newLevel,
        message
    };
}
// Award XP for achievements
export async function awardAchievementXP(discordId, achievementName) {
    const xpResult = await awardXP(discordId, XP_SOURCES.ACHIEVEMENT_UNLOCK, `Achievement: ${achievementName}`);
    let message = "";
    if (xpResult.levelUp && xpResult.newLevel) {
        message = createPenguinSuccess("🎉 DOUBLE CELEBRATION! 🎉", `Your achievement earned you a LEVEL UP! You've reached **${xpResult.newLevel.title}**!\n${xpResult.newLevel.unlockMessage}`, { personality: 'excited', emoji: xpResult.newLevel.emoji });
    }
    else {
        message = `🏆 **+${XP_SOURCES.ACHIEVEMENT_UNLOCK} XP** bonus for earning an achievement!`;
    }
    return {
        xpAwarded: XP_SOURCES.ACHIEVEMENT_UNLOCK,
        levelUp: xpResult.levelUp,
        newLevel: xpResult.newLevel,
        message
    };
}
// Award XP for deposits
export async function awardDepositXP(discordId, amount) {
    const xpResult = await awardXP(discordId, XP_SOURCES.DEPOSIT, "Deposit");
    let message = "";
    if (xpResult.levelUp && xpResult.newLevel) {
        message = createPenguinSuccess("🎉 LEVEL UP! 🎉", `Building your fish reserves has paid off! You've reached **${xpResult.newLevel.title}**!\n${xpResult.newLevel.unlockMessage}`, { personality: 'excited', emoji: xpResult.newLevel.emoji });
    }
    else {
        message = `🏦 **+${XP_SOURCES.DEPOSIT} XP** for building your fish reserves!`;
    }
    return {
        xpAwarded: XP_SOURCES.DEPOSIT,
        levelUp: xpResult.levelUp,
        newLevel: xpResult.newLevel,
        message
    };
}
// Award XP for referrals
export async function awardReferralXP(discordId, referredUser) {
    const xpResult = await awardXP(discordId, XP_SOURCES.REFERRAL, `Referral: ${referredUser}`);
    let message = "";
    if (xpResult.levelUp && xpResult.newLevel) {
        message = createPenguinSuccess("🎉 LEVEL UP! 🎉", `Growing the colony has earned you a promotion! You've reached **${xpResult.newLevel.title}**!\n${xpResult.newLevel.unlockMessage}`, { personality: 'excited', emoji: xpResult.newLevel.emoji });
    }
    else {
        message = `👥 **+${XP_SOURCES.REFERRAL} XP** for bringing ${referredUser} to the colony!`;
    }
    return {
        xpAwarded: XP_SOURCES.REFERRAL,
        levelUp: xpResult.levelUp,
        newLevel: xpResult.newLevel,
        message
    };
}
// Award daily login XP
export async function awardDailyLoginXP(discordId) {
    const xpResult = await awardXP(discordId, XP_SOURCES.DAILY_LOGIN, "Daily Login");
    let message = "";
    if (xpResult.levelUp && xpResult.newLevel) {
        message = createPenguinSuccess("🎉 LEVEL UP! 🎉", `Your daily dedication has paid off! You've reached **${xpResult.newLevel.title}**!\n${xpResult.newLevel.unlockMessage}`, { personality: 'excited', emoji: xpResult.newLevel.emoji });
    }
    else {
        message = `🌅 **+${XP_SOURCES.DAILY_LOGIN} XP** for visiting the colony today!`;
    }
    return {
        xpAwarded: XP_SOURCES.DAILY_LOGIN,
        levelUp: xpResult.levelUp,
        newLevel: xpResult.newLevel,
        message
    };
}
