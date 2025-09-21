const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasourceUrl: "postgresql://neondb_owner:npg_jk3fVNRPhD4Q@ep-lingering-wildflower-afwekf33.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&connect_timeout=10&statement_timeout=5000&query_timeout=5000"
});

async function create10MinTip() {
  console.log('Creating 10-minute group tip...');

  try {
    // Find or create a user first
    const user = await prisma.user.upsert({
      where: { discordId: "403807194308673537" },
      update: {},
      create: { discordId: "403807194308673537" },
    });

    // Create a new group tip that expires in 10 minutes
    const tip = await prisma.groupTip.create({
      data: {
        creatorId: user.id,
        tokenId: 1,
        totalAmount: "100.0",
        duration: 10, // 10 minutes
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
        status: "ACTIVE",
        guildId: "1074882281841360926",
        channelId: "1074882281841360929"
      }
    });

    console.log('✅ Created 10-minute group tip:', tip.id, 'expires in 10 minutes');

  } catch (error) {
    console.log('❌ Failed to create tip:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

create10MinTip();