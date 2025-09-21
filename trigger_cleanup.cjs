const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasourceUrl: "postgresql://neondb_owner:npg_jk3fVNRPhD4Q@ep-lingering-wildflower-afwekf33.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&connect_timeout=10&statement_timeout=5000&query_timeout=5000"
});

async function triggerCleanup() {
  console.log('🧹 Manually triggering cleanup to test tip 55...');

  try {
    // Find expired tips
    const expiredTips = await prisma.groupTip.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: { lte: new Date() }
      },
      select: { id: true, expiresAt: true },
    });

    if (expiredTips.length === 0) {
      console.log('✅ No expired tips found');
    } else {
      console.log(`⚠️ Found ${expiredTips.length} expired tips:`);
      expiredTips.forEach(tip => {
        const secondsAgo = Math.floor((Date.now() - tip.expiresAt.getTime()) / 1000);
        console.log(`  - Tip ${tip.id}: expired ${secondsAgo} seconds ago`);
      });
    }

  } catch (error) {
    console.log('❌ Failed to check expired tips:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

triggerCleanup();