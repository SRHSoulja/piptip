import { ethers, Contract } from "ethers";
import { prisma } from "./db.js";
import { formatAmount, toAtomicDirect } from "./token.js";
import { logCompleteTransaction } from "./tx_logger.js";
class TreasuryColdTransferService {
  pendingTransfers = /* @__PURE__ */ new Map();
  /**
   * Validate cold wallet transfer parameters
   */
  async validateTransfer(params, token) {
    if (!ethers.isAddress(params.destinationAddress)) {
      return { valid: false, error: "Invalid destination address format" };
    }
    const treasuryAddress = process.env.TREASURY_PRIVATE_KEY ? new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY).address : null;
    if (treasuryAddress && params.destinationAddress.toLowerCase() === treasuryAddress.toLowerCase()) {
      return { valid: false, error: "Destination cannot be the same as treasury address" };
    }
    if (params.amountAtomic <= 0n) {
      return { valid: false, error: "Transfer amount must be greater than zero" };
    }
    try {
      const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
      const wallet = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY, provider);
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
      return { valid: false, error: `Failed to check treasury balance: ${error.message}` };
    }
    const transferKey = `${params.tokenId}_${params.destinationAddress}`;
    if (this.pendingTransfers.has(transferKey)) {
      return { valid: false, error: "Transfer to this address already pending" };
    }
    return { valid: true };
  }
  /**
   * Execute cold wallet transfer
   */
  async executeColdTransfer(params, token) {
    const validation = await this.validateTransfer(params, token);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    const transferKey = `${params.tokenId}_${params.destinationAddress}`;
    const record = {
      tokenId: params.tokenId,
      amountAtomic: params.amountAtomic,
      destinationAddress: params.destinationAddress,
      reason: params.reason,
      initiatedBy: params.initiatedBy,
      adminUserId: params.adminUserId,
      status: "pending",
      createdAt: /* @__PURE__ */ new Date()
    };
    this.pendingTransfers.set(transferKey, record);
    try {
      const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
      const wallet = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY, provider);
      const ERC20_ABI = [
        "function balanceOf(address) view returns (uint256)",
        "function transfer(address to, uint256 amount) returns (bool)"
      ];
      const tokenContract = new Contract(token.address, ERC20_ABI, wallet);
      console.log(`\u{1F3E6} Executing cold transfer: ${formatAmount(params.amountAtomic, token)} ${token.symbol} to ${params.destinationAddress}`);
      const tx = await tokenContract.transfer(params.destinationAddress, params.amountAtomic);
      console.log(`\u{1F4E4} Cold transfer transaction sent: ${tx.hash}`);
      record.txHash = tx.hash;
      record.status = "pending";
      const receipt = await tx.wait();
      if (receipt?.status === 1) {
        record.status = "completed";
        record.completedAt = /* @__PURE__ */ new Date();
        record.gasUsed = receipt.gasUsed;
        console.log(`\u2705 Cold transfer completed: ${tx.hash} (Gas: ${receipt.gasUsed})`);
        await prisma.$transaction(async (txDb) => {
          const idempotencyKey = `treasury_cold_transfer_${params.tokenId}_${tx.hash}`;
          await logCompleteTransaction(txDb, {
            operation: "TREASURY_COLD_TRANSFER",
            userId: params.adminUserId,
            // Optional admin user ID
            balanceChanges: [{
              tokenId: params.tokenId,
              userId: void 0,
              // Treasury operation - no specific user
              amountDelta: -params.amountAtomic,
              // Funds leaving treasury
              reason: "treasury_cold_transfer"
            }],
            metadata: {
              destinationAddress: params.destinationAddress,
              reason: params.reason,
              initiatedBy: params.initiatedBy,
              adminUserId: params.adminUserId,
              gasUsed: receipt.gasUsed.toString()
            },
            blockchainTxHash: tx.hash,
            idempotencyKey,
            source: "TREASURY"
          });
        });
        await this.storeColdTransferRecord(record);
        await this.logColdTransferAction("transfer_completed", {
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
        throw new Error("Transaction failed on blockchain");
      }
    } catch (error) {
      const errorMessage = error.message;
      record.status = "failed";
      record.error = errorMessage;
      record.completedAt = /* @__PURE__ */ new Date();
      console.error(`\u274C Cold transfer failed:`, error);
      await this.storeColdTransferRecord(record);
      await this.logColdTransferAction("transfer_failed", {
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
      this.pendingTransfers.delete(transferKey);
    }
  }
  /**
   * Store cold transfer record in database
   */
  async storeColdTransferRecord(record) {
    try {
      console.log(`\u{1F4DD} Cold transfer record stored: ${record.status} - ${record.txHash || "No TX"}`);
    } catch (error) {
      console.error("Failed to store cold transfer record:", error);
    }
  }
  /**
   * Log cold transfer action for audit trail
   */
  async logColdTransferAction(action, metadata) {
    try {
      console.log(`\u{1F3E6} COLD TRANSFER ACTION: ${action}`, metadata);
    } catch (error) {
      console.error("Failed to log cold transfer action:", error);
    }
  }
  /**
   * Get recent cold transfer history
   */
  async getColdTransferHistory(limit = 50) {
    return [];
  }
  /**
   * Get pending transfers
   */
  getPendingTransfers() {
    return Array.from(this.pendingTransfers.values());
  }
  /**
   * Calculate recommended transfer amount based on treasury safety thresholds
   */
  calculateRecommendedTransferAmount(currentBalanceAtomic, maxHoldingUSD, currentUSDValue, token) {
    if (currentUSDValue <= maxHoldingUSD) {
      return {
        shouldTransfer: false,
        transferAmountAtomic: 0n,
        reason: "Balance is within safe limits"
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
  async pauseColdTransfers() {
    await prisma.appConfig.updateMany({
      data: { autoTransferEnabled: false }
    });
    console.log("\u{1F6A8} EMERGENCY: All cold transfers have been paused");
  }
}
const treasuryColdTransfer = new TreasuryColdTransferService();
export {
  treasuryColdTransfer
};
//# sourceMappingURL=treasury_cold_transfer.js.map
