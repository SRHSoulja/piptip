// Cache for usernames and server names to avoid repeated API calls
const usernameCache = new Map();
const servernameCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
export async function fetchDiscordUsername(client, discordId) {
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
    }
    catch (error) {
        console.error(`Failed to fetch username for ${discordId}:`, error);
        return `User#${discordId.slice(-4)}`;
    }
}
export async function fetchMultipleUsernames(client, discordIds) {
    const results = new Map();
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
            }
            else {
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
export async function fetchDiscordServername(client, guildId) {
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
    }
    catch (error) {
        console.error(`Failed to fetch server name for ${guildId}:`, error);
        return `Server#${guildId.slice(-4)}`;
    }
}
export async function fetchMultipleServernames(client, guildIds) {
    const results = new Map();
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
            }
            else {
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
let globalClient = null;
export function setDiscordClient(client) {
    globalClient = client;
}
export function getDiscordClient() {
    return globalClient;
}
