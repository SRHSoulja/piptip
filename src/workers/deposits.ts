import "dotenv/config";
import { ethers, JsonRpcProvider } from "ethers";
import { PrismaClient } from "@prisma/client";
import { bigToDec } from "../services/token.js";

const prisma = new PrismaClient();

const RPC        = process.env.ABSTRACT_RPC_URL!;
const TOKEN      = process.env.TOKEN_ADDRESS!.toLowerCase();
const TREASURY   = process.env.TREASURY_AGW_ADDRESS!.toLowerCase();
const DECIMALS   = Number(process.env.TOKEN_DECIMALS || "18");
const CHAIN_ID   = Number(process.env.ABSTRACT_CHAIN_ID || "2741"); // Abstract mainnet

// Single JSON-RPC provider (Alchemy). Static network avoids auto-detect issues.
const provider = new JsonRpcProvider(RPC, { chainId: CHAIN_ID, name: "abstract" });

// Minimal ERC20 ABI and Transfer topic
const iface = new ethers.Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)"
]);
const transferTopic = iface.getEvent("Transfer")!.topicHash;

async function credit(from: string, value: bigint, txHash: string) {
  const user = await prisma.user.findFirst({ where: { agwAddress: from } });
  if (!user) {
    console.log(`🔎 deposit from unlinked wallet ${from} tx ${txHash}`);
    return;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { balanceAtomic: { increment: bigToDec(value) } }
  });
  console.log(
    `💰 credited ${ethers.formatUnits(value, DECIMALS)} PENGU to ${user.discordId} (from ${from}) tx ${txHash}`
  );
}

async function scanRange(fromBlock: number, toBlock: number) {
  // Filter only transfers where indexed "to" == TREASURY
  const filter = {
    address: TOKEN,
    fromBlock,
    toBlock,
    topics: [
      transferTopic,
      null,
      ethers.zeroPadValue(TREASURY, 32), // indexed "to"
    ],
  };

  const logs = await provider.getLogs(filter);
  for (const log of logs) {
    try {
      const parsed = iface.parseLog(log);
      if (!parsed || !parsed.args) continue;

      // ethers v6 Result is array-like; access as "any" by named keys
      const args = parsed.args as any;
      const from  = (args.from as string).toLowerCase();
      const to    = (args.to as string).toLowerCase();
      const value = args.value as bigint;

      if (to !== TREASURY) continue;
      await credit(from, value, log.transactionHash);
    } catch (e) {
      console.error("parse/credit error:", e);
    }
  }
}

async function main() {
  console.log("🔎 watching deposits to", TREASURY);
  let lastBlock: number | null = null;

  while (true) {
    try {
      const latest = await provider.getBlockNumber();

      if (lastBlock == null) {
        lastBlock = Math.max(0, latest - 5_000);
        console.log(`⏱  initial backfill from block ${lastBlock} → ${latest}`);
      }

      const CHUNK = 1_000;
      while (lastBlock <= latest) {
        const to = Math.min(lastBlock + CHUNK, latest);
        await scanRange(lastBlock, to);
        lastBlock = to + 1;
      }

      await new Promise((r) => setTimeout(r, 7_000)); // idle poll
    } catch (e: any) {
      console.error("watcher error:", e?.message ?? e);
      await new Promise((r) => setTimeout(r, 2_000)); // brief backoff
    }
  }
}

main().catch((err) => {
  console.error("fatal watcher error:", err);
  process.exit(1);
});
