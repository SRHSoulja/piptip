import type { ChatInputCommandInteraction } from "discord.js";
import { getTokenByAddress } from "../services/token.js";
import { TREASURY_AGW_ADDRESS } from "../config.js";

export default async function pipDeposit(i: ChatInputCommandInteraction) {
  const tokenAddress = i.options.getString("token", true);
  
  // Get token details
  const token = await getTokenByAddress(tokenAddress);
  if (!token) {
    return i.reply({ content: "Invalid or inactive token selected.", flags: 64 });
  }

  const warning = `⚠️ **Minimum deposit:** ${token.minDeposit} ${token.symbol} (deposits below this are ignored)`;

  await i.reply({
    content: [
      `Send **${token.symbol}** to the Treasury. Your balance is credited after confirmation.`,
      "",
      `**Treasury:** \`${TREASURY_AGW_ADDRESS}\``,
      `**Token:** \`${token.address}\``,
      `**Symbol:** ${token.symbol}`,
      "",
      warning
    ].join("\n"),
    flags: 64 // ephemeral
  });
}