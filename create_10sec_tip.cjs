const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasourceUrl: "postgresql://neondb_owner:npg_jk3fVNRPhD4Q@ep-lingering-wildflower-afwekf33.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&connect_timeout=10&statement_timeout=5000&query_timeout=5000"
});

async function create10SecTip() {
  console.log('Creating 10-second group tip...');

  try {
    // Find or create a user first
    const user = await prisma.user.upsert({
      where: { discordId: "403807194308673537" },
      update: {},
      create: { discordId: "403807194308673537" },
    });

    // Create a new group tip that expires in 10 seconds
    const tip = await prisma.groupTip.create({
      data: {
        creatorId: user.id,
        tokenId: 1,
        totalAmount: "25.0",
        duration: 0.16, // ~10 seconds
        expiresAt: new Date(Date.now() + 10 * 1000), // 10 seconds from now
        status: "ACTIVE",
        guildId: "1074882281841360926",
        channelId: "1074882281841360929"
      }
    });

    console.log('✅ Created 10-second group tip:', tip.id, 'expires in 10 seconds');

    // Also schedule the timer in the running bot
    console.log('🕒 Scheduling timer for tip', tip.id);
    try {
      const { scheduleGroupTipExpiry } = require('./dist/features/group_tip_expiry.js');
      const { getDiscordClient } = require('./dist/services/discord_users.js');

      const client = await getDiscordClient();
      if (client) {
        await scheduleGroupTipExpiry(client, tip.id);
        console.log('✅ Timer scheduled for tip', tip.id);
      } else {
        console.log('⚠️ No Discord client available - timer not scheduled');
      }
    } catch (timerError) {
      console.log('⚠️ Failed to schedule timer:', timerError.message);
    }

  } catch (error) {
    console.log('❌ Failed to create tip:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

create10SecTip();