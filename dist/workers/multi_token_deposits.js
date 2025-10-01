import "dotenv/config";
import { JsonRpcProvider } from "ethers";
import { PrismaClient } from "@prisma/client";
import { getActiveTokens } from "../services/token.js";
import { applyDeposit } from "../services/deposits.js";
import { getAbstractRpcUrl } from "../services/network.js";
const prisma = new PrismaClient();
const RPC = getAbstractRpcUrl();
const TREASURY = process.env.TREASURY_AGW_ADDRESS.toLowerCase();
const provider = new JsonRpcProvider(RPC);
const CURSOR_NAME = "multi_token_treasury";
function hexToBigint(hex) {
  if (!hex) return 0n;
  return BigInt(hex);
}
async function getCursor() {
  const c = await prisma.depositCursor.findUnique({ where: { name: CURSOR_NAME } });
  if (c) return c.blockHex;
  const latest = await provider.getBlockNumber();
  const start = Math.max(0, latest - 5e3);
  const hex = "0x" + start.toString(16);
  await prisma.depositCursor.create({ data: { name: CURSOR_NAME, blockHex: hex } });
  console.log(`\u23F1\uFE0F Multi-token watcher starting backfill from block ${start} \u2192 latest`);
  return hex;
}
async function saveCursor(blockHex) {
  await prisma.depositCursor.upsert({
    where: { name: CURSOR_NAME },
    update: { blockHex },
    create: { name: CURSOR_NAME, blockHex }
  });
}
async function processMultiTokenDeposits(fromBlockHex) {
  const tokens = await getActiveTokens();
  if (tokens.length === 0) {
    console.log("\u26A0\uFE0F No active tokens found in database");
    return fromBlockHex;
  }
  const tokenAddresses = tokens.map((t) => t.address);
  console.log(`\u{1F50D} Scanning ${tokens.length} tokens: ${tokens.map((t) => t.symbol).join(", ")}`);
  const paramsBase = {
    fromBlock: fromBlockHex,
    toBlock: "latest",
    toAddress: TREASURY,
    category: ["erc20"],
    contractAddresses: tokenAddresses,
    // Multiple token addresses
    withMetadata: false,
    excludeZeroValue: true,
    order: "asc",
    maxCount: "0x3e8"
    // 1000 per page
  };
  let pageKey;
  let lastBlockSeen = fromBlockHex;
  let totalProcessed = 0;
  do {
    const params = { ...paramsBase, pageKey };
    try {
      const resp = await provider.send("alchemy_getAssetTransfers", [params]);
      const transfers = resp?.transfers || [];
      for (const transfer of transfers) {
        const toAddr = (transfer.to || "").toLowerCase();
        const fromAddr = (transfer.from || "").toLowerCase();
        const tokenAddr = (transfer.contract?.address || transfer.rawContract?.address || "").toLowerCase();
        if (transfer.category !== "erc20") continue;
        if (toAddr !== TREASURY) continue;
        if (!tokenAddresses.includes(tokenAddr)) continue;
        const valueAtomic = hexToBigint(transfer.rawContract?.value);
        if (valueAtomic <= 0n) continue;
        const result = await applyDeposit({
          from: fromAddr,
          to: toAddr,
          token: tokenAddr,
          valueAtomic,
          tx: transfer.hash
        });
        if (result.ok) {
          totalProcessed++;
          if (result.credited) {
            console.log(`\u{1F4B0} ${result.token}: ${result.amount} credited to user ${result.userId} (tx: ${transfer.hash})`);
          } else if (result.duplicate) {
          } else if (result.skipped) {
            console.log(`\u23ED\uFE0F ${tokenAddr}: ${result.skipped} (tx: ${transfer.hash})`);
          } else if (result.ignored) {
            console.log(`\u{1F50E} ${tokenAddr}: ${result.ignored} (tx: ${transfer.hash})`);
          }
        } else {
          console.log(`\u274C ${tokenAddr}: ${result.reason} (tx: ${transfer.hash})`);
        }
        lastBlockSeen = transfer.blockNum;
      }
      pageKey = resp?.pageKey;
    } catch (error) {
      console.error("Error fetching transfers:", error);
      break;
    }
  } while (pageKey);
  if (totalProcessed > 0) {
    console.log(`\u{1F4CA} Processed ${totalProcessed} deposits across ${tokens.length} tokens`);
  }
  return lastBlockSeen || fromBlockHex;
}
async function pollOnce() {
  let fromBlockHex = await getCursor();
  try {
    const newBlockHex = await processMultiTokenDeposits(fromBlockHex);
    if (newBlockHex !== fromBlockHex) {
      await saveCursor(newBlockHex);
    }
  } catch (error) {
    console.error("Multi-token deposit processing error:", error);
  }
}
async function main() {
  console.log("\u{1F50E} Multi-token deposit watcher starting...");
  console.log(`\u{1F4CD} Treasury address: ${TREASURY}`);
  await getCursor();
  const tokens = await getActiveTokens();
  console.log(`\u{1FA99} Monitoring ${tokens.length} active tokens:`);
  tokens.forEach((token) => {
    console.log(`  - ${token.symbol} (${token.address})`);
  });
  while (true) {
    try {
      await pollOnce();
    } catch (error) {
      console.error("Multi-token watcher error:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 7e3));
  }
}
process.on("SIGINT", () => {
  console.log("\n\u{1F6D1} Multi-token deposit watcher shutting down...");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("\n\u{1F6D1} Multi-token deposit watcher terminated");
  process.exit(0);
});
main().catch((err) => {
  console.error("Fatal multi-token watcher error:", err);
  process.exit(1);
});
//# sourceMappingURL=multi_token_deposits.js.map
