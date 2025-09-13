import "dotenv/config";
import { ethers, JsonRpcProvider } from "ethers";
import { PrismaClient } from "@prisma/client";
import { bigToDecDirect } from "../services/token.js";
const prisma = new PrismaClient();
const RPC = process.env.ABSTRACT_RPC_URL;
const TOKEN = process.env.TOKEN_ADDRESS.toLowerCase();
const TREASURY = process.env.TREASURY_AGW_ADDRESS.toLowerCase();
const DECIMALS = Number(process.env.TOKEN_DECIMALS || "18");
const CHAIN_ID = Number(process.env.ABSTRACT_CHAIN_ID || "2741"); // Abstract mainnet
// Single JSON-RPC provider (Alchemy). Static network avoids auto-detect issues.
const provider = new JsonRpcProvider(RPC, { chainId: CHAIN_ID, name: "abstract" });
// Minimal ERC20 ABI and Transfer topic
const iface = new ethers.Interface([
    "event Transfer(address indexed from, address indexed to, uint256 value)"
]);
const transferTopic = iface.getEvent("Transfer").topicHash;
async function credit(from, value, txHash) {
    // SECURITY FIX: Add duplicate transaction protection
    const dedupeKey = `${txHash}:${from.toLowerCase()}:${value.toString()}`;
    try {
        await prisma.processedDeposit.create({ data: { key: dedupeKey } });
    }
    catch (e) {
        if (e?.code === "P2002") {
            console.log(`🔄 duplicate deposit ignored: ${txHash}`);
            return;
        }
        throw e;
    }
    const user = await prisma.user.findFirst({ where: { agwAddress: from.toLowerCase() } });
    if (!user) {
        console.log(`🔎 deposit from unlinked wallet ${from} tx ${txHash}`);
        return;
    }
    // SECURITY FIX: Get token info and check minimum deposit
    const token = await prisma.token.findUnique({ where: { address: TOKEN } });
    if (!token) {
        console.error(`❌ Token ${TOKEN} not found in database`);
        return;
    }
    const minDepositAtomic = BigInt(token.minDeposit.toString()) * (10n ** BigInt(token.decimals));
    if (value < minDepositAtomic) {
        console.log(`🔎 deposit below minimum ignored: ${ethers.formatUnits(value, DECIMALS)} < ${token.minDeposit}`);
        return;
    }
    // SECURITY FIX: Use new balance system instead of deprecated balanceAtomic
    await prisma.userBalance.upsert({
        where: { userId_tokenId: { userId: user.id, tokenId: token.id } },
        update: { amount: { increment: bigToDecDirect(value, token.decimals) } },
        create: { userId: user.id, tokenId: token.id, amount: bigToDecDirect(value, token.decimals) }
    });
    // SECURITY: Log transaction for audit trail
    await prisma.transaction.create({
        data: {
            type: "DEPOSIT",
            userId: user.id,
            tokenId: token.id,
            amount: bigToDecDirect(value, token.decimals),
            fee: "0",
            txHash: txHash,
            metadata: `deposit from ${from}`
        }
    });
    console.log(`💰 credited ${ethers.formatUnits(value, DECIMALS)} ${token.symbol} to ${user.discordId} (from ${from}) tx ${txHash}`);
}
async function scanRange(fromBlock, toBlock) {
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
            if (!parsed || !parsed.args)
                continue;
            // ethers v6 Result is array-like; access as "any" by named keys
            const args = parsed.args;
            const from = args.from.toLowerCase();
            const to = args.to.toLowerCase();
            const value = args.value;
            if (to !== TREASURY)
                continue;
            await credit(from, value, log.transactionHash);
        }
        catch (e) {
            console.error("parse/credit error:", e);
        }
    }
}
async function main() {
    console.log("🔎 watching deposits to", TREASURY);
    let lastBlock = null;
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
        }
        catch (e) {
            console.error("watcher error:", e?.message ?? e);
            await new Promise((r) => setTimeout(r, 2_000)); // brief backoff
        }
    }
}
main().catch((err) => {
    console.error("fatal watcher error:", err);
    process.exit(1);
});
