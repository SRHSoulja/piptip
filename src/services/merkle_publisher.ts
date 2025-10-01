// src/services/merkle_publisher.ts
// Merkle tree snapshot publisher with testnet/mainnet network support

import { JsonRpcProvider, Wallet, Contract, solidityPackedKeccak256 } from "ethers";
import { getAbstractRpcUrl, getAbstractChainId, getNetworkType, getNetworkDisplayName, isMainnet, isTestnet } from "./network.js";
import { prisma } from "./db.js";
import { toAtomicDirect } from "./token.js";

// Registry contract addresses for each network
const REGISTRY_CONTRACTS = {
  mainnet: process.env.MAINNET_REGISTRY_CONTRACT_ADDRESS,
  testnet: process.env.TESTNET_REGISTRY_CONTRACT_ADDRESS
} as const;

// Registry contract ABI
const REGISTRY_ABI = [
  "function publishSnapshot(bytes32 merkleRoot, string calldata ipfsHash, uint256 timestamp) external",
  "function getLatestSnapshot() external view returns (bytes32 merkleRoot, string memory ipfsHash, uint256 timestamp)",
  "function isValidSnapshot(bytes32 merkleRoot) external view returns (bool)",
  "event SnapshotPublished(bytes32 indexed merkleRoot, string ipfsHash, uint256 timestamp, address publisher)"
];

export interface MerkleSnapshot {
  merkleRoot: string;
  ipfsHash: string;
  timestamp: number;
  totalUsers: number;
  totalBalance: string;
  network: 'mainnet' | 'testnet';
}

export interface MerkleLeaf {
  address: string;
  amount: string;
  proof: string[];
}

export interface PublishResult {
  success: boolean;
  txHash?: string;
  error?: string;
  network: 'mainnet' | 'testnet';
  chainId: number;
  registryContract: string;
  snapshot?: MerkleSnapshot;
}

class MerklePublisher {
  private provider: JsonRpcProvider;
  private chainId: number;
  private network: 'mainnet' | 'testnet';
  private registryAddress: string;

  constructor() {
    this.network = getNetworkType();
    this.provider = new JsonRpcProvider(getAbstractRpcUrl());
    this.chainId = getAbstractChainId();

    const registryAddr = REGISTRY_CONTRACTS[this.network];
    if (!registryAddr) {
      throw new Error(`Missing registry contract address for ${this.network}. Set ${this.network.toUpperCase()}_REGISTRY_CONTRACT_ADDRESS environment variable.`);
    }
    this.registryAddress = registryAddr;

    this.logNetworkInfo();
  }

  private logNetworkInfo(): void {
    console.log(`🌐 MerklePublisher configured: ${getNetworkDisplayName()}`);
    console.log(`📡 RPC URL: ${getAbstractRpcUrl().replace(/\/[^\/]+$/, '/***')}`);
    console.log(`📋 Registry Contract: ${this.registryAddress}`);

    if (isTestnet()) {
      console.log(`🧪 TESTNET MODE: Safe for testing snapshot publishing`);
    } else if (isMainnet()) {
      console.log(`🚀 MAINNET MODE: Publishing real snapshots to production`);
    }
  }

  /**
   * Generate merkle tree from user balances or transaction log
   */
  async generateMerkleTree(cutoff?: Date): Promise<{
    merkleRoot: string;
    leaves: MerkleLeaf[];
    totalUsers: number;
    totalBalance: string;
  }> {
    console.log(`📊 Generating merkle tree for ${this.network}...`);

    // Check if we should use transaction log aggregation
    const useTransactionLog = process.env.MERKLE_FROM_TXLOG === 'true';

    if (useTransactionLog && cutoff) {
      console.log(`🔄 Using transaction log aggregation up to ${cutoff.toISOString()}`);
      return this.buildMerkleFromTransactionLog(cutoff);
    } else {
      console.log(`📊 Using UserBalance table (legacy mode)`);
      return this.buildMerkleFromUserBalance();
    }
  }

  /**
   * Build merkle tree from transaction log aggregation
   */
  private async buildMerkleFromTransactionLog(cutoff: Date): Promise<{
    merkleRoot: string;
    leaves: MerkleLeaf[];
    totalUsers: number;
    totalBalance: string;
  }> {
    // Aggregate balance deltas per user per token up to cutoff
    const aggregateQuery = `
      SELECT
        u."agwAddress" as agw_address,
        bd."tokenId" as token_id,
        t.decimals,
        SUM(CAST(bd."amountDelta" AS DECIMAL)) as total_delta
      FROM "BalanceDelta" bd
      JOIN "Transaction" tx ON bd."transactionId" = tx.id
      JOIN "User" u ON bd."userId" = u.id
      JOIN "Token" t ON bd."tokenId" = t.id
      WHERE tx."createdAt" <= $1
        AND tx.status = 'CONFIRMED'
        AND u."agwAddress" IS NOT NULL
        AND bd."userId" IS NOT NULL
      GROUP BY u."agwAddress", bd."tokenId", t.decimals
      HAVING SUM(CAST(bd."amountDelta" AS DECIMAL)) > 0
    `;

    const balanceDeltas = await prisma.$queryRawUnsafe(aggregateQuery, cutoff) as Array<{
      agw_address: string;
      token_id: number;
      decimals: number;
      total_delta: string;
    }>;

    console.log(`📈 Found ${balanceDeltas.length} balance delta aggregations`);

    // Compare with UserBalance to detect drift
    const userBalanceMap = new Map<string, bigint>();
    const txLogBalanceMap = new Map<string, bigint>();

    // Get current UserBalance for comparison
    const userBalances = await prisma.userBalance.findMany({
      where: { amount: { gt: 0 } },
      include: {
        User: { select: { agwAddress: true } },
        Token: { select: { decimals: true } }
      }
    });

    for (const balance of userBalances) {
      if (!balance.User.agwAddress) continue;
      const key = `${balance.User.agwAddress.toLowerCase()}_${balance.tokenId}`;
      const atomic = toAtomicDirect(Number(balance.amount), balance.Token.decimals);
      userBalanceMap.set(key, atomic);
    }

    // Build tx-log derived balances
    for (const delta of balanceDeltas) {
      const key = `${delta.agw_address.toLowerCase()}_${delta.token_id}`;
      const atomic = toAtomicDirect(delta.total_delta, delta.decimals);
      txLogBalanceMap.set(key, atomic);
    }

    // Check for drift between UserBalance and transaction log
    const epsilon = 1000n; // 1000 wei tolerance for rounding errors
    const drifts: string[] = [];

    for (const [key, txLogBalance] of txLogBalanceMap) {
      const userBalance = userBalanceMap.get(key) || 0n;
      const diff = txLogBalance > userBalance ? txLogBalance - userBalance : userBalance - txLogBalance;

      if (diff > epsilon) {
        drifts.push(`${key}: UserBalance=${userBalance}, TxLog=${txLogBalance}, Diff=${diff}`);
      }
    }

    if (drifts.length > 0) {
      console.error(`❌ Balance drift detected between UserBalance and transaction log:`);
      drifts.forEach(drift => console.error(`   ${drift}`));
      throw new Error(`Balance drift detected. Found ${drifts.length} mismatches exceeding ${epsilon} wei tolerance.`);
    }

    console.log(`✅ Transaction log balances match UserBalance (checked ${txLogBalanceMap.size} entries)`);

    // Aggregate balances by user address across all tokens
    const userTotalMap = new Map<string, bigint>();
    for (const delta of balanceDeltas) {
      const userAddr = delta.agw_address.toLowerCase();
      const atomic = toAtomicDirect(delta.total_delta, delta.decimals);
      userTotalMap.set(userAddr, (userTotalMap.get(userAddr) || 0n) + atomic);
    }

    return this.buildMerkleTreeFromBalanceMap(userTotalMap, 'transaction log');
  }

  /**
   * Build merkle tree from UserBalance table (legacy)
   */
  private async buildMerkleFromUserBalance(): Promise<{
    merkleRoot: string;
    leaves: MerkleLeaf[];
    totalUsers: number;
    totalBalance: string;
  }> {
    // Get all user balances across all tokens
    const userBalances = await prisma.userBalance.findMany({
      where: {
        amount: { gt: 0 }
      },
      include: {
        User: {
          select: { agwAddress: true }
        },
        Token: {
          select: { address: true, decimals: true }
        }
      }
    });

    if (userBalances.length === 0) {
      throw new Error('No user balances found for merkle tree generation');
    }

    // Aggregate balances by user address
    const balanceMap = new Map<string, bigint>();
    for (const balance of userBalances) {
      if (!balance.User.agwAddress) continue;

      const userAddr = balance.User.agwAddress.toLowerCase();
      const amountAtomic = toAtomicDirect(Number(balance.amount), balance.Token.decimals);

      balanceMap.set(userAddr, (balanceMap.get(userAddr) || 0n) + amountAtomic);
    }

    return this.buildMerkleTreeFromBalanceMap(balanceMap, 'UserBalance table');
  }

  /**
   * Common merkle tree building logic
   */
  private buildMerkleTreeFromBalanceMap(
    balanceMap: Map<string, bigint>,
    source: string
  ): {
    merkleRoot: string;
    leaves: MerkleLeaf[];
    totalUsers: number;
    totalBalance: string;
  } {
    // Generate leaves
    const leaves: MerkleLeaf[] = [];
    let totalBalance = 0n;

    for (const [address, amount] of balanceMap) {
      const leaf = solidityPackedKeccak256(
        ['address', 'uint256'],
        [address, amount]
      );

      leaves.push({
        address,
        amount: amount.toString(),
        proof: [] // Will be filled when tree is built
      });

      totalBalance += amount;
    }

    // Sort leaves for consistent tree building
    leaves.sort((a, b) => a.address.localeCompare(b.address));

    // Build merkle tree (simplified - in production use a proper merkle tree library)
    const merkleRoot = this.buildMerkleRoot(leaves.map(l =>
      solidityPackedKeccak256(['address', 'uint256'], [l.address, l.amount])
    ));

    console.log(`✅ Generated merkle tree from ${source}: ${leaves.length} users, total: ${totalBalance.toString()}`);
    console.log(`🌳 Merkle root: ${merkleRoot}`);

    return {
      merkleRoot,
      leaves,
      totalUsers: leaves.length,
      totalBalance: totalBalance.toString()
    };
  }

  /**
   * Simplified merkle root calculation
   * Note: In production, use a proper merkle tree library like merkletreejs
   */
  private buildMerkleRoot(leaves: string[]): string {
    if (leaves.length === 0) return '0x' + '0'.repeat(64);
    if (leaves.length === 1) return leaves[0];

    const nextLevel: string[] = [];
    for (let i = 0; i < leaves.length; i += 2) {
      const left = leaves[i];
      const right = i + 1 < leaves.length ? leaves[i + 1] : left;
      const combined = solidityPackedKeccak256(['bytes32', 'bytes32'], [left, right]);
      nextLevel.push(combined);
    }

    return this.buildMerkleRoot(nextLevel);
  }

  /**
   * Publish snapshot to IPFS (placeholder)
   */
  private async publishToIPFS(snapshot: any): Promise<string> {
    // TODO: Implement actual IPFS publishing
    // For now, return a placeholder hash
    const placeholder = `Qm${Math.random().toString(36).substring(2).padEnd(44, '0')}`;
    console.log(`📤 IPFS placeholder: ${placeholder}`);
    console.log(`📄 Snapshot data: ${JSON.stringify(snapshot, null, 2)}`);
    return placeholder;
  }

  /**
   * Publish snapshot to registry contract
   */
  async publishSnapshot(privateKey: string, cutoff?: Date): Promise<PublishResult> {
    try {
      console.log(`\n🚀 Starting snapshot publishing on ${this.network}...`);

      // Use current time as cutoff if not provided
      const snapshotCutoff = cutoff || new Date();
      console.log(`📅 Snapshot cutoff: ${snapshotCutoff.toISOString()}`);

      // Generate merkle tree
      const treeData = await this.generateMerkleTree(snapshotCutoff);

      // Create snapshot metadata
      const snapshot: MerkleSnapshot = {
        merkleRoot: treeData.merkleRoot,
        ipfsHash: '', // Will be set after IPFS upload
        timestamp: Math.floor(snapshotCutoff.getTime() / 1000),
        totalUsers: treeData.totalUsers,
        totalBalance: treeData.totalBalance,
        network: this.network
      };

      // Upload to IPFS
      snapshot.ipfsHash = await this.publishToIPFS({
        ...snapshot,
        leaves: treeData.leaves
      });

      // Setup blockchain transaction
      const wallet = new Wallet(privateKey, this.provider);
      const contract = new Contract(this.registryAddress, REGISTRY_ABI, wallet);

      console.log(`📝 Publishing snapshot to registry contract...`);
      console.log(`   Merkle Root: ${snapshot.merkleRoot}`);
      console.log(`   IPFS Hash: ${snapshot.ipfsHash}`);
      console.log(`   Timestamp: ${snapshot.timestamp}`);
      console.log(`   Network: ${this.network}`);
      console.log(`   Registry: ${this.registryAddress}`);

      // Publish to contract
      const tx = await contract.publishSnapshot(
        snapshot.merkleRoot,
        snapshot.ipfsHash,
        snapshot.timestamp
      );

      console.log(`⏳ Transaction submitted: ${tx.hash}`);
      console.log(`   Waiting for confirmation on ${getNetworkDisplayName()}...`);

      const receipt = await tx.wait();

      if (receipt.status === 1) {
        console.log(`✅ Snapshot published successfully!`);
        console.log(`   TX Hash: ${tx.hash}`);
        console.log(`   Block: ${receipt.blockNumber}`);
        console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);

        // Store in database and log transaction
        await this.storeSnapshot(snapshot, tx.hash, receipt.gasUsed);

        return {
          success: true,
          txHash: tx.hash,
          network: this.network,
          chainId: this.chainId,
          registryContract: this.registryAddress,
          snapshot
        };
      } else {
        throw new Error(`Transaction failed with status: ${receipt.status}`);
      }

    } catch (error) {
      console.error(`❌ Snapshot publishing failed:`, error);
      return {
        success: false,
        error: (error as Error).message,
        network: this.network,
        chainId: this.chainId,
        registryContract: this.registryAddress
      };
    }
  }

  /**
   * Store snapshot metadata in database and log transaction
   */
  private async storeSnapshot(snapshot: MerkleSnapshot, txHash: string, gasUsed: bigint): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // Store snapshot metadata
      await tx.merkleSnapshot.create({
        data: {
          merkleRoot: snapshot.merkleRoot,
          ipfsHash: snapshot.ipfsHash,
          timestamp: new Date(snapshot.timestamp * 1000),
          totalUsers: snapshot.totalUsers,
          totalBalance: snapshot.totalBalance,
          network: snapshot.network,
          txHash,
          chainId: this.chainId,
          registryContract: this.registryAddress
        }
      });

      // Log snapshot publish transaction
      const { logSnapshotPublish } = await import('./tx_logger.js');
      const idempotencyKey = `snapshot_${snapshot.merkleRoot}_${txHash}`;

      await logSnapshotPublish(tx, {
        merkleRoot: snapshot.merkleRoot,
        ipfsHash: snapshot.ipfsHash,
        gasUsed,
        txHash,
        idempotencyKey
      });
    });

    console.log(`💾 Snapshot metadata stored and transaction logged`);
  }

  /**
   * Verify snapshot exists on chain
   */
  async verifySnapshot(merkleRoot: string): Promise<boolean> {
    try {
      const contract = new Contract(this.registryAddress, REGISTRY_ABI, this.provider);
      const isValid = await contract.isValidSnapshot(merkleRoot);

      console.log(`🔍 Snapshot verification for ${merkleRoot.slice(0, 10)}...: ${isValid ? '✅ VALID' : '❌ INVALID'}`);
      return isValid;
    } catch (error) {
      console.error(`❌ Snapshot verification failed:`, error);
      return false;
    }
  }

  /**
   * Get latest snapshot from registry contract
   */
  async getLatestSnapshot(): Promise<{
    merkleRoot: string;
    ipfsHash: string;
    timestamp: number;
  } | null> {
    try {
      const contract = new Contract(this.registryAddress, REGISTRY_ABI, this.provider);
      const [merkleRoot, ipfsHash, timestamp] = await contract.getLatestSnapshot();

      if (merkleRoot === '0x' + '0'.repeat(64)) {
        return null; // No snapshots published yet
      }

      return {
        merkleRoot,
        ipfsHash,
        timestamp: Number(timestamp)
      };
    } catch (error) {
      console.error(`❌ Failed to get latest snapshot:`, error);
      return null;
    }
  }

  /**
   * Get network information
   */
  getNetworkInfo() {
    return {
      network: this.network,
      chainId: this.chainId,
      rpcUrl: getAbstractRpcUrl(),
      registryContract: this.registryAddress,
      displayName: getNetworkDisplayName()
    };
  }
}

// Export singleton instance
export const merklePublisher = new MerklePublisher();
export type { MerkleSnapshot, MerkleLeaf, PublishResult };