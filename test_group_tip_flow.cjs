const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasourceUrl: "postgresql://neondb_owner:npg_jk3fVNRPhD4Q@ep-lingering-wildflower-afwekf33.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&connect_timeout=10&statement_timeout=5000&query_timeout=5000"
});

async function testGroupTipFlow() {
  console.log('🧪 Testing group tip creation and expiry flow...');

  try {
    // Find or create a user
    const user = await prisma.user.upsert({
      where: { discordId: "403807194308673537" },
      update: {},
      create: { discordId: "403807194308673537" },
    });

    // Create a new group tip that expires in 15 seconds
    const tip = await prisma.groupTip.create({
      data: {
        creatorId: user.id,
        tokenId: 1,
        totalAmount: "15.0",
        duration: 0.25, // ~15 seconds
        expiresAt: new Date(Date.now() + 15 * 1000), // 15 seconds from now
        status: "ACTIVE",
        guildId: "1074882281841360926",
        channelId: "1074882281841360929"
      }
    });

    console.log(`✅ Created group tip ID ${tip.id} - expires in 15 seconds`);
    console.log(`📅 Expiry time: ${tip.expiresAt.toISOString()}`);

    // Monitor for expiry
    console.log('⏰ Monitoring for expiry...');

    const checkInterval = setInterval(async () => {
      try {
        const currentTip = await prisma.groupTip.findUnique({
          where: { id: tip.id },
          select: { status: true, expiresAt: true }
        });

        if (!currentTip) {
          console.log('❌ Tip not found');
          clearInterval(checkInterval);
          return;
        }

        const now = new Date();
        const expired = now >= currentTip.expiresAt;

        if (expired && currentTip.status === 'ACTIVE') {
          console.log(`⏰ Tip ${tip.id} should be expired but status is still ACTIVE`);
          console.log(`📅 Now: ${now.toISOString()}, Expiry: ${currentTip.expiresAt.toISOString()}`);
        } else if (currentTip.status === 'FINALIZED') {
          console.log(`✅ Tip ${tip.id} has been finalized!`);
          clearInterval(checkInterval);
        } else {
          const timeLeft = Math.max(0, Math.ceil((currentTip.expiresAt.getTime() - now.getTime()) / 1000));
          console.log(`⏳ Tip ${tip.id} expires in ${timeLeft} seconds (status: ${currentTip.status})`);
        }
      } catch (error) {
        console.log(`❌ Monitor error: ${error.message}`);
      }
    }, 2000); // Check every 2 seconds

    // Auto-cleanup after 60 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      console.log('🔚 Monitoring ended');
      process.exit(0);
    }, 60000);

  } catch (error) {
    console.log('❌ Failed to create test tip:', error.message);
  }
}

testGroupTipFlow();