// src/services/penguin_levels.ts - User level and title progression system
import { prisma } from "./db.js";
// Experience point sources (balanced for healthy engagement)
export const XP_SOURCES = {
    MATCH_WIN: 50,
    MATCH_LOSS: 15,
    MATCH_TIE: 25,
    TIP_SENT: 5,
    TIP_RECEIVED: 3,
    DEPOSIT: 10,
    ACHIEVEMENT_UNLOCK: 25, // Reduced from 100 to prevent unhealthy achievement hunting
    DAILY_LOGIN: 20,
    REFERRAL: 200,
    GROUP_TIP_CREATE: 25,
    GROUP_TIP_CLAIM: 15
};
// Daily XP caps for healthy engagement
export const DAILY_XP_CAPS = {
    MATCHES: 500, // Max 10 wins worth of XP per day
    TIPS: 200, // Max 40 tips worth of XP per day
    ACHIEVEMENTS: 100, // Max 4 achievements worth of XP per day
    TOTAL_DAILY: 1000 // Absolute daily maximum
};
// Rate limiting cooldowns (in milliseconds)
export const XP_COOLDOWNS = {
    MATCH: 60000, // 1 minute between match XP awards
    TIP: 30000, // 30 seconds between tip XP awards
    ACHIEVEMENT: 5000 // 5 seconds between achievement XP awards
};
// Penguin level progression table
export const PENGUIN_LEVELS = [
    {
        level: 1,
        title: "Hatchling",
        emoji: "🥚",
        xpRequired: 0,
        xpToNext: 100,
        description: "A brand new penguin just starting their colony journey",
        unlockMessage: "Welcome to the penguin colony! 🐧",
        benefits: ["Basic colony access", "Fish sharing"]
    },
    {
        level: 2,
        title: "Fledgling",
        emoji: "🐣",
        xpRequired: 100,
        xpToNext: 150,
        description: "Learning the ropes of penguin life",
        unlockMessage: "You're growing into a proper penguin! 🐧✨",
        benefits: ["Match participation", "Tip notifications", "+5% XP bonus"]
    },
    {
        level: 3,
        title: "Waddle Walker",
        emoji: "🐧",
        xpRequired: 250,
        xpToNext: 200,
        description: "Mastering the art of the penguin waddle",
        unlockMessage: "Look at you waddle! So graceful! 🐧👟",
        benefits: ["Enhanced achievements", "Profile customization", "+10% XP bonus"]
    },
    {
        level: 4,
        title: "Fish Hunter",
        emoji: "🎣",
        xpRequired: 450,
        xpToNext: 300,
        description: "Skilled at finding and sharing the best fish",
        unlockMessage: "You've become a master fish hunter! 🎣🐟",
        benefits: ["Enhanced match rewards", "Fish sharing bonuses", "+15% XP bonus"]
    },
    {
        level: 5,
        title: "Ice Slider",
        emoji: "🧊",
        xpRequired: 750,
        xpToNext: 400,
        description: "Effortlessly gliding across the ice fields",
        unlockMessage: "Sliding on ice like a true penguin pro! 🧊⚡",
        benefits: ["Streak protection", "Premium match access", "+20% XP bonus"]
    },
    {
        level: 6,
        title: "Colony Guardian",
        emoji: "🛡️",
        xpRequired: 1150,
        xpToNext: 500,
        description: "Protecting and nurturing fellow colony members",
        unlockMessage: "The colony trusts you as their guardian! 🛡️🐧",
        benefits: ["Moderator tools", "Community events", "+25% XP bonus"]
    },
    {
        level: 7,
        title: "Pebble Master",
        emoji: "🪨",
        xpRequired: 1650,
        xpToNext: 650,
        description: "Legendary skill in the ancient art of Penguin-Ice-Pebble",
        unlockMessage: "You've mastered the sacred pebble arts! 🪨👑",
        benefits: ["Advanced match features", "Special events", "+30% XP bonus"]
    },
    {
        level: 8,
        title: "Arctic Veteran",
        emoji: "❄️",
        xpRequired: 2300,
        xpToNext: 800,
        description: "A weathered penguin with vast arctic experience",
        unlockMessage: "Your arctic wisdom is unmatched! ❄️🎖️",
        benefits: ["Veteran status", "Special badges", "+35% XP bonus"]
    },
    {
        level: 9,
        title: "Emperor's Advisor",
        emoji: "👑",
        xpRequired: 3100,
        xpToNext: 1000,
        description: "Trusted counsel to the penguin royalty",
        unlockMessage: "The Emperor recognizes your wisdom! 👑🐧",
        benefits: ["Royal privileges", "Exclusive events", "+40% XP bonus"]
    },
    {
        level: 10,
        title: "Penguin Emperor",
        emoji: "🐧👑",
        xpRequired: 4100,
        xpToNext: 0,
        description: "The ultimate penguin - ruler of the entire colony",
        unlockMessage: "ALL HAIL THE PENGUIN EMPEROR! 🐧👑🎉",
        benefits: ["Maximum prestige", "All features unlocked", "+50% XP bonus"]
    }
];
// Get user's current level and XP
export async function getUserLevel(discordId) {
    try {
        const user = await prisma.user.findUnique({
            where: { discordId },
            select: {
                totalXP: true
            }
        });
        const currentXP = user?.totalXP || 0;
        const currentLevel = calculateLevel(currentXP);
        const nextLevel = PENGUIN_LEVELS[currentLevel.level] || null;
        let xpToNextLevel = 0;
        let progress = 100; // Max level reached
        if (nextLevel) {
            xpToNextLevel = nextLevel.xpRequired - currentXP;
            const levelXPRange = nextLevel.xpRequired - currentLevel.xpRequired;
            const earnedInLevel = currentXP - currentLevel.xpRequired;
            progress = levelXPRange > 0 ? Math.floor((earnedInLevel / levelXPRange) * 100) : 100;
        }
        return {
            currentLevel,
            currentXP,
            xpToNextLevel: Math.max(0, xpToNextLevel),
            progress: Math.max(0, Math.min(100, progress))
        };
    }
    catch (error) {
        console.error("Error getting user level:", error);
        return {
            currentLevel: PENGUIN_LEVELS[0],
            currentXP: 0,
            xpToNextLevel: PENGUIN_LEVELS[1]?.xpRequired || 0,
            progress: 0
        };
    }
}
// Calculate level from total XP
function calculateLevel(totalXP) {
    for (let i = PENGUIN_LEVELS.length - 1; i >= 0; i--) {
        if (totalXP >= PENGUIN_LEVELS[i].xpRequired) {
            return PENGUIN_LEVELS[i];
        }
    }
    return PENGUIN_LEVELS[0]; // Default to level 1
}
// Get XP bonus percentage based on level
function getXPBonus(level) {
    // Level-based XP bonuses from the penguin level benefits
    if (level >= 10)
        return 0.50; // 50% bonus for max level
    if (level >= 9)
        return 0.40; // 40% bonus
    if (level >= 8)
        return 0.35; // 35% bonus
    if (level >= 7)
        return 0.30; // 30% bonus
    if (level >= 6)
        return 0.25; // 25% bonus
    if (level >= 5)
        return 0.20; // 20% bonus
    if (level >= 4)
        return 0.15; // 15% bonus
    if (level >= 3)
        return 0.10; // 10% bonus
    if (level >= 2)
        return 0.05; // 5% bonus
    return 0; // No bonus for level 1
}
// Daily XP tracking cache
const dailyXpCache = new Map();
// Award XP and check for level up - SECURE ATOMIC VERSION WITH DAILY CAPS
export async function awardXP(discordId, xpAmount, source) {
    // Input validation and bounds checking
    if (typeof xpAmount !== 'number' || !Number.isFinite(xpAmount)) {
        throw new Error('Invalid XP amount');
    }
    if (xpAmount < 0 || xpAmount > 10000) {
        throw new Error('XP amount out of bounds (0-10000)');
    }
    if (!source || source.length > 100) {
        throw new Error('Invalid XP source');
    }
    // Check daily XP caps for healthy engagement
    const today = new Date().toISOString().split('T')[0];
    const userDailyKey = `${discordId}:${today}`;
    const dailyData = dailyXpCache.get(userDailyKey) || { date: today, total: 0, byCategory: {} };
    // Determine XP category for cap checking
    const category = getXpCategory(source);
    const categoryXp = dailyData.byCategory[category] || 0;
    const categoryLimit = DAILY_XP_CAPS[category] || DAILY_XP_CAPS.TOTAL_DAILY;
    // Apply caps with gentle enforcement
    let cappedAmount = xpAmount;
    if (categoryXp + xpAmount > categoryLimit) {
        cappedAmount = Math.max(0, categoryLimit - categoryXp);
    }
    if (dailyData.total + cappedAmount > DAILY_XP_CAPS.TOTAL_DAILY) {
        cappedAmount = Math.max(0, DAILY_XP_CAPS.TOTAL_DAILY - dailyData.total);
    }
    // Update daily tracking
    dailyData.total += cappedAmount;
    dailyData.byCategory[category] = (dailyData.byCategory[category] || 0) + cappedAmount;
    dailyXpCache.set(userDailyKey, dailyData);
    // If XP was capped, log for monitoring
    if (cappedAmount < xpAmount) {
        console.log(`XP capped for user ${discordId}: ${xpAmount} -> ${cappedAmount} (${source})`);
    }
    // Skip processing if no XP to award after caps
    if (cappedAmount <= 0) {
        return {
            newXP: 0,
            cappedAmount
        };
    }
    // Use atomic transaction to prevent race conditions
    return await prisma.$transaction(async (tx) => {
        // Find user with FOR UPDATE lock to prevent concurrent modifications
        const user = await tx.user.findUnique({
            where: { discordId },
            select: { id: true, totalXP: true }
        });
        if (!user) {
            throw new Error("User not found");
        }
        const previousXP = user.totalXP || 0;
        const previousLevel = calculateLevel(previousXP);
        // Apply XP bonus based on current level
        const xpBonus = getXPBonus(previousLevel.level);
        const finalXP = Math.floor(cappedAmount * (1 + xpBonus));
        // Check for XP overflow protection
        const newXP = previousXP + finalXP;
        if (newXP > 2147483647) { // Max safe integer
            throw new Error('XP overflow prevented');
        }
        const newLevel = calculateLevel(newXP);
        // Atomic XP update using increment
        await tx.user.update({
            where: { discordId },
            data: { totalXP: { increment: finalXP } }
        });
        // Log XP transaction atomically
        await tx.xpTransaction.create({
            data: {
                userId: user.id,
                amount: finalXP,
                reason: source,
                metadata: JSON.stringify({
                    totalXPAfter: newXP,
                    previousXP,
                    bonus: xpBonus,
                    originalAmount: xpAmount,
                    cappedAmount,
                    timestamp: new Date().toISOString()
                })
            }
        }).catch(() => { }); // Ignore if table doesn't exist
        const levelUp = newLevel.level > previousLevel.level;
        return {
            newXP,
            levelUp,
            newLevel: levelUp ? newLevel : undefined,
            previousLevel: levelUp ? previousLevel : undefined,
            cappedAmount
        };
    });
}
// Helper function to categorize XP sources for daily caps
function getXpCategory(source) {
    if (source.includes('Match') || source.includes('WIN') || source.includes('LOSS')) {
        return 'MATCHES';
    }
    if (source.includes('Tip') || source.includes('TIP')) {
        return 'TIPS';
    }
    if (source.includes('Achievement') || source.includes('ACHIEVEMENT')) {
        return 'ACHIEVEMENTS';
    }
    return 'OTHER';
}
// Clean up daily XP cache periodically
setInterval(() => {
    const today = new Date().toISOString().split('T')[0];
    for (const [key] of dailyXpCache) {
        if (!key.includes(today)) {
            dailyXpCache.delete(key);
        }
    }
}, 3600000); // Clean every hour
// Format level display for embeds
export function formatLevelDisplay(levelInfo) {
    const { currentLevel, currentXP, xpToNextLevel, progress } = levelInfo;
    // Create progress bar
    const progressBar = createLevelProgressBar(progress);
    let display = `${currentLevel.emoji} **${currentLevel.title}** (Level ${currentLevel.level})\n`;
    display += `*${currentLevel.description}*\n\n`;
    display += `🌟 **Total XP:** ${currentXP.toLocaleString()}\n`;
    if (xpToNextLevel > 0) {
        display += `📈 **Next Level:** ${xpToNextLevel.toLocaleString()} XP away\n`;
        display += `${progressBar}`;
    }
    else {
        display += `👑 **MAX LEVEL ACHIEVED!** 🎉\n`;
        display += `🐧👑🐧👑🐧👑🐧👑🐧👑`;
    }
    return display;
}
// Create progress bar for level display
function createLevelProgressBar(progress, length = 10) {
    const filled = Math.floor((progress / 100) * length);
    const empty = length - filled;
    const filledChar = "🐧";
    const emptyChar = "❄️";
    const bar = filledChar.repeat(filled) + emptyChar.repeat(empty);
    return `${bar} ${progress}%`;
}
// Get level-based features/permissions
export function getUserPermissions(level) {
    return {
        hasStreakProtection: level >= 5,
        hasModeratorTools: level >= 6,
        hasAdvancedFeatures: level >= 7,
        hasSpecialEvents: level >= 8,
        xpBonusPercent: getXPBonus(level) * 100
    };
}
