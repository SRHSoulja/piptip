#!/usr/bin/env tsx
import { getDiscordClient } from '../src/services/discord_users';
import { prisma } from '../src/services/db';

async function testSearchWithDiscord() {
  try {
    const client = getDiscordClient();
    console.log('Discord client available:', !!client);

    if (client) {
      console.log('Client ready:', client.isReady());
      console.log('Client user:', client.user?.username);

      // Test fetching a user
      try {
        const testUser = await client.users.fetch('403807194308673537');
        console.log('Test Discord fetch - Username:', testUser.username);
        console.log('Test Discord fetch - Display name:', testUser.displayName);
        console.log('Test Discord fetch - Global name:', testUser.globalName);
      } catch (error: any) {
        console.error('Error fetching Discord user:', error.message);
      }
    }

    // Test the search functionality like the API does
    const users = await prisma.user.findMany({
      where: {
        discordId: { not: "403807194308673537" }
      },
      select: {
        discordId: true,
        showInPenguBook: true,
        bio: true,
        wins: true
      },
      take: 3
    });

    console.log('\nFound users to test search with:');

    const enhancedUsers = await Promise.all(
      users.map(async user => {
        let displayName = `Player ${user.discordId.slice(-4)}`;
        let avatarURL = `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discordId.slice(-1)) % 6}.png`;

        if (client && client.isReady()) {
          try {
            const discordUser = await client.users.fetch(user.discordId);
            displayName = discordUser.displayName || discordUser.username || displayName;
            avatarURL = discordUser.displayAvatarURL({ size: 64 });
            console.log(`User ${user.discordId}: ${displayName} (original fallback: Player ${user.discordId.slice(-4)})`);
          } catch (error) {
            console.log(`Failed to fetch ${user.discordId}, using fallback: ${displayName}`);
          }
        }

        return {
          discordId: user.discordId,
          displayName,
          rawDisplayName: displayName,
          avatarURL
        };
      })
    );

    console.log('\nTesting search filters:');
    const testQueries = ['arson', 'dragon', 'the'];

    testQueries.forEach(query => {
      const filtered = enhancedUsers.filter(user => {
        const lowerQuery = query.toLowerCase();
        const matchesId = user.discordId.toLowerCase().includes(lowerQuery);
        const matchesName = user.rawDisplayName && !user.rawDisplayName.startsWith('Player ') &&
            user.rawDisplayName.toLowerCase().includes(lowerQuery);

        console.log(`Query "${query}" vs User ${user.discordId} (${user.rawDisplayName}):`);
        console.log(`  - ID match: ${matchesId}`);
        console.log(`  - Name match: ${matchesName}`);

        return matchesId || matchesName;
      });

      console.log(`Query "${query}" found ${filtered.length} results\n`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testSearchWithDiscord();