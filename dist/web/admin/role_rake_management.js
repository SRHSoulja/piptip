// src/web/admin/role_rake_management.ts - Admin interface for Discord role rake reductions
import { Router } from 'express';
import { prisma } from '../../services/db.js';
import { RoleRakeReductionService } from '../../services/role_rake_benefits.js';
import { getDiscordClient } from '../../services/discord_users.js';
const router = Router();
// Authentication is handled by the global admin middleware - no need for duplicate auth here
// GET /admin/role-rake - List all role rake reductions
router.get('/', async (req, res) => {
    try {
        const { guildId } = req.query;
        const reductions = await RoleRakeReductionService.getAllActiveReductions(guildId);
        // Enrich with Discord role names
        const enrichedReductions = await Promise.all(reductions.map(async (reduction) => {
            try {
                const discord = getDiscordClient();
                const guild = await discord?.guilds.fetch(reduction.guildId);
                const role = await guild?.roles.fetch(reduction.roleId);
                return {
                    ...reduction,
                    roleName: role?.name || 'Unknown Role',
                    guildName: guild?.name || 'Unknown Server',
                    memberCount: role?.members.size || 0,
                    reductionPercentage: Number(reduction.rakeReductionBps) / 100 // Convert BPS to percentage
                };
            }
            catch {
                return {
                    ...reduction,
                    roleName: 'Role Not Found',
                    guildName: 'Server Not Found',
                    memberCount: 0,
                    reductionPercentage: Number(reduction.rakeReductionBps) / 100
                };
            }
        }));
        res.json({
            success: true,
            reductions: enrichedReductions,
            total: reductions.length
        });
    }
    catch (error) {
        res.status(500).json({
            error: 'Failed to fetch role rake reductions',
            details: String(error)
        });
    }
});
// POST /admin/role-rake - Create new role rake reduction
router.post('/', async (req, res) => {
    try {
        const { roleId, guildId, rakeReductionBps, duration, label, notes } = req.body;
        // Validation
        const errors = [];
        if (!roleId || !/^\d{17,20}$/.test(roleId)) {
            errors.push('Valid Discord role ID required');
        }
        if (!guildId || !/^\d{17,20}$/.test(guildId)) {
            errors.push('Valid Discord guild ID required');
        }
        if (rakeReductionBps === undefined || rakeReductionBps < 0 || rakeReductionBps > 10000) {
            errors.push('Rake reduction must be 0-10000 basis points (0-100%)');
        }
        if (!label || label.length < 3 || label.length > 50) {
            errors.push('Label must be 3-50 characters');
        }
        if (duration && (duration < 1 || duration > 365)) {
            errors.push('Duration must be 1-365 days');
        }
        if (errors.length > 0) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors
            });
        }
        // Verify role and guild exist
        try {
            const discord = getDiscordClient();
            const guild = await discord?.guilds.fetch(guildId);
            if (!guild) {
                return res.status(400).json({
                    error: 'Discord server not found or bot not in server'
                });
            }
            const role = await guild.roles.fetch(roleId);
            if (!role) {
                return res.status(400).json({
                    error: 'Discord role not found in server'
                });
            }
            // Create rake reduction
            await RoleRakeReductionService.createRoleRakeReduction({
                roleId,
                guildId,
                rakeReductionBps: Number(rakeReductionBps),
                duration: duration ? Number(duration) : undefined,
                label,
                createdBy: 'admin', // TODO: Get from JWT or session
                notes
            });
            res.json({
                success: true,
                message: `Rake reduction created for role "${role.name}" in server "${guild.name}"`,
                reduction: {
                    roleId,
                    guildId,
                    roleName: role.name,
                    guildName: guild.name,
                    rakeReductionBps,
                    reductionPercentage: Number(rakeReductionBps) / 100,
                    duration,
                    label,
                    memberCount: role.members.size
                }
            });
        }
        catch (discordError) {
            return res.status(400).json({
                error: 'Discord verification failed',
                details: String(discordError)
            });
        }
    }
    catch (error) {
        res.status(500).json({
            error: 'Failed to create role rake reduction',
            details: String(error)
        });
    }
});
// DELETE /admin/role-rake/:id - Remove role rake reduction
router.delete('/:id', async (req, res) => {
    try {
        const reductionId = parseInt(req.params.id);
        if (isNaN(reductionId)) {
            return res.status(400).json({ error: 'Invalid reduction ID' });
        }
        const reduction = await prisma.roleRakeReduction.findUnique({
            where: { id: reductionId }
        });
        if (!reduction) {
            return res.status(404).json({ error: 'Role rake reduction not found' });
        }
        await prisma.roleRakeReduction.update({
            where: { id: reductionId },
            data: { isActive: false }
        });
        res.json({
            success: true,
            message: `Role rake reduction for "${reduction.label}" has been deactivated`
        });
    }
    catch (error) {
        res.status(500).json({
            error: 'Failed to remove role rake reduction',
            details: String(error)
        });
    }
});
// PUT /admin/role-rake/:id - Update existing reduction
router.put('/:id', async (req, res) => {
    try {
        const reductionId = parseInt(req.params.id);
        const { rakeReductionBps, duration, label, notes, isActive } = req.body;
        if (isNaN(reductionId)) {
            return res.status(400).json({ error: 'Invalid reduction ID' });
        }
        const reduction = await prisma.roleRakeReduction.findUnique({
            where: { id: reductionId }
        });
        if (!reduction) {
            return res.status(404).json({ error: 'Role rake reduction not found' });
        }
        // Calculate new expiry date if duration changed
        const expiresAt = duration
            ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000)
            : null;
        const updated = await prisma.roleRakeReduction.update({
            where: { id: reductionId },
            data: {
                ...(rakeReductionBps !== undefined && { rakeReductionBps: Number(rakeReductionBps) }),
                ...(duration !== undefined && { expiresAt }),
                ...(label !== undefined && { label }),
                ...(notes !== undefined && { notes }),
                ...(isActive !== undefined && { isActive: Boolean(isActive) })
            }
        });
        res.json({
            success: true,
            message: 'Role rake reduction updated successfully',
            reduction: {
                ...updated,
                reductionPercentage: Number(updated.rakeReductionBps) / 100
            }
        });
    }
    catch (error) {
        res.status(500).json({
            error: 'Failed to update role rake reduction',
            details: String(error)
        });
    }
});
// GET /admin/role-rake/preview/:guildId/:roleId - Preview role before creating reduction
router.get('/preview/:guildId/:roleId', async (req, res) => {
    try {
        const { guildId, roleId } = req.params;
        const discord = getDiscordClient();
        if (!discord) {
            return res.status(500).json({ error: 'Discord client not available' });
        }
        const guild = await discord.guilds.fetch(guildId);
        if (!guild) {
            return res.status(404).json({ error: 'Discord server not found' });
        }
        const role = await guild.roles.fetch(roleId);
        if (!role) {
            return res.status(404).json({ error: 'Discord role not found' });
        }
        // Check if reduction already exists
        const existingReduction = await prisma.roleRakeReduction.findUnique({
            where: { roleId_guildId: { roleId, guildId } }
        });
        res.json({
            success: true,
            preview: {
                roleName: role.name,
                roleColor: role.hexColor,
                guildName: guild.name,
                memberCount: role.members.size,
                position: role.position,
                isManaged: role.managed,
                existingReduction: existingReduction ? {
                    rakeReductionBps: existingReduction.rakeReductionBps,
                    reductionPercentage: Number(existingReduction.rakeReductionBps) / 100,
                    label: existingReduction.label,
                    isActive: existingReduction.isActive
                } : null
            }
        });
    }
    catch (error) {
        res.status(500).json({
            error: 'Failed to preview role',
            details: String(error)
        });
    }
});
// GET /admin/role-rake/stats - Get usage statistics
router.get('/stats', async (req, res) => {
    try {
        const stats = await prisma.roleRakeReduction.groupBy({
            by: ['guildId'],
            where: { isActive: true },
            _count: { id: true },
            _avg: { rakeReductionBps: true }
        });
        const totalActive = await prisma.roleRakeReduction.count({
            where: { isActive: true }
        });
        const recentlyCreated = await prisma.roleRakeReduction.count({
            where: {
                createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
            }
        });
        res.json({
            success: true,
            stats: {
                totalActive,
                recentlyCreated,
                guildBreakdown: stats.map(stat => ({
                    ...stat,
                    avgReductionPercentage: stat._avg.rakeReductionBps ? Number(stat._avg.rakeReductionBps) / 100 : 0
                })),
                uniqueGuilds: stats.length
            }
        });
    }
    catch (error) {
        res.status(500).json({
            error: 'Failed to get role rake statistics',
            details: String(error)
        });
    }
});
export default router;
