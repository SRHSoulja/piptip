const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasourceUrl: "postgresql://neondb_owner:npg_jk3fVNRPhD4Q@ep-lingering-wildflower-afwekf33.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&connect_timeout=10&statement_timeout=5000&query_timeout=5000"
});

async function create5MinTip() {
  console.log('Creating 5-minute group tip...');

  try {
    // Find or create a user first
    const user = await prisma.user.upsert({
      where: { discordId: "403807194308673537" },
      update: {},
      create: { discordId: "403807194308673537" },
    });

    // Create a new group tip that expires in 5 minutes
    const tip = await prisma.groupTip.create({
      data: {
        creatorId: user.id,
        tokenId: 1,
        totalAmount: "75.0",
        duration: 5, // 5 minutes
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes from now
        status: "ACTIVE",
        guildId: "1074882281841360926",
        channelId: "1074882281841360929"
      }
    });

    console.log('✅ Created 5-minute group tip:', tip.id, 'expires in 5 minutes');

  } catch (error) {
    console.log('❌ Failed to create tip:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

create5MinTip();