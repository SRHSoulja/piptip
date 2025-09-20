/** Handle show help button */
export async function handleShowHelp(i) {
    await i.deferReply({ ephemeral: true }).catch(() => { });
    try {
        // Import the help embed from the command but handle the interaction properly
        const { EmbedBuilder } = await import("discord.js");
        const embed = new EmbedBuilder()
            .setTitle("🐧🧊🪨 PIPTip Bot Help")
            .setDescription("**Welcome to PIPTip!** Your Discord bot for tipping Abstract Chain tokens (Penguin, Ice, Pebble)")
            .setColor(0x5865F2)
            .addFields({
            name: "🚀 Getting Started",
            value: "1️⃣ **View Profile**: `/pip_profile` - View your balance and account details (auto-creates account)\n" +
                "2️⃣ **Get Wallet**: Visit **abs.xyz** to create a free Abstract wallet\n" +
                "3️⃣ **Link Wallet**: `/pip_link address:0x...` - Connect your wallet for deposits\n" +
                "4️⃣ **Add Funds**: `/pip_deposit token:PENGUIN` - Get deposit instructions\n" +
                "5️⃣ **Start Playing**: `/pip_tip amount:10 user:@friend` - Send tips or `/pip_game` to challenge friends!",
            inline: false
        }, {
            name: "💸 Tipping Commands",
            value: "**Direct Tips**: `/pip_tip amount:10 user:@someone` - Send tokens to a specific user\n" +
                "**Group Tips**: `/pip_tip amount:10` - Create a tip everyone can claim (leave user empty)\n" +
                "**With Notes**: `/pip_tip amount:5 user:@friend note:\"Great work!\"` - Add a message\n\n" +
                "💡 *Tip: The same command does both - just include or omit the user parameter!*",
            inline: false
        }, {
            name: "🎮 Gaming & Features",
            value: "**Challenge Players**: `/pip_game token:PENGUIN amount:5` - Start a Penguin Ice Pebble match\n" +
                "**View Profile**: `/pip_profile` - See your balance, stats, and recent activity\n" +
                "**Withdraw Funds**: `/pip_withdraw token:PENGUIN amount:10` - Send tokens to your wallet",
            inline: false
        }, {
            name: "⭐ Premium Features",
            value: "🔹 **Tier Memberships**: Purchase premium tiers for reduced fees and special perks\n" +
                "🔹 **Tax-Free Tipping**: Premium members get lower or no fees on tips\n" +
                "🔹 **Exclusive Perks**: Priority support and special benefits\n\n" +
                "*Check your profile for membership options!*",
            inline: false
        }, {
            name: "🛠️ Quick Reference",
            value: "**Account Management**:\n" +
                "`/pip_link` - Link your Abstract wallet\n" +
                "`/pip_profile` - View balance and stats\n\n" +
                "**Money & Tokens**:\n" +
                "`/pip_deposit` - Add funds to your account\n" +
                "`/pip_withdraw` - Send tokens to your wallet\n" +
                "`/pip_tip` - Send tips (direct or group)\n\n" +
                "**Gaming & Help**:\n" +
                "`/pip_game` - Challenge others to play\n" +
                "`/pip_help` - Show this guide",
            inline: false
        })
            .setFooter({
            text: "💡 Pro tip: Most commands support autocomplete - just start typing!"
        })
            .setTimestamp();
        await i.editReply({
            embeds: [embed]
        });
    }
    catch (error) {
        console.error("Show help error:", error);
        await i.editReply({
            content: `❌ **Error showing help**\n${error?.message || String(error)}`
        });
    }
}
