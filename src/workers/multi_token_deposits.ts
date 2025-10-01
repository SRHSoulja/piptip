// Multi-Token Deposit Watcher - Replaces single-token deposits.ts
// Monitors ALL active tokens for deposits to treasury address

import "dotenv/config";
import { JsonRpcProvider } from "ethers";
import { PrismaClient } from "@prisma/client";
import { getActiveTokens } from "../services/token.js";
import { applyDeposit } from "../services/deposits.js";
import { getAbstractRpcUrl } from "../services/network.js";

const prisma = new PrismaClient();

const RPC = getAbstractRpcUrl();
const TREASURY = process.env.TREASURY_AGW_ADDRESS!.toLowerCase();

// Alchemy JSON-RPC provider
const provider = new JsonRpcProvider(RPC);

// Persistent cursor for multi-token scanning
const CURSOR_NAME = "multi_token_treasury";

type AlchemyTransfer = {
  hash: string;
  from: string;
  to: string;
  rawContract?: { value?: string | null; address?: string | null; decimal?: string | number | null };
  category: string;
  blockNum: string;
  contract?: { address?: string | null };
};

// Helper: hex to bigint (Alchemy returns rawContract.value as hex)
function hexToBigint(hex?: string | null): bigint {
  if (!hex) return 0n;
  return BigInt(hex);
}

// Load cursor or seed to latest-5000
async function getCursor(): Promise<string> {
  const c = await prisma.depositCursor.findUnique({ where: { name: CURSOR_NAME } });
  if (c) return c.blockHex;

  const latest = await provider.getBlockNumber();
  const start = Math.max(0, latest - 5000);
  const hex = "0x" + start.toString(16);
  await prisma.depositCursor.create({ data: { name: CURSOR_NAME, blockHex: hex } });
  console.log(`⏱️ Multi-token watcher starting backfill from block ${start} → latest`);
  return hex;
}

async function saveCursor(blockHex: string) {
  await prisma.depositCursor.upsert({
    where: { name: CURSOR_NAME },
    update: { blockHex },
    create: { name: CURSOR_NAME, blockHex },
  });
}

async function processMultiTokenDeposits(fromBlockHex: string): Promise<string> {
  // Get all active token addresses
  const tokens = await getActiveTokens();
  if (tokens.length === 0) {
    console.log("⚠️ No active tokens found in database");
    return fromBlockHex;
  }

  const tokenAddresses = tokens.map(t => t.address);
  console.log(`🔍 Scanning ${tokens.length} tokens: ${tokens.map(t => t.symbol).join(', ')}`);

  // Pull ALL ERC20 transfers TO treasury for ALL active tokens
  const paramsBase: any = {
    fromBlock: fromBlockHex,
    toBlock: "latest",
    toAddress: TREASURY,
    category: ["erc20"],
    contractAddresses: tokenAddresses, // Multiple token addresses
    withMetadata: false,
    excludeZeroValue: true,
    order: "asc",
    maxCount: "0x3e8", // 1000 per page
  };

  let pageKey: string | undefined;
  let lastBlockSeen = fromBlockHex;
  let totalProcessed = 0;

  do {
    const params = { ...paramsBase, pageKey };

    try {
      const resp: any = await provider.send("alchemy_getAssetTransfers", [params]);
      const transfers: AlchemyTransfer[] = (resp?.transfers || []) as any[];

      for (const transfer of transfers) {
        const toAddr = (transfer.to || "").toLowerCase();
        const fromAddr = (transfer.from || "").toLowerCase();
        const tokenAddr = (transfer.contract?.address || transfer.rawContract?.address || "").toLowerCase();

        // Validate transfer
        if (transfer.category !== "erc20") continue;
        if (toAddr !== TREASURY) continue;
        if (!tokenAddresses.includes(tokenAddr)) continue;

        const valueAtomic = hexToBigint(transfer.rawContract?.value);
        if (valueAtomic <= 0n) continue;

        // Use the unified deposit handler
        const result = await applyDeposit({
          from: fromAddr,
          to: toAddr,
          token: tokenAddr,
          valueAtomic: valueAtomic,
          tx: transfer.hash
        });

        if (result.ok) {
          totalProcessed++;
          if (result.credited) {
            console.log(`💰 ${result.token}: ${result.amount} credited to user ${result.userId} (tx: ${transfer.hash})`);
          } else if (result.duplicate) {
            // Silent - already processed
          } else if (result.skipped) {
            console.log(`⏭️ ${tokenAddr}: ${result.skipped} (tx: ${transfer.hash})`);
          } else if (result.ignored) {
            console.log(`🔎 ${tokenAddr}: ${result.ignored} (tx: ${transfer.hash})`);
          }
        } else {
          console.log(`❌ ${tokenAddr}: ${result.reason} (tx: ${transfer.hash})`);
        }

        lastBlockSeen = transfer.blockNum;
      }

      pageKey = resp?.pageKey;
    } catch (error) {
      console.error("Error fetching transfers:", error);
      break; // Exit page loop on error
    }
  } while (pageKey);

  if (totalProcessed > 0) {
    console.log(`📊 Processed ${totalProcessed} deposits across ${tokens.length} tokens`);
  }

  return lastBlockSeen || fromBlockHex;
}

async function pollOnce() {
  let fromBlockHex = await getCursor();

  try {
    const newBlockHex = await processMultiTokenDeposits(fromBlockHex);

    // Only advance cursor if we processed successfully
    if (newBlockHex !== fromBlockHex) {
      await saveCursor(newBlockHex);
    }
  } catch (error) {
    console.error("Multi-token deposit processing error:", error);
    // Don't advance cursor on error - retry from same position
  }
}

async function main() {
  console.log("🔎 Multi-token deposit watcher starting...");
  console.log(`📍 Treasury address: ${TREASURY}`);

  // Initialize cursor
  await getCursor();

  // Log active tokens on startup
  const tokens = await getActiveTokens();
  console.log(`🪙 Monitoring ${tokens.length} active tokens:`);
  tokens.forEach(token => {
    console.log(`  - ${token.symbol} (${token.address})`);
  });

  while (true) {
    try {
      await pollOnce();
    } catch (error) {
      console.error("Multi-token watcher error:", error);
    }

    // Poll every 7 seconds
    await new Promise((resolve) => setTimeout(resolve, 7_000));
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Multi-token deposit watcher shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Multi-token deposit watcher terminated');
  process.exit(0);
});

main().catch((err) => {
  console.error("Fatal multi-token watcher error:", err);
  process.exit(1);
});