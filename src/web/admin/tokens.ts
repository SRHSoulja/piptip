// src/web/admin/tokens.ts
import { Router, Request, Response } from "express";
import { JsonRpcProvider, Contract } from "ethers";
import { prisma } from "../../services/db.js";
import { ABSTRACT_RPC_URL } from "../../config.js";
import { priceAPI } from "../../services/price_api.js";
import { alchemyTokenMetadata } from "../../services/alchemy_token_metadata.js";

export const tokensRouter = Router();

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

tokensRouter.get("/tokens", async (_req: Request, res: Response) => {
  try {
    const tokens = await prisma.token.findMany({
      orderBy: { createdAt: "asc" }
    });
    res.json({ ok: true, tokens });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to fetch tokens" });
  }
});

tokensRouter.post("/tokens", async (req: Request, res: Response) => {
  try {
    const { address } = req.body;
    
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ ok: false, error: "Invalid token address" });
    }

    // Check if token already exists
    const existing = await prisma.token.findUnique({ where: { address: address.toLowerCase() } });
    if (existing) {
      return res.status(400).json({ ok: false, error: "Token already exists" });
    }

    // Fetch token info from blockchain
    const provider = new JsonRpcProvider(ABSTRACT_RPC_URL);
    const contract = new Contract(address, ERC20_ABI, provider);
    
    const [name, symbol, decimals] = await Promise.all([
      contract.name(),
      contract.symbol(), 
      contract.decimals()
    ]);

    const token = await prisma.token.create({
      data: {
        address: address.toLowerCase(),
        symbol,
        decimals: Number(decimals),
        active: true,
        minDeposit: 50,
        minWithdraw: 50
      }
    });

    // Try to get current price (non-blocking)
    let currentPrice = null;
    try {
      currentPrice = await priceAPI.getTokenPrice(symbol);
      console.log(`💰 Current price for ${symbol}: $${currentPrice}`);
    } catch (error) {
      console.warn(`Failed to fetch price for ${symbol}:`, error);
    }

    res.json({
      ok: true,
      token: {
        ...token,
        currentPrice,
        priceSource: currentPrice ? 'live' : 'unavailable'
      }
    });
  } catch (error: any) {
    console.error("Failed to add token:", error);
    if (error.code === "P2002") {
      return res.status(400).json({ ok: false, error: "Token address already exists" });
    }
    res.status(500).json({ ok: false, error: "Failed to add token" });
  }
});

tokensRouter.put("/tokens/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid token ID" });

    const { active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap } = req.body;
    const data: any = {};

    if (typeof active === "boolean") data.active = active;
    if (minDeposit !== undefined) data.minDeposit = Number(minDeposit);
    if (minWithdraw !== undefined) data.minWithdraw = Number(minWithdraw);
    if (tipFeeBps !== undefined) data.tipFeeBps = tipFeeBps === "" ? null : Number(tipFeeBps);
    if (houseFeeBps !== undefined) data.houseFeeBps = houseFeeBps === "" ? null : Number(houseFeeBps);
    if (withdrawMaxPerTx !== undefined) data.withdrawMaxPerTx = withdrawMaxPerTx === "" ? null : Number(withdrawMaxPerTx);
    if (withdrawDailyCap !== undefined) data.withdrawDailyCap = withdrawDailyCap === "" ? null : Number(withdrawDailyCap);

    const token = await prisma.token.update({ where: { id }, data });
    res.json({ ok: true, token });
  } catch (error: any) {
    if (error.code === "P2025") {
      return res.status(404).json({ ok: false, error: "Token not found" });
    }
    res.status(500).json({ ok: false, error: "Failed to update token" });
  }
});

tokensRouter.delete("/tokens/:id", async (req: Request, res: Response) => {
  try {
    const tokenId = parseInt(req.params.id);
    if (isNaN(tokenId)) {
      return res.status(400).json({ ok: false, error: "Invalid token ID" });
    }

    // Check if token exists
    const token = await prisma.token.findUnique({ where: { id: tokenId } });
    if (!token) {
      return res.status(404).json({ ok: false, error: "Token not found" });
    }

    // Safety checks - prevent deletion if token is in use
    const [userBalances, transactions, tierPrices, groupTips] = await Promise.all([
      prisma.userBalance.count({ where: { tokenId } }),
      prisma.transaction.count({ where: { tokenId } }),
      prisma.tierPrice.count({ where: { tokenId } }),
      prisma.groupTip.count({ where: { tokenId } })
    ]);

    const issues = [];
    if (userBalances > 0) issues.push(`${userBalances} user balances`);
    if (transactions > 0) issues.push(`${transactions} transactions`);
    if (tierPrices > 0) issues.push(`${tierPrices} tier prices`);
    if (groupTips > 0) issues.push(`${groupTips} group tips`);

    if (issues.length > 0) {
      return res.status(400).json({ 
        ok: false, 
        error: `Cannot delete token - it has associated data: ${issues.join(', ')}`,
        details: { userBalances, transactions, tierPrices, groupTips }
      });
    }

    // Safe to delete - no associated data
    await prisma.token.delete({ where: { id: tokenId } });

    console.log(`Token ${token.symbol} (ID: ${tokenId}) deleted by admin`);
    res.json({ 
      ok: true, 
      message: `Token ${token.symbol} deleted successfully`,
      deletedToken: token
    });

  } catch (error: any) {
    console.error("Token deletion failed:", error);
    
    // Handle foreign key constraint errors
    if (error.code === "P2003") {
      return res.status(400).json({ 
        ok: false, 
        error: "Cannot delete token - it is referenced by other records" 
      });
    }
    
    res.status(500).json({ 
      ok: false, 
      error: "Failed to delete token",
      details: error.message 
    });
  }
});

tokensRouter.post("/tokens/refresh", async (_req: Request, res: Response) => {
  try {
    // Invalidate token cache if you have one
    res.json({ ok: true, message: "Token cache refreshed" });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to refresh token cache" });
  }
});

// Test endpoint to explore what Alchemy provides for a token
tokensRouter.get("/tokens/:address/explore", async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ ok: false, error: "Invalid token address" });
    }

    console.log(`🔍 Exploring Alchemy metadata for: ${address}`);

    const exploration = await alchemyTokenMetadata.exploreAvailableMethods(address);

    res.json({
      ok: true,
      tokenAddress: address,
      exploration: {
        availableMethods: exploration.availableMethods,
        basicData: exploration.basicData,
        enhancedData: exploration.alchemyEnhanced,
        errors: exploration.errors,
        summary: {
          totalMethods: exploration.availableMethods.length,
          failedMethods: Object.keys(exploration.errors).length,
          hasEnhancedData: Object.keys(exploration.alchemyEnhanced).length > 1
        }
      }
    });
  } catch (error) {
    console.error("Token exploration failed:", error);
    res.status(500).json({
      ok: false,
      error: "Failed to explore token metadata",
      details: (error as Error).message
    });
  }
});