#!/usr/bin/env tsx
import { prisma } from '../src/services/db';

async function testUserSearch() {
  try {
    // Test the same query that the API would use
    const query = "403";

    console.log(`Testing search for query: "${query}"`);

    // Simulate the search query from the API
    const users = await prisma.user.findMany({
      where: {
        AND: [
          { discordId: { not: "403807194308673537" } }, // Exclude current user (your ID)
          {
            OR: [
              { discordId: { contains: query, mode: 'insensitive' } },
            ]
          }
        ]
      },
      select: {
        discordId: true,
        createdAt: true,
        wins: true,
        bio: true,
        showInPenguBook: true
      },
      take: 15,
      orderBy: [
        { showInPenguBook: 'desc' }, // PenguBook users first
        { wins: 'desc' }, // Popular users first
        { createdAt: 'desc' }
      ]
    });

    console.log(`Found ${users.length} users matching query "${query}":`);
    users.forEach((user, i) => {
      console.log(`${i+1}. Discord ID: ${user.discordId}`);
      console.log(`   PenguBook: ${user.showInPenguBook}`);
      console.log(`   Wins: ${user.wins}`);
      console.log(`   Bio: ${user.bio ? user.bio.substring(0, 50) + '...' : 'None'}`);
      console.log('');
    });

    // Test another search
    const query2 = "84334";
    console.log(`\nTesting search for query: "${query2}"`);

    const users2 = await prisma.user.findMany({
      where: {
        AND: [
          { discordId: { not: "403807194308673537" } },
          {
            OR: [
              { discordId: { contains: query2, mode: 'insensitive' } },
            ]
          }
        ]
      },
      select: {
        discordId: true,
        showInPenguBook: true,
        wins: true
      },
      take: 5
    });

    console.log(`Found ${users2.length} users matching query "${query2}":`);
    users2.forEach((user, i) => {
      console.log(`${i+1}. Discord ID: ${user.discordId}, PenguBook: ${user.showInPenguBook}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testUserSearch();