const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasourceUrl: "postgresql://neondb_owner:npg_jk3fVNRPhD4Q@ep-lingering-wildflower-afwekf33.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&connect_timeout=10&statement_timeout=5000&query_timeout=5000"
});

async function create1MinTip() {
  console.log('Creating 1-minute group tip...');

  try {
    // Find or create a user first
    const user = await prisma.user.upsert({
      where: { discordId: "403807194308673537" },
      update: {},
      create: { discordId: "403807194308673537" },
    });

    // Create a new group tip that expires in 1 minute
    const tip = await prisma.groupTip.create({
      data: {
        creatorId: user.id,
        tokenId: 1,
        totalAmount: "50.0",
        duration: 1, // 1 minute
        expiresAt: new Date(Date.now() + 1 * 60 * 1000), // 1 minute from now
        status: "ACTIVE",
        guildId: "1074882281841360926",
        channelId: "1074882281841360929"
      }
    });

    console.log('✅ Created 1-minute group tip:', tip.id, 'expires in 1 minute');

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

create1MinTip();