const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasourceUrl: "postgresql://neondb_owner:npg_jk3fVNRPhD4Q@ep-lingering-wildflower-afwekf33.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&connect_timeout=10&statement_timeout=5000&query_timeout=5000"
});

async function checkAllTips() {
  console.log('📋 Checking all recent group tips...');

  try {
    // Find all active tips
    const activeTips = await prisma.groupTip.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        expiresAt: true,
        totalAmount: true,
        _count: {
          select: { claims: true }
        }
      },
      orderBy: { id: 'desc' }
    });

    console.log(`\n🔍 Found ${activeTips.length} ACTIVE tips:`);
    const now = new Date();

    activeTips.forEach(tip => {
      const timeLeft = Math.ceil((tip.expiresAt.getTime() - now.getTime()) / 1000);
      const status = timeLeft <= 0 ? '⏰ EXPIRED' : `⏳ ${timeLeft}s left`;
      const expiredFor = timeLeft <= 0 ? ` (${Math.abs(timeLeft)}s ago)` : '';

      console.log(`  Tip ${tip.id}: ${tip.totalAmount} PENGU, ${tip._count.claims} claims, ${status}${expiredFor}`);
    });

    // Find recent finalized tips
    const finalizedTips = await prisma.groupTip.findMany({
      where: { status: "FINALIZED" },
      select: {
        id: true,
        totalAmount: true,
        _count: {
          select: { claims: true }
        }
      },
      orderBy: { id: 'desc' },
      take: 5
    });

    console.log(`\n✅ Recent FINALIZED tips (last 5):`);
    finalizedTips.forEach(tip => {
      const perUser = tip._count.claims > 0 ? (parseFloat(tip.totalAmount) / tip._count.claims).toFixed(2) : '0';
      console.log(`  Tip ${tip.id}: ${tip.totalAmount} PENGU → ${tip._count.claims} claimers (${perUser} each)`);
    });

  } catch (error) {
    console.log('❌ Failed to check tips:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkAllTips();