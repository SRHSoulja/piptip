import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
export default async function pipHelp(i) {
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
            "**Detailed Stats**: `/pip_stats` - Comprehensive transaction history and analytics\n" +
            "**Achievements**: `/pip_achievements` - View your unlocked achievements and progress\n" +
            "**Leaderboards**: `/pip_leaderboard category:streaks` - See top players (streaks, wins, tips, etc.)\n" +
            "**Withdraw Funds**: `/pip_withdraw` - Interactive withdrawal interface with your holdings and limits",
        inline: false
    }, {
        name: "📖 PenguBook Social Features",
        value: "**Create Bio**: `/pip_bio set text:\"Your bio here\"` - Create your PenguBook profile\n" +
            "**Browse Profiles**: `/pip_pengubook` - Discover other users and their bios\n" +
            "**🔍 Search Users**: Use the search feature to find specific Discord usernames safely\n" +
            "**Send Messages**: Tip with notes through PenguBook - messages go to their inbox\n" +
            "**View Inbox**: Check your PenguBook messages from profile tips\n\n" +
            "🛡️ *Safety: Always verify exact usernames to avoid impersonators!*",
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
            "`/pip_withdraw` - Interactive withdrawal interface\n" +
            "`/pip_tip` - Send tips (direct or group)\n\n" +
            "**Social & Gaming**:\n" +
            "`/pip_bio` - Manage your PenguBook profile\n" +
            "`/pip_pengubook` - Browse community profiles\n" +
            "`/pip_game` - Challenge others to play\n" +
            "`/pip_achievements` - View unlocked achievements\n" +
            "`/pip_leaderboard` - See community leaderboards\n" +
            "`/pip_stats` - Detailed transaction analytics\n" +
            "`/pip_help` - Show this guide",
        inline: false
    })
        .setFooter({
        text: "💡 Pro tip: Most commands support autocomplete - just start typing!"
    })
        .setTimestamp();
    // Add web access button
    const webAccessRow = new ActionRowBuilder()
        .addComponents(new ButtonBuilder()
        .setURL(`${process.env.PUBLIC_BASE_URL || 'http://localhost:3000'}/pengubook`)
        .setLabel("🌐 Open PenguBook in Browser")
        .setStyle(ButtonStyle.Link)
        .setEmoji("💻"), new ButtonBuilder()
        .setCustomId("pip:view_profile")
        .setLabel("👤 View My Profile")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📊"));
    await i.reply({
        embeds: [embed],
        components: [webAccessRow],
        ephemeral: true
    });
}
