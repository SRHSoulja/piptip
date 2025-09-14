// src/services/emergency_controls.ts - Emergency achievement system controls
import { prisma } from './db.js';
// Cache for app config to avoid DB hits on every request
let configCache = null;
const CACHE_TTL = 30000; // 30 seconds
async function getAppConfig() {
    const now = Date.now();
    if (configCache && (now - configCache.lastFetched) < CACHE_TTL) {
        return configCache;
    }
    try {
        const config = await prisma.appConfig.findFirst({
            select: {
                achievementsEnabled: true,
                streakProtectionEnabled: true
            }
        });
        configCache = {
            achievementsEnabled: config?.achievementsEnabled ?? true,
            streakProtectionEnabled: config?.streakProtectionEnabled ?? true,
            lastFetched: now
        };
        return configCache;
    }
    catch (error) {
        console.warn('Failed to fetch app config, using defaults:', error);
        // Fallback to enabled if DB is unavailable
        return {
            achievementsEnabled: true,
            streakProtectionEnabled: true,
            lastFetched: now
        };
    }
}
// Check if achievements are globally enabled
export async function areAchievementsEnabled() {
    const config = await getAppConfig();
    return config.achievementsEnabled;
}
// Check if streak protection is enabled
export async function isStreakProtectionEnabled() {
    const config = await getAppConfig();
    return config.streakProtectionEnabled;
}
// Emergency disable achievements
export async function disableAchievements() {
    await prisma.appConfig.updateMany({
        data: { achievementsEnabled: false }
    });
    // Clear cache
    configCache = null;
    console.log('🚨 EMERGENCY: Achievements system DISABLED');
}
// Emergency enable achievements
export async function enableAchievements() {
    await prisma.appConfig.updateMany({
        data: { achievementsEnabled: true }
    });
    // Clear cache
    configCache = null;
    console.log('✅ Achievements system ENABLED');
}
// Emergency disable streak protection
export async function disableStreakProtection() {
    await prisma.appConfig.updateMany({
        data: { streakProtectionEnabled: false }
    });
    // Clear cache
    configCache = null;
    console.log('🚨 EMERGENCY: Streak protection DISABLED');
}
// Get current emergency status
export async function getEmergencyStatus() {
    const config = await getAppConfig();
    return {
        ...config,
        lastChecked: new Date(config.lastFetched)
    };
}
