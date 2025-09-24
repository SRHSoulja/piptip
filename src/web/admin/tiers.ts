// src/web/admin/tiers.ts
import { Router, Request, Response } from "express";
import { prisma } from "../../services/db.js";

export const tiersRouter = Router();

tiersRouter.get("/tiers", async (_req: Request, res: Response) => {
  try {
    const tiers = await prisma.tier.findMany({
      include: { 
        prices: { 
          include: { token: true } 
        }
      },
      orderBy: { createdAt: "desc" }
    });
    
    // Format tiers for the admin interface with new fields
    const formattedTiers = tiers.map(tier => ({
      id: tier.id,
      name: tier.name,
      description: tier.description,
      priceAmount: tier.priceAmount, // legacy field for compatibility
      durationDays: tier.durationDays,

      // Tax and rake benefits
      tipTaxFree: tier.tipTaxFree, // legacy
      taxReductionBps: tier.taxReductionBps,
      rakeReductionBps: tier.rakeReductionBps,

      // Market creation permissions
      canCreateMarkets: tier.canCreateMarkets,
      dailyMarketLimit: tier.dailyMarketLimit,
      marketCooldownMinutes: tier.marketCooldownMinutes,

      // Direct percentage rates (new fields)
      customRakePercent: tier.customRakePercent, // PIP game rake
      marketRakePercent: tier.marketRakePercent, // Prediction market rake
      systemLiquidityBonus: tier.systemLiquidityBonus, // Liquidity bonus

      active: tier.active,
      tokenId: tier.prices[0]?.tokenId || null, // first token for legacy compatibility
      token: tier.prices[0]?.token || null,
      prices: tier.prices // Include all prices for multi-token support
    }));
    
    res.json({ ok: true, tiers: formattedTiers });
  } catch (error) {
    console.error("Failed to fetch tiers:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch tiers" });
  }
});

tiersRouter.post("/tiers", async (req: Request, res: Response) => {
  try {
    const {
      name, description, tokenId, priceAmount, durationDays,
      tipTaxFree = false, active = true,
      canCreateMarkets = false, dailyMarketLimit = 0, marketCooldownMinutes = 0,

      // Direct percentage rates (new fields)
      customRakePercent, // PIP game rake percentage
      marketRakePercent, // Prediction market rake percentage
      systemLiquidityBonus = 0, // Liquidity bonus

      // Legacy fields for compatibility
      taxReductionBps = 0,
      rakeReductionBps = 0
    } = req.body;
    
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ ok: false, error: "Tier name is required" });
    }
    
    if (!tokenId || isNaN(Number(tokenId))) {
      return res.status(400).json({ ok: false, error: "Valid token ID is required" });
    }
    
    if (!priceAmount || isNaN(Number(priceAmount)) || Number(priceAmount) <= 0) {
      return res.status(400).json({ ok: false, error: "Valid price amount is required" });
    }
    
    if (!durationDays || isNaN(Number(durationDays)) || Number(durationDays) <= 0) {
      return res.status(400).json({ ok: false, error: "Valid duration in days is required" });
    }

    // Verify token exists
    const token = await prisma.token.findUnique({ where: { id: Number(tokenId) } });
    if (!token) {
      return res.status(400).json({ ok: false, error: "Token not found" });
    }

    // Create tier and price in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create tier
      const tier = await tx.tier.create({
        data: {
          name: name.trim(),
          description: description?.trim() || null,
          priceAmount: Number(priceAmount), // legacy field for compatibility
          durationDays: Number(durationDays),

          // Tax and rake benefits
          tipTaxFree: Boolean(tipTaxFree),
          taxReductionBps: Number(taxReductionBps) || 0,
          rakeReductionBps: Number(rakeReductionBps) || 0,

          // Market creation permissions
          canCreateMarkets: Boolean(canCreateMarkets),
          dailyMarketLimit: Number(dailyMarketLimit) || 0,
          marketCooldownMinutes: Number(marketCooldownMinutes) || 0,

          // Direct percentage rates (new fields)
          customRakePercent: customRakePercent ? Number(customRakePercent) : null, // PIP game rake
          marketRakePercent: marketRakePercent ? Number(marketRakePercent) : 3.0, // Default 3% for prediction markets
          systemLiquidityBonus: Number(systemLiquidityBonus) || 0, // Liquidity bonus

          active: Boolean(active)
        }
      });

      // Create tier price
      await tx.tierPrice.create({
        data: {
          tierId: tier.id,
          tokenId: Number(tokenId),
          amount: Number(priceAmount)
        }
      });

      return tier;
    });

    res.json({ ok: true, tier: result, message: "Tier created successfully" });
  } catch (error: any) {
    console.error("Failed to create tier:", error);
    if (error.code === "P2002") {
      return res.status(400).json({ ok: false, error: "Tier name already exists" });
    }
    res.status(500).json({ ok: false, error: "Failed to create tier" });
  }
});

tiersRouter.put("/tiers/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid tier ID" });

    const {
      name, description, priceAmount, durationDays, tipTaxFree, active,
      canCreateMarkets, dailyMarketLimit, customRakePercent, marketCooldownMinutes
    } = req.body;
    const data: any = {};

    if (name !== undefined) {
      if (!name || name.trim().length === 0) {
        return res.status(400).json({ ok: false, error: "Tier name is required" });
      }
      data.name = name.trim();
    }

    if (description !== undefined) {
      data.description = description?.trim() || null;
    }

    if (priceAmount !== undefined) {
      const price = Number(priceAmount);
      if (isNaN(price) || price <= 0) {
        return res.status(400).json({ ok: false, error: "Valid price amount is required" });
      }
      data.priceAmount = price;
    }

    if (durationDays !== undefined) {
      const days = Number(durationDays);
      if (isNaN(days) || days <= 0) {
        return res.status(400).json({ ok: false, error: "Valid duration in days is required" });
      }
      data.durationDays = days;
    }

    if (typeof tipTaxFree === "boolean") data.tipTaxFree = tipTaxFree;
    if (typeof active === "boolean") data.active = active;

    // Prediction market fields
    if (typeof canCreateMarkets === "boolean") data.canCreateMarkets = canCreateMarkets;
    if (dailyMarketLimit !== undefined) {
      const limit = Number(dailyMarketLimit);
      if (!isNaN(limit) && limit >= 0) data.dailyMarketLimit = limit;
    }
    if (customRakePercent !== undefined) {
      if (customRakePercent === null || customRakePercent === "") {
        data.customRakePercent = null;
      } else {
        const rake = Number(customRakePercent);
        if (!isNaN(rake) && rake >= 0 && rake <= 100) data.customRakePercent = rake;
      }
    }
    if (marketCooldownMinutes !== undefined) {
      const cooldown = Number(marketCooldownMinutes);
      if (!isNaN(cooldown) && cooldown >= 0) data.marketCooldownMinutes = cooldown;
    }

    const tier = await prisma.tier.update({ where: { id }, data });
    
    // Also update the price if priceAmount was changed
    if (priceAmount !== undefined) {
      await prisma.tierPrice.updateMany({
        where: { tierId: id },
        data: { amount: Number(priceAmount) }
      });
    }

    res.json({ ok: true, tier });
  } catch (error: any) {
    console.error("Failed to update tier:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ ok: false, error: "Tier not found" });
    }
    if (error.code === "P2002") {
      return res.status(400).json({ ok: false, error: "Tier name already exists" });
    }
    res.status(500).json({ ok: false, error: "Failed to update tier" });
  }
});