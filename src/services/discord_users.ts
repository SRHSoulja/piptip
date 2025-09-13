// src/services/discord_users.ts
import { Client } from "discord.js";
import { prisma } from "./db.js";

// Cache for usernames, avatars, and server names to avoid repeated API calls
const usernameCache = new Map<string, { username: string, fetchedAt: number }>();
const avatarCache = new Map<string, { avatarURL: string, fetchedAt: number }>();
const userDataCache = new Map<string, { username: string, avatarURL: string, fetchedAt: number }>();
const servernameCache = new Map<string, { servername: string, fetchedAt: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function fetchDiscordUsername(client: Client, discordId: string): Promise<string> {
  try {
    // Check cache first
    const cached = usernameCache.get(discordId);
    if (cached && (Date.now() - cached.fetchedAt) < CACHE_DURATION) {
      return cached.username;
    }

    // Fetch from Discord API
    const user = await client.users.fetch(discordId);
    const username = user.username || user.displayName || `User#${discordId.slice(-4)}`;
    
    // Cache the result
    usernameCache.set(discordId, { username, fetchedAt: Date.now() });
    
    return username;
  } catch (error) {
    console.error(`Failed to fetch username for ${discordId}:`, error);
    return `User#${discordId.slice(-4)}`;
  }
}

// Enhanced function to fetch both username and avatar
export async function fetchDiscordUserData(client: Client, discordId: string): Promise<{ username: string, avatarURL: string }> {
  try {
    // Check cache first
    const cached = userDataCache.get(discordId);
    if (cached && (Date.now() - cached.fetchedAt) < CACHE_DURATION) {
      return { username: cached.username, avatarURL: cached.avatarURL };
    }

    // Fetch from Discord API
    const user = await client.users.fetch(discordId);
    const username = user.username || user.displayName || `User#${discordId.slice(-4)}`;
    const avatarURL = user.displayAvatarURL({ size: 256, extension: 'png' });
    
    // Cache the result
    userDataCache.set(discordId, { username, avatarURL, fetchedAt: Date.now() });
    
    return { username, avatarURL };
  } catch (error) {
    console.error(`Failed to fetch user data for ${discordId}:`, error);
    return { 
      username: `User#${discordId.slice(-4)}`,
      avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId.slice(-1)) % 6}.png` // Default Discord avatar
    };
  }
}

// Fetch multiple users with both usernames and avatars
export async function fetchMultipleUserData(client: Client, discordIds: string[]): Promise<Map<string, { username: string, avatarURL: string }>> {
  const results = new Map<string, { username: string, avatarURL: string }>();
  
  // Process in batches to avoid rate limiting
  const BATCH_SIZE = 10;
  for (let i = 0; i < discordIds.length; i += BATCH_SIZE) {
    const batch = discordIds.slice(i, i + BATCH_SIZE);
    
    const promises = batch.map(async (id) => {
      const userData = await fetchDiscordUserData(client, id);
      return { id, userData };
    });
    
    const batchResults = await Promise.allSettled(promises);
    
    batchResults.forEach((result, index) => {
      const discordId = batch[index];
      if (result.status === 'fulfilled') {
        results.set(discordId, result.value.userData);
      } else {
        // Fallback for failed requests
        results.set(discordId, { 
          username: `User#${discordId.slice(-4)}`,
          avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId.slice(-1)) % 6}.png`
        });
      }
    });
    
    // Small delay between batches to be nice to Discord API
    if (i + BATCH_SIZE < discordIds.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return results;
}

export async function fetchMultipleUsernames(client: Client, discordIds: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  
  // Process in batches to avoid rate limiting
  const BATCH_SIZE = 10;
  for (let i = 0; i < discordIds.length; i += BATCH_SIZE) {
    const batch = discordIds.slice(i, i + BATCH_SIZE);
    
    const promises = batch.map(async (id) => {
      const username = await fetchDiscordUsername(client, id);
      return { id, username };
    });
    
    const batchResults = await Promise.allSettled(promises);
    
    batchResults.forEach((result, index) => {
      const discordId = batch[index];
      if (result.status === 'fulfilled') {
        results.set(discordId, result.value.username);
      } else {
        results.set(discordId, `User#${discordId.slice(-4)}`);
      }
    });
    
    // Small delay between batches to be nice to Discord API
    if (i + BATCH_SIZE < discordIds.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return results;
}

export async function fetchDiscordServername(client: Client, guildId: string): Promise<string> {
  try {
    // Check cache first
    const cached = servernameCache.get(guildId);
    if (cached && (Date.now() - cached.fetchedAt) < CACHE_DURATION) {
      return cached.servername;
    }

    // Fetch from Discord API
    const guild = await client.guilds.fetch(guildId);
    const servername = guild.name || `Server#${guildId.slice(-4)}`;
    
    // Cache the result
    servernameCache.set(guildId, { servername, fetchedAt: Date.now() });
    
    return servername;
  } catch (error) {
    console.error(`Failed to fetch server name for ${guildId}:`, error);
    return `Server#${guildId.slice(-4)}`;
  }
}

export async function fetchMultipleServernames(client: Client, guildIds: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  
  // Process in batches to avoid rate limiting
  const BATCH_SIZE = 10;
  for (let i = 0; i < guildIds.length; i += BATCH_SIZE) {
    const batch = guildIds.slice(i, i + BATCH_SIZE);
    
    const promises = batch.map(async (id) => {
      const servername = await fetchDiscordServername(client, id);
      return { id, servername };
    });
    
    const batchResults = await Promise.allSettled(promises);
    
    batchResults.forEach((result, index) => {
      const guildId = batch[index];
      if (result.status === 'fulfilled') {
        results.set(guildId, result.value.servername);
      } else {
        results.set(guildId, `Server#${guildId.slice(-4)}`);
      }
    });
    
    // Small delay between batches to be nice to Discord API
    if (i + BATCH_SIZE < guildIds.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return results;
}

// Global client reference for admin routes
let globalClient: Client | null = null;

export function setDiscordClient(client: Client) {
  globalClient = client;
}

export function getDiscordClient(): Client | null {
  return globalClient;
}