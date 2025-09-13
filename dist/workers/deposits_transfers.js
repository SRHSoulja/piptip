import "dotenv/config";
import { JsonRpcProvider } from "ethers";
import { PrismaClient } from "@prisma/client";
import { bigToDecDirect } from "../services/token.js";
const prisma = new PrismaClient();
const RPC = process.env.ABSTRACT_RPC_URL;
const TOKEN = process.env.TOKEN_ADDRESS.toLowerCase();
const TREASURY = process.env.TREASURY_AGW_ADDRESS.toLowerCase();
const DECIMALS = Number(process.env.TOKEN_DECIMALS || "18");
// Alchemy JSON-RPC (no need to pass chain id for Transfers API)
const provider = new JsonRpcProvider(RPC);
// Persistent cursor name
const CURSOR_NAME = "treasury";
// Helper: hex to bigint (Alchemy returns rawContract.value as hex)
function hexToBigint(hex) {
    if (!hex)
        return 0n;
    return BigInt(hex);
}
// Load cursor or seed to latest-5000
async function getCursor() {
    const c = await prisma.depositCursor.findUnique({ where: { name: CURSOR_NAME } });
    if (c)
        return c.blockHex;
    const latest = await provider.getBlockNumber();
    const start = Math.max(0, latest - 5000);
    const hex = "0x" + start.toString(16);
    await prisma.depositCursor.create({ data: { name: CURSOR_NAME, blockHex: hex } });
    console.log(`⏱  starting backfill from block ${start} → latest`);
    return hex;
}
async function saveCursor(blockHex) {
    await prisma.depositCursor.upsert({
        where: { name: CURSOR_NAME },
        update: { blockHex },
        create: { name: CURSOR_NAME, blockHex },
    });
}
async function credit(fromAddr, valueAtomic, txHash) {
    // De-dupe key: txHash + from + value
    const key = `${txHash}:${fromAddr.toLowerCase()}:${valueAtomic.toString()}`;
    try {
        await prisma.processedDeposit.create({ data: { key } });
    }
    catch (e) {
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
    // Get token details for validation and multi-token support
    const token = await prisma.token.findUnique({ where: { address: TOKEN } });
    if (!token) {
        console.error(`❌ Token ${TOKEN} not found in database`);
        return;
    }
    // Check minimum deposit
    const minDepositAtomic = BigInt(token.minDeposit.toString()) * (10n ** BigInt(token.decimals));
    if (valueAtomic < minDepositAtomic) {
        console.log(`🔎 deposit below minimum ignored: ${Number(valueAtomic) / 10 ** DECIMALS} < ${token.minDeposit}`);
        return;
    }
    // Use new secure balance system
    await prisma.userBalance.upsert({
        where: { userId_tokenId: { userId: user.id, tokenId: token.id } },
        update: { amount: { increment: bigToDecDirect(valueAtomic, token.decimals) } },
        create: { userId: user.id, tokenId: token.id, amount: bigToDecDirect(valueAtomic, token.decimals) }
    });
    // Add audit trail
    await prisma.transaction.create({
        data: {
            type: "DEPOSIT",
            userId: user.id,
            tokenId: token.id,
            amount: bigToDecDirect(valueAtomic, token.decimals),
            fee: "0",
            txHash: txHash,
            metadata: `deposit from ${fromAddr}`
        }
    });
    const whole = Number(valueAtomic) / 10 ** token.decimals;
    console.log(`💰 credited ${whole} ${token.symbol} to ${user.discordId} (from ${fromAddr}) tx ${txHash}`);
}
let fromBlockHex; // persisted cursor
async function pollOnce() {
    // Ensure we have a cursor
    if (!fromBlockHex) {
        fromBlockHex = await getCursor();
        // ensure saved
        await saveCursor(fromBlockHex);
    }
    // Pull ALL ERC20 transfers TO treasury, filtered to our token, ascending order.
    // Will auto-page via pageKey.
    const paramsBase = {
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
    let pageKey;
    let lastBlockSeen = fromBlockHex;
    do {
        const params = { ...paramsBase, pageKey };
        const resp = await provider.send("alchemy_getAssetTransfers", [params]);
        const transfers = (resp?.transfers || []);
        for (const t of transfers) {
            const toAddr = (t.to || "").toLowerCase();
            const fromAddr = (t.from || "").toLowerCase();
            const token = (t.contract?.address || t.rawContract?.address || "").toLowerCase();
            if (t.category !== "erc20")
                continue;
            if (toAddr !== TREASURY)
                continue;
            if (token !== TOKEN)
                continue;
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
        }
        catch (e) {
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
