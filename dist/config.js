import dotenv from "dotenv";
dotenv.config({ override: true });
import { getAbstractRpcUrl, getAbstractChainId } from "./services/network.js";
import { getAppConfig } from "./services/app_config_cache.js";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const ABSTRACT_RPC_URL = getAbstractRpcUrl();
const ABSTRACT_CHAIN_ID = getAbstractChainId();
const TREASURY_AGW_ADDRESS = (() => {
  const address = process.env.TREASURY_AGW_ADDRESS;
  if (!address) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TREASURY_AGW_ADDRESS environment variable is required in production");
    }
    console.warn("\u26A0\uFE0F TREASURY_AGW_ADDRESS not set - treasury operations disabled");
    return "";
  }
  return address.toLowerCase();
})();
const AGW_SESSION_PRIVATE_KEY = process.env.AGW_SESSION_PRIVATE_KEY;
const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS || "18");
const TOKEN_ADDR_LOWER = (() => {
  const address = process.env.TOKEN_ADDRESS;
  if (!address) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TOKEN_ADDRESS environment variable is required in production");
    }
    console.warn("\u26A0\uFE0F TOKEN_ADDRESS not set - token operations may fail");
    return "";
  }
  return address.toLowerCase();
})();
const ADMIN_BEARER = process.env.ADMIN_BEARER || "";
const INTERNAL_BEARER = process.env.INTERNAL_BEARER || process.env.NODE_INTERNAL_BEARER || "";
let _cache = null;
let _ts = 0;
async function getConfig(force = false) {
  const now = Date.now();
  if (!force && _cache && now - _ts < 1e4) return _cache;
  const cfg = await getAppConfig();
  _cache = cfg ?? {
    minDeposit: 50,
    minWithdraw: 50,
    withdrawMaxPerTx: 50,
    withdrawDailyCap: 500,
    houseFeeBps: Number(process.env.HOUSE_FEE_BPS || 200),
    tipFeeBps: Number(process.env.TIP_FEE_BPS || 100),
    referralEnabled: true,
    referralTaxReductionBps: 50,
    // 0.5% tax reduction - safe with 1%+ rake
    referralRakeReductionBps: 50,
    // 0.5% rake reduction - safe with 3%+ rake
    referralVerificationThreshold: 20,
    referralRewardInterval: 10,
    referralWelcomeBonus: 0
  };
  _ts = now;
  return _cache;
}
export {
  ABSTRACT_CHAIN_ID,
  ABSTRACT_RPC_URL,
  ADMIN_BEARER,
  AGW_SESSION_PRIVATE_KEY,
  DISCORD_CLIENT_ID,
  DISCORD_TOKEN,
  GUILD_ID,
  INTERNAL_BEARER,
  TOKEN_ADDR_LOWER,
  TOKEN_DECIMALS,
  TREASURY_AGW_ADDRESS,
  getConfig
};
//# sourceMappingURL=config.js.map
