// src/commands/pip_withdraw.ts
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { prisma } from "../services/db.js";
import { getTokenByAddress, toAtomicDirect, formatAmount, decToBigDirect } from "../services/token.js";
import { debitToken } from "../services/balances.js";
import { getConfig } from "../config.js";
import { ABSTRACT_RPC_URL, AGW_SESSION_PRIVATE_KEY, TREASURY_AGW_ADDRESS } from "../config.js";
// at top
import { MessageFlags, type ChatInputCommandInteraction, type User } from "discord.js";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
];

function startOfUTCDay(d = new Date()) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
const isHexAddress = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);

export default async function pipWithdraw(i: ChatInputCommandInteraction) {
  try {
    const tokenAddress = (i.options.getString("token", true) || "").toLowerCase();
    const amountHuman = i.options.getNumber("amount", true);
    const overrideAddr = (i.options.getString("address") || "").trim();

    // Load token
    const token = await getTokenByAddress(tokenAddress);
    if (!token || !token.active) {
      return i.reply({ content: "Invalid or inactive token selected.", flags: MessageFlags.Ephemeral });
    }

    // Load config (global defaults)
    const cfg = await getConfig();

    // Per-token overrides take precedence; 0 or null means “no cap”
    const maxPerTxHuman =
      token.withdrawMaxPerTx != null
        ? Number(token.withdrawMaxPerTx)
        : Number(cfg?.withdrawMaxPerTx ?? 0);

    const dailyCapHuman =
      token.withdrawDailyCap != null
        ? Number(token.withdrawDailyCap)
        : Number(cfg?.withdrawDailyCap ?? 0);

    const maxLine = maxPerTxHuman > 0 ? `max per tx ${maxPerTxHuman} ${token.symbol}` : "no per-tx max";
    const dailyLine = dailyCapHuman > 0 ? `daily cap ${dailyCapHuman} ${token.symbol}` : "no daily cap";
    const policyLine =
      `⚠️ **Withdraw limits:** min ${token.minWithdraw} ${token.symbol} · ${maxLine} · ${dailyLine}`;

    if (!(amountHuman > 0)) {
      return i.reply({ content: `Amount must be > 0.\n${policyLine}`, flags: MessageFlags.Ephemeral });
    }

    // Min (per token)
    if (amountHuman < Number(token.minWithdraw)) {
      return i.reply({
        content: `Amount is below the minimum: **${token.minWithdraw} ${token.symbol}**.\n${policyLine}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Max per tx
    if (maxPerTxHuman > 0 && amountHuman > maxPerTxHuman) {
      return i.reply({
        content: `Amount exceeds the per-transaction max: **${maxPerTxHuman} ${token.symbol}**.\n${policyLine}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Load user + destination
    const user = await prisma.user.findUnique({ where: { discordId: i.user.id } });
    if (!user) {
      return i.reply({ content: `No profile. Run **/pip_register**.\n${policyLine}`, flags: MessageFlags.Ephemeral });
    }

    const dest = (overrideAddr || user.agwAddress || "").toLowerCase();
    if (!dest || !isHexAddress(dest)) {
      return i.reply({
        content: `No valid destination address. Link a wallet with **/pip_link** or pass a valid \`address\`.\n${policyLine}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Balance check
    const ub = await prisma.userBalance.findUnique({
      where: { userId_tokenId: { userId: user.id, tokenId: token.id } },
    });
    const amtAtomic = toAtomicDirect(amountHuman, token.decimals);
    const userBalAtomic = ub ? decToBigDirect(ub.amount, token.decimals) : 0n;

    if (userBalAtomic < amtAtomic) {
      return i.reply({
        content: `Insufficient balance. You have ${formatAmount(userBalAtomic, token)}.\n${policyLine}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Daily cap (sum WITHDRAW amounts since UTC midnight)
    if (dailyCapHuman > 0) {
      const since = startOfUTCDay();
      const agg = await prisma.transaction.aggregate({
        where: {
          type: "WITHDRAW",
          userId: user.id,
          tokenId: token.id,
          createdAt: { gte: since },
        },
        _sum: { amount: true },
      });
      const alreadyToday = parseFloat(String(agg._sum.amount ?? "0"));
      if (alreadyToday + amountHuman > dailyCapHuman) {
        const remaining = Math.max(0, dailyCapHuman - alreadyToday);
        return i.reply({
          content: `This would exceed your daily cap. Remaining today: **${remaining} ${token.symbol}**.\n${policyLine}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // Ack + proceed
    await i.reply({
      content: `⏳ Submitting withdraw of ${formatAmount(amtAtomic, token)} to \`${dest}\`.\n${policyLine}`,
      flags: MessageFlags.Ephemeral,
    });

    // RPC signer
    const provider = new JsonRpcProvider(ABSTRACT_RPC_URL);
    const signer = new Wallet(AGW_SESSION_PRIVATE_KEY, provider);
    const signerAddr = (await signer.getAddress()).toLowerCase();

    if (signerAddr !== TREASURY_AGW_ADDRESS.toLowerCase()) {
      return i.followUp({
        content: `⚠️ Signer \`${signerAddr}\` != Treasury \`${TREASURY_AGW_ADDRESS}\`. Update \`AGW_SESSION_PRIVATE_KEY\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Treasury balance check + send
    const tokenContract = new Contract(token.address, ERC20_ABI, signer);
    const treasBal: bigint = await tokenContract.balanceOf(signerAddr);
    if (treasBal < amtAtomic) {
      return i.followUp({
        content: `Treasury has insufficient ${token.symbol} for this withdraw. Treasury balance: ${formatAmount(treasBal, token)}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const tx = await tokenContract.transfer(dest, amtAtomic);
      await tx.wait();

      await debitToken(i.user.id, token.id, amtAtomic, "WITHDRAW", {
        guildId: i.guildId,
        txHash: tx.hash,
      });

      return i.followUp({
        content: `✅ Withdraw sent: ${formatAmount(amtAtomic, token)} → \`${dest}\`\nTx: \`${tx.hash}\`\n${policyLine}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (e: any) {
      return i.followUp({
        content: `❌ Withdraw failed: ${e?.reason || e?.message || String(e)}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (e: any) {
    return i
      .reply({ content: `Withdraw errored: ${e?.message || String(e)}`, flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
}
