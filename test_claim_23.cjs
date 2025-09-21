const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasourceUrl: "postgresql://neondb_owner:npg_jk3fVNRPhD4Q@ep-lingering-wildflower-afwekf33.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&connect_timeout=10&statement_timeout=5000&query_timeout=5000"
});

async function testClaim() {
  console.log('Testing claim functionality for group tip 23...');

  try {
    const groupTipId = 23;
    const discordId = "843340896518406154"; // Test user ID

    // Check group tip status first
    const groupTip = await prisma.groupTip.findUnique({
      where: { id: groupTipId },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        totalAmount: true,
        Creator: { select: { discordId: true } }
      }
    });

    console.log('Group tip status:', groupTip);

    if (!groupTip) {
      console.log('❌ Group tip not found');
      return;
    }

    const now = new Date();
    const timeLeft = Math.max(0, Math.floor((groupTip.expiresAt.getTime() - now.getTime()) / 1000));
    console.log(`⏰ Time remaining: ${timeLeft} seconds`);

    if (groupTip.expiresAt.getTime() < now.getTime()) {
      console.log('❌ Group tip has expired');
      return;
    }

    if (groupTip.status !== 'ACTIVE') {
      console.log('❌ Group tip is not active');
      return;
    }

    if (groupTip.Creator && groupTip.Creator.discordId === discordId) {
      console.log('❌ Cannot claim own group tip');
      return;
    }

    // Simulate the exact transaction logic from the button handler
    const result = await prisma.$transaction(async (tx) => {
      // Ensure user exists first
      const user = await tx.user.upsert({
        where: { discordId },
        update: {},
        create: { discordId },
      });

      // Check for existing participation
      const [existingContribution, existingClaim] = await Promise.all([
        tx.groupTipContribution.findUnique({
          where: {
            groupTipId_contributorId: {
              groupTipId,
              contributorId: user.id
            }
          }
        }),
        tx.groupTipClaim.findUnique({
          where: {
            groupTipId_userId: {
              groupTipId,
              userId: user.id
            }
          }
        })
      ]);

      if (existingContribution) {
        throw new Error("User has already contributed to this group tip! Contributors can't also claim!");
      }

      if (existingClaim) {
        throw new Error("User has already claimed this group tip");
      }

      // Record claim
      await tx.groupTipClaim.create({
        data: { groupTipId, userId: user.id },
      });

      // Get current claim count after successful insert
      const claimCount = await tx.groupTipClaim.count({
        where: { groupTipId },
      });

      return {
        expired: false,
        groupTipId,
        newClaimCount: claimCount,
      };
    });

    console.log('✅ Claim test successful!', result);

  } catch (error) {
    console.error('❌ Claim test failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testClaim();