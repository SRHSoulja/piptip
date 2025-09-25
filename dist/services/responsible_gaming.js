// src/services/responsible_gaming.ts - Responsible gaming protection features
import { prisma } from './db.js';
class ResponsibleGamingService {
    DEFAULT_DAILY_LOSS_LIMIT = 1000; // Default max daily loss in tokens
    DEFAULT_DAILY_PREDICTION_LIMIT = 20; // Max predictions per day
    MIN_AGE_REMINDER_DAYS = 30; // Show age reminder every 30 days
    /**
     * Check if user can place a prediction based on responsible gaming limits
     */
    async canUserPredict(userId, amount, tokenSymbol) {
        try {
            // Check self-exclusion status
            const exclusionCheck = await this.checkSelfExclusion(userId);
            if (!exclusionCheck.allowed) {
                return exclusionCheck;
            }
            // Get or create user limits
            const limits = await this.getUserLimits(userId);
            // Check daily prediction count limit
            if (limits.currentDailyPredictions >= limits.maxDailyPredictions) {
                return {
                    allowed: false,
                    reason: `Daily prediction limit reached (${limits.maxDailyPredictions})`,
                    suggestion: 'Take a break and come back tomorrow for more predictions.'
                };
            }
            // Check daily loss limit (only check if they've had losses today)
            if (limits.currentDailyLoss + amount > limits.maxDailyLoss) {
                return {
                    allowed: false,
                    reason: `This prediction would exceed your daily loss limit of ${limits.maxDailyLoss} ${tokenSymbol}`,
                    suggestion: 'Consider setting a lower daily limit or taking a break.'
                };
            }
            // All checks passed
            return { allowed: true };
        }
        catch (error) {
            console.error('Error checking responsible gaming limits:', error);
            // Fail safe - allow prediction but log error
            return { allowed: true };
        }
    }
    /**
     * Check if user is self-excluded
     */
    async checkSelfExclusion(userId) {
        try {
            const user = await prisma.user.findFirst({
                where: { discordId: userId }
            });
            if (user?.predictionSelfExcluded) {
                const exclusionEnd = user.predictionSelfExclusionEnd;
                if (!exclusionEnd || new Date() < exclusionEnd) {
                    const endDate = exclusionEnd ? exclusionEnd.toLocaleDateString() : 'permanently';
                    return {
                        allowed: false,
                        reason: `You are currently self-excluded from predictions until ${endDate}`,
                        suggestion: 'If you need support, visit https://www.ncpgambling.org/ or call 1-800-522-4700'
                    };
                }
                else {
                    // Exclusion period ended, remove it
                    await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            predictionSelfExcluded: false,
                            predictionSelfExclusionEnd: null
                        }
                    });
                }
            }
            return { allowed: true };
        }
        catch (error) {
            console.error('Error checking self-exclusion:', error);
            return { allowed: true }; // Fail safe
        }
    }
    /**
     * Self-exclude user from predictions
     */
    async selfExclude(userId, durationHours) {
        try {
            const user = await prisma.user.findFirst({
                where: { discordId: userId }
            });
            if (!user) {
                return {
                    success: false,
                    message: 'User account not found. Use `/pip_profile` to create an account first.'
                };
            }
            const exclusionEnd = durationHours ?
                new Date(Date.now() + durationHours * 60 * 60 * 1000) :
                null; // Permanent if no duration
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    predictionSelfExcluded: true,
                    predictionSelfExclusionEnd: exclusionEnd
                }
            });
            const durationText = durationHours ?
                `for ${durationHours} hours` :
                'permanently';
            return {
                success: true,
                message: `✅ You have been self-excluded from predictions ${durationText}.\n\n` +
                    'Remember: Predictions should only be for entertainment.\n' +
                    'If you need support: https://www.ncpgambling.org/ or call 1-800-522-4700'
            };
        }
        catch (error) {
            console.error('Error setting self-exclusion:', error);
            return {
                success: false,
                message: 'Failed to process self-exclusion. Please try again.'
            };
        }
    }
    /**
     * Get or create user responsible gaming limits
     */
    async getUserLimits(userId) {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        try {
            // Try to get existing limits for user
            const user = await prisma.user.findFirst({
                where: { discordId: userId },
                select: {
                    id: true,
                    predictionDailyLossLimit: true,
                    predictionDailyCountLimit: true,
                    predictionLimitsLastReset: true,
                    predictionSelfExcluded: true,
                    predictionSelfExclusionEnd: true
                }
            });
            if (!user) {
                throw new Error('User not found');
            }
            const lastReset = user.predictionLimitsLastReset?.toISOString().split('T')[0];
            const isNewDay = lastReset !== today;
            // Get today's prediction activity
            const todaysPredictions = await prisma.predictionParticipation.count({
                where: {
                    userId: userId,
                    createdAt: {
                        gte: new Date(today + 'T00:00:00.000Z'),
                        lt: new Date(new Date(today).getTime() + 24 * 60 * 60 * 1000)
                    }
                }
            });
            // Calculate today's losses (simplified - actual losses would need market resolution data)
            // For now, we'll track total amount participated today as potential loss
            const todaysParticipationAmount = await prisma.predictionParticipation.aggregate({
                where: {
                    userId: userId,
                    createdAt: {
                        gte: new Date(today + 'T00:00:00.000Z'),
                        lt: new Date(new Date(today).getTime() + 24 * 60 * 60 * 1000)
                    }
                },
                _sum: {
                    amount: true
                }
            });
            const currentDailyLoss = todaysParticipationAmount._sum.amount || 0;
            // Reset daily counters if it's a new day
            if (isNewDay) {
                await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        predictionLimitsLastReset: new Date()
                    }
                });
            }
            return {
                userId,
                maxDailyLoss: user.predictionDailyLossLimit || this.DEFAULT_DAILY_LOSS_LIMIT,
                maxDailyPredictions: user.predictionDailyCountLimit || this.DEFAULT_DAILY_PREDICTION_LIMIT,
                currentDailyLoss,
                currentDailyPredictions: todaysPredictions,
                lastResetDate: today,
                selfExcluded: user.predictionSelfExcluded || false,
                selfExclusionEnd: user.predictionSelfExclusionEnd || undefined
            };
        }
        catch (error) {
            console.error('Error getting user limits:', error);
            // Return default safe limits
            return {
                userId,
                maxDailyLoss: this.DEFAULT_DAILY_LOSS_LIMIT,
                maxDailyPredictions: this.DEFAULT_DAILY_PREDICTION_LIMIT,
                currentDailyLoss: 0,
                currentDailyPredictions: 0,
                lastResetDate: today,
                selfExcluded: false
            };
        }
    }
    /**
     * Update user's responsible gaming limits
     */
    async updateUserLimits(userId, limits) {
        try {
            const user = await prisma.user.findFirst({
                where: { discordId: userId }
            });
            if (!user) {
                return {
                    success: false,
                    message: 'User account not found.'
                };
            }
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    predictionDailyLossLimit: limits.maxDailyLoss,
                    predictionDailyCountLimit: limits.maxDailyPredictions
                }
            });
            return {
                success: true,
                message: '✅ Your prediction limits have been updated successfully.'
            };
        }
        catch (error) {
            console.error('Error updating user limits:', error);
            return {
                success: false,
                message: 'Failed to update limits. Please try again.'
            };
        }
    }
    /**
     * Get responsible gaming status and statistics for user
     */
    async getUserStatus(userId) {
        const limits = await this.getUserLimits(userId);
        // Get weekly statistics
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const [weeklyPredictions, weeklyParticipationAmount, user] = await Promise.all([
            prisma.predictionParticipation.count({
                where: {
                    userId: userId,
                    createdAt: { gte: weekAgo }
                }
            }),
            prisma.predictionParticipation.aggregate({
                where: {
                    userId: userId,
                    createdAt: { gte: weekAgo }
                },
                _sum: { amount: true }
            }),
            prisma.user.findFirst({
                where: { discordId: userId },
                select: { lastAgeReminderShown: true }
            })
        ]);
        const lastAgeReminder = user?.lastAgeReminderShown;
        const needsAgeReminder = !lastAgeReminder ||
            (Date.now() - lastAgeReminder.getTime()) > (this.MIN_AGE_REMINDER_DAYS * 24 * 60 * 60 * 1000);
        return {
            limits,
            weeklyStats: {
                predictionsThisWeek: weeklyPredictions,
                potentialLossThisWeek: weeklyParticipationAmount._sum.amount || 0
            },
            lastAgeReminderShown: lastAgeReminder || undefined,
            needsAgeReminder
        };
    }
    /**
     * Record that age reminder was shown to user
     */
    async recordAgeReminderShown(userId) {
        try {
            const user = await prisma.user.findFirst({
                where: { discordId: userId }
            });
            if (user) {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { lastAgeReminderShown: new Date() }
                });
            }
        }
        catch (error) {
            console.error('Error recording age reminder:', error);
        }
    }
    /**
     * Generate responsible gaming reminder message
     */
    generateResponsibleGamingMessage() {
        return `
🛡️ **Responsible Gaming Reminder**

• **18+ Only**: You must be 18 or older to participate in predictions
• **Entertainment Only**: Predictions are for entertainment purposes only
• **Never Predict More Than You Can Afford to Lose**
• **Set Limits**: Use \`/predictions limits\` to set daily limits
• **Take Breaks**: Regular breaks help maintain healthy prediction habits
• **Self-Exclude**: Use \`/predictions exclude\` if you need a break

**Need Help?**
• National Problem Gambling Helpline: **1-800-522-4700**
• Online Support: **https://www.ncpgambling.org/**
• Crisis Text Line: Text HOME to **741741**

Remember: The house always has an edge, and predictions should never be your primary source of income.
    `.trim();
    }
}
export const responsibleGaming = new ResponsibleGamingService();
