// src/config.ts
import dotenv from "dotenv";
dotenv.config({ override: true });

export const DISCORD_TOKEN = process.env.DISCORD_TOKEN!;
export const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
export const GUILD_ID = process.env.GUILD_ID!;

export const ABSTRACT_RPC_URL = process.env.ABSTRACT_RPC_URL!;
export const TREASURY_AGW_ADDRESS = (() => {
  const address = process.env.TREASURY_AGW_ADDRESS;
  if (!address) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TREASURY_AGW_ADDRESS environment variable is required in production');
    }
    console.warn('⚠️ TREASURY_AGW_ADDRESS not set - treasury operations disabled');
    return '';
  }
  return address.toLowerCase();
})();
export const AGW_SESSION_PRIVATE_KEY = process.env.AGW_SESSION_PRIVATE_KEY!;

export const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS || "18");
export const TOKEN_ADDR_LOWER = (() => {
  const address = process.env.TOKEN_ADDRESS;
  if (!address) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TOKEN_ADDRESS environment variable is required in production');
    }
    console.warn('⚠️ TOKEN_ADDRESS not set - token operations may fail');
    return '';
  }
  return address.toLowerCase();
})();

export const ADMIN_BEARER = process.env.ADMIN_BEARER || "";
export const INTERNAL_BEARER = process.env.INTERNAL_BEARER || process.env.NODE_INTERNAL_BEARER || "";

import { prisma } from "./services/db.js";

let _cache: any | null = null;
let _ts = 0;

/** Load AppConfig with a tiny 10s in-memory cache. Falls back to envs if row missing. */
export async function getConfig(force = false) {
  const now = Date.now();
  if (!force && _cache && now - _ts < 10_000) return _cache;
  const cfg = await prisma.appConfig.findFirst();
  _cache = cfg ?? {
    minDeposit: 50,
    minWithdraw: 50,
    withdrawMaxPerTx: 50,
    withdrawDailyCap: 500,
    houseFeeBps: Number(process.env.HOUSE_FEE_BPS || 200),
    tipFeeBps: Number(process.env.TIP_FEE_BPS || 100),
    referralEnabled: true,
    referralTaxReductionBps: 50, // 0.5% tax reduction - safe with 1%+ rake
    referralRakeReductionBps: 50, // 0.5% rake reduction - safe with 3%+ rake
    referralVerificationThreshold: 20,
    referralRewardInterval: 10,
    referralWelcomeBonus: 0,
  };
  _ts = now;
  return _cache;
}
