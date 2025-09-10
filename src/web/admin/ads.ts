// src/web/admin/ads.ts
import { Router } from "express";
import { prisma } from "../../services/db.js";

export const adsRouter = Router();

adsRouter.get("/ads", async (_req, res) => {
  try {
    const ads = await prisma.ad.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ ok: true, ads });
  } catch {
    res.status(500).json({ ok:false, error:"Failed to fetch ads" });
  }
});

adsRouter.post("/ads", async (req, res) => {
  try {
    const { text, url, weight = 5, active = true } = req.body;
    if (!text || typeof text !== "string" || text.trim().length === 0) return res.status(400).json({ ok:false, error:"Ad text is required" });
    if (text.length > 500) return res.status(400).json({ ok:false, error:"Ad text too long (max 500 characters)" });
    if (url && (!/^https?:\/\/.+/.test(url) || url.length > 2000)) return res.status(400).json({ ok:false, error:"Invalid URL format or too long" });

    const weightNum = Number(weight);
    if (isNaN(weightNum) || weightNum < 1 || weightNum > 100) return res.status(400).json({ ok:false, error:"Weight must be between 1 and 100" });

    const ad = await prisma.ad.create({ data: { text: text.trim(), url: url?.trim() || null, weight: weightNum, active: Boolean(active) } });
    res.json({ ok:true, ad, message:"Ad created successfully" });
  } catch {
    res.status(500).json({ ok:false, error:"Failed to create ad" });
  }
});

adsRouter.put("/ads/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok:false, error:"Invalid ad ID" });

    const { active, weight, text, url } = req.body;
    const data: any = {};
    if (typeof active === "boolean") data.active = active;
    if (weight !== undefined) {
      const w = Number(weight);
      if (isNaN(w) || w < 1 || w > 100) return res.status(400).json({ ok:false, error:"Weight must be between 1 and 100" });
      data.weight = w;
    }
    if (text !== undefined) {
      if (!text || text.trim().length === 0) return res.status(400).json({ ok:false, error:"Ad text is required" });
      if (text.length > 500) return res.status(400).json({ ok:false, error:"Ad text too long (max 500 characters)" });
      data.text = text.trim();
    }
    if (url !== undefined) {
      if (url && (!/^https?:\/\/.+/.test(url) || url.length > 2000)) return res.status(400).json({ ok:false, error:"Invalid URL format or too long" });
      data.url = url?.trim() || null;
    }

    const ad = await prisma.ad.update({ where: { id }, data });
    res.json({ ok:true, ad });
  } catch (error: any) {
    if (error.code === "P2025") return res.status(404).json({ ok:false, error:"Ad not found" });
    res.status(500).json({ ok:false, error:"Failed to update ad" });
  }
});

adsRouter.delete("/ads/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok:false, error:"Invalid ad ID" });
    await prisma.ad.delete({ where: { id } });
    res.json({ ok:true, message:"Ad deleted successfully" });
  } catch (error: any) {
    if (error.code === "P2025") return res.status(404).json({ ok:false, error:"Ad not found" });
    res.status(500).json({ ok:false, error:"Failed to delete ad" });
  }
});

adsRouter.post("/ads/refresh", async (_req, res) => {
  try {
    const { refreshAdsCache } = await import("../../services/ads.js");
    await refreshAdsCache();
    res.json({ ok:true, message:"Ad cache refreshed successfully" });
  } catch {
    res.status(500).json({ ok:false, error:"Failed to refresh ad cache" });
  }
});