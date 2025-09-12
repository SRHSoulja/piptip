// tests/server-stats-optimization.test.js - Test server stats N+1 optimization
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Server stats N+1 optimization', () => {
  let testUsers = [];
  let testToken;
  let testServers = [];

  beforeEach(async () => {
    // Create test token
    testToken = await prisma.token.create({
      data: {
        symbol: 'TESTCOIN4',
        address: '0x' + Math.random().toString(16).substr(2, 40),
        decimals: 6,
        active: true
      }
    });

    // Create test users
    for (let i = 0; i < 6; i++) {
      const user = await prisma.user.create({
        data: { discordId: `test_user_${Date.now()}_${i}` }
      });
      testUsers.push(user);

      await prisma.userBalance.create({
        data: {
          userId: user.id,
          tokenId: testToken.id,
          amount: 1000
        }
      });
    }

    // Create test servers
    for (let i = 0; i < 3; i++) {
      const server = await prisma.approvedServer.create({
        data: {
          guildId: `test_guild_${Date.now()}_${i}`,
          enabled: true,
          note: `Test server ${i + 1}`
        }
      });
      testServers.push(server);
    }
  });

  afterEach(async () => {
    // Clean up in correct order
    await prisma.userBalance.deleteMany({
      where: { tokenId: testToken.id }
    });
    await prisma.transaction.deleteMany({
      where: { guildId: { in: testServers.map(s => s.guildId) } }
    });
    await prisma.groupTip.deleteMany({
      where: { tokenId: testToken.id }
    });
    await prisma.approvedServer.deleteMany({
      where: { guildId: { in: testServers.map(s => s.guildId) } }
    });
    await prisma.user.deleteMany({
      where: { id: { in: testUsers.map(u => u.id) } }
    });
    await prisma.token.delete({
      where: { id: testToken.id }
    });
    testUsers = [];
    testServers = [];
  });

  test('Grouped queries return correct data for multiple guilds', async () => {
    const [guild1, guild2, guild3] = testServers;
    const [user1, user2, user3, user4, user5, user6] = testUsers;

    // Create tip transactions for different guilds
    await prisma.transaction.create({
      data: {
        type: 'TIP',
        userId: user1.id,
        guildId: guild1.guildId,
        tokenId: testToken.id,
        amount: 100
      }
    });

    await prisma.transaction.create({
      data: {
        type: 'TIP',
        userId: user2.id,
        guildId: guild1.guildId,
        tokenId: testToken.id,
        amount: 200
      }
    });

    await prisma.transaction.create({
      data: {
        type: 'TIP',
        userId: user3.id,
        guildId: guild2.guildId,
        tokenId: testToken.id,
        amount: 150
      }
    });

    // Create game transactions
    await prisma.transaction.create({
      data: {
        type: 'MATCH_RAKE',
        userId: user1.id,
        guildId: guild1.guildId,
        tokenId: testToken.id,
        amount: 10
      }
    });

    await prisma.transaction.create({
      data: {
        type: 'MATCH_WIN',
        userId: user2.id,
        guildId: guild1.guildId,
        tokenId: testToken.id,
        amount: 90
      }
    });

    await prisma.transaction.create({
      data: {
        type: 'MATCH_RAKE',
        userId: user4.id,
        guildId: guild2.guildId,
        tokenId: testToken.id,
        amount: 5
      }
    });

    // Create group tips
    await prisma.groupTip.create({
      data: {
        creatorId: user1.id,
        tokenId: testToken.id,
        totalAmount: 300,
        duration: 1,
        status: 'FINALIZED',
        guildId: guild1.guildId,
        expiresAt: new Date(Date.now() - 1000)
      }
    });

    await prisma.groupTip.create({
      data: {
        creatorId: user3.id,
        tokenId: testToken.id,
        totalAmount: 200,
        duration: 1,
        status: 'REFUNDED',
        guildId: guild2.guildId,
        expiresAt: new Date(Date.now() - 2000),
        refundedAt: new Date()
      }
    });

    // Create recent transaction for guild3
    await prisma.transaction.create({
      data: {
        type: 'TIP',
        userId: user6.id,
        guildId: guild3.guildId,
        tokenId: testToken.id,
        amount: 75
      }
    });

    const guildIds = testServers.map(s => s.guildId);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Test the optimized grouped queries
    const [tipStats, gameStats, groupTipStats, activeUsersByGuild] = await Promise.all([
      // 1. Group tip transactions by guildId
      prisma.transaction.groupBy({
        by: ['guildId'],
        where: { 
          guildId: { in: guildIds },
          type: 'TIP' 
        },
        _count: { id: true },
        _sum: { amount: true }
      }),

      // 2. Group game transactions by guildId
      prisma.transaction.groupBy({
        by: ['guildId'],
        where: { 
          guildId: { in: guildIds },
          type: { in: ['MATCH_RAKE', 'MATCH_WIN'] }
        },
        _count: { id: true }
      }),

      // 3. Group completed group tips by guildId
      prisma.groupTip.groupBy({
        by: ['guildId'],
        where: { 
          guildId: { in: guildIds },
          status: { in: ['FINALIZED', 'REFUNDED'] }
        },
        _count: { id: true }
      }),

      // 4. Get active users per guild (users with activity in last 30 days)
      prisma.transaction.groupBy({
        by: ['guildId', 'userId'],
        where: { 
          guildId: { in: guildIds },
          createdAt: { gte: thirtyDaysAgo },
          userId: { not: null }
        },
        _count: { id: true }
      })
    ]);

    // Build lookup maps
    const tipStatsMap = new Map(tipStats.map(stat => [
      stat.guildId, 
      { count: stat._count.id, volume: stat._sum.amount || 0 }
    ]));
    
    const gameStatsMap = new Map(gameStats.map(stat => [
      stat.guildId, 
      stat._count.id
    ]));
    
    const groupTipStatsMap = new Map(groupTipStats.map(stat => [
      stat.guildId, 
      stat._count.id
    ]));
    
    // Count unique active users per guild
    const activeUsersMap = new Map();
    const usersByGuild = new Map();
    
    for (const entry of activeUsersByGuild) {
      if (!entry.guildId || !entry.userId) continue;
      
      if (!usersByGuild.has(entry.guildId)) {
        usersByGuild.set(entry.guildId, new Set());
      }
      usersByGuild.get(entry.guildId).add(entry.userId);
    }
    
    for (const [guildId, userSet] of usersByGuild) {
      activeUsersMap.set(guildId, userSet.size);
    }

    // Test Guild 1 results
    const guild1TipData = tipStatsMap.get(guild1.guildId);
    assert(guild1TipData, 'Guild1 should have tip data');
    assert.strictEqual(guild1TipData.count, 2, 'Guild1 should have 2 tips');
    assert.strictEqual(Number(guild1TipData.volume), 300, 'Guild1 tip volume should be 300 (100+200)');

    const guild1GameCount = gameStatsMap.get(guild1.guildId);
    assert.strictEqual(guild1GameCount, 2, 'Guild1 should have 2 game transactions');

    const guild1GroupTipCount = groupTipStatsMap.get(guild1.guildId);
    assert.strictEqual(guild1GroupTipCount, 1, 'Guild1 should have 1 finalized group tip');

    const guild1ActiveUsers = activeUsersMap.get(guild1.guildId);
    assert.strictEqual(guild1ActiveUsers, 2, 'Guild1 should have 2 active users (user1, user2)');

    // Test Guild 2 results
    const guild2TipData = tipStatsMap.get(guild2.guildId);
    assert(guild2TipData, 'Guild2 should have tip data');
    assert.strictEqual(guild2TipData.count, 1, 'Guild2 should have 1 tip');
    assert.strictEqual(Number(guild2TipData.volume), 150, 'Guild2 tip volume should be 150');

    const guild2GameCount = gameStatsMap.get(guild2.guildId);
    assert.strictEqual(guild2GameCount, 1, 'Guild2 should have 1 game transaction');

    const guild2GroupTipCount = groupTipStatsMap.get(guild2.guildId);
    assert.strictEqual(guild2GroupTipCount, 1, 'Guild2 should have 1 refunded group tip');

    const guild2ActiveUsers = activeUsersMap.get(guild2.guildId);
    assert.strictEqual(guild2ActiveUsers, 2, 'Guild2 should have 2 active users (user3, user4)');

    // Test Guild 3 results
    const guild3TipData = tipStatsMap.get(guild3.guildId);
    assert(guild3TipData, 'Guild3 should have tip data');
    assert.strictEqual(guild3TipData.count, 1, 'Guild3 should have 1 tip');

    const guild3GameCount = gameStatsMap.get(guild3.guildId) || 0;
    assert.strictEqual(guild3GameCount, 0, 'Guild3 should have 0 game transactions');

    const guild3GroupTipCount = groupTipStatsMap.get(guild3.guildId) || 0;
    assert.strictEqual(guild3GroupTipCount, 0, 'Guild3 should have 0 group tips');

    const guild3ActiveUsers = activeUsersMap.get(guild3.guildId);
    assert.strictEqual(guild3ActiveUsers, 1, 'Guild3 should have 1 active user (user6)');
  });

  test('Grouped queries handle empty guilds correctly', async () => {
    // Don't create any transactions - test empty data handling
    const guildIds = testServers.map(s => s.guildId);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [tipStats, gameStats, groupTipStats, activeUsersByGuild] = await Promise.all([
      prisma.transaction.groupBy({
        by: ['guildId'],
        where: { 
          guildId: { in: guildIds },
          type: 'TIP' 
        },
        _count: { id: true },
        _sum: { amount: true }
      }),

      prisma.transaction.groupBy({
        by: ['guildId'],
        where: { 
          guildId: { in: guildIds },
          type: { in: ['MATCH_RAKE', 'MATCH_WIN'] }
        },
        _count: { id: true }
      }),

      prisma.groupTip.groupBy({
        by: ['guildId'],
        where: { 
          guildId: { in: guildIds },
          status: { in: ['FINALIZED', 'REFUNDED'] }
        },
        _count: { id: true }
      }),

      prisma.transaction.groupBy({
        by: ['guildId', 'userId'],
        where: { 
          guildId: { in: guildIds },
          createdAt: { gte: thirtyDaysAgo },
          userId: { not: null }
        },
        _count: { id: true }
      })
    ]);

    // Should return empty arrays when no data exists
    assert.strictEqual(tipStats.length, 0, 'Should have no tip stats for empty guilds');
    assert.strictEqual(gameStats.length, 0, 'Should have no game stats for empty guilds');
    assert.strictEqual(groupTipStats.length, 0, 'Should have no group tip stats for empty guilds');
    assert.strictEqual(activeUsersByGuild.length, 0, 'Should have no active users for empty guilds');

    // Build maps should handle empty results gracefully
    const tipStatsMap = new Map(tipStats.map(stat => [stat.guildId, { count: stat._count.id, volume: stat._sum.amount || 0 }]));
    const gameStatsMap = new Map(gameStats.map(stat => [stat.guildId, stat._count.id]));
    
    // Test that fallback values work correctly
    for (const guildId of guildIds) {
      const tipData = tipStatsMap.get(guildId) || { count: 0, volume: 0 };
      const gameCount = gameStatsMap.get(guildId) || 0;
      
      assert.strictEqual(tipData.count, 0, `Guild ${guildId} should have 0 tips`);
      assert.strictEqual(tipData.volume, 0, `Guild ${guildId} should have 0 volume`);
      assert.strictEqual(gameCount, 0, `Guild ${guildId} should have 0 games`);
    }
  });

  test('Active users calculation excludes old activity', async () => {
    const [guild1] = testServers;
    const [user1, user2, user3] = testUsers;

    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const twentyNineDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

    // Create transactions at different times
    await prisma.transaction.create({
      data: {
        type: 'TIP',
        userId: user1.id,
        guildId: guild1.guildId,
        tokenId: testToken.id,
        amount: 100,
        createdAt: thirtyOneDaysAgo // Too old
      }
    });

    await prisma.transaction.create({
      data: {
        type: 'TIP',
        userId: user2.id,
        guildId: guild1.guildId,
        tokenId: testToken.id,
        amount: 100,
        createdAt: twentyNineDaysAgo // Within 30 days
      }
    });

    await prisma.transaction.create({
      data: {
        type: 'TIP',
        userId: user3.id,
        guildId: guild1.guildId,
        tokenId: testToken.id,
        amount: 100,
        createdAt: oneDayAgo // Recent
      }
    });

    // Same user with multiple recent transactions should count only once
    await prisma.transaction.create({
      data: {
        type: 'MATCH_RAKE',
        userId: user3.id,
        guildId: guild1.guildId,
        tokenId: testToken.id,
        amount: 10,
        createdAt: oneDayAgo
      }
    });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Test the grouped query for active users
    const activeUsersByGuild = await prisma.transaction.groupBy({
      by: ['guildId', 'userId'],
      where: { 
        guildId: guild1.guildId,
        createdAt: { gte: thirtyDaysAgo },
        userId: { not: null }
      },
      _count: { id: true }
    });

    // Count unique users
    const uniqueUsers = new Set();
    for (const entry of activeUsersByGuild) {
      if (entry.userId) {
        uniqueUsers.add(entry.userId);
      }
    }

    assert.strictEqual(uniqueUsers.size, 2, 'Should count only users with activity in last 30 days (user2, user3)');
    assert(uniqueUsers.has(user2.id), 'Should include user2 (29 days ago)');
    assert(uniqueUsers.has(user3.id), 'Should include user3 (recent)');
    assert(!uniqueUsers.has(user1.id), 'Should not include user1 (31 days ago)');
  });

  test('Grouped query performance compared to N+1 pattern', async () => {
    const [guild1, guild2] = testServers;
    const [user1, user2] = testUsers;

    // Create test data
    await prisma.transaction.create({
      data: {
        type: 'TIP',
        userId: user1.id,
        guildId: guild1.guildId,
        tokenId: testToken.id,
        amount: 100
      }
    });

    await prisma.transaction.create({
      data: {
        type: 'TIP',
        userId: user2.id,
        guildId: guild2.guildId,
        tokenId: testToken.id,
        amount: 150
      }
    });

    const guildIds = testServers.map(s => s.guildId);

    // Test single grouped query approach
    const start = Date.now();
    
    const tipStats = await prisma.transaction.groupBy({
      by: ['guildId'],
      where: { 
        guildId: { in: guildIds },
        type: 'TIP' 
      },
      _count: { id: true },
      _sum: { amount: true }
    });

    const groupedQueryTime = Date.now() - start;

    // Verify results
    assert.strictEqual(tipStats.length, 2, 'Should return stats for 2 guilds with data');
    
    const guild1Stats = tipStats.find(s => s.guildId === guild1.guildId);
    const guild2Stats = tipStats.find(s => s.guildId === guild2.guildId);
    
    assert(guild1Stats, 'Guild1 should have stats');
    assert.strictEqual(guild1Stats._count.id, 1, 'Guild1 should have 1 tip');
    assert.strictEqual(Number(guild1Stats._sum.amount), 100, 'Guild1 should have 100 volume');
    
    assert(guild2Stats, 'Guild2 should have stats');
    assert.strictEqual(guild2Stats._count.id, 1, 'Guild2 should have 1 tip');
    assert.strictEqual(Number(guild2Stats._sum.amount), 150, 'Guild2 should have 150 volume');

    console.log(`Grouped query completed in ${groupedQueryTime}ms for ${guildIds.length} guilds`);

    // This demonstrates the performance benefit - single query instead of N queries
    assert(groupedQueryTime < 1000, 'Grouped query should complete quickly');
  });
});