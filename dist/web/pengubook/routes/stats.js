import { getCurrentUser } from "../../auth.js";
import { findOrCreateUser } from "../../../services/user_helpers.js";
import { getUnreadMessageCount } from "../../../interactions/buttons/pengubook.js";
import { generateBaseHTML } from "../templates.js";
import { prisma } from "../../../services/db.js";
import { formatDecimal } from "../../../services/token.js";
import { priceAPI } from "../../../services/price_api.js";
const statsCache = /* @__PURE__ */ new Map();
const STATS_CACHE_TTL = 60 * 1e3;
async function statsHandler(req, res) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.redirect("/auth/discord");
    const cacheKey = `stats_${currentUser.discordId}`;
    const cached = statsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < STATS_CACHE_TTL) {
      return res.send(cached.data);
    }
    const user = await findOrCreateUser(currentUser.discordId);
    const unreadCount = await getUnreadMessageCount(currentUser.discordId);
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
        orderBy: { amount: "desc" }
      }),
      // Active tier memberships
      prisma.tierMembership.findMany({
        where: {
          userId: user.id,
          status: "ACTIVE",
          expiresAt: { gt: /* @__PURE__ */ new Date() }
        },
        include: { tier: true },
        orderBy: { createdAt: "desc" }
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
          status: "COMPLETED"
        },
        _count: { id: true }
      })
    ]);
    const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1e3 * 60 * 60 * 24));
    const winRate = user.wins + user.losses > 0 ? (user.wins / (user.wins + user.losses) * 100).toFixed(1) : "0.0";
    let priceMap = {};
    let priceSource = "fallback";
    if (balances.length > 0) {
      const tokenSymbols = [...new Set(balances.map((b) => b.Token.symbol))];
      try {
        const priceResult = await priceAPI.getTokenPrices(tokenSymbols);
        priceMap = priceResult.prices || {};
        priceSource = priceResult.source;
      } catch (error) {
        console.warn("Failed to fetch USD prices for stats page:", error);
      }
    }
    const content = `
    <div class="pg-container">
        <h1 style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-800);">\u{1F4CA} Statistics</h1>

        <!-- Overview Cards -->
        <div class="pg-stats-overview">
            <div class="pg-stat-highlight-card">
                <div class="pg-stat-icon">\u{1F3AE}</div>
                <div class="pg-stat-content">
                    <div class="pg-stat-number">${user.wins}</div>
                    <div class="pg-stat-label">Total Wins</div>
                </div>
            </div>

            <div class="pg-stat-highlight-card">
                <div class="pg-stat-icon">\u{1F4C8}</div>
                <div class="pg-stat-content">
                    <div class="pg-stat-number">${winRate}%</div>
                    <div class="pg-stat-label">Win Rate</div>
                </div>
            </div>

            <div class="pg-stat-highlight-card">
                <div class="pg-stat-icon">\u{1F4B8}</div>
                <div class="pg-stat-content">
                    <div class="pg-stat-number">${tipStatsSent._count.id || 0}</div>
                    <div class="pg-stat-label">Tips Sent</div>
                </div>
            </div>

            <div class="pg-stat-highlight-card">
                <div class="pg-stat-icon">\u{1F4B0}</div>
                <div class="pg-stat-content">
                    <div class="pg-stat-number">${tipStatsReceived._count.id || 0}</div>
                    <div class="pg-stat-label">Tips Received</div>
                </div>
            </div>
        </div>

        <!-- Gaming Statistics -->
        <div class="pg-card" style="margin-top: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">\u{1F3AE} Gaming Stats</h2>

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
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">\u{1F4B8} Tipping Activity</h2>

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
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">\u{1F4B0} Financial Overview</h2>

            <div class="pg-financial-stats">
                <div class="pg-financial-section">
                    <h3 style="color: var(--pg-green-600); margin-bottom: var(--pg-space-3);">\u{1F4E5} Deposits</h3>
                    <div class="pg-financial-row">
                        <span>Total Deposits:</span>
                        <span class="pg-financial-value">${depositStats || 0} transactions</span>
                    </div>
                </div>

                <div class="pg-financial-section">
                    <h3 style="color: var(--pg-red-600); margin-bottom: var(--pg-space-3);">\u{1F4E4} Withdrawals</h3>
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
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">\u{1F4B3} Current Balances</h2>

            <div class="pg-balance-display">
                ${balances.map((balance) => {
      const amount = Number(balance.amount.toString());
      const priceUSD = priceMap[balance.Token.symbol] || 0;
      const usdValue = priceUSD > 0 ? amount * priceUSD : 0;
      let formattedUSD = "";
      if (priceUSD > 0) {
        if (usdValue === 0) {
          formattedUSD = "$0.00";
        } else if (usdValue < 0.01) {
          formattedUSD = "< $0.01";
        } else {
          formattedUSD = `$${usdValue.toFixed(2)}`;
        }
      }
      return `
                    <div class="pg-balance-row">
                        <div class="pg-balance-token">${balance.Token.symbol}</div>
                        <div class="pg-balance-amount">${formatDecimal(balance.amount, balance.Token.decimals)}</div>
                        ${formattedUSD ? `<div class="pg-balance-usd" style="color: var(--pg-dark-600); font-size: var(--pg-text-sm);">${formattedUSD} USD</div>` : ""}
                    </div>
                    `;
    }).join("")}
            </div>
            ${Object.keys(priceMap).length > 0 ? `
            <div style="margin-top: var(--pg-space-3); padding-top: var(--pg-space-3); border-top: 1px solid var(--pg-dark-200); font-size: var(--pg-text-xs); color: var(--pg-dark-500);">
                USD prices via ${priceSource.toUpperCase()}${priceSource === "fallback" ? " (estimates only)" : ""}
            </div>
            ` : ""}
        </div>
        ` : ""}

        <!-- Premium Memberships -->
        ${activeMemberships.length > 0 ? `
        <div class="pg-card" style="margin-top: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">\u2B50 Active Memberships</h2>

            <div class="pg-membership-display">
                ${activeMemberships.map((membership) => `
                    <div class="pg-membership-item">
                        <div class="pg-membership-tier">${membership.tier.name}</div>
                        <div class="pg-membership-expires">Expires: ${new Date(membership.expiresAt).toLocaleDateString()}</div>
                    </div>
                `).join("")}
            </div>
        </div>
        ` : ""}

        <!-- Navigation Links -->
        <div class="pg-stats-navigation" style="margin-top: var(--pg-space-8);">
            <a href="/pengubook/transactions" class="pg-btn pg-btn--primary">
                \u{1F4CB} View Transaction History
            </a>
            <a href="/pengubook/profile" class="pg-btn pg-btn--secondary">
                \u{1F464} Back to Profile
            </a>
        </div>
    </div>`;
    const html = generateBaseHTML(content, "\u{1F4CA} Statistics - PenguBook", "stats", {
      user: currentUser,
      unreadCount
    });
    statsCache.set(cacheKey, {
      data: html,
      timestamp: Date.now()
    });
    res.send(html);
  } catch (error) {
    console.error("PenguBook stats error:", error);
    res.status(500).send("Error loading statistics");
  }
}
export {
  statsHandler
};
//# sourceMappingURL=stats.js.map
