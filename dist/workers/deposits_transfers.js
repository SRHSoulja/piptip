import "dotenv/config";
import { JsonRpcProvider } from "ethers";
import { PrismaClient } from "@prisma/client";
import { bigToDecDirect } from "../services/token.js";
import { getAbstractRpcUrl } from "../services/network.js";
import { TOKEN_ADDR_LOWER } from "../config.js";
const prisma = new PrismaClient();
const RPC = getAbstractRpcUrl();
const TOKEN = TOKEN_ADDR_LOWER;
const TREASURY = process.env.TREASURY_AGW_ADDRESS.toLowerCase();
const DECIMALS = Number(process.env.TOKEN_DECIMALS || "18");
const provider = new JsonRpcProvider(RPC);
const CURSOR_NAME = "treasury";
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
  console.log(`\u23F1  starting backfill from block ${start} \u2192 latest`);
  return hex;
}
async function saveCursor(blockHex) {
  await prisma.depositCursor.upsert({
    where: { name: CURSOR_NAME },
    update: { blockHex },
    create: { name: CURSOR_NAME, blockHex }
  });
}
async function credit(fromAddr, valueAtomic, txHash) {
  const key = `${txHash}:${fromAddr.toLowerCase()}:${valueAtomic.toString()}`;
  try {
    await prisma.processedDeposit.create({ data: { key } });
  } catch (e) {
    if (e?.code === "P2002") {
      return;
    }
    throw e;
  }
  const user = await prisma.user.findFirst({
    where: { agwAddress: fromAddr.toLowerCase() }
  });
  if (!user) {
    console.log(`\u{1F50E} deposit from unlinked wallet ${fromAddr} tx ${txHash}`);
    return;
  }
  const token = await prisma.token.findUnique({ where: { address: TOKEN } });
  if (!token) {
    console.error(`\u274C Token ${TOKEN} not found in database`);
    return;
  }
  const minDepositAtomic = BigInt(token.minDeposit.toString()) * 10n ** BigInt(token.decimals);
  if (valueAtomic < minDepositAtomic) {
    console.log(`\u{1F50E} deposit below minimum ignored: ${Number(valueAtomic) / 10 ** DECIMALS} < ${token.minDeposit}`);
    return;
  }
  await prisma.userBalance.upsert({
    where: { userId_tokenId: { userId: user.id, tokenId: token.id } },
    update: { amount: { increment: bigToDecDirect(valueAtomic, token.decimals) } },
    create: { userId: user.id, tokenId: token.id, amount: bigToDecDirect(valueAtomic, token.decimals) }
  });
  await prisma.transaction.create({
    data: {
      type: "DEPOSIT",
      userId: user.id,
      tokenId: token.id,
      amount: bigToDecDirect(valueAtomic, token.decimals),
      fee: "0",
      txHash,
      metadata: `deposit from ${fromAddr}`
    }
  });
  const whole = Number(valueAtomic) / 10 ** token.decimals;
  console.log(`\u{1F4B0} credited ${whole} ${token.symbol} to ${user.discordId} (from ${fromAddr}) tx ${txHash}`);
}
let fromBlockHex;
async function pollOnce() {
  if (!fromBlockHex) {
    fromBlockHex = await getCursor();
    await saveCursor(fromBlockHex);
  }
  const paramsBase = {
    fromBlock: fromBlockHex,
    toBlock: "latest",
    toAddress: TREASURY,
    category: ["erc20"],
    contractAddresses: [TOKEN],
    withMetadata: false,
    excludeZeroValue: true,
    order: "asc",
    maxCount: "0x3e8"
    // 1000 per page
  };
  let pageKey;
  let lastBlockSeen = fromBlockHex;
  do {
    const params = { ...paramsBase, pageKey };
    const resp = await provider.send("alchemy_getAssetTransfers", [params]);
    const transfers = resp?.transfers || [];
    for (const t of transfers) {
      const toAddr = (t.to || "").toLowerCase();
      const fromAddr = (t.from || "").toLowerCase();
      const token = (t.contract?.address || t.rawContract?.address || "").toLowerCase();
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
  fromBlockHex = lastBlockSeen || fromBlockHex;
  await saveCursor(fromBlockHex);
}
async function main() {
  console.log("\u{1F50E} watching deposits via Transfers API to", TREASURY);
  fromBlockHex = await getCursor();
  while (true) {
    try {
      await pollOnce();
    } catch (e) {
      console.error("transfers poll error:", e?.message ?? e);
    }
    await new Promise((r) => setTimeout(r, 7e3));
  }
}
main().catch((err) => {
  console.error("fatal transfers watcher error:", err);
  process.exit(1);
});
//# sourceMappingURL=deposits_transfers.js.map
