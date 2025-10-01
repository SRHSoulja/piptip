import "dotenv/config";
import { ethers, JsonRpcProvider } from "ethers";
import { PrismaClient } from "@prisma/client";
import { bigToDecDirect } from "../services/token.js";
import { getAbstractRpcUrl, getAbstractChainId } from "../services/network.js";
import { TOKEN_ADDR_LOWER } from "../config.js";
const prisma = new PrismaClient();
const RPC = getAbstractRpcUrl();
const TOKEN = TOKEN_ADDR_LOWER;
const TREASURY = process.env.TREASURY_AGW_ADDRESS.toLowerCase();
const DECIMALS = Number(process.env.TOKEN_DECIMALS || "18");
const CHAIN_ID = getAbstractChainId();
const provider = new JsonRpcProvider(RPC, { chainId: CHAIN_ID, name: "abstract" });
const iface = new ethers.Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)"
]);
const transferTopic = iface.getEvent("Transfer").topicHash;
async function credit(from, value, txHash) {
  const dedupeKey = `${txHash}:${from.toLowerCase()}:${value.toString()}`;
  try {
    await prisma.processedDeposit.create({ data: { key: dedupeKey } });
  } catch (e) {
    if (e?.code === "P2002") {
      console.log(`\u{1F504} duplicate deposit ignored: ${txHash}`);
      return;
    }
    throw e;
  }
  const user = await prisma.user.findFirst({ where: { agwAddress: from.toLowerCase() } });
  if (!user) {
    console.log(`\u{1F50E} deposit from unlinked wallet ${from} tx ${txHash}`);
    return;
  }
  const token = await prisma.token.findUnique({ where: { address: TOKEN } });
  if (!token) {
    console.error(`\u274C Token ${TOKEN} not found in database`);
    return;
  }
  const minDepositAtomic = BigInt(token.minDeposit.toString()) * 10n ** BigInt(token.decimals);
  if (value < minDepositAtomic) {
    console.log(`\u{1F50E} deposit below minimum ignored: ${ethers.formatUnits(value, DECIMALS)} < ${token.minDeposit}`);
    return;
  }
  await prisma.userBalance.upsert({
    where: { userId_tokenId: { userId: user.id, tokenId: token.id } },
    update: { amount: { increment: bigToDecDirect(value, token.decimals) } },
    create: { userId: user.id, tokenId: token.id, amount: bigToDecDirect(value, token.decimals) }
  });
  await prisma.transaction.create({
    data: {
      type: "DEPOSIT",
      userId: user.id,
      tokenId: token.id,
      amount: bigToDecDirect(value, token.decimals),
      fee: "0",
      txHash,
      metadata: `deposit from ${from}`
    }
  });
  console.log(
    `\u{1F4B0} credited ${ethers.formatUnits(value, DECIMALS)} ${token.symbol} to ${user.discordId} (from ${from}) tx ${txHash}`
  );
}
async function scanRange(fromBlock, toBlock) {
  const filter = {
    address: TOKEN,
    fromBlock,
    toBlock,
    topics: [
      transferTopic,
      null,
      ethers.zeroPadValue(TREASURY, 32)
      // indexed "to"
    ]
  };
  const logs = await provider.getLogs(filter);
  for (const log of logs) {
    try {
      const parsed = iface.parseLog(log);
      if (!parsed || !parsed.args) continue;
      const args = parsed.args;
      const from = args.from.toLowerCase();
      const to = args.to.toLowerCase();
      const value = args.value;
      if (to !== TREASURY) continue;
      await credit(from, value, log.transactionHash);
    } catch (e) {
      console.error("parse/credit error:", e);
    }
  }
}
async function main() {
  console.log("\u{1F50E} watching deposits to", TREASURY);
  let lastBlock = null;
  while (true) {
    try {
      const latest = await provider.getBlockNumber();
      if (lastBlock == null) {
        lastBlock = Math.max(0, latest - 5e3);
        console.log(`\u23F1  initial backfill from block ${lastBlock} \u2192 ${latest}`);
      }
      const CHUNK = 1e3;
      while (lastBlock <= latest) {
        const to = Math.min(lastBlock + CHUNK, latest);
        await scanRange(lastBlock, to);
        lastBlock = to + 1;
      }
      await new Promise((r) => setTimeout(r, 7e3));
    } catch (e) {
      console.error("watcher error:", e?.message ?? e);
      await new Promise((r) => setTimeout(r, 2e3));
    }
  }
}
main().catch((err) => {
  console.error("fatal watcher error:", err);
  process.exit(1);
});
//# sourceMappingURL=deposits.js.map
