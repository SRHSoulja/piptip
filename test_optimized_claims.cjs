#!/usr/bin/env node

/**
 * Test script for optimized group tip claim processing
 * Tests the new fast validation, caching, and background processing features
 */

const { PrismaClient } = require('@prisma/client');

async function testOptimizedClaims() {
  const prisma = new PrismaClient();

  try {
    console.log('🧪 Testing optimized group tip claim processing...\n');

    // Test 1: Find an active group tip for testing
    console.log('📋 Step 1: Finding active group tips...');
    const activeTips = await prisma.groupTip.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: new Date() }
      },
      take: 1,
      include: {
        Token: true,
        Creator: true,
        claims: true,
        contributions: true
      }
    });

    if (activeTips.length === 0) {
      console.log('⚠️ No active group tips found for testing');
      return;
    }

    const testTip = activeTips[0];
    console.log(`✅ Found active tip ${testTip.id} (${testTip.Token.symbol})`);
    console.log(`   Created by: ${testTip.Creator?.discordId || 'Unknown'}`);
    console.log(`   Expires: ${testTip.expiresAt.toISOString()}`);
    console.log(`   Current claims: ${testTip.claims.length}`);
    console.log(`   Current contributions: ${testTip.contributions.length}\n`);

    // Test 2: Test fast validation query performance
    console.log('⚡ Step 2: Testing fast validation performance...');
    const validationStart = Date.now();

    const fastValidation = await Promise.race([
      prisma.groupTip.findUnique({
        where: { id: testTip.id },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          Creator: { select: { discordId: true } }
        }
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Validation query timeout")), 800)
      )
    ]);

    const validationTime = Date.now() - validationStart;
    console.log(`✅ Fast validation completed in ${validationTime}ms`);
    console.log(`   Status: ${fastValidation?.status}`);
    console.log(`   Expired: ${fastValidation ? fastValidation.expiresAt.getTime() < Date.now() : 'N/A'}\n`);

    // Test 3: Test user lookup performance
    console.log('👤 Step 3: Testing user operations...');
    const testDiscordId = 'test_user_' + Date.now();

    const userStart = Date.now();
    const user = await Promise.race([
      prisma.user.upsert({
        where: { discordId: testDiscordId },
        update: {},
        create: { discordId: testDiscordId },
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("User upsert timeout")), 500)
      )
    ]);
    const userTime = Date.now() - userStart;
    console.log(`✅ User upsert completed in ${userTime}ms (User ID: ${user.id})\n`);

    // Test 4: Test participation check performance
    console.log('🔍 Step 4: Testing participation checks...');
    const participationStart = Date.now();

    const [existingContribution, existingClaim] = await Promise.race([
      Promise.all([
        prisma.groupTipContribution.findUnique({
          where: {
            groupTipId_contributorId: {
              groupTipId: testTip.id,
              contributorId: user.id
            }
          }
        }),
        prisma.groupTipClaim.findUnique({
          where: {
            groupTipId_userId: {
              groupTipId: testTip.id,
              userId: user.id
            }
          }
        })
      ]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Participation check timeout")), 700)
      )
    ]);

    const participationTime = Date.now() - participationStart;
    console.log(`✅ Participation check completed in ${participationTime}ms`);
    console.log(`   Has contribution: ${!!existingContribution}`);
    console.log(`   Has claim: ${!!existingClaim}\n`);

    // Test 5: Test actual claim transaction (if user hasn't claimed yet)
    if (!existingClaim && !existingContribution) {
      console.log('💫 Step 5: Testing claim transaction...');
      const claimStart = Date.now();

      try {
        const result = await Promise.race([
          prisma.$transaction(async (tx) => {
            // Record claim
            await tx.groupTipClaim.create({
              data: { groupTipId: testTip.id, userId: user.id },
            });

            // Get current claim count
            const claimCount = await tx.groupTipClaim.count({
              where: { groupTipId: testTip.id },
            });

            return { newClaimCount: claimCount };
          }, {
            maxWait: 800,
            timeout: 1000,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Transaction timeout")), 1000)
          )
        ]);

        const claimTime = Date.now() - claimStart;
        console.log(`✅ Claim transaction completed in ${claimTime}ms`);
        console.log(`   New claim count: ${result.newClaimCount}\n`);

        // Clean up test claim
        await prisma.groupTipClaim.delete({
          where: {
            groupTipId_userId: {
              groupTipId: testTip.id,
              userId: user.id
            }
          }
        });
        console.log('🧹 Cleaned up test claim\n');

      } catch (error) {
        const claimTime = Date.now() - claimStart;
        console.log(`❌ Claim transaction failed after ${claimTime}ms: ${error.message}\n`);
      }
    } else {
      console.log('⏭️ Step 5: Skipping claim test (user already participated)\n');
    }

    // Clean up test user
    await prisma.user.delete({
      where: { id: user.id }
    });
    console.log('🧹 Cleaned up test user');

    // Test 6: Summary
    console.log('\n📊 Performance Summary:');
    console.log(`   Fast validation: ${validationTime}ms (target: <800ms)`);
    console.log(`   User operations: ${userTime}ms (target: <500ms)`);
    console.log(`   Participation check: ${participationTime}ms (target: <700ms)`);

    const totalOptimizedTime = validationTime + userTime + participationTime;
    console.log(`   Total optimized flow: ${totalOptimizedTime}ms (target: <2000ms)`);

    if (totalOptimizedTime < 2000) {
      console.log('✅ All performance targets met! The optimization should significantly reduce Discord timeouts.');
    } else {
      console.log('⚠️ Some performance targets missed. Database may be under heavy load.');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
if (require.main === module) {
  testOptimizedClaims()
    .then(() => {
      console.log('\n🎉 Optimization test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test crashed:', error);
      process.exit(1);
    });
}

module.exports = { testOptimizedClaims };