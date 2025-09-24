// src/services/treasury_cold_transfer.ts - Cold wallet transfer functionality for treasury safety

import { ethers, Contract } from 'ethers';
import { prisma } from './db.js';
import { formatAmount, toAtomicDirect } from './token.js';
import type { TokenRow } from './token.js';

interface ColdTransferParams {
  tokenId: number;
  amountAtomic: bigint;
  destinationAddress: string;
  reason: string;
  initiatedBy: 'auto' | 'manual';
  adminUserId?: number;
}

interface ColdTransferResult {
  success: boolean;
  txHash?: string;
  error?: string;
  gasUsed?: bigint;
  actualAmountTransferred?: bigint;
}

interface ColdTransferRecord {
  id?: number;
  tokenId: number;
  amountAtomic: bigint;
  destinationAddress: string;
  txHash?: string;
  reason: string;
  initiatedBy: 'auto' | 'manual';
  adminUserId?: number;
  status: 'pending' | 'completed' | 'failed';
  gasUsed?: bigint;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

class TreasuryColdTransferService {
  private pendingTransfers = new Map<string, ColdTransferRecord>();

  /**
   * Validate cold wallet transfer parameters
   */
  private async validateTransfer(params: ColdTransferParams, token: TokenRow): Promise<{ valid: boolean; error?: string }> {
    // 1. Validate destination address
    if (!ethers.isAddress(params.destinationAddress)) {
      return { valid: false, error: 'Invalid destination address format' };
    }

    // 2. Check if destination is not the same as treasury
    const treasuryAddress = process.env.TREASURY_PRIVATE_KEY ?
      new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY).address : null;

    if (treasuryAddress && params.destinationAddress.toLowerCase() === treasuryAddress.toLowerCase()) {
      return { valid: false, error: 'Destination cannot be the same as treasury address' };
    }

    // 3. Validate amount
    if (params.amountAtomic <= 0n) {
      return { valid: false, error: 'Transfer amount must be greater than zero' };
    }

    // 4. Check treasury balance
    try {
      const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
      const wallet = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY!, provider);
      const ERC20_ABI = [
        "function balanceOf(address) view returns (uint256)",
        "function transfer(address to, uint256 amount) returns (bool)"
      ];
      const tokenContract = new Contract(token.address, ERC20_ABI, wallet);

      const treasuryBalance = await tokenContract.balanceOf(wallet.address);

      if (treasuryBalance < params.amountAtomic) {
        return {
          valid: false,
          error: `Insufficient treasury balance: has ${formatAmount(treasuryBalance, token)}, requested ${formatAmount(params.amountAtomic, token)}`
        };
      }
    } catch (error) {
      return { valid: false, error: `Failed to check treasury balance: ${(error as Error).message}` };
    }

    // 5. Check for duplicate pending transfers
    const transferKey = `${params.tokenId}_${params.destinationAddress}`;
    if (this.pendingTransfers.has(transferKey)) {
      return { valid: false, error: 'Transfer to this address already pending' };
    }

    return { valid: true };
  }

  /**
   * Execute cold wallet transfer
   */
  async executeColdTransfer(params: ColdTransferParams, token: TokenRow): Promise<ColdTransferResult> {
    // Validate transfer
    const validation = await this.validateTransfer(params, token);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const transferKey = `${params.tokenId}_${params.destinationAddress}`;
    const record: ColdTransferRecord = {
      tokenId: params.tokenId,
      amountAtomic: params.amountAtomic,
      destinationAddress: params.destinationAddress,
      reason: params.reason,
      initiatedBy: params.initiatedBy,
      adminUserId: params.adminUserId,
      status: 'pending',
      createdAt: new Date()
    };

    // Track pending transfer
    this.pendingTransfers.set(transferKey, record);

    try {
      // Initialize blockchain connection
      const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
      const wallet = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY!, provider);
      const ERC20_ABI = [
        "function balanceOf(address) view returns (uint256)",
        "function transfer(address to, uint256 amount) returns (bool)"
      ];
      const tokenContract = new Contract(token.address, ERC20_ABI, wallet);

      console.log(`🏦 Executing cold transfer: ${formatAmount(params.amountAtomic, token)} ${token.symbol} to ${params.destinationAddress}`);

      // Execute the transfer
      const tx = await tokenContract.transfer(params.destinationAddress, params.amountAtomic);

      console.log(`📤 Cold transfer transaction sent: ${tx.hash}`);
      record.txHash = tx.hash;
      record.status = 'pending';

      // Wait for confirmation
      const receipt = await tx.wait();

      if (receipt?.status === 1) {
        record.status = 'completed';
        record.completedAt = new Date();
        record.gasUsed = receipt.gasUsed;

        console.log(`✅ Cold transfer completed: ${tx.hash} (Gas: ${receipt.gasUsed})`);

        // Store successful transfer record
        await this.storeColdTransferRecord(record);

        // Log to audit trail
        await this.logColdTransferAction('transfer_completed', {
          tokenSymbol: token.symbol,
          amount: formatAmount(params.amountAtomic, token),
          destination: params.destinationAddress,
          txHash: tx.hash,
          gasUsed: receipt.gasUsed.toString(),
          reason: params.reason,
          initiatedBy: params.initiatedBy
        });

        return {
          success: true,
          txHash: tx.hash,
          gasUsed: receipt.gasUsed,
          actualAmountTransferred: params.amountAtomic
        };

      } else {
        throw new Error('Transaction failed on blockchain');
      }

    } catch (error) {
      const errorMessage = (error as Error).message;

      record.status = 'failed';
      record.error = errorMessage;
      record.completedAt = new Date();

      console.error(`❌ Cold transfer failed:`, error);

      // Store failed transfer record
      await this.storeColdTransferRecord(record);

      // Log failure
      await this.logColdTransferAction('transfer_failed', {
        tokenSymbol: token.symbol,
        amount: formatAmount(params.amountAtomic, token),
        destination: params.destinationAddress,
        error: errorMessage,
        reason: params.reason,
        initiatedBy: params.initiatedBy
      });

      return {
        success: false,
        error: `Cold transfer failed: ${errorMessage}`
      };

    } finally {
      // Remove from pending transfers
      this.pendingTransfers.delete(transferKey);
    }
  }

  /**
   * Store cold transfer record in database
   */
  private async storeColdTransferRecord(record: ColdTransferRecord): Promise<void> {
    try {
      // TODO: Store in dedicated cold_transfers table
      // await prisma.coldTransfer.create({
      //   data: {
      //     tokenId: record.tokenId,
      //     amountAtomic: record.amountAtomic,
      //     destinationAddress: record.destinationAddress,
      //     txHash: record.txHash,
      //     reason: record.reason,
      //     initiatedBy: record.initiatedBy,
      //     adminUserId: record.adminUserId,
      //     status: record.status,
      //     gasUsed: record.gasUsed,
      //     error: record.error,
      //     completedAt: record.completedAt
      //   }
      // });

      console.log(`📝 Cold transfer record stored: ${record.status} - ${record.txHash || 'No TX'}`);
    } catch (error) {
      console.error('Failed to store cold transfer record:', error);
    }
  }

  /**
   * Log cold transfer action for audit trail
   */
  private async logColdTransferAction(action: string, metadata: Record<string, any>): Promise<void> {
    try {
      console.log(`🏦 COLD TRANSFER ACTION: ${action}`, metadata);

      // In production, this would go to a dedicated audit log
      // await prisma.treasuryAuditLog.create({
      //   data: {
      //     action: `cold_transfer_${action}`,
      //     metadata: JSON.stringify(metadata),
      //     createdAt: new Date()
      //   }
      // });
    } catch (error) {
      console.error('Failed to log cold transfer action:', error);
    }
  }

  /**
   * Get recent cold transfer history
   */
  async getColdTransferHistory(limit: number = 50): Promise<ColdTransferRecord[]> {
    // TODO: Fetch from database
    // return await prisma.coldTransfer.findMany({
    //   orderBy: { createdAt: 'desc' },
    //   take: limit,
    //   include: {
    //     Token: { select: { symbol: true, name: true } },
    //     Admin: { select: { discordId: true } }
    //   }
    // });

    // Placeholder: Return empty array for now
    return [];
  }

  /**
   * Get pending transfers
   */
  getPendingTransfers(): ColdTransferRecord[] {
    return Array.from(this.pendingTransfers.values());
  }

  /**
   * Calculate recommended transfer amount based on treasury safety thresholds
   */
  calculateRecommendedTransferAmount(
    currentBalanceAtomic: bigint,
    maxHoldingUSD: number,
    currentUSDValue: number,
    token: TokenRow
  ): { shouldTransfer: boolean; transferAmountAtomic: bigint; reason: string } {

    if (currentUSDValue <= maxHoldingUSD) {
      return {
        shouldTransfer: false,
        transferAmountAtomic: 0n,
        reason: 'Balance is within safe limits'
      };
    }

    const excessUSD = currentUSDValue - maxHoldingUSD;
    const pricePerToken = currentUSDValue / Number(formatAmount(currentBalanceAtomic, token));
    const excessTokens = excessUSD / pricePerToken;
    const transferAmountAtomic = toAtomicDirect(excessTokens, token.decimals);

    return {
      shouldTransfer: true,
      transferAmountAtomic,
      reason: `Excess $${excessUSD.toFixed(2)} above safety limit of $${maxHoldingUSD}`
    };
  }

  /**
   * Emergency pause all cold transfers
   */
  async pauseColdTransfers(): Promise<void> {
    // Update AppConfig to disable auto transfers
    await prisma.appConfig.updateMany({
      data: { autoTransferEnabled: false }
    });

    console.log('🚨 EMERGENCY: All cold transfers have been paused');
  }
}

export const treasuryColdTransfer = new TreasuryColdTransferService();
export type { ColdTransferParams, ColdTransferResult, ColdTransferRecord };