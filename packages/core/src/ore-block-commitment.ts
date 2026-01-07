// Battle Dinghy - ORE Block Commitment
//
// Security mitigation C2: Prevents operator from selectively choosing ORE blocks.
//
// Protocol:
// 1. Before game starts, operator commits to a future ORE block height
// 2. Commitment includes: target_block_height, commitment_timestamp, game_id
// 3. After block is mined, anyone can verify the commitment was made before mining
// 4. The committed block's hash is used in the final seed computation
//
// This ensures operator cannot mine multiple blocks and choose the most favorable one.

import { createHash } from 'crypto';

// =============================================================================
// Types
// =============================================================================

export interface OreBlockCommitment {
  /** Game ID this commitment is for */
  gameId: string;
  /** The ORE block height we're committing to use */
  targetBlockHeight: number;
  /** When this commitment was made (Unix timestamp ms) */
  committedAt: number;
  /** Hash of the commitment for verification */
  commitmentHash: string;
  /** Operator's signature (wallet address for now, real sig in production) */
  operatorWallet: string;
}

export interface OreBlockVerification {
  /** The commitment being verified */
  commitment: OreBlockCommitment;
  /** The actual ORE block hash at the committed height */
  actualBlockHash: string;
  /** When the block was mined (Unix timestamp ms) */
  blockMinedAt: number;
  /** Whether verification passed */
  verified: boolean;
  /** Verification failure reason if any */
  failureReason?: OreVerificationFailure;
}

export type OreVerificationFailure =
  | 'COMMITMENT_AFTER_BLOCK' // Commitment was made after block was mined
  | 'BLOCK_HEIGHT_MISMATCH'  // Block height doesn't match commitment
  | 'INVALID_COMMITMENT_HASH' // Commitment hash verification failed
  | 'BLOCK_NOT_FOUND'        // Block at committed height doesn't exist yet
  | 'COMMITMENT_EXPIRED';    // Too much time passed since commitment

export interface OreBlockCommitmentConfig {
  /** Minimum blocks in the future for commitment (prevents last-second commits) */
  minBlocksAhead: number;
  /** Maximum time to wait for committed block (ms) */
  maxWaitTimeMs: number;
  /** Buffer time before block mining to require commitment (ms) */
  commitmentBufferMs: number;
}

export interface CreateCommitmentResult {
  success: boolean;
  commitment?: OreBlockCommitment;
  error?: string;
}

export interface VerifyCommitmentResult {
  success: boolean;
  verification?: OreBlockVerification;
  error?: string;
}

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_ORE_COMMITMENT_CONFIG: OreBlockCommitmentConfig = {
  minBlocksAhead: 3,           // Must commit at least 3 blocks ahead
  maxWaitTimeMs: 600_000,      // 10 minutes max wait for block
  commitmentBufferMs: 30_000,  // Commitment must be 30s before block mining
};

// Average ORE block time (approximate, used for estimations)
const ESTIMATED_ORE_BLOCK_TIME_MS = 60_000; // ~1 minute per block

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a commitment hash for verification.
 * hash = SHA256(gameId || targetBlockHeight || committedAt || operatorWallet)
 */
export function createCommitmentHash(
  gameId: string,
  targetBlockHeight: number,
  committedAt: number,
  operatorWallet: string
): string {
  const hash = createHash('sha256');
  hash.update(gameId);
  hash.update(targetBlockHeight.toString());
  hash.update(committedAt.toString());
  hash.update(operatorWallet);
  return hash.digest('hex');
}

/**
 * Verify a commitment hash matches its components.
 */
export function verifyCommitmentHash(commitment: OreBlockCommitment): boolean {
  const computed = createCommitmentHash(
    commitment.gameId,
    commitment.targetBlockHeight,
    commitment.committedAt,
    commitment.operatorWallet
  );
  return computed === commitment.commitmentHash;
}

/**
 * Estimate when a future block will be mined.
 */
export function estimateBlockMiningTime(
  currentBlockHeight: number,
  targetBlockHeight: number,
  currentTime: number = Date.now()
): number {
  const blocksAhead = targetBlockHeight - currentBlockHeight;
  if (blocksAhead <= 0) {
    return currentTime; // Block already mined
  }
  return currentTime + blocksAhead * ESTIMATED_ORE_BLOCK_TIME_MS;
}

// =============================================================================
// OreBlockCommitmentManager Class
// =============================================================================

export class OreBlockCommitmentManager {
  private config: OreBlockCommitmentConfig;
  private commitments: Map<string, OreBlockCommitment> = new Map();
  private verifications: Map<string, OreBlockVerification> = new Map();

  // Callback to get current ORE block height (injected dependency)
  private getCurrentBlockHeight: () => Promise<number>;
  // Callback to get ORE block hash by height (injected dependency)
  private getBlockHash: (height: number) => Promise<string | null>;
  // Callback to get block mining timestamp (injected dependency)
  private getBlockTimestamp: (height: number) => Promise<number | null>;

  constructor(
    config: Partial<OreBlockCommitmentConfig> = {},
    callbacks: {
      getCurrentBlockHeight: () => Promise<number>;
      getBlockHash: (height: number) => Promise<string | null>;
      getBlockTimestamp?: (height: number) => Promise<number | null>;
    }
  ) {
    this.config = { ...DEFAULT_ORE_COMMITMENT_CONFIG, ...config };
    this.getCurrentBlockHeight = callbacks.getCurrentBlockHeight;
    this.getBlockHash = callbacks.getBlockHash;
    this.getBlockTimestamp = callbacks.getBlockTimestamp ?? (async () => Date.now());
  }

  // ===========================================================================
  // Commitment Creation
  // ===========================================================================

  /**
   * Create a commitment to a future ORE block.
   */
  async createCommitment(
    gameId: string,
    operatorWallet: string,
    targetBlockHeight?: number
  ): Promise<CreateCommitmentResult> {
    // Check if commitment already exists for this game
    if (this.commitments.has(gameId)) {
      return {
        success: false,
        error: 'Commitment already exists for this game',
      };
    }

    const currentHeight = await this.getCurrentBlockHeight();
    const now = Date.now();

    // If no target specified, use minimum blocks ahead
    const target = targetBlockHeight ?? currentHeight + this.config.minBlocksAhead;

    // Validate target is far enough in the future
    if (target < currentHeight + this.config.minBlocksAhead) {
      return {
        success: false,
        error: `Target block must be at least ${this.config.minBlocksAhead} blocks ahead (current: ${currentHeight}, target: ${target})`,
      };
    }

    // Create the commitment
    const commitmentHash = createCommitmentHash(gameId, target, now, operatorWallet);

    const commitment: OreBlockCommitment = {
      gameId,
      targetBlockHeight: target,
      committedAt: now,
      commitmentHash,
      operatorWallet,
    };

    this.commitments.set(gameId, commitment);

    return {
      success: true,
      commitment,
    };
  }

  /**
   * Get an existing commitment for a game.
   */
  getCommitment(gameId: string): OreBlockCommitment | null {
    return this.commitments.get(gameId) ?? null;
  }

  /**
   * Check if commitment exists and is still waiting for block.
   */
  isWaitingForBlock(gameId: string): boolean {
    const commitment = this.commitments.get(gameId);
    if (!commitment) return false;

    // Check if already verified
    if (this.verifications.has(gameId)) return false;

    return true;
  }

  // ===========================================================================
  // Block Verification
  // ===========================================================================

  /**
   * Verify a commitment against the actual mined block.
   */
  async verifyCommitment(gameId: string): Promise<VerifyCommitmentResult> {
    const commitment = this.commitments.get(gameId);

    if (!commitment) {
      return {
        success: false,
        error: 'No commitment found for this game',
      };
    }

    // Check if already verified
    const existing = this.verifications.get(gameId);
    if (existing) {
      return {
        success: existing.verified,
        verification: existing,
      };
    }

    // Verify commitment hash integrity
    if (!verifyCommitmentHash(commitment)) {
      const verification: OreBlockVerification = {
        commitment,
        actualBlockHash: '',
        blockMinedAt: 0,
        verified: false,
        failureReason: 'INVALID_COMMITMENT_HASH',
      };
      this.verifications.set(gameId, verification);
      return { success: false, verification };
    }

    // Get the block at committed height
    const blockHash = await this.getBlockHash(commitment.targetBlockHeight);

    if (!blockHash) {
      return {
        success: false,
        error: 'Block not yet mined at committed height',
      };
    }

    // Get block mining timestamp
    const blockMinedAt = await this.getBlockTimestamp(commitment.targetBlockHeight);

    if (!blockMinedAt) {
      return {
        success: false,
        error: 'Could not retrieve block timestamp',
      };
    }

    // Verify commitment was made before block was mined (with buffer)
    const commitmentDeadline = blockMinedAt - this.config.commitmentBufferMs;

    if (commitment.committedAt > commitmentDeadline) {
      const verification: OreBlockVerification = {
        commitment,
        actualBlockHash: blockHash,
        blockMinedAt,
        verified: false,
        failureReason: 'COMMITMENT_AFTER_BLOCK',
      };
      this.verifications.set(gameId, verification);
      return { success: false, verification };
    }

    // Check commitment hasn't expired
    const timeSinceCommitment = Date.now() - commitment.committedAt;
    if (timeSinceCommitment > this.config.maxWaitTimeMs) {
      const verification: OreBlockVerification = {
        commitment,
        actualBlockHash: blockHash,
        blockMinedAt,
        verified: false,
        failureReason: 'COMMITMENT_EXPIRED',
      };
      this.verifications.set(gameId, verification);
      return { success: false, verification };
    }

    // All checks passed
    const verification: OreBlockVerification = {
      commitment,
      actualBlockHash: blockHash,
      blockMinedAt,
      verified: true,
    };
    this.verifications.set(gameId, verification);

    return {
      success: true,
      verification,
    };
  }

  /**
   * Get the verified block hash for a game (only after successful verification).
   */
  getVerifiedBlockHash(gameId: string): string | null {
    const verification = this.verifications.get(gameId);
    if (!verification || !verification.verified) {
      return null;
    }
    return verification.actualBlockHash;
  }

  /**
   * Get verification result for a game.
   */
  getVerification(gameId: string): OreBlockVerification | null {
    return this.verifications.get(gameId) ?? null;
  }

  // ===========================================================================
  // Waiting for Block
  // ===========================================================================

  /**
   * Wait for the committed block to be mined.
   * Returns the verified block hash or throws on timeout/failure.
   */
  async waitForBlock(
    gameId: string,
    pollIntervalMs: number = 5000
  ): Promise<string> {
    const commitment = this.commitments.get(gameId);

    if (!commitment) {
      throw new Error('No commitment found for this game');
    }

    const deadline = commitment.committedAt + this.config.maxWaitTimeMs;

    while (Date.now() < deadline) {
      const result = await this.verifyCommitment(gameId);

      if (result.success && result.verification) {
        return result.verification.actualBlockHash;
      }

      // If verification failed (not just pending), throw
      if (result.verification?.failureReason) {
        throw new Error(`Block verification failed: ${result.verification.failureReason}`);
      }

      // Block not mined yet, wait and retry
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error('Timeout waiting for committed block');
  }

  // ===========================================================================
  // State Management
  // ===========================================================================

  /**
   * Get estimated time until block is mined.
   */
  async getEstimatedWaitTime(gameId: string): Promise<number> {
    const commitment = this.commitments.get(gameId);
    if (!commitment) return 0;

    const currentHeight = await this.getCurrentBlockHeight();
    if (currentHeight >= commitment.targetBlockHeight) {
      return 0; // Block already mined
    }

    const estimatedMiningTime = estimateBlockMiningTime(
      currentHeight,
      commitment.targetBlockHeight
    );

    return Math.max(0, estimatedMiningTime - Date.now());
  }

  /**
   * Clear commitment data for a game.
   */
  clearGame(gameId: string): void {
    this.commitments.delete(gameId);
    this.verifications.delete(gameId);
  }

  /**
   * Get all pending commitments (waiting for block).
   */
  getPendingCommitments(): OreBlockCommitment[] {
    return Array.from(this.commitments.values()).filter(
      (c) => !this.verifications.has(c.gameId)
    );
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================

  /**
   * Serialize state for persistence.
   */
  serialize(): string {
    return JSON.stringify({
      commitments: Array.from(this.commitments.entries()),
      verifications: Array.from(this.verifications.entries()),
    });
  }

  /**
   * Restore state from serialized data.
   */
  restore(json: string): void {
    const data = JSON.parse(json);
    this.commitments = new Map(data.commitments);
    this.verifications = new Map(data.verifications);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an OreBlockCommitmentManager with mock callbacks for testing.
 */
export function createMockOreBlockCommitmentManager(
  config?: Partial<OreBlockCommitmentConfig>
): {
  manager: OreBlockCommitmentManager;
  setBlockHeight: (height: number) => void;
  addBlock: (height: number, hash: string, timestamp?: number) => void;
} {
  let currentBlockHeight = 100;
  const blocks = new Map<number, { hash: string; timestamp: number }>();

  const manager = new OreBlockCommitmentManager(config, {
    getCurrentBlockHeight: async () => currentBlockHeight,
    getBlockHash: async (height) => blocks.get(height)?.hash ?? null,
    getBlockTimestamp: async (height) => blocks.get(height)?.timestamp ?? null,
  });

  return {
    manager,
    setBlockHeight: (height: number) => {
      currentBlockHeight = height;
    },
    addBlock: (height: number, hash: string, timestamp?: number) => {
      blocks.set(height, { hash, timestamp: timestamp ?? Date.now() });
    },
  };
}

// =============================================================================
// Exports
// =============================================================================

export default OreBlockCommitmentManager;
