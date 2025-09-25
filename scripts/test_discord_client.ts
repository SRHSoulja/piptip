#!/usr/bin/env tsx
import { getDiscordClient } from '../src/services/discord_users';

async function testDiscordClient() {
  try {
    const client = getDiscordClient();
    console.log('Discord client available:', client !== null && client !== undefined);

    if (client) {
      console.log('Client user:', client.user?.username || 'not logged in');
      console.log('Client ready:', client.isReady());

      if (client.isReady()) {
        try {
          // Test fetching a user
          const testUser = await client.users.fetch('403807194308673537');
          console.log('Test user fetch success:', testUser.username || testUser.displayName);
        } catch (error: any) {
          console.error('Error fetching test user:', error.message);
        }
      } else {
        console.log('Discord client is not ready yet');
      }
    }
  } catch (error) {
    console.error('Error testing Discord client:', error);
  }
}

testDiscordClient();