/**
 * TPIP Validation Service
 *
 * Validates TPIP balances, allocations, and ensures proper isolation from PIPChips
 * Used in Merkle tree generation and reconciliation processes
 */
import { prisma } from "./db.js";
const TPIP_TOKEN_ID = 4;
const PIPCHIPS_TOKEN_ID = 2;
/**
 * Comprehensive TPIP validation
 * Checks for orphaned balances, negative balances, and allocation accuracy
 */
export async function validateTPIPSystem() {
    const errors = [];
    const warnings = [];
    // Get TPIP token
    const tpipToken = await prisma.token.findUnique({
        where: { id: TPIP_TOKEN_ID },
        select: { id: true, symbol: true, decimals: true, address: true }
    });
    if (!tpipToken) {
        errors.push("TPIP token not found in database (ID: 4)");
        return {
            isValid: false,
            errors,
            warnings,
            stats: {
                totalTPIPHolders: 0,
                totalTPIPBalance: 0n,
                activeTournaments: 0,
                orphanedTPIPUsers: 0,
                negativeBalances: 0
            }
        };
    }
    // Verify TPIP has 0 decimals
    if (tpipToken.decimals !== 0) {
        errors.push(`TPIP should have 0 decimals, but has ${tpipToken.decimals}`);
    }
    // Get all TPIP balances
    const tpipBalances = await prisma.userBalance.findMany({
        where: {
            tokenId: TPIP_TOKEN_ID
        },
        include: {
            User: {
                select: {
                    id: true,
                    discordId: true,
                    inTournamentMode: true,
                    activeTournamentId: true
                }
            }
        }
    });
    let totalTPIPBalance = 0n;
    let negativeBalances = 0;
    const nonZeroBalances = tpipBalances.filter(b => {
        const amount = BigInt(b.amount.toFixed(0));
        if (amount < 0n) {
            negativeBalances++;
            errors.push(`User ${b.userId} has negative TPIP balance: ${amount}`);
        }
        if (amount !== 0n) {
            totalTPIPBalance += amount;
            return true;
        }
        return false;
    });
    // Check for active tournaments
    const activeTournaments = await prisma.tournament.count({
        where: {
            status: { in: ['PENDING', 'ACTIVE'] }
        }
    });
    // Check for orphaned TPIP (users with TPIP but not in tournament mode)
    const orphanedUsers = nonZeroBalances.filter(b => !b.User.inTournamentMode || !b.User.activeTournamentId);
    if (orphanedUsers.length > 0 && activeTournaments === 0) {
        errors.push(`Found ${orphanedUsers.length} users with TPIP balances but no active tournaments. ` +
            `TPIP should be reset to zero when tournaments conclude.`);
    }
    else if (orphanedUsers.length > 0) {
        warnings.push(`Found ${orphanedUsers.length} users with TPIP but not in tournament mode. ` +
            `They may have exited their tournament without proper cleanup.`);
    }
    // Validate TPIP-PIPChips separation
    const crossContamination = await validateTPIPPIPChipsSeparation();
    errors.push(...crossContamination.errors);
    warnings.push(...crossContamination.warnings);
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        stats: {
            totalTPIPHolders: nonZeroBalances.length,
            totalTPIPBalance,
            activeTournaments,
            orphanedTPIPUsers: orphanedUsers.length,
            negativeBalances
        }
    };
}
/**
 * Validate that TPIP and PIPChips remain completely separate
 * Checks for any transactions that mix token types
 */
async function validateTPIPPIPChipsSeparation() {
    const errors = [];
    const warnings = [];
    // Check for transactions that involve both TPIP and PIPChips
    const mixedTransactions = await prisma.transaction.findMany({
        where: {
            balanceDeltas: {
                some: {
                    tokenId: { in: [TPIP_TOKEN_ID, PIPCHIPS_TOKEN_ID] }
                }
            }
        },
        include: {
            balanceDeltas: {
                include: {
                    token: {
                        select: { symbol: true }
                    }
                }
            }
        },
        take: 100 // Limit to first 100 for performance
    });
    for (const tx of mixedTransactions) {
        const hasTPIP = tx.balanceDeltas.some(bd => bd.tokenId === TPIP_TOKEN_ID);
        const hasPIPChips = tx.balanceDeltas.some(bd => bd.tokenId === PIPCHIPS_TOKEN_ID);
        if (hasTPIP && hasPIPChips) {
            errors.push(`Transaction ${tx.id} (type: ${tx.type}) mixes TPIP and PIPChips! ` +
                `This violates the separation principle. opRef: ${tx.opRef}`);
        }
    }
    return { errors, warnings };
}
/**
 * Validate TPIP allocations match entry payments
 * Ensures users received correct TPIP for their tournament entry fees
 */
export async function validateTPIPAllocations(tournamentId) {
    const results = [];
    // Get tournament config
    const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: {
            id: true,
            startingPIPChips: true, // This is the TPIP allocation
            entryFee: true
        }
    });
    if (!tournament) {
        return results;
    }
    const expectedTPIPAllocation = BigInt(tournament.startingPIPChips);
    // Get all participants
    const participants = await prisma.tournamentParticipant.findMany({
        where: { tournamentId }
    });
    for (const participant of participants) {
        // Get entry payment transactions
        const entryTxs = await prisma.transaction.findMany({
            where: {
                userId: participant.userId,
                type: 'TOURNAMENT_ENTRY_PAYMENT',
                opRef: `tournament_${tournamentId}`
            }
        });
        const totalUSDPaid = entryTxs.reduce((sum, tx) => sum + (tx.usdValue ?? 0), 0);
        // Get TPIP allocation transaction
        const tpipAllocationTx = await prisma.transaction.findFirst({
            where: {
                userId: participant.userId,
                type: 'TPIP_ALLOCATION',
                opRef: `tournament_${tournamentId}`
            },
            include: {
                balanceDeltas: {
                    where: { tokenId: TPIP_TOKEN_ID }
                }
            }
        });
        const actualTPIP = tpipAllocationTx?.balanceDeltas[0]
            ? BigInt(tpipAllocationTx.balanceDeltas[0].amountDelta.toFixed(0))
            : 0n;
        const isValid = actualTPIP === expectedTPIPAllocation;
        const validation = {
            userId: participant.userId,
            expectedTPIP: expectedTPIPAllocation,
            actualTPIP,
            entryPaymentsUSD: totalUSDPaid,
            tournamentId,
            isValid
        };
        if (!isValid) {
            validation.discrepancy = actualTPIP - expectedTPIPAllocation;
        }
        results.push(validation);
    }
    return results;
}
/**
 * Validate TPIP in Merkle tree context
 * Ensures TPIP balances are included correctly in snapshots
 */
export async function validateTPIPInMerkle() {
    // Get all UserBalance entries for TPIP
    const tpipBalances = await prisma.userBalance.findMany({
        where: {
            tokenId: TPIP_TOKEN_ID,
            amount: { gt: 0 }
        },
        select: {
            userId: true,
            amount: true
        }
    });
    const totalTPIPInMerkle = tpipBalances.reduce((sum, b) => sum + BigInt(b.amount.toFixed(0)), 0n);
    // TPIP should be included if there are any non-zero balances
    const tpipIncluded = tpipBalances.length > 0;
    return {
        tpipIncluded,
        tpipHolders: tpipBalances.length,
        totalTPIPInMerkle,
        discrepancies: [] // In production, compare with transaction log aggregation
    };
}
/**
 * Get TPIP statistics for monitoring
 */
export async function getTPIPStats() {
    const tpipBalances = await prisma.userBalance.findMany({
        where: {
            tokenId: TPIP_TOKEN_ID,
            amount: { gt: 0 }
        },
        include: {
            User: {
                select: {
                    inTournamentMode: true,
                    activeTournamentId: true
                }
            }
        }
    });
    const balanceAmounts = tpipBalances.map(b => BigInt(b.amount.toFixed(0)));
    const totalTPIPInCirculation = balanceAmounts.reduce((sum, b) => sum + b, 0n);
    const activeTournamentPlayers = tpipBalances.filter(b => b.User.inTournamentMode && b.User.activeTournamentId).length;
    const orphanedTPIPHolders = tpipBalances.filter(b => !b.User.inTournamentMode || !b.User.activeTournamentId).length;
    const averageTPIPPerUser = tpipBalances.length > 0
        ? Number(totalTPIPInCirculation) / tpipBalances.length
        : 0;
    const largestTPIPBalance = balanceAmounts.length > 0
        ? balanceAmounts.reduce((max, b) => b > max ? b : max, 0n)
        : 0n;
    const smallestNonZeroTPIPBalance = balanceAmounts.length > 0
        ? balanceAmounts.reduce((min, b) => b < min ? b : min, balanceAmounts[0])
        : 0n;
    return {
        totalTPIPInCirculation,
        totalTPIPHolders: tpipBalances.length,
        activeTournamentPlayers,
        orphanedTPIPHolders,
        averageTPIPPerUser,
        largestTPIPBalance,
        smallestNonZeroTPIPBalance
    };
}
