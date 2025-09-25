// src/services/tournaments.ts
import { prisma } from "./db.js";
import { Decimal } from "@prisma/client/runtime/library";

export interface TournamentConfig {
  id: string;
  name: string;
  description: string;
  status: 'SETUP' | 'REGISTRATION' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  entryFeeUSD?: number;
  maxParticipants?: number;

  // Prize configuration using existing multi-token system
  prizeTokens: Array<{
    tokenId: number;
    tokenSymbol: string;
    amount: number;
  }>;

  // Prize distribution percentages
  prizeDistribution: {
    [position: string]: number; // e.g., "1": 40, "2": 25, "3": 15, "4-10": 20
  };

  // Tournament type
  type: 'LEADERBOARD' | 'BRACKET' | 'FREE_ROLL';

  // Timing
  registrationStart?: Date;
  registrationEnd?: Date;
  tournamentStart?: Date;
  tournamentEnd?: Date;

  // Metadata
  createdBy: string; // Discord ID
  createdAt: Date;
  updatedAt: Date;
}

export interface TournamentEntry {
  tournamentId: string;
  userId: number;
  discordId: string;
  entryFee?: {
    tokenId: number;
    amount: number;
  };
  registeredAt: Date;
}

export interface TournamentPrizeDistribution {
  tournamentId: string;
  position: number;
  userId: number;
  prizes: Array<{
    tokenId: number;
    tokenSymbol: string;
    amount: number;
  }>;
  distributedAt: Date;
}

/**
 * Get tournament configuration from admin settings
 */
export async function getTournamentConfig(tournamentId: string): Promise<TournamentConfig | null> {
  try {
    // TODO: Implement proper tournament config storage in database
    // For now, return a mock tournament config for demonstration
    console.warn(`TODO: Implement tournament config storage for ID: ${tournamentId}`);
    return null;
  } catch (error) {
    console.error('Error getting tournament config:', error);
    return null;
  }
}

/**
 * Create or update tournament configuration
 */
export async function setTournamentConfig(config: TournamentConfig): Promise<boolean> {
  try {
    // TODO: Implement proper tournament config storage in database
    console.warn(`TODO: Save tournament config for ${config.name}`);
    return true;
  } catch (error) {
    console.error('Error setting tournament config:', error);
    return false;
  }
}

/**
 * Calculate prize distribution based on tournament configuration
 */
export function calculatePrizeDistribution(
  config: TournamentConfig,
  totalParticipants: number
): Array<{ position: number; percentage: number; prizes: Array<{ tokenId: number; tokenSymbol: string; amount: number }> }> {
  const results = [];

  for (const [positionKey, percentage] of Object.entries(config.prizeDistribution)) {
    if (positionKey.includes('-')) {
      // Handle range like "4-10"
      const [start, end] = positionKey.split('-').map(Number);
      const rangeSize = Math.min(end - start + 1, Math.max(0, totalParticipants - start + 1));
      const perPersonPercentage = percentage / rangeSize;

      for (let pos = start; pos <= Math.min(end, totalParticipants); pos++) {
        results.push({
          position: pos,
          percentage: perPersonPercentage,
          prizes: config.prizeTokens.map(token => ({
            tokenId: token.tokenId,
            tokenSymbol: token.tokenSymbol,
            amount: (token.amount * perPersonPercentage) / 100
          }))
        });
      }
    } else {
      // Handle single position like "1"
      const position = Number(positionKey);
      if (position <= totalParticipants) {
        results.push({
          position,
          percentage,
          prizes: config.prizeTokens.map(token => ({
            tokenId: token.tokenId,
            tokenSymbol: token.tokenSymbol,
            amount: (token.amount * percentage) / 100
          }))
        });
      }
    }
  }

  return results.sort((a, b) => a.position - b.position);
}

/**
 * Distribute tournament prizes using existing balance system
 */
export async function distributeTournamentPrizes(
  tournamentId: string,
  leaderboard: Array<{ userId: number; discordId: string; score: number; position: number }>
): Promise<{ success: boolean; distributed: number; errors: string[] }> {
  const config = await getTournamentConfig(tournamentId);
  if (!config) {
    return { success: false, distributed: 0, errors: ['Tournament configuration not found'] };
  }

  const prizeDistribution = calculatePrizeDistribution(config, leaderboard.length);
  const errors: string[] = [];
  let distributed = 0;

  // Use transaction to ensure all prizes are distributed atomically
  try {
    await prisma.$transaction(async (tx) => {
      for (const winner of leaderboard) {
        const prizeInfo = prizeDistribution.find(p => p.position === winner.position);
        if (!prizeInfo || prizeInfo.prizes.length === 0) continue;

        try {
          // Distribute each token type as separate transactions
          for (const prize of prizeInfo.prizes) {
            if (prize.amount <= 0) continue;

            // Credit user's balance using existing system
            await tx.userBalance.upsert({
              where: {
                userId_tokenId: {
                  userId: winner.userId,
                  tokenId: prize.tokenId
                }
              },
              update: {
                amount: {
                  increment: new Decimal(prize.amount)
                }
              },
              create: {
                userId: winner.userId,
                tokenId: prize.tokenId,
                amount: new Decimal(prize.amount)
              }
            });

            // Record the prize transaction using existing TOURNAMENT_PRIZE type
            await tx.pipchipsTransaction.create({
              data: {
                userId: winner.userId.toString(),
                amount: BigInt(prize.amount),
                transactionType: 'TOURNAMENT_PRIZE',
                balanceAfter: BigInt(0), // Will be updated by service
                description: `Tournament prize: ${config.name} - Position #${winner.position}`,
                metadata: {
                  tournamentId,
                  tournamentName: config.name,
                  position: winner.position,
                  percentage: prizeInfo.percentage,
                  tokenSymbol: prize.tokenSymbol,
                  totalParticipants: leaderboard.length
                }
              }
            });
          }

          distributed++;
          console.log(`✅ Distributed prizes to ${winner.discordId} (position #${winner.position})`);

        } catch (error) {
          console.error(`❌ Failed to distribute prizes to ${winner.discordId}:`, error);
          errors.push(`Failed to distribute prizes to position #${winner.position}: ${error}`);
        }
      }
    });

    // TODO: Log tournament completion properly
    console.log(`Tournament ${tournamentId} completed:`, {
      participants: leaderboard.length,
      prizesDistributed: distributed,
      errors
    });

    return {
      success: errors.length === 0,
      distributed,
      errors
    };

  } catch (error) {
    console.error('Error in tournament prize distribution transaction:', error);
    return {
      success: false,
      distributed,
      errors: [`Transaction failed: ${error}`]
    };
  }
}

/**
 * Calculate dynamic prize pool from entry fees (alternative to fixed prizes)
 */
export async function calculateDynamicPrizePool(tournamentId: string): Promise<{ [tokenSymbol: string]: number }> {
  try {
    // TODO: Get tournament entries from proper transaction log
    console.warn(`TODO: Calculate dynamic prize pool for tournament ${tournamentId}`);
    const entries: any[] = []; // Mock empty entries for now

    // Group by token type
    const tokenPools: { [tokenSymbol: string]: number } = {};
    for (const entry of entries) {
      const tokenSymbol = entry.metadata?.tokenSymbol as string || 'PIPChips';
      tokenPools[tokenSymbol] = (tokenPools[tokenSymbol] || 0) + Number(entry.amount);
    }

    // Take 80% for prizes, 20% house edge
    const prizePool: { [tokenSymbol: string]: number } = {};
    for (const [token, amount] of Object.entries(tokenPools)) {
      prizePool[token] = amount * 0.8;
    }

    return prizePool;

  } catch (error) {
    console.error('Error calculating dynamic prize pool:', error);
    return {};
  }
}

/**
 * Get tournament leaderboard from social leaderboards system
 */
export async function getTournamentLeaderboard(
  tournamentId: string,
  limit: number = 50
): Promise<Array<{ userId: number; discordId: string; score: number; position: number }>> {
  try {
    // This would integrate with the existing social leaderboards system
    // For now, return mock data - in real implementation, this would query
    // the social leaderboards filtered by tournament timeframe

    const users = await prisma.user.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' }
    });

    return users.map((user, index) => ({
      userId: user.id,
      discordId: user.discordId,
      score: Math.floor(Math.random() * 1000), // Mock score
      position: index + 1
    }));

  } catch (error) {
    console.error('Error getting tournament leaderboard:', error);
    return [];
  }
}

/**
 * Display prize pool information for users
 */
export async function displayTournamentPrizePool(tournamentId: string): Promise<{
  total: string;
  breakdown: { [position: string]: string[] };
} | null> {
  const config = await getTournamentConfig(tournamentId);
  if (!config) return null;

  const breakdown: { [position: string]: string[] } = {};

  // Calculate display strings for each position
  for (const [positionKey, percentage] of Object.entries(config.prizeDistribution)) {
    const positionLabel = positionKey.includes('-')
      ? `🏅 ${positionKey.replace('-', 'th-')}th Place`
      : positionKey === '1' ? '🥇 1st Place'
      : positionKey === '2' ? '🥈 2nd Place'
      : positionKey === '3' ? '🥉 3rd Place'
      : `🏅 ${positionKey}th Place`;

    if (positionKey.includes('-')) {
      const [start, end] = positionKey.split('-').map(Number);
      const rangeSize = end - start + 1;
      const perPersonPercentage = percentage / rangeSize;

      breakdown[positionLabel] = config.prizeTokens.map(token =>
        `${(token.amount * perPersonPercentage / 100).toFixed(2)} ${token.tokenSymbol}`
      );
    } else {
      breakdown[positionLabel] = config.prizeTokens.map(token =>
        `${(token.amount * percentage / 100).toFixed(2)} ${token.tokenSymbol}`
      );
    }
  }

  return {
    total: config.prizeTokens.map(p => `${p.amount} ${p.tokenSymbol}`).join(' + '),
    breakdown
  };
}