import { prisma } from "../services/db.js";
import { getTokenByAddress, toAtomicDirect, formatAmount, bigToDecDirect } from "../services/token.js";
import { debitToken } from "../services/balances.js";
import { secretPickRow } from "../ui/components.js";
import { Prisma } from "@prisma/client";
// at top
import { MessageFlags, type ChatInputCommandInteraction, type User } from "discord.js";


export default async function pipStart(i: ChatInputCommandInteraction) {
  try {
    const tokenAddress = (i.options.getString("token", true) || "").toLowerCase();
    const amount = i.options.getNumber("amount", true);

    // fast validation can reply immediately
    if (!(amount > 0)) {
      return i.reply({ content: "Amount must be greater than 0.", flags: MessageFlags.Ephemeral });
    }

    // acknowledge within 3s
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    // token lookup (may take time)
    const token = await getTokenByAddress(tokenAddress);
    if (!token || !token.active) {
      return i.editReply({ content: "Invalid or inactive token selected." });
    }

    const atomic = toAtomicDirect(amount, token.decimals);

    // debit the challenger (returns challenger User.id)
    const challengerId = await debitToken(i.user.id, token.id, atomic, "MATCH_WAGER", {
      guildId: i.guildId,
    });

// create DRAFT match
const match = await prisma.match.create({
  data: {
    status: "DRAFT",
    wagerAtomic: bigToDecDirect(atomic, token.decimals),
    potAtomic: bigToDecDirect(2n * atomic, token.decimals),
    tokenId: token.id,          // scalar FK
    challengerId,               // scalar FK (from debitToken)
  } as Prisma.MatchUncheckedCreateInput, // <-- key line
});



    // finish the deferred reply
    await i.editReply({
      content: `Wager: **${formatAmount(atomic, token)}**\nPick your secret move to post the match.`,
      components: [secretPickRow(match.id)],
    });
  } catch (error: any) {
    const msg = error?.message || String(error);
    if (i.deferred || i.replied) {
      await i.editReply({ content: `Failed to start match: ${msg}` }).catch(() => {});
    } else {
      await i.reply({ content: `Failed to start match: ${msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
