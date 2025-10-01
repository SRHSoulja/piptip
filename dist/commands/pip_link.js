import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../services/db.js";
const isAddress = (s) => /^0x[a-fA-F0-9]{40}$/.test(s);
async function pipLink(i) {
  const rawAddr = i.options.getString("address", true);
  if (!rawAddr || typeof rawAddr !== "string") {
    return i.reply({ content: "Invalid address format.", flags: 64 });
  }
  const addr = rawAddr.trim().toLowerCase();
  if (!isAddress(addr)) {
    const errorRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("\u{1F310} Get Abstract Wallet").setStyle(ButtonStyle.Link).setURL("https://abs.xyz"),
      new ButtonBuilder().setCustomId("pip:show_help").setLabel("\u{1F4DA} Get Help").setStyle(ButtonStyle.Secondary)
    );
    return i.reply({
      content: [
        "\u274C **Invalid wallet address format**",
        "",
        "Please provide a valid Abstract wallet address (starts with 0x).",
        "",
        "**Don't have an Abstract wallet?**",
        "Click the button below to get one free!",
        "",
        "Then use: `/pip_link address:0x...`"
      ].join("\n"),
      components: [errorRow],
      flags: 64
    });
  }
  const taken = await prisma.user.findFirst({
    where: { agwAddress: addr, discordId: { not: i.user.id } }
  });
  if (taken) return i.reply({ content: "That wallet is already linked to another user.", flags: 64 });
  await prisma.user.upsert({
    where: { discordId: i.user.id },
    update: { agwAddress: addr },
    create: { discordId: i.user.id, agwAddress: addr }
  });
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pip:show_deposit_instructions").setLabel("\u{1F4B0} View Deposit Instructions").setStyle(ButtonStyle.Primary).setEmoji("\u{1F4E5}"),
    new ButtonBuilder().setCustomId("pip:view_profile").setLabel("\u{1F464} View My Profile").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F4CA}"),
    new ButtonBuilder().setCustomId("pip:show_help").setLabel("\u{1F4DA} Get Help").setStyle(ButtonStyle.Secondary).setEmoji("\u2753")
  );
  await i.reply({
    content: [
      `\u2705 **Wallet Successfully Linked!**`,
      "",
      `\u{1F517} **Address:** \`${addr}\``,
      "",
      "**What's next?**",
      "\u2022 Add funds to start tipping and gaming",
      "\u2022 View your profile to see your stats",
      "\u2022 Check out the help guide to learn more",
      "",
      "\u{1F4A1} *Use the buttons below for quick actions!*"
    ].join("\n"),
    components: [actionRow],
    flags: 64
  });
}
export {
  pipLink as default
};
//# sourceMappingURL=pip_link.js.map
