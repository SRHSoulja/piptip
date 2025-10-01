import { prisma } from "./db.js";
import { findOrCreateUser } from "./user_helpers.js";
import { getConfig } from "../config.js";
import crypto from "crypto";
function generateReferralCode(userId) {
  const timestamp = Date.now().toString(36);
  const userHash = userId.slice(-4);
  const randomBytes = crypto.randomBytes(3);
  const random = randomBytes.toString("base64").replace(/[^a-zA-Z0-9]/g, "").substring(0, 4);
  return `PIP${userHash}${timestamp}${random}`.toUpperCase();
}
async function createReferralCode(discordId) {
  const user = await findOrCreateUser(discordId);
  const existingReferral = await prisma.referral.findFirst({
    where: { referrerId: user.id }
  });
  if (existingReferral) {
    return existingReferral.referralCode;
  }
  let referralCode = generateReferralCode(discordId);
  while (await prisma.referral.findUnique({ where: { referralCode } })) {
    referralCode = generateReferralCode(discordId);
  }
  await prisma.referral.create({
    data: {
      referrerId: user.id,
      referredId: user.id,
      // Self-referral for code generation
      referralCode,
      isVerified: false
    }
  });
  return referralCode;
}
async function processReferralSignup(referralCode, newUserDiscordId) {
  try {
    const referralEntry = await prisma.referral.findUnique({
      where: { referralCode },
      include: { referrer: true }
    });
    if (!referralEntry) {
      return false;
    }
    const newUser = await findOrCreateUser(newUserDiscordId);
    const existingReferral = await prisma.referral.findFirst({
      where: { referredId: newUser.id }
    });
    if (existingReferral) {
      return false;
    }
    await prisma.referral.create({
      data: {
        referrerId: referralEntry.referrerId,
        referredId: newUser.id,
        referralCode,
        isVerified: false,
        totalTipped: 0
      }
    });
    return true;
  } catch (error) {
    console.error("Error processing referral signup:", error);
    return false;
  }
}
async function updateReferralProgress(userDiscordId, tipAmount, tokenId) {
  try {
    const user = await findOrCreateUser(userDiscordId);
    const referral = await prisma.referral.findFirst({
      where: { referredId: user.id, isVerified: false }
    });
    if (!referral) return;
    const config = await getConfig();
    if (!referral.welcomeBonusGranted && Number(config.referralWelcomeBonus) > 0 && tokenId) {
      await grantWelcomeBonus(user.id, tokenId, Number(config.referralWelcomeBonus));
      await prisma.referral.update({
        where: { id: referral.id },
        data: { welcomeBonusGranted: true }
      });
    }
    const newTotal = Number(referral.totalTipped) + tipAmount;
    await prisma.referral.update({
      where: { id: referral.id },
      data: { totalTipped: newTotal }
    });
    if (newTotal >= Number(config.referralVerificationThreshold) && !referral.isVerified) {
      await verifyReferral(referral.id);
    }
  } catch (error) {
    console.error("Error updating referral progress:", error);
  }
}
async function verifyReferral(referralId) {
  await prisma.referral.update({
    where: { id: referralId },
    data: {
      isVerified: true,
      verifiedAt: /* @__PURE__ */ new Date()
    }
  });
  const referral = await prisma.referral.findUnique({
    where: { id: referralId },
    include: { referrer: true }
  });
  if (!referral) return;
  const verifiedCount = await prisma.referral.count({
    where: {
      referrerId: referral.referrerId,
      isVerified: true
    }
  });
  const config = await getConfig();
  const rewardInterval = config.referralRewardInterval;
  if (verifiedCount > 0 && verifiedCount % rewardInterval === 0) {
    await grantTaxFreeWeek(referral.referrerId);
  }
  await createAchievement(referral.referrerId, "referral_count", Math.floor(verifiedCount / 5) + 1);
}
async function grantWelcomeBonus(userId, tokenId, bonusAmount) {
  try {
    await prisma.userBalance.upsert({
      where: {
        userId_tokenId: {
          userId,
          tokenId
        }
      },
      update: {
        amount: {
          increment: bonusAmount
          // Amount is already in correct decimal format
        }
      },
      create: {
        userId,
        tokenId,
        amount: bonusAmount
      }
    });
    console.log(`Granted welcome bonus of ${bonusAmount} tokens (ID: ${tokenId}) to user ${userId}`);
  } catch (error) {
    console.error("Error granting welcome bonus:", error);
  }
}
async function grantTaxFreeWeek(userId) {
  const startDate = /* @__PURE__ */ new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 7);
  const taxFreeTier = await prisma.tier.findFirst({
    where: { tipTaxFree: true, active: true }
  });
  if (!taxFreeTier) {
    console.warn("No tax-free tier found for referral reward");
    return;
  }
  await prisma.tierMembership.create({
    data: {
      userId,
      tierId: taxFreeTier.id,
      startedAt: startDate,
      expiresAt: endDate,
      status: "ACTIVE"
    }
  });
}
async function getReferralStats(discordId) {
  const user = await findOrCreateUser(discordId);
  const [totalReferrals, verifiedReferrals, referralCode] = await Promise.all([
    prisma.referral.count({
      where: { referrerId: user.id, referredId: { not: user.id } }
    }),
    prisma.referral.count({
      where: { referrerId: user.id, isVerified: true, referredId: { not: user.id } }
    }),
    prisma.referral.findFirst({
      where: { referrerId: user.id },
      select: { referralCode: true }
    })
  ]);
  const pendingReferrals = await prisma.referral.findMany({
    where: {
      referrerId: user.id,
      isVerified: false,
      referredId: { not: user.id }
    },
    select: {
      totalTipped: true,
      createdAt: true
    }
  });
  const nextTaxFreeAt = Math.ceil(verifiedReferrals / 10) * 10;
  const referralsUntilTaxFree = nextTaxFreeAt - verifiedReferrals;
  return {
    referralCode: referralCode?.referralCode,
    totalReferrals,
    verifiedReferrals,
    pendingReferrals: pendingReferrals.map((r) => ({
      progress: Number(r.totalTipped),
      needed: 20 - Number(r.totalTipped),
      joinedAt: r.createdAt
    })),
    referralsUntilTaxFree,
    taxFreeWeeksEarned: Math.floor(verifiedReferrals / 10)
  };
}
async function useReferralCode(discordId, code) {
  const user = await findOrCreateUser(discordId);
  const existingReferral = await prisma.referral.findFirst({
    where: { referredId: user.id, isVerified: false }
  });
  if (existingReferral) {
    return { success: false, message: "You have already used a referral code" };
  }
  const referralEntry = await prisma.referral.findFirst({
    where: {
      referralCode: code.toUpperCase(),
      referrer: { discordId: { not: discordId } }
      // Can't refer yourself
    },
    include: { referrer: true }
  });
  if (!referralEntry) {
    return { success: false, message: "Invalid or expired referral code" };
  }
  await prisma.referral.create({
    data: {
      referrerId: referralEntry.referrerId,
      referredId: user.id,
      referralCode: code.toUpperCase(),
      isVerified: false
    }
  });
  return { success: true, message: "Referral code applied successfully!" };
}
async function createAchievement(userId, type, level, data) {
  try {
    await prisma.achievement.create({
      data: {
        userId,
        type,
        level,
        data: data || void 0
      }
    });
  } catch (error) {
    console.log(`Achievement ${type} level ${level} already exists for user ${userId}`);
  }
}
export {
  createReferralCode,
  generateReferralCode,
  getReferralStats,
  processReferralSignup,
  updateReferralProgress,
  useReferralCode
};
//# sourceMappingURL=referrals.js.map
