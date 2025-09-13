// src/web/admin/pengubook.ts - PenguBook moderation and management
import { Router } from "express";
import { prisma } from "../../services/db.js";
import { fetchMultipleUsernames, getDiscordClient } from "../../services/discord_users.js";
export const pengubookRouter = Router();
// Get all PenguBook profiles with moderation info
pengubookRouter.get("/pengubook/profiles", async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const showBanned = req.query.banned === 'true';
        const whereClause = showBanned
            ? { bio: { not: null }, isBanned: true }
            : { bio: { not: null } };
        const [profiles, totalCount] = await Promise.all([
            prisma.user.findMany({
                where: whereClause,
                select: {
                    id: true,
                    discordId: true,
                    bio: true,
                    bioLastUpdated: true,
                    bioViewCount: true,
                    xUsername: true,
                    showInPenguBook: true,
                    allowTipsFromBook: true,
                    isBanned: true,
                    bannedAt: true,
                    bannedReason: true,
                    bannedByAdminId: true,
                    createdAt: true,
                    _count: {
                        select: {
                            tipsSent: true,
                            tipsReceived: true,
                            penguBookMessagesSent: true,
                            penguBookMessagesReceived: true
                        }
                    }
                },
                orderBy: { bioLastUpdated: 'desc' },
                skip: offset,
                take: limit
            }),
            prisma.user.count({ where: whereClause })
        ]);
        // Fetch Discord usernames
        const discordIds = profiles.map(p => p.discordId);
        let usernames = new Map();
        try {
            const client = getDiscordClient();
            if (client && discordIds.length > 0) {
                usernames = await fetchMultipleUsernames(client, discordIds);
            }
        }
        catch (error) {
            console.warn("Failed to fetch usernames:", error);
        }
        const formattedProfiles = profiles.map(profile => ({
            ...profile,
            username: usernames.get(profile.discordId) || `User ${profile.discordId.slice(0, 8)}...`,
            bioPreview: profile.bio ? profile.bio.substring(0, 100) + (profile.bio.length > 100 ? '...' : '') : null
        }));
        res.json({
            ok: true,
            profiles: formattedProfiles,
            pagination: {
                page,
                limit,
                total: totalCount,
                pages: Math.ceil(totalCount / limit)
            }
        });
    }
    catch (error) {
        console.error("Failed to fetch PenguBook profiles:", error);
        res.status(500).json({ ok: false, error: "Failed to fetch profiles" });
    }
});
// Get specific profile details for moderation
pengubookRouter.get("/pengubook/profile/:discordId", async (req, res) => {
    try {
        const { discordId } = req.params;
        const profile = await prisma.user.findUnique({
            where: { discordId },
            include: {
                _count: {
                    select: {
                        tipsSent: true,
                        tipsReceived: true,
                        penguBookMessagesSent: true,
                        penguBookMessagesReceived: true,
                        profileViewsGiven: true,
                        profileViewsReceived: true
                    }
                },
                penguBookMessagesSent: {
                    take: 10,
                    orderBy: { createdAt: 'desc' },
                    include: {
                        to: { select: { discordId: true } },
                        tip: { select: { amountAtomic: true, Token: { select: { symbol: true } } } }
                    }
                },
                penguBookMessagesReceived: {
                    take: 10,
                    orderBy: { createdAt: 'desc' },
                    include: {
                        from: { select: { discordId: true } },
                        tip: { select: { amountAtomic: true, Token: { select: { symbol: true } } } }
                    }
                }
            }
        });
        if (!profile) {
            return res.status(404).json({ ok: false, error: "Profile not found" });
        }
        // Fetch Discord username
        let username = `User ${profile.discordId.slice(0, 8)}...`;
        try {
            const client = getDiscordClient();
            if (client) {
                const usernames = await fetchMultipleUsernames(client, [profile.discordId]);
                username = usernames.get(profile.discordId) || username;
            }
        }
        catch (error) {
            console.warn("Failed to fetch username:", error);
        }
        const formattedProfile = {
            ...profile,
            username
        };
        res.json({ ok: true, profile: formattedProfile });
    }
    catch (error) {
        console.error("Failed to fetch profile details:", error);
        res.status(500).json({ ok: false, error: "Failed to fetch profile" });
    }
});
// Ban a user from PIPTip
pengubookRouter.post("/pengubook/ban", async (req, res) => {
    try {
        const { discordId, reason, adminId } = req.body;
        if (!discordId || !reason || !adminId) {
            return res.status(400).json({
                ok: false,
                error: "Missing required fields: discordId, reason, adminId"
            });
        }
        const user = await prisma.user.findUnique({
            where: { discordId },
            select: { id: true, isBanned: true }
        });
        if (!user) {
            return res.status(404).json({ ok: false, error: "User not found" });
        }
        if (user.isBanned) {
            return res.status(400).json({ ok: false, error: "User is already banned" });
        }
        await prisma.user.update({
            where: { discordId },
            data: {
                isBanned: true,
                bannedAt: new Date(),
                bannedReason: reason,
                bannedByAdminId: adminId,
                // Hide from PenguBook when banned
                showInPenguBook: false,
                allowTipsFromBook: false
            }
        });
        res.json({ ok: true, message: "User banned successfully" });
    }
    catch (error) {
        console.error("Failed to ban user:", error);
        res.status(500).json({ ok: false, error: "Failed to ban user" });
    }
});
// Unban a user
pengubookRouter.post("/pengubook/unban", async (req, res) => {
    try {
        const { discordId } = req.body;
        if (!discordId) {
            return res.status(400).json({ ok: false, error: "discordId is required" });
        }
        const user = await prisma.user.findUnique({
            where: { discordId },
            select: { id: true, isBanned: true }
        });
        if (!user) {
            return res.status(404).json({ ok: false, error: "User not found" });
        }
        if (!user.isBanned) {
            return res.status(400).json({ ok: false, error: "User is not banned" });
        }
        await prisma.user.update({
            where: { discordId },
            data: {
                isBanned: false,
                bannedAt: null,
                bannedReason: null,
                bannedByAdminId: null,
                // Restore default PenguBook settings (they can change them if they want)
                showInPenguBook: true,
                allowTipsFromBook: true
            }
        });
        res.json({ ok: true, message: "User unbanned successfully" });
    }
    catch (error) {
        console.error("Failed to unban user:", error);
        res.status(500).json({ ok: false, error: "Failed to unban user" });
    }
});
// Delete a PenguBook profile (remove bio)
pengubookRouter.delete("/pengubook/profile/:discordId", async (req, res) => {
    try {
        const { discordId } = req.params;
        const user = await prisma.user.findUnique({
            where: { discordId },
            select: { id: true, bio: true }
        });
        if (!user) {
            return res.status(404).json({ ok: false, error: "User not found" });
        }
        if (!user.bio) {
            return res.status(400).json({ ok: false, error: "User has no PenguBook profile" });
        }
        await prisma.user.update({
            where: { discordId },
            data: {
                bio: null,
                bioLastUpdated: null,
                bioViewCount: 0,
                xUsername: null,
                showInPenguBook: false,
                allowTipsFromBook: false
            }
        });
        res.json({ ok: true, message: "PenguBook profile deleted" });
    }
    catch (error) {
        console.error("Failed to delete profile:", error);
        res.status(500).json({ ok: false, error: "Failed to delete profile" });
    }
});
// Get PenguBook statistics
pengubookRouter.get("/pengubook/stats", async (req, res) => {
    try {
        const [totalProfiles, activeProfiles, bannedUsers, totalMessages, recentProfiles, topViewedProfiles] = await Promise.all([
            prisma.user.count({ where: { bio: { not: null } } }),
            prisma.user.count({ where: { bio: { not: null }, showInPenguBook: true } }),
            prisma.user.count({ where: { isBanned: true } }),
            prisma.penguBookMessage.count(),
            prisma.user.count({
                where: {
                    bio: { not: null },
                    bioLastUpdated: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
                }
            }),
            prisma.user.findMany({
                where: { bio: { not: null }, showInPenguBook: true },
                select: { discordId: true, bioViewCount: true },
                orderBy: { bioViewCount: 'desc' },
                take: 5
            })
        ]);
        const stats = {
            totalProfiles,
            activeProfiles,
            bannedUsers,
            totalMessages,
            recentProfiles,
            topViewedProfiles
        };
        res.json({ ok: true, stats });
    }
    catch (error) {
        console.error("Failed to fetch PenguBook stats:", error);
        res.status(500).json({ ok: false, error: "Failed to fetch stats" });
    }
});
