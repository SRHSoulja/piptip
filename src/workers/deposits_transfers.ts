import "dotenv/config";
import { JsonRpcProvider } from "ethers";
import { PrismaClient } from "@prisma/client";
import { bigToDec } from "../services/token.js";

const prisma = new PrismaClient();

const RPC       = process.env.ABSTRACT_RPC_URL!;
const TOKEN     = process.env.TOKEN_ADDRESS!.toLowerCase();
const TREASURY  = process.env.TREASURY_AGW_ADDRESS!.toLowerCase();
const DECIMALS  = Number(process.env.TOKEN_DECIMALS || "18");

// Alchemy JSON-RPC (no need to pass chain id for Transfers API)
const provider = new JsonRpcProvider(RPC);

// Persistent cursor name
const CURSOR_NAME = "treasury";

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
  const start  = Math.max(0, latest - 5000);
  const hex    = "0x" + start.toString(16);
  await prisma.depositCursor.create({ data: { name: CURSOR_NAME, blockHex: hex } });
  console.log(`⏱  starting backfill from block ${start} → latest`);
  return hex;
}

async function saveCursor(blockHex: string) {
  await prisma.depositCursor.upsert({
    where: { name: CURSOR_NAME },
    update: { blockHex },
    create: { name: CURSOR_NAME, blockHex },
  });
}

async function credit(fromAddr: string, valueAtomic: bigint, txHash: string) {
  // De-dupe key: txHash + from + value
  const key = `${txHash}:${fromAddr.toLowerCase()}:${valueAtomic.toString()}`;

  try {
    await prisma.processedDeposit.create({ data: { key } });
  } catch (e: any) {
    if (e?.code === "P2002") {
      // already processed
      return;
    }
    throw e;
  }

  const user = await prisma.user.findFirst({
    where: { agwAddress: fromAddr.toLowerCase() },
  });
  if (!user) {
    console.log(`🔎 deposit from unlinked wallet ${fromAddr} tx ${txHash}`);
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { balanceAtomic: { increment: bigToDec(valueAtomic) } },
  });

  const whole = Number(valueAtomic) / 10 ** DECIMALS;
  console.log(`💰 credited ${whole} PENGU to ${user.discordId} (from ${fromAddr}) tx ${txHash}`);
}

type AlchemyTransfer = {
  hash: string;
  from: string;
  to: string;
  rawContract?: { value?: string | null; address?: string | null; decimal?: string | number | null };
  category: string; // "erc20", "external", etc
  blockNum: string; // hex
  contract?: { address?: string | null };
};

let fromBlockHex: string; // persisted cursor

async function pollOnce() {
  // Ensure we have a cursor
  if (!fromBlockHex) {
    fromBlockHex = await getCursor();
    // ensure saved
    await saveCursor(fromBlockHex);
  }

  // Pull ALL ERC20 transfers TO treasury, filtered to our token, ascending order.
  // Will auto-page via pageKey.
  const paramsBase: any = {
    fromBlock: fromBlockHex,
    toBlock: "latest",
    toAddress: TREASURY,
    category: ["erc20"],
    contractAddresses: [TOKEN],
    withMetadata: false,
    excludeZeroValue: true,
    order: "asc",
    maxCount: "0x3e8", // 1000 per page
  };

  let pageKey: string | undefined;
  let lastBlockSeen = fromBlockHex;

  do {
    const params = { ...paramsBase, pageKey };
    const resp: any = await provider.send("alchemy_getAssetTransfers", [params]);

    const transfers: AlchemyTransfer[] = (resp?.transfers || []) as any[];
    for (const t of transfers) {
      const toAddr   = (t.to || "").toLowerCase();
      const fromAddr = (t.from || "").toLowerCase();
      const token    = (t.contract?.address || t.rawContract?.address || "").toLowerCase();
      if (t.category !== "erc20") continue;
      if (toAddr !== TREASURY) continue;
      if (token !== TOKEN) continue;

      const valueAtomic = hexToBigint(t.rawContract?.value);
      if (valueAtomic > 0n) {
        await credit(fromAddr, valueAtomic, t.hash);
      }

      lastBlockSeen = t.blockNum;
    }

    pageKey = resp?.pageKey;
  } while (pageKey);

  // Advance cursor to last seen block for next poll
  fromBlockHex = lastBlockSeen || fromBlockHex;
  await saveCursor(fromBlockHex);
}

async function main() {
  console.log("🔎 watching deposits via Transfers API to", TREASURY);
  // seed cursor
  fromBlockHex = await getCursor();

  while (true) {
    try {
      await pollOnce();
    } catch (e: any) {
      console.error("transfers poll error:", e?.message ?? e);
    }
    // Poll cadence
    await new Promise((r) => setTimeout(r, 7_000));
  }
}

main().catch((err) => {
  console.error("fatal transfers watcher error:", err);
  process.exit(1);
});
