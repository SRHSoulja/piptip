const usernameCache = /* @__PURE__ */ new Map();
const avatarCache = /* @__PURE__ */ new Map();
const userDataCache = /* @__PURE__ */ new Map();
const servernameCache = /* @__PURE__ */ new Map();
const CACHE_DURATION = 5 * 60 * 1e3;
async function fetchDiscordUsername(client, discordId) {
  try {
    const cached = usernameCache.get(discordId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_DURATION) {
      return cached.username;
    }
    const user = await client.users.fetch(discordId);
    const username = user.username || user.displayName || `User#${discordId.slice(-4)}`;
    usernameCache.set(discordId, { username, fetchedAt: Date.now() });
    return username;
  } catch (error) {
    console.error(`Failed to fetch username for ${discordId}:`, error);
    return `User#${discordId.slice(-4)}`;
  }
}
async function fetchDiscordUserData(client, discordId) {
  try {
    const cached = userDataCache.get(discordId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_DURATION) {
      return { username: cached.username, avatarURL: cached.avatarURL };
    }
    const user = await client.users.fetch(discordId);
    const username = user.username || user.displayName || `User#${discordId.slice(-4)}`;
    const avatarURL = user.displayAvatarURL({ size: 256, extension: "png" });
    userDataCache.set(discordId, { username, avatarURL, fetchedAt: Date.now() });
    return { username, avatarURL };
  } catch (error) {
    console.error(`Failed to fetch user data for ${discordId}:`, error);
    return {
      username: `User#${discordId.slice(-4)}`,
      avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId.slice(-1), 10) % 6}.png`
      // Default Discord avatar
    };
  }
}
async function fetchMultipleUserData(client, discordIds) {
  const results = /* @__PURE__ */ new Map();
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
      if (result.status === "fulfilled") {
        results.set(discordId, result.value.userData);
      } else {
        results.set(discordId, {
          username: `User#${discordId.slice(-4)}`,
          avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId.slice(-1), 10) % 6}.png`
        });
      }
    });
    if (i + BATCH_SIZE < discordIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return results;
}
async function fetchMultipleUsernames(client, discordIds) {
  const results = /* @__PURE__ */ new Map();
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
      if (result.status === "fulfilled") {
        results.set(discordId, result.value.username);
      } else {
        results.set(discordId, `User#${discordId.slice(-4)}`);
      }
    });
    if (i + BATCH_SIZE < discordIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return results;
}
async function fetchDiscordServername(client, guildId) {
  try {
    const cached = servernameCache.get(guildId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_DURATION) {
      return cached.servername;
    }
    const guild = await client.guilds.fetch(guildId);
    const servername = guild.name || `Server#${guildId.slice(-4)}`;
    servernameCache.set(guildId, { servername, fetchedAt: Date.now() });
    return servername;
  } catch (error) {
    console.error(`Failed to fetch server name for ${guildId}:`, error);
    return `Server#${guildId.slice(-4)}`;
  }
}
async function fetchMultipleServernames(client, guildIds) {
  const results = /* @__PURE__ */ new Map();
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
      if (result.status === "fulfilled") {
        results.set(guildId, result.value.servername);
      } else {
        results.set(guildId, `Server#${guildId.slice(-4)}`);
      }
    });
    if (i + BATCH_SIZE < guildIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return results;
}
let globalClient = null;
function setDiscordClient(client) {
  globalClient = client;
}
function getDiscordClient() {
  return globalClient;
}
export {
  fetchDiscordServername,
  fetchDiscordUserData,
  fetchDiscordUsername,
  fetchMultipleServernames,
  fetchMultipleUserData,
  fetchMultipleUsernames,
  getDiscordClient,
  setDiscordClient
};
//# sourceMappingURL=discord_users.js.map
