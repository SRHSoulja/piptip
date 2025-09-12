// tests/chart-debug.test.js - Debug chart optimization issues
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Chart debug', () => {
  let testUsers = [];
  let testToken;

  beforeEach(async () => {
    testToken = await prisma.token.create({
      data: {
        symbol: 'DEBUG',
        address: '0x' + Math.random().toString(16).substr(2, 40),
        decimals: 6,
        active: true
      }
    });

    for (let i = 0; i < 2; i++) {
      const user = await prisma.user.create({
        data: { discordId: `debug_user_${Date.now()}_${i}` }
      });
      testUsers.push(user);
    }
  });

  afterEach(async () => {
    await prisma.tip.deleteMany({ where: { tokenId: testToken.id } });
    await prisma.user.deleteMany({ where: { id: { in: testUsers.map(u => u.id) } } });
    await prisma.token.delete({ where: { id: testToken.id } });
    testUsers = [];
  });

  test('Debug date grouping behavior', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    
    console.log('Now:', now.toISOString());
    console.log('Yesterday:', yesterday.toISOString());

    // Create test tip
    const tip = await prisma.tip.create({
      data: {
        fromUserId: testUsers[0].id,
        toUserId: testUsers[1].id,
        tokenId: testToken.id,
        amountAtomic: 100,
        status: 'COMPLETED',
        createdAt: yesterday
      }
    });

    console.log('Created tip at:', tip.createdAt.toISOString());

    // Test raw query
    const results = await prisma.$queryRaw`
      SELECT 
        "createdAt",
        DATE("createdAt") as date,
        COUNT(*) as tip_count
      FROM "Tip"
      WHERE "tokenId" = ${testToken.id}
      GROUP BY DATE("createdAt"), "createdAt"
      ORDER BY "createdAt" DESC
    `;

    console.log('Query results:', results.map(r => ({ 
      createdAt: r.createdAt,
      date: r.date,
      tip_count: Number(r.tip_count)
    })));

    // Test simple count
    const count = await prisma.tip.count({
      where: { tokenId: testToken.id, status: 'COMPLETED' }
    });
    
    console.log('Total tip count:', count);
    
    assert.strictEqual(count, 1, 'Should have 1 tip');
  });
});