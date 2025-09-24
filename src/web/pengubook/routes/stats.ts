// src/web/pengubook/routes/stats.ts - User statistics page
import { Request, Response } from "express";
import { getCurrentUser } from "../../auth.js";
import { findOrCreateUser } from "../../../services/user_helpers.js";
import { getUnreadMessageCount } from "../../../interactions/buttons/pengubook.js";
import { generateBaseHTML } from "../templates.js";
import { prisma } from "../../../services/db.js";
import { formatDecimal } from "../../../services/token.js";

export async function statsHandler(req: Request, res: Response) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.redirect("/auth/discord");

    const user = await findOrCreateUser(currentUser.discordId);
    const unreadCount = await getUnreadMessageCount(currentUser.discordId);

    // Get comprehensive statistics
    const [
      balances,
      activeMemberships,
      tipStatsSent,
      tipStatsReceived,
      groupTipStats,
      depositStats,
      withdrawStats,
      gameStats
    ] = await Promise.all([
      // Current token balances
      prisma.userBalance.findMany({
        where: { userId: user.id },
        include: { Token: true },
        orderBy: { amount: 'desc' }
      }),

      // Active tier memberships
      prisma.tierMembership.findMany({
        where: {
          userId: user.id,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() }
        },
        include: { tier: true },
        orderBy: { createdAt: 'desc' }
      }),

      // Tips sent stats
      prisma.tip.aggregate({
        where: { fromUserId: user.id },
        _count: { id: true },
        _sum: { amountAtomic: true }
      }),

      // Tips received stats
      prisma.tip.aggregate({
        where: { toUserId: user.id },
        _count: { id: true },
        _sum: { amountAtomic: true }
      }),

      // Group tip stats
      prisma.groupTip.aggregate({
        where: { creatorId: user.id },
        _count: { id: true },
        _sum: { totalAmount: true }
      }),

      // Deposit stats (using processed deposits as proxy)
      prisma.processedDeposit.count(),

      // Withdrawal stats
      prisma.withdrawalAttempt.aggregate({
        where: { userId: user.id },
        _count: { id: true },
        _sum: { amount: true }
      }),

      // Game match stats
      prisma.match.aggregate({
        where: {
          OR: [
            { challengerId: user.id },
            { joinerId: user.id }
          ],
          status: 'COMPLETED'
        },
        _count: { id: true }
      })
    ]);

    const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const winRate = user.wins + user.losses > 0 ?
      ((user.wins / (user.wins + user.losses)) * 100).toFixed(1) : '0.0';

    const content = `
    <div class="pg-container">
        <h1 style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-800);">📊 Statistics</h1>

        <!-- Overview Cards -->
        <div class="pg-stats-overview">
            <div class="pg-stat-highlight-card">
                <div class="pg-stat-icon">🎮</div>
                <div class="pg-stat-content">
                    <div class="pg-stat-number">${user.wins}</div>
                    <div class="pg-stat-label">Total Wins</div>
                </div>
            </div>

            <div class="pg-stat-highlight-card">
                <div class="pg-stat-icon">📈</div>
                <div class="pg-stat-content">
                    <div class="pg-stat-number">${winRate}%</div>
                    <div class="pg-stat-label">Win Rate</div>
                </div>
            </div>

            <div class="pg-stat-highlight-card">
                <div class="pg-stat-icon">💸</div>
                <div class="pg-stat-content">
                    <div class="pg-stat-number">${tipStatsSent._count.id || 0}</div>
                    <div class="pg-stat-label">Tips Sent</div>
                </div>
            </div>

            <div class="pg-stat-highlight-card">
                <div class="pg-stat-icon">💰</div>
                <div class="pg-stat-content">
                    <div class="pg-stat-number">${tipStatsReceived._count.id || 0}</div>
                    <div class="pg-stat-label">Tips Received</div>
                </div>
            </div>
        </div>

        <!-- Gaming Statistics -->
        <div class="pg-card" style="margin-top: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">🎮 Gaming Stats</h2>

            <div class="pg-stats-grid">
                <div class="pg-stat-item">
                    <div class="pg-stat-value">${user.wins}</div>
                    <div class="pg-stat-label">Wins</div>
                </div>
                <div class="pg-stat-item">
                    <div class="pg-stat-value">${user.losses}</div>
                    <div class="pg-stat-label">Losses</div>
                </div>
                <div class="pg-stat-item">
                    <div class="pg-stat-value">${user.ties}</div>
                    <div class="pg-stat-label">Ties</div>
                </div>
                <div class="pg-stat-item">
                    <div class="pg-stat-value">${gameStats._count.id || 0}</div>
                    <div class="pg-stat-label">Total Games</div>
                </div>
                <div class="pg-stat-item">
                    <div class="pg-stat-value">${accountAge}</div>
                    <div class="pg-stat-label">Days Active</div>
                </div>
                <div class="pg-stat-item">
                    <div class="pg-stat-value">${user.bioViewCount || 0}</div>
                    <div class="pg-stat-label">Profile Views</div>
                </div>
            </div>
        </div>

        <!-- Tipping Statistics -->
        <div class="pg-card" style="margin-top: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">💸 Tipping Activity</h2>

            <div class="pg-tipping-stats">
                <div class="pg-tip-stat-section">
                    <h3 style="color: var(--pg-primary-600); margin-bottom: var(--pg-space-3);">Tips Sent</h3>
                    <div class="pg-tip-stat-row">
                        <span>Total Tips:</span>
                        <span class="pg-tip-stat-value">${tipStatsSent._count?.id || 0}</span>
                    </div>
                </div>

                <div class="pg-tip-stat-section">
                    <h3 style="color: var(--pg-green-600); margin-bottom: var(--pg-space-3);">Tips Received</h3>
                    <div class="pg-tip-stat-row">
                        <span>Total Tips:</span>
                        <span class="pg-tip-stat-value">${tipStatsReceived._count.id || 0}</span>
                    </div>
                </div>

                <div class="pg-tip-stat-section">
                    <h3 style="color: var(--pg-yellow-600); margin-bottom: var(--pg-space-3);">Group Tips</h3>
                    <div class="pg-tip-stat-row">
                        <span>Created:</span>
                        <span class="pg-tip-stat-value">${groupTipStats._count.id || 0}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Financial Overview -->
        <div class="pg-card" style="margin-top: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">💰 Financial Overview</h2>

            <div class="pg-financial-stats">
                <div class="pg-financial-section">
                    <h3 style="color: var(--pg-green-600); margin-bottom: var(--pg-space-3);">📥 Deposits</h3>
                    <div class="pg-financial-row">
                        <span>Total Deposits:</span>
                        <span class="pg-financial-value">${depositStats || 0} transactions</span>
                    </div>
                </div>

                <div class="pg-financial-section">
                    <h3 style="color: var(--pg-red-600); margin-bottom: var(--pg-space-3);">📤 Withdrawals</h3>
                    <div class="pg-financial-row">
                        <span>Total Withdrawals:</span>
                        <span class="pg-financial-value">${withdrawStats._count.id || 0} transactions</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Current Balances -->
        ${balances.length > 0 ? `
        <div class="pg-card" style="margin-top: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">💳 Current Balances</h2>

            <div class="pg-balance-display">
                ${balances.map((balance: any) => `
                    <div class="pg-balance-row">
                        <div class="pg-balance-token">${balance.Token.symbol}</div>
                        <div class="pg-balance-amount">${formatDecimal(balance.amount, balance.Token.decimals)}</div>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        <!-- Premium Memberships -->
        ${activeMemberships.length > 0 ? `
        <div class="pg-card" style="margin-top: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">⭐ Active Memberships</h2>

            <div class="pg-membership-display">
                ${activeMemberships.map((membership: any) => `
                    <div class="pg-membership-item">
                        <div class="pg-membership-tier">${membership.tier.name}</div>
                        <div class="pg-membership-expires">Expires: ${new Date(membership.expiresAt).toLocaleDateString()}</div>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        <!-- Navigation Links -->
        <div class="pg-stats-navigation" style="margin-top: var(--pg-space-8);">
            <a href="/pengubook/transactions" class="pg-btn pg-btn--primary">
                📋 View Transaction History
            </a>
            <a href="/pengubook/profile" class="pg-btn pg-btn--secondary">
                👤 Back to Profile
            </a>
        </div>
    </div>`;

    res.send(generateBaseHTML(content, '📊 Statistics - PenguBook', 'stats', {
      user: currentUser,
      unreadCount
    }));
  } catch (error) {
    console.error("PenguBook stats error:", error);
    res.status(500).send("Error loading statistics");
  }
}