import { prisma } from "../services/db.js";
import { getTokenByAddress, toAtomicDirect, formatAmount } from "../services/token.js";
import { debitToken } from "../services/balances.js";
import { secretPickRow } from "../ui/components.js";
import { MessageFlags } from "discord.js";
async function pipStart(i) {
  try {
    const tokenAddress = (i.options.getString("token", true) || "").toLowerCase();
    const amount = i.options.getNumber("amount", true);
    if (!(amount > 0)) {
      return i.reply({ content: "Amount must be greater than 0.", flags: MessageFlags.Ephemeral });
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const token = await getTokenByAddress(tokenAddress);
    if (!token || !token.active) {
      return i.editReply({ content: "Invalid or inactive token selected." });
    }
    const atomic = toAtomicDirect(amount, token.decimals);
    const challengerId = await debitToken(i.user.id, token.id, atomic, "MATCH_WAGER", {
      guildId: i.guildId
    });
    const match = await prisma.match.create({
      data: {
        status: "DRAFT",
        wagerAtomic: atomic.toString(),
        // Store atomic units, not converted amounts
        potAtomic: (2n * atomic).toString(),
        // Store atomic units, not converted amounts
        tokenId: token.id,
        // scalar FK
        challengerId
        // scalar FK (from debitToken)
      }
      // <-- key line
    });
    await i.editReply({
      content: `<a:BoxingPengu:1415471596717477949> Wager: **${formatAmount(atomic, token)}**
Pick your secret move to post the match.`,
      components: [secretPickRow(match.id)]
    });
  } catch (error) {
    const msg = error?.message || String(error);
    if (i.deferred || i.replied) {
      await i.editReply({ content: `Failed to start match: ${msg}` }).catch(() => {
      });
    } else {
      await i.reply({ content: `Failed to start match: ${msg}`, flags: MessageFlags.Ephemeral }).catch(() => {
      });
    }
  }
}
export {
  pipStart as default
};
//# sourceMappingURL=pip_game.js.map
