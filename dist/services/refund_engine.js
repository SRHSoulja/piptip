import { prisma } from "./db.js";
import { creditTokenTx } from "./balances.js";
import { decToBigDirect } from "./token.js";
import { incrementRefundIssued, incrementRefundFailure } from "./metrics.js";
class RefundEngine {
  /**
   * Refund a tip with principal + tax in a single transaction
   * @param tipId The tip ID to refund
   * @returns RefundResult indicating success/failure and amounts
   */
  static async refundTip(tipId) {
    return await prisma.$transaction(async (tx) => {
      const tip = await tx.tip.findUnique({
        where: { id: tipId },
        include: {
          From: true,
          Token: true
        }
      });
      if (!tip) {
        incrementRefundFailure("tip_not_found");
        return {
          success: false,
          message: "Tip not found"
        };
      }
      if (tip.status === "REFUNDED") {
        return {
          success: true,
          message: "Tip already refunded",
          alreadyRefunded: true,
          refundedAmount: BigInt(tip.amountAtomic.toString()),
          refundedTax: BigInt(tip.taxAtomic.toString())
        };
      }
      if (!tip.From || !tip.Token) {
        incrementRefundFailure("invalid_tip_data");
        return {
          success: false,
          message: "Invalid tip data - missing sender or token"
        };
      }
      const principalAtomic = BigInt(tip.amountAtomic.toString());
      const taxAtomic = BigInt(tip.taxAtomic.toString());
      const totalRefund = principalAtomic + taxAtomic;
      await creditTokenTx(tx, tip.From.discordId, tip.Token.id, totalRefund, "TIP", {
        note: `Tip refund: principal ${tip.amountAtomic} + tax ${tip.taxAtomic}`
      });
      await tx.tip.update({
        where: { id: tipId },
        data: {
          status: "REFUNDED",
          refundedAt: /* @__PURE__ */ new Date()
        }
      });
      incrementRefundIssued("single");
      return {
        success: true,
        message: "Tip refunded successfully",
        alreadyRefunded: false,
        refundedAmount: principalAtomic,
        refundedTax: taxAtomic
      };
    });
  }
  /**
   * Refund a group tip contribution with principal + tax in a single transaction
   * @param groupTipId The group tip ID to refund
   * @returns RefundResult indicating success/failure and amounts  
   */
  static async refundContribution(groupTipId) {
    return await prisma.$transaction(async (tx) => {
      const groupTip = await tx.groupTip.findUnique({
        where: { id: groupTipId },
        include: {
          Creator: true,
          Token: true
        }
      });
      if (!groupTip) {
        incrementRefundFailure("group_tip_not_found");
        return {
          success: false,
          message: "Group tip not found"
        };
      }
      if (groupTip.status === "REFUNDED") {
        return {
          success: true,
          message: "Group tip already refunded",
          alreadyRefunded: true,
          refundedAmount: decToBigDirect(groupTip.totalAmount, groupTip.Token.decimals),
          refundedTax: BigInt(groupTip.taxAtomic.toString())
        };
      }
      if (!groupTip.Creator || !groupTip.Token) {
        incrementRefundFailure("invalid_group_tip_data");
        return {
          success: false,
          message: "Invalid group tip data - missing creator or token"
        };
      }
      const principalAtomic = decToBigDirect(groupTip.totalAmount, groupTip.Token.decimals);
      const taxAtomic = BigInt(groupTip.taxAtomic.toString());
      const totalRefund = principalAtomic + taxAtomic;
      await creditTokenTx(tx, groupTip.Creator.discordId, groupTip.Token.id, totalRefund, "TIP", {
        guildId: groupTip.guildId ?? void 0,
        note: `Group tip refund: principal ${groupTip.totalAmount} + tax ${groupTip.taxAtomic}`
      });
      await tx.groupTip.update({
        where: { id: groupTipId },
        data: {
          status: "REFUNDED",
          refundedAt: /* @__PURE__ */ new Date()
        }
      });
      incrementRefundIssued("group");
      return {
        success: true,
        message: "Group tip refunded successfully",
        alreadyRefunded: false,
        refundedAmount: principalAtomic,
        refundedTax: taxAtomic
      };
    });
  }
}
export {
  RefundEngine
};
//# sourceMappingURL=refund_engine.js.map
