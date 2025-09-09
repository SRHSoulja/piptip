// src/commands/pip_tip.ts
import { MessageFlags, type ChatInputCommandInteraction, type User } from "discord.js";
import { prisma } from "../services/db.js";
import { getTokenByAddress, toAtomicDirect, formatAmount, bigToDecDirect } from "../services/token.js";
import { transferToken, debitToken } from "../services/balances.js";
import { getConfig } from "../config.js";
import { groupTipEmbed } from "../ui/embeds.js";
import { groupTipClaimRow } from "../ui/components.js";
import { scheduleGroupTipExpiry } from "../features/group_tip_expiry.js";

export default async function pipTip(i: ChatInputCommandInteraction) {
  try {
    const tipType = i.options.getString("type") || "direct";
    const tokenAddress = (i.options.getString("token", true) || "").toLowerCase();
    const amount = i.options.getNumber("amount", true);
    const note = i.options.getString("note")?.slice(0, 200) || "";

    if (!(amount > 0)) {
      return i.reply({ content: "Amount must be greater than 0.", flags: MessageFlags.Ephemeral });
    }

    const token = await getTokenByAddress(tokenAddress);
    if (!token || !token.active) {
      return i.reply({ content: "Invalid or inactive token selected.", flags: MessageFlags.Ephemeral });
    }

    const cfg = await getConfig();
    const feeBps = BigInt(token.tipFeeBps ?? cfg?.tipFeeBps ?? 100);
    const atomic = toAtomicDirect(amount, token.decimals);
    const feeAtomic = (atomic * feeBps) / 10000n;

    // ------------------------------- GROUP -------------------------------
    if (tipType === "group") {
      const durationMin = i.options.getInteger("duration") ?? 5;
      if (durationMin < 1 || durationMin > 60) {
        return i.reply({ content: "Duration must be 1–60 minutes.", flags: MessageFlags.Ephemeral });
      }

      // Defer FIRST, before any potentially failing operations
      await i.deferReply({ flags: MessageFlags.Ephemeral });

      // Now charge (after deferring)
      try {
        await debitToken(i.user.id, token.id, atomic + feeAtomic, "TIP", { guildId: i.guildId });
      } catch (err: any) {
        const totalLine = `${formatAmount(atomic, token)} + fee ${formatAmount(feeAtomic, token)} = ${formatAmount(atomic + feeAtomic, token)}`;
        const msg = /insufficient|fund/i.test(err?.message || "")
          ? `You don't have enough ${token.symbol} to cover **${totalLine}**.`
          : `Could not charge your balance: ${err?.message || err}`;
        // Use editReply since we already deferred
        return i.editReply({ content: `❌ ${msg}` });
      }

      const creator = await prisma.user.upsert({
        where: { discordId: i.user.id },
        update: {},
        create: { discordId: i.user.id },
      });

      const expiresAt = new Date(Date.now() + durationMin * 60 * 1000);
      const groupTip = await prisma.groupTip.create({
        data: {
          creatorId: creator.id,
          tokenId: token.id,
          totalAmount: amount.toString(), // human units
          duration: durationMin * 60,
          status: "ACTIVE",
          expiresAt,
          guildId: i.guildId ?? undefined,
        },
      });

      if (feeAtomic > 0n) {
        await prisma.transaction.create({
          data: {
            type: "TIP",
            userId: creator.id,
            tokenId: token.id,
            amount: bigToDecDirect(atomic, token.decimals),
            fee: bigToDecDirect(feeAtomic, token.decimals),
            guildId: i.guildId ?? undefined,
            metadata: JSON.stringify({ groupTipId: groupTip.id, kind: "GROUP_TIP_CREATE" }),
          },
        });
      }

      const embed = groupTipEmbed({
        creator: `<@${i.user.id}>`,
        amount: formatAmount(atomic, token),
        expiresAt,
        claimCount: 0,
        claimedBy: [],
        note,
      });

      if (i.channel && i.channel.isTextBased() && "send" in i.channel) {
        const msg = await (i.channel as any).send({
          embeds: [embed],
          components: [groupTipClaimRow(groupTip.id, false)],
        });

        await prisma.groupTip.update({
          where: { id: groupTip.id },
          data: { messageId: msg.id, channelId: msg.channelId },
        });
        await scheduleGroupTipExpiry(i.client, groupTip.id);

        await i.editReply({ content: "✅ Group tip created!" });

        const totalLine = `${formatAmount(atomic, token)} + fee ${formatAmount(feeAtomic, token)} = ${formatAmount(atomic + feeAtomic, token)}`;
        await i.followUp({ content: `🧾 You were charged **${totalLine}**.`, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await i.editReply({ content: "❌ Cannot create group tip in this channel." });
      }
      return;
    }

    // ------------------------------- DIRECT ------------------------------
    const target = i.options.getUser("user", true) as User;
    if (target.bot) {
      return i.reply({ content: "You can't tip a bot.", flags: MessageFlags.Ephemeral });
    }
    if (target.id === i.user.id) {
      return i.reply({ content: "You cannot tip yourself.", flags: MessageFlags.Ephemeral });
    }

    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const [fromUser, toUser] = await Promise.all([
      prisma.user.upsert({ where: { discordId: i.user.id }, update: {}, create: { discordId: i.user.id } }),
      prisma.user.upsert({ where: { discordId: target.id }, update: {}, create: { discordId: target.id } }),
    ]);

    // Try the transfer; return a descriptive line if insufficient
    try {
      await transferToken(i.user.id, target.id, token.id, atomic, "TIP", {
        guildId: i.guildId ?? undefined,
        feeAtomic,
        note,
      });
    } catch (err: any) {
      const totalLine =
        `${formatAmount(atomic, token)} + fee ${formatAmount(feeAtomic, token)} = ${formatAmount(atomic + feeAtomic, token)}`;
      const msg = /insufficient|fund/i.test(err?.message || "")
        ? `You don't have enough ${token.symbol} to send **${totalLine}**.`
        : `Transfer failed: ${err?.message || err}`;
      return i.editReply({ content: `❌ ${msg}` });
    }

    await prisma.tip.create({
      data: {
        fromUserId: fromUser.id,
        toUserId: toUser.id,
        tokenId: token.id,
        amountAtomic: bigToDecDirect(atomic, token.decimals),
        feeAtomic: bigToDecDirect(feeAtomic, token.decimals),
        note,
      },
    });

    await prisma.transaction.create({
      data: {
        type: "TIP",
        userId: fromUser.id,
        otherUserId: toUser.id,
        tokenId: token.id,
        amount: bigToDecDirect(atomic, token.decimals),
        fee: bigToDecDirect(feeAtomic, token.decimals),
        guildId: i.guildId ?? undefined,
        metadata: JSON.stringify({ kind: "DIRECT_TIP" }),
      },
    });

    const publicLine =
      `💸 <@${i.user.id}> tipped ${formatAmount(atomic, token)} to <@${target.id}>` +
      (feeAtomic > 0n ? ` (fee ${formatAmount(feeAtomic, token)} paid by sender)` : "") +
      (note ? `\n📝 ${note}` : "");

    if (i.channel && i.channel.isTextBased() && "send" in i.channel) {
      await (i.channel as any).send({
        content: publicLine,
        allowedMentions: { users: [i.user.id, target.id] },
      }).catch(() => {});
    }

    await i.editReply({ content: "✅ Tip sent." }).catch(() => {});
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (i.deferred || i.replied) {
      await i.editReply({ content: `Tip failed: ${msg}` }).catch(() => {});
    } else {
      await i.reply({ content: `Tip failed: ${msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}