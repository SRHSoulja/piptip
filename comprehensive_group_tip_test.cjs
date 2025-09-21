const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasourceUrl: "postgresql://neondb_owner:npg_jk3fVNRPhD4Q@ep-lingering-wildflower-afwekf33.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&connect_timeout=10&statement_timeout=5000&query_timeout=5000"
});

async function comprehensiveGroupTipTest() {
  console.log('🧪 Comprehensive Group Tip Testing...\n');

  try {
    // 1. Create users for testing
    console.log('👥 Creating test users...');
    const creator = await prisma.user.upsert({
      where: { discordId: "403807194308673537" },
      update: {},
      create: { discordId: "403807194308673537" },
    });

    const claimer1 = await prisma.user.upsert({
      where: { discordId: "123456789012345678" },
      update: {},
      create: { discordId: "123456789012345678" },
    });

    const claimer2 = await prisma.user.upsert({
      where: { discordId: "987654321098765432" },
      update: {},
      create: { discordId: "987654321098765432" },
    });

    console.log(`✅ Created/found users: Creator(${creator.id}), Claimer1(${claimer1.id}), Claimer2(${claimer2.id})\n`);

    // 2. Create a group tip with timer integration
    console.log('💰 Creating group tip with timer scheduling...');
    const tip = await prisma.groupTip.create({
      data: {
        creatorId: creator.id,
        tokenId: 1,
        totalAmount: "50.0",
        duration: 0.5, // 30 seconds
        expiresAt: new Date(Date.now() + 30 * 1000),
        status: "ACTIVE",
        guildId: "1074882281841360926",
        channelId: "1074882281841360929"
      }
    });

    console.log(`✅ Created group tip ID ${tip.id} - expires in 30 seconds`);
    console.log(`📅 Expiry time: ${tip.expiresAt.toISOString()}\n`);

    // 3. Try to schedule timer in running bot
    console.log('🕒 Attempting to schedule timer in running bot...');
    try {
      const { scheduleGroupTipExpiry } = require('./dist/features/group_tip_expiry.js');
      const { getDiscordClient } = require('./dist/services/discord_users.js');

      const client = await getDiscordClient();
      if (client) {
        await scheduleGroupTipExpiry(client, tip.id);
        console.log('✅ Timer scheduled successfully');
      } else {
        console.log('⚠️ No Discord client available - timer not scheduled');
      }
    } catch (timerError) {
      console.log(`⚠️ Failed to schedule timer: ${timerError.message}`);
    }
    console.log('');

    // 4. Simulate claims
    console.log('🎯 Adding claims to the group tip...');

    await prisma.groupTipClaim.create({
      data: { groupTipId: tip.id, userId: claimer1.id }
    });
    console.log('✅ Claimer1 claimed the tip');

    await prisma.groupTipClaim.create({
      data: { groupTipId: tip.id, userId: claimer2.id }
    });
    console.log('✅ Claimer2 claimed the tip');

    // 5. Show current status
    const currentTip = await prisma.groupTip.findUnique({
      where: { id: tip.id },
      include: {
        Creator: true,
        claims: { include: { User: true } },
        Token: true
      }
    });

    console.log('\n📊 Current Group Tip Status:');
    console.log(`   ID: ${currentTip.id}`);
    console.log(`   Creator: ${currentTip.Creator?.discordId}`);
    console.log(`   Amount: ${currentTip.totalAmount} ${currentTip.Token.symbol}`);
    console.log(`   Status: ${currentTip.status}`);
    console.log(`   Claims: ${currentTip.claims.length}`);
    currentTip.claims.forEach((claim, i) => {
      console.log(`     ${i+1}. ${claim.User?.discordId} (claimed at ${claim.claimedAt.toISOString()})`);
    });

    const timeLeft = Math.max(0, Math.ceil((currentTip.expiresAt.getTime() - Date.now()) / 1000));
    console.log(`   Expires in: ${timeLeft} seconds\n`);

    // 6. Monitor for processing
    console.log('⏰ Monitoring for expiry processing...');
    let monitorCount = 0;
    const maxMonitor = 20; // Monitor for 40 seconds

    const monitor = setInterval(async () => {
      try {
        monitorCount++;

        const updatedTip = await prisma.groupTip.findUnique({
          where: { id: tip.id },
          select: { status: true, expiresAt: true }
        });

        if (!updatedTip) {
          console.log('❌ Tip not found');
          clearInterval(monitor);
          return;
        }

        const now = new Date();
        const expired = now >= updatedTip.expiresAt;
        const timeLeft = Math.max(0, Math.ceil((updatedTip.expiresAt.getTime() - now.getTime()) / 1000));

        if (updatedTip.status === 'FINALIZED') {
          console.log(`🎉 SUCCESS! Tip ${tip.id} has been FINALIZED!`);

          // Show final state
          const finalTip = await prisma.groupTip.findUnique({
            where: { id: tip.id },
            include: {
              claims: { include: { User: true } },
              Token: true
            }
          });

          console.log('\n🏁 Final Group Tip State:');
          console.log(`   Status: ${finalTip.status}`);
          console.log(`   Total Claims: ${finalTip.claims.length}`);
          if (finalTip.claims.length > 0) {
            const perUser = parseFloat(finalTip.totalAmount) / finalTip.claims.length;
            console.log(`   Payout per claimer: ${perUser} ${finalTip.Token.symbol}`);
          }

          clearInterval(monitor);
          return;
        }

        if (expired && updatedTip.status === 'ACTIVE') {
          console.log(`⏰ Tip ${tip.id} expired but still ACTIVE (${Math.floor((now.getTime() - updatedTip.expiresAt.getTime()) / 1000)}s ago)`);
        } else if (!expired) {
          console.log(`⏳ Tip ${tip.id} expires in ${timeLeft}s (status: ${updatedTip.status})`);
        }

        if (monitorCount >= maxMonitor) {
          console.log('⏰ Monitoring timeout - cleanup service will handle expired tip');
          clearInterval(monitor);
        }
      } catch (error) {
        console.log(`❌ Monitor error: ${error.message}`);
      }
    }, 2000);

  } catch (error) {
    console.log('❌ Test failed:', error.message);
  } finally {
    // Don't disconnect immediately, let monitoring complete
    setTimeout(() => {
      prisma.$disconnect();
      console.log('\n🔚 Test completed');
      process.exit(0);
    }, 45000);
  }
}

comprehensiveGroupTipTest();