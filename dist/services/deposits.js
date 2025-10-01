import { prisma } from "../services/db.js";
import { getTokenByAddress, toAtomicDirect } from "../services/token.js";
import { creditToken } from "../services/balances.js";
const TREASURY = (process.env.TREASURY_AGW_ADDRESS || "").toLowerCase();
async function applyDeposit(input) {
  const from = input.from.toLowerCase();
  const to = input.to.toLowerCase();
  const tok = input.token.toLowerCase();
  const amt = BigInt(input.valueAtomic);
  if (amt <= 0n) return { ok: false, reason: "invalid amount" };
  if (!TREASURY || to !== TREASURY) return { ok: false, reason: "wrong treasury" };
  const tokenRow = await getTokenByAddress(tok);
  if (!tokenRow || !tokenRow.active) return { ok: false, reason: "token not active/known" };
  const key = `${input.tx}:${from}:${amt}`;
  try {
    await prisma.processedDeposit.create({ data: { key } });
  } catch (error) {
    console.log(`Duplicate deposit detected: ${key}`);
    return { ok: true, duplicate: true };
  }
  const minAtomic = toAtomicDirect(String(tokenRow.minDeposit), tokenRow.decimals);
  if (amt < minAtomic) {
    return { ok: true, skipped: `below minimum ${tokenRow.minDeposit} ${tokenRow.symbol}` };
  }
  const user = await prisma.user.findFirst({ where: { agwAddress: from } });
  if (!user) return { ok: true, ignored: "wallet not linked" };
  await creditToken(user.discordId, tokenRow.id, amt, "DEPOSIT", { txHash: input.tx });
  (async () => {
    try {
      const { checkDepositAchievements } = await import("./streaks.js");
      const { queueAchievementNotifications } = await import("./notifications.js");
      const depositAmount = Number(amt) / Math.pow(10, tokenRow.decimals);
      const achievements = await checkDepositAchievements(user.id, depositAmount);
      if (achievements.length > 0) {
        queueAchievementNotifications(user.discordId, achievements, "deposit");
      }
    } catch (error) {
      console.error("Error checking deposit achievements:", error);
    }
  })();
  return { ok: true, credited: true, userId: user.id, token: tokenRow.symbol, amount: amt.toString() };
}
export {
  applyDeposit
};
//# sourceMappingURL=deposits.js.map
