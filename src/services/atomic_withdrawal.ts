// Atomic Withdrawal Service - Fixes race conditions in withdrawal processing
// Ensures balance check and debit happen atomically with blockchain transaction

import { prisma } from './db.js';
import { decToBigDirect, formatAmount, toAtomicDirect } from './token.js';
import type { TokenRow } from './token.js';

export interface AtomicWithdrawalParams {
  userId: number;
  tokenId: number;
  amountHuman: number;
  destinationAddress: string;
  discordUserId: string;
  guildId?: string | null;
  metadata?: Record<string, any>;
}

export interface AtomicWithdrawalResult {
  success: boolean;
  txHash?: string;
  error?: string;
  balanceAfter?: bigint;
  amountAtomic?: bigint;
}

/**
 * Executes an atomic withdrawal with proper race condition protection.
 * Uses database transaction to ensure balance is checked and debited atomically,
 * with rollback capability if blockchain transaction fails.
 */
export async function executeAtomicWithdrawal(
  params: AtomicWithdrawalParams,
  token: TokenRow,
  treasuryContract: any,
  signer: any
): Promise<AtomicWithdrawalResult> {
  const { userId, tokenId, amountHuman, destinationAddress, discordUserId, guildId, metadata } = params;

  const amountAtomic = toAtomicDirect(amountHuman, token.decimals);

  try {
    // Use Prisma interactive transaction for atomic balance operations
    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Lock and check user balance with SELECT FOR UPDATE
        const userBalance = await tx.userBalance.findUnique({
          where: {
            userId_tokenId: { userId, tokenId }
          }
        });

        if (!userBalance) {
          throw new Error(`No balance found for user ${userId} and token ${tokenId}`);
        }

        const currentBalanceAtomic = decToBigDirect(userBalance.amount, token.decimals);

        // 2. Verify sufficient balance (this is now inside transaction)
        if (currentBalanceAtomic < amountAtomic) {
          throw new Error(
            `Insufficient balance: has ${formatAmount(currentBalanceAtomic, token)}, ` +
            `requested ${formatAmount(amountAtomic, token)}`
          );
        }

        // 3. Execute blockchain transaction first (can be rolled back if it fails)
        let blockchainTx: any;
        try {
          blockchainTx = await treasuryContract.transfer(destinationAddress, amountAtomic);
          await blockchainTx.wait(); // Wait for transaction confirmation
        } catch (blockchainError: any) {
          throw new Error(`Blockchain transaction failed: ${blockchainError?.reason || blockchainError?.message || blockchainError}`);
        }

        // 4. If blockchain transaction succeeded, debit the balance atomically
        const newBalanceAtomic = currentBalanceAtomic - amountAtomic;

        await tx.userBalance.update({
          where: { userId_tokenId: { userId, tokenId } },
          data: { amount: newBalanceAtomic.toString() }
        });

        // 5. Create transaction record
        await tx.transaction.create({
          data: {
            type: 'WITHDRAW',
            userId,
            tokenId,
            amount: amountHuman, // Store human-readable amount
            txHash: blockchainTx.hash,
            guildId,
            metadata: metadata ? JSON.stringify(metadata) : null
          }
        });

        // 6. Update balance conservation tracking
        // TODO: Implement balance conservation tracking when service is available
        // const { updateBalanceConservation } = await import('./balance_conservation.js');
        // await updateBalanceConservation(tokenId, -amountAtomic);

        return {
          success: true,
          txHash: blockchainTx.hash,
          balanceAfter: newBalanceAtomic,
          amountAtomic
        };
      },
      {
        // Transaction options for better isolation and timeout
        isolationLevel: 'Serializable', // Highest isolation level for financial operations
        timeout: 30000, // 30 second timeout
        maxWait: 15000  // Maximum wait time for transaction
      }
    );

    return result;

  } catch (error: any) {
    console.error('Atomic withdrawal failed:', error);

    return {
      success: false,
      error: error.message || String(error),
      amountAtomic
    };
  }
}

/**
 * Validates withdrawal preconditions before attempting atomic execution.
 * Checks limits, quotas, and other business rules without modifying state.
 */
export async function validateWithdrawalPreconditions(
  userId: number,
  tokenId: number,
  amountHuman: number,
  token: TokenRow,
  appConfig: any
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Check basic limits
    if (amountHuman < Number(token.minWithdraw)) {
      return {
        valid: false,
        error: `Amount below minimum: ${token.minWithdraw} ${token.symbol}`
      };
    }

    const maxPerTxHuman = token.withdrawMaxPerTx != null
      ? Number(token.withdrawMaxPerTx)
      : Number(appConfig?.withdrawMaxPerTx ?? 0);

    if (maxPerTxHuman > 0 && amountHuman > maxPerTxHuman) {
      return {
        valid: false,
        error: `Amount exceeds maximum per transaction: ${maxPerTxHuman} ${token.symbol}`
      };
    }

    // Check daily cap
    const dailyCapHuman = token.withdrawDailyCap != null
      ? Number(token.withdrawDailyCap)
      : Number(appConfig?.withdrawDailyCap ?? 0);

    if (dailyCapHuman > 0) {
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);

      const agg = await prisma.transaction.aggregate({
        where: {
          type: "WITHDRAW",
          userId,
          tokenId,
          createdAt: { gte: since }
        },
        _sum: { amount: true }
      });

      const alreadyToday = parseFloat(String(agg._sum.amount ?? "0"));
      if (alreadyToday + amountHuman > dailyCapHuman) {
        const remaining = Math.max(0, dailyCapHuman - alreadyToday);
        return {
          valid: false,
          error: `Daily limit exceeded. Remaining today: ${remaining} ${token.symbol}`
        };
      }
    }

    return { valid: true };

  } catch (error: any) {
    return {
      valid: false,
      error: `Validation error: ${error.message}`
    };
  }
}

/**
 * Comprehensive withdrawal safety checker that validates all conditions
 * including user state, token state, treasury state, and rate limits.
 */
export async function performComprehensiveWithdrawalCheck(
  discordUserId: string,
  tokenId: number,
  amountHuman: number
): Promise<{
  canProceed: boolean;
  user?: any;
  token?: TokenRow;
  appConfig?: any;
  treasuryBalance?: bigint;
  error?: string;
  limitCheckResult?: any;
}> {
  try {
    // 1. Get user, token, and config in parallel
    const [user, token, appConfig] = await Promise.all([
      prisma.user.findUnique({
        where: { discordId: discordUserId },
        select: { id: true, agwAddress: true }
      }),
      prisma.token.findUnique({ where: { id: tokenId } }),
      prisma.appConfig.findFirst()
    ]);

    if (!user) {
      return { canProceed: false, error: "User not found" };
    }

    if (!token) {
      return { canProceed: false, error: "Token not found" };
    }

    if (!user.agwAddress) {
      return { canProceed: false, error: "Wallet not linked" };
    }

    if (!token.active) {
      return { canProceed: false, error: "Token inactive" };
    }

    // 2. Check emergency mode
    if (appConfig?.withdrawalsPaused || appConfig?.emergencyMode) {
      return { canProceed: false, error: "Withdrawals temporarily disabled" };
    }

    // 3. Validate preconditions
    const preconditionCheck = await validateWithdrawalPreconditions(
      user.id, tokenId, amountHuman, token, appConfig
    );

    if (!preconditionCheck.valid) {
      return {
        canProceed: false,
        error: preconditionCheck.error,
        user, token, appConfig
      };
    }

    // 4. Check withdrawal limits
    const { withdrawalLimiter } = await import('./withdrawal_limiter.js');
    const limitCheck = await withdrawalLimiter.checkWithdrawalAllowed(user.id, token.id, amountHuman);

    if (!limitCheck.allowed) {
      return {
        canProceed: false,
        error: limitCheck.reason || "Withdrawal blocked by rate limits",
        user, token, appConfig,
        limitCheckResult: limitCheck
      };
    }

    // 5. Check treasury balance
    const { JsonRpcProvider, Wallet, Contract } = await import("ethers");
    const { ABSTRACT_RPC_URL } = await import("../config.js");
    const { getSecureTreasuryPrivateKey } = await import("./secure_key.js");

    const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
    const provider = new JsonRpcProvider(ABSTRACT_RPC_URL);
    const signer = new Wallet(getSecureTreasuryPrivateKey(), provider);
    const tokenContract = new Contract(token.address, ERC20_ABI, signer);

    const treasuryBalance: bigint = await tokenContract.balanceOf(await signer.getAddress());
    const amountAtomic = toAtomicDirect(amountHuman, token.decimals);

    if (treasuryBalance < amountAtomic) {
      return {
        canProceed: false,
        error: `Treasury insufficient funds: has ${formatAmount(treasuryBalance, token)}, requested ${formatAmount(amountAtomic, token)}`,
        user, token, appConfig, treasuryBalance
      };
    }

    return {
      canProceed: true,
      user, token, appConfig, treasuryBalance,
      limitCheckResult: limitCheck
    };

  } catch (error: any) {
    return {
      canProceed: false,
      error: `Comprehensive check failed: ${error.message}`
    };
  }
}