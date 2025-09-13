// src/web/admin/tiers.ts
import { Router } from "express";
import { prisma } from "../../services/db.js";
export const tiersRouter = Router();
tiersRouter.get("/tiers", async (_req, res) => {
    try {
        const tiers = await prisma.tier.findMany({
            include: {
                prices: {
                    include: { token: true }
                }
            },
            orderBy: { createdAt: "desc" }
        });
        // Format tiers for the old admin interface compatibility
        const formattedTiers = tiers.map(tier => ({
            id: tier.id,
            name: tier.name,
            description: tier.description,
            priceAmount: tier.priceAmount, // legacy field for compatibility
            durationDays: tier.durationDays,
            tipTaxFree: tier.tipTaxFree,
            active: tier.active,
            tokenId: tier.prices[0]?.tokenId || null, // first token for legacy compatibility
            token: tier.prices[0]?.token || null
        }));
        res.json({ ok: true, tiers: formattedTiers });
    }
    catch (error) {
        console.error("Failed to fetch tiers:", error);
        res.status(500).json({ ok: false, error: "Failed to fetch tiers" });
    }
});
tiersRouter.post("/tiers", async (req, res) => {
    try {
        const { name, description, tokenId, priceAmount, durationDays, tipTaxFree = false, active = true } = req.body;
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
                    tipTaxFree: Boolean(tipTaxFree),
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
    }
    catch (error) {
        console.error("Failed to create tier:", error);
        if (error.code === "P2002") {
            return res.status(400).json({ ok: false, error: "Tier name already exists" });
        }
        res.status(500).json({ ok: false, error: "Failed to create tier" });
    }
});
tiersRouter.put("/tiers/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id))
            return res.status(400).json({ ok: false, error: "Invalid tier ID" });
        const { name, description, priceAmount, durationDays, tipTaxFree, active } = req.body;
        const data = {};
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
        if (typeof tipTaxFree === "boolean")
            data.tipTaxFree = tipTaxFree;
        if (typeof active === "boolean")
            data.active = active;
        const tier = await prisma.tier.update({ where: { id }, data });
        // Also update the price if priceAmount was changed
        if (priceAmount !== undefined) {
            await prisma.tierPrice.updateMany({
                where: { tierId: id },
                data: { amount: Number(priceAmount) }
            });
        }
        res.json({ ok: true, tier });
    }
    catch (error) {
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
