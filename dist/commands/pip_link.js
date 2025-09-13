import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../services/db.js";
const isAddress = (s) => /^0x[a-fA-F0-9]{40}$/.test(s);
export default async function pipLink(i) {
    const rawAddr = i.options.getString("address", true);
    if (!rawAddr || typeof rawAddr !== "string") {
        return i.reply({ content: "Invalid address format.", flags: 64 });
    }
    const addr = rawAddr.trim().toLowerCase();
    if (!isAddress(addr)) {
        const errorRow = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setLabel("🌐 Get Abstract Wallet")
            .setStyle(ButtonStyle.Link)
            .setURL("https://abs.xyz"), new ButtonBuilder()
            .setCustomId("pip:show_help")
            .setLabel("📚 Get Help")
            .setStyle(ButtonStyle.Secondary));
        return i.reply({
            content: [
                "❌ **Invalid wallet address format**",
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
    // prevent sharing the same wallet
    const taken = await prisma.user.findFirst({
        where: { agwAddress: addr, discordId: { not: i.user.id } }
    });
    if (taken)
        return i.reply({ content: "That wallet is already linked to another user.", flags: 64 });
    await prisma.user.upsert({
        where: { discordId: i.user.id },
        update: { agwAddress: addr },
        create: { discordId: i.user.id, agwAddress: addr }
    });
    // Create next-step buttons to guide user flow
    const actionRow = new ActionRowBuilder()
        .addComponents(new ButtonBuilder()
        .setCustomId("pip:show_deposit_instructions")
        .setLabel("💰 View Deposit Instructions")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📥"), new ButtonBuilder()
        .setCustomId("pip:view_profile")
        .setLabel("👤 View My Profile")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("📊"), new ButtonBuilder()
        .setCustomId("pip:show_help")
        .setLabel("📚 Get Help")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("❓"));
    await i.reply({
        content: [
            `✅ **Wallet Successfully Linked!**`,
            "",
            `🔗 **Address:** \`${addr}\``,
            "",
            "**What's next?**",
            "• Add funds to start tipping and gaming",
            "• View your profile to see your stats",
            "• Check out the help guide to learn more",
            "",
            "💡 *Use the buttons below for quick actions!*"
        ].join("\n"),
        components: [actionRow],
        flags: 64
    });
}
