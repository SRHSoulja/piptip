import { getCurrentUser } from "../../auth.js";
import { findOrCreateUser } from "../../../services/user_helpers.js";
import { getUnreadMessageCount } from "../../../interactions/buttons/pengubook.js";
import { generateBaseHTML } from "../templates.js";
import { prisma } from "../../../services/db.js";
import { formatDecimal } from "../../../services/token.js";
export async function transactionsHandler(req, res) {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser)
            return res.redirect("/auth/discord");
        const user = await findOrCreateUser(currentUser.discordId);
        const unreadCount = await getUnreadMessageCount(currentUser.discordId);
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;
        // Get recent transactions in parallel
        const [tipsSent, tipsReceived, groupTipsCreated, withdrawals, deposits, // empty array
        totalCounts] = await Promise.all([
            // Tips sent
            prisma.tip.findMany({
                where: { fromUserId: user.id },
                include: {
                    Token: true,
                    To: { select: { discordId: true } }
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: offset
            }),
            // Tips received
            prisma.tip.findMany({
                where: { toUserId: user.id },
                include: {
                    Token: true,
                    From: { select: { discordId: true } }
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: offset
            }),
            // Group tips created
            prisma.groupTip.findMany({
                where: { creatorId: user.id },
                include: {
                    Token: true,
                    claims: {
                        include: {
                            User: { select: { discordId: true } }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: offset
            }),
            // Withdrawal attempts (simplified - no token relation available)
            prisma.withdrawalAttempt.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: offset
            }),
            // Note: Deposits are tracked differently and not easily queryable
            [],
            // Get total counts for pagination
            Promise.all([
                prisma.tip.count({ where: { fromUserId: user.id } }),
                prisma.tip.count({ where: { toUserId: user.id } }),
                prisma.groupTip.count({ where: { creatorId: user.id } }),
                prisma.withdrawalAttempt.count({ where: { userId: user.id } })
            ])
        ]);
        // Combine and sort all transactions by date
        const allTransactions = [];
        // Add tips sent
        tipsSent.forEach((tip) => {
            allTransactions.push({
                type: 'tip_sent',
                date: tip.createdAt,
                amount: formatDecimal(tip.amountAtomic, tip.Token.decimals),
                token: tip.Token.symbol,
                description: `Tip sent to User#${tip.To.discordId.slice(-4)}`,
                status: 'completed',
                txHash: tip.txHash,
                note: tip.note
            });
        });
        // Add tips received
        tipsReceived.forEach((tip) => {
            allTransactions.push({
                type: 'tip_received',
                date: tip.createdAt,
                amount: formatDecimal(tip.amountAtomic, tip.Token.decimals),
                token: tip.Token.symbol,
                description: `Tip received from User#${tip.From.discordId.slice(-4)}`,
                status: 'completed',
                txHash: tip.txHash,
                note: tip.note
            });
        });
        // Add group tips
        groupTipsCreated.forEach((groupTip) => {
            allTransactions.push({
                type: 'group_tip',
                date: groupTip.createdAt,
                amount: formatDecimal(groupTip.totalAmount, groupTip.Token.decimals),
                token: groupTip.Token.symbol,
                description: `Group tip created (${groupTip.claims.length} claims)`,
                status: groupTip.expiresAt && groupTip.expiresAt < new Date() ? 'expired' : 'active',
                note: groupTip.note
            });
        });
        // Add withdrawal attempts (simplified)
        withdrawals.forEach((withdrawal) => {
            allTransactions.push({
                type: 'withdrawal',
                date: withdrawal.createdAt,
                amount: withdrawal.amount.toString(),
                token: 'Unknown',
                description: 'Withdrawal attempt',
                status: 'pending',
                txHash: undefined
            });
        });
        // Sort by date (newest first)
        allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        // Limit to requested page size
        const paginatedTransactions = allTransactions.slice(0, limit);
        const totalTransactions = totalCounts.reduce((sum, count) => sum + count, 0);
        const totalPages = Math.ceil(totalTransactions / limit);
        const content = `
    <div class="pg-container">
        <h1 style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-800);">📋 Transaction History</h1>

        <!-- Filter Tabs -->
        <div class="pg-transaction-filters">
            <button class="pg-filter-tab pg-filter-tab--active" data-filter="all">
                All Transactions
            </button>
            <button class="pg-filter-tab" data-filter="tips">
                Tips
            </button>
            <button class="pg-filter-tab" data-filter="wallet">
                Wallet Operations
            </button>
            <button class="pg-filter-tab" data-filter="group">
                Group Tips
            </button>
        </div>

        <!-- Transactions List -->
        <div class="pg-card" style="margin-top: var(--pg-space-4);">
            ${paginatedTransactions.length > 0 ? `
                <div class="pg-transaction-list">
                    ${paginatedTransactions.map(tx => {
            const typeConfig = {
                tip_sent: { icon: '💸', color: 'var(--pg-red-600)', bgColor: 'var(--pg-red-50)' },
                tip_received: { icon: '💰', color: 'var(--pg-green-600)', bgColor: 'var(--pg-green-50)' },
                group_tip: { icon: '🎁', color: 'var(--pg-yellow-600)', bgColor: 'var(--pg-yellow-50)' },
                deposit: { icon: '📥', color: 'var(--pg-blue-600)', bgColor: 'var(--pg-blue-50)' },
                withdrawal: { icon: '📤', color: 'var(--pg-purple-600)', bgColor: 'var(--pg-purple-50)' }
            };
            const config = typeConfig[tx.type] || typeConfig.tip_sent;
            const statusBadge = tx.status === 'completed' ? '✅' :
                tx.status === 'pending' ? '⏳' :
                    tx.status === 'expired' ? '⏰' : '❌';
            return `
                        <div class="pg-transaction-item" data-type="${tx.type}">
                            <div class="pg-transaction-icon" style="background: ${config.bgColor}; color: ${config.color};">
                                ${config.icon}
                            </div>

                            <div class="pg-transaction-details">
                                <div class="pg-transaction-header">
                                    <span class="pg-transaction-description">${tx.description}</span>
                                    <span class="pg-transaction-status">${statusBadge}</span>
                                </div>

                                <div class="pg-transaction-meta">
                                    <span class="pg-transaction-amount" style="color: ${config.color};">
                                        ${tx.type === 'tip_received' || tx.type === 'deposit' ? '+' : '-'}${tx.amount} ${tx.token}
                                    </span>
                                    <span class="pg-transaction-date">
                                        ${new Date(tx.date).toLocaleDateString()} ${new Date(tx.date).toLocaleTimeString()}
                                    </span>
                                </div>

                                ${tx.note ? `
                                <div class="pg-transaction-note">
                                    💬 ${tx.note}
                                </div>
                                ` : ''}

                                ${tx.txHash ? `
                                <div class="pg-transaction-hash">
                                    <a href="https://explorer.abstract.xyz/tx/${tx.txHash}" target="_blank"
                                       style="color: var(--pg-primary-600); text-decoration: none; font-size: var(--pg-text-sm);">
                                        🔗 View on Explorer
                                    </a>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                      `;
        }).join('')}
                </div>

                ${totalPages > 1 ? `
                <div class="pg-pagination" style="margin-top: var(--pg-space-6);">
                    ${page > 1 ? `
                    <a href="/pengubook/transactions?page=${page - 1}" class="pg-btn pg-btn--secondary">
                        ← Previous
                    </a>
                    ` : ''}

                    <span class="pg-pagination-info">
                        Page ${page} of ${totalPages} (${totalTransactions} total)
                    </span>

                    ${page < totalPages ? `
                    <a href="/pengubook/transactions?page=${page + 1}" class="pg-btn pg-btn--secondary">
                        Next →
                    </a>
                    ` : ''}
                </div>
                ` : ''}
            ` : `
                <div class="pg-empty-state" style="padding: var(--pg-space-8); text-align: center;">
                    <div style="font-size: 4rem; margin-bottom: var(--pg-space-4);">📋</div>
                    <h3 style="margin-bottom: var(--pg-space-2); color: var(--pg-dark-700);">No Transactions Yet</h3>
                    <p style="color: var(--pg-dark-600); margin-bottom: var(--pg-space-4);">
                        Your transaction history will appear here once you start using PIPTip.
                    </p>
                    <a href="/pengubook/browse" class="pg-btn pg-btn--primary">
                        Start Tipping
                    </a>
                </div>
            `}
        </div>

        <!-- Navigation Links -->
        <div style="margin-top: var(--pg-space-6); display: flex; gap: var(--pg-space-3);">
            <a href="/pengubook/stats" class="pg-btn pg-btn--secondary">
                📊 View Statistics
            </a>
            <a href="/pengubook/profile" class="pg-btn pg-btn--secondary">
                👤 Back to Profile
            </a>
        </div>
    </div>

    <script>
        // Transaction filtering
        document.querySelectorAll('.pg-filter-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                // Update active tab
                document.querySelectorAll('.pg-filter-tab').forEach(t => t.classList.remove('pg-filter-tab--active'));
                tab.classList.add('pg-filter-tab--active');

                const filter = tab.dataset.filter;
                const transactions = document.querySelectorAll('.pg-transaction-item');

                transactions.forEach(item => {
                    const type = item.dataset.type;
                    let show = false;

                    switch(filter) {
                        case 'all':
                            show = true;
                            break;
                        case 'tips':
                            show = type === 'tip_sent' || type === 'tip_received';
                            break;
                        case 'wallet':
                            show = type === 'deposit' || type === 'withdrawal';
                            break;
                        case 'group':
                            show = type === 'group_tip';
                            break;
                    }

                    item.style.display = show ? 'flex' : 'none';
                });
            });
        });
    </script>`;
        res.send(generateBaseHTML(content, '📋 Transactions - PenguBook', 'transactions', {
            user: currentUser,
            unreadCount
        }));
    }
    catch (error) {
        console.error("PenguBook transactions error:", error);
        res.status(500).send("Error loading transactions");
    }
}
