// Battle Dinghy - Commit-Reveal Scheme
//
// Security mitigation C1: Prevents operator from manipulating board generation.
//
// Protocol:
// 1. COMMIT PHASE: Each player submits H(secret || wallet) before seeing others
// 2. REVEAL PHASE: Players reveal their secrets, verified against commitments
// 3. FINALIZE: Final seed = H(all_secrets || ore_block_hash)
//
// This ensures no single party (including operator) can predict or control the seed.

import { createHash, randomBytes } from 'crypto';

// =============================================================================
// Types
// =============================================================================

export interface PlayerCommitment {
  /** Player wallet address */
  wallet: string;
  /** Hash of (secret || wallet) */
  commitmentHash: string;
  /** The revealed secret (only set after reveal phase) */
  revealedSecret?: string;
  /** Timestamp when commitment was submitted */
  committedAt: number;
  /** Timestamp when secret was revealed */
  revealedAt?: number;
}

export interface CommitRevealState {
  /** Game ID */
  gameId: string;
  /** Current phase */
  phase: CommitRevealPhase;
  /** Player commitments */
  commitments: Map<string, PlayerCommitment>;
  /** Deadline for commit phase (Unix timestamp) */
  commitDeadline: number;
  /** Deadline for reveal phase (Unix timestamp) */
  revealDeadline: number;
  /** ORE block hash used in final seed (set during finalize) */
  oreBlockHash?: string;
  /** Final computed seed (set after finalize) */
  finalSeed?: string;
  /** When the state was created */
  createdAt: number;
}

export type CommitRevealPhase =
  | 'committing'   // Players can submit commitments
  | 'revealing'    // Players can reveal secrets
  | 'finalized'    // Seed has been computed
  | 'expired';     // Deadlines passed without completion

export interface CommitRevealConfig {
  /** Time allowed for commit phase in seconds */
  commitPhaseDurationSec: number;
  /** Time allowed for reveal phase in seconds */
  revealPhaseDurationSec: number;
  /** Minimum players required to finalize */
  minPlayers: number;
}

export interface CommitResult {
  success: boolean;
  error?: string;
  commitmentHash?: string;
}

export interface RevealResult {
  success: boolean;
  error?: string;
  verified?: boolean;
}

export interface FinalizeResult {
  success: boolean;
  error?: string;
  seed?: Uint8Array;
  seedHex?: string;
  participantCount?: number;
}

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_CONFIG: CommitRevealConfig = {
  commitPhaseDurationSec: 300,   // 5 minutes to commit
  revealPhaseDurationSec: 120,   // 2 minutes to reveal
  minPlayers: 2,
};

const SECRET_LENGTH = 32; // 256 bits of entropy

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a random secret for commitment.
 */
export function generateSecret(): string {
  return randomBytes(SECRET_LENGTH).toString('hex');
}

/**
 * Create a commitment hash from a secret and wallet.
 * commitment = SHA256(secret || wallet)
 */
export function createCommitment(secret: string, wallet: string): string {
  const hash = createHash('sha256');
  hash.update(secret);
  hash.update(wallet);
  return hash.digest('hex');
}

/**
 * Verify that a revealed secret matches a commitment.
 */
export function verifyReveal(
  commitmentHash: string,
  secret: string,
  wallet: string
): boolean {
  const computed = createCommitment(secret, wallet);
  return computed === commitmentHash;
}

/**
 * Compute the final seed from all player entropies and ORE block hash.
 * seed = SHA256(sorted_secrets || ore_hash)
 *
 * Players who didn't reveal have their commitment hash used as entropy
 * to prevent selective exclusion attacks.
 */
export function computeFinalSeed(
  commitments: PlayerCommitment[],
  oreBlockHash: string
): Uint8Array {
  // Sort by wallet for deterministic ordering
  const sorted = [...commitments].sort((a, b) =>
    a.wallet.localeCompare(b.wallet)
  );

  const hash = createHash('sha256');

  // Add each player's entropy
  for (const commitment of sorted) {
    // Use revealed secret if available, otherwise use commitment hash
    // This prevents operator from excluding players to manipulate outcome
    const entropy = commitment.revealedSecret ?? commitment.commitmentHash;
    hash.update(entropy);
  }

  // Add ORE block hash for additional unpredictability
  hash.update(oreBlockHash);

  return new Uint8Array(hash.digest());
}

// =============================================================================
// CommitRevealManager Class
// =============================================================================

export class CommitRevealManager {
  private state: CommitRevealState;
  private config: CommitRevealConfig;

  constructor(gameId: string, config?: Partial<CommitRevealConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    const now = Date.now();
    this.state = {
      gameId,
      phase: 'committing',
      commitments: new Map(),
      commitDeadline: now + this.config.commitPhaseDurationSec * 1000,
      revealDeadline: now + (this.config.commitPhaseDurationSec + this.config.revealPhaseDurationSec) * 1000,
      createdAt: now,
    };
  }

  // ===========================================================================
  // Phase Management
  // ===========================================================================

  /**
   * Get current phase, accounting for deadlines.
   */
  getPhase(): CommitRevealPhase {
    const now = Date.now();

    if (this.state.phase === 'finalized') {
      return 'finalized';
    }

    if (now > this.state.revealDeadline) {
      return 'expired';
    }

    if (now > this.state.commitDeadline && this.state.phase === 'committing') {
      // Auto-transition to revealing phase
      this.state.phase = 'revealing';
    }

    return this.state.phase;
  }

  /**
   * Manually transition to reveal phase (e.g., when all players have committed).
   */
  startRevealPhase(): boolean {
    if (this.state.phase !== 'committing') {
      return false;
    }

    if (this.state.commitments.size < this.config.minPlayers) {
      return false;
    }

    this.state.phase = 'revealing';
    return true;
  }

  // ===========================================================================
  // Commit Phase
  // ===========================================================================

  /**
   * Submit a commitment for a player.
   */
  submitCommitment(wallet: string, commitmentHash: string): CommitResult {
    const phase = this.getPhase();

    if (phase !== 'committing') {
      return {
        success: false,
        error: `Cannot commit in ${phase} phase`,
      };
    }

    if (this.state.commitments.has(wallet)) {
      return {
        success: false,
        error: 'Player has already committed',
      };
    }

    // Validate commitment hash format (should be 64 hex chars = SHA256)
    if (!/^[a-f0-9]{64}$/i.test(commitmentHash)) {
      return {
        success: false,
        error: 'Invalid commitment hash format',
      };
    }

    this.state.commitments.set(wallet, {
      wallet,
      commitmentHash,
      committedAt: Date.now(),
    });

    return {
      success: true,
      commitmentHash,
    };
  }

  /**
   * Check if a player has committed.
   */
  hasCommitted(wallet: string): boolean {
    return this.state.commitments.has(wallet);
  }

  /**
   * Get all players who have committed.
   */
  getCommittedPlayers(): string[] {
    return Array.from(this.state.commitments.keys());
  }

  // ===========================================================================
  // Reveal Phase
  // ===========================================================================

  /**
   * Reveal a secret for a player.
   */
  revealSecret(wallet: string, secret: string): RevealResult {
    const phase = this.getPhase();

    if (phase !== 'revealing') {
      return {
        success: false,
        error: `Cannot reveal in ${phase} phase`,
      };
    }

    const commitment = this.state.commitments.get(wallet);
    if (!commitment) {
      return {
        success: false,
        error: 'No commitment found for this player',
      };
    }

    if (commitment.revealedSecret) {
      return {
        success: false,
        error: 'Secret already revealed',
      };
    }

    // Verify the reveal matches the commitment
    const verified = verifyReveal(commitment.commitmentHash, secret, wallet);
    if (!verified) {
      return {
        success: false,
        error: 'Revealed secret does not match commitment',
        verified: false,
      };
    }

    commitment.revealedSecret = secret;
    commitment.revealedAt = Date.now();

    return {
      success: true,
      verified: true,
    };
  }

  /**
   * Check if a player has revealed.
   */
  hasRevealed(wallet: string): boolean {
    const commitment = this.state.commitments.get(wallet);
    return commitment?.revealedSecret !== undefined;
  }

  /**
   * Get all players who have revealed.
   */
  getRevealedPlayers(): string[] {
    return Array.from(this.state.commitments.values())
      .filter((c) => c.revealedSecret !== undefined)
      .map((c) => c.wallet);
  }

  /**
   * Get players who committed but didn't reveal.
   */
  getMissingReveals(): string[] {
    return Array.from(this.state.commitments.values())
      .filter((c) => c.revealedSecret === undefined)
      .map((c) => c.wallet);
  }

  // ===========================================================================
  // Finalization
  // ===========================================================================

  /**
   * Finalize the commit-reveal process and compute the final seed.
   *
   * @param oreBlockHash - Hash from ORE mining to add additional entropy
   */
  finalize(oreBlockHash: string): FinalizeResult {
    const phase = this.getPhase();

    if (phase === 'finalized') {
      return {
        success: true,
        seed: new Uint8Array(Buffer.from(this.state.finalSeed!, 'hex')),
        seedHex: this.state.finalSeed!,
        participantCount: this.state.commitments.size,
      };
    }

    if (phase === 'committing') {
      return {
        success: false,
        error: 'Still in commit phase',
      };
    }

    if (this.state.commitments.size < this.config.minPlayers) {
      return {
        success: false,
        error: `Not enough participants (${this.state.commitments.size}/${this.config.minPlayers})`,
      };
    }

    // Validate ORE block hash format
    if (!/^[a-f0-9]{64}$/i.test(oreBlockHash)) {
      return {
        success: false,
        error: 'Invalid ORE block hash format',
      };
    }

    // Compute final seed
    const commitments = Array.from(this.state.commitments.values());
    const seed = computeFinalSeed(commitments, oreBlockHash);

    this.state.oreBlockHash = oreBlockHash;
    this.state.finalSeed = Buffer.from(seed).toString('hex');
    this.state.phase = 'finalized';

    return {
      success: true,
      seed,
      seedHex: this.state.finalSeed,
      participantCount: commitments.length,
    };
  }

  // ===========================================================================
  // State Access
  // ===========================================================================

  /**
   * Get the current state (for serialization/debugging).
   */
  getState(): Readonly<CommitRevealState> {
    return {
      ...this.state,
      commitments: new Map(this.state.commitments),
    };
  }

  /**
   * Get the final seed (only available after finalization).
   */
  getFinalSeed(): Uint8Array | null {
    if (!this.state.finalSeed) {
      return null;
    }
    return new Uint8Array(Buffer.from(this.state.finalSeed, 'hex'));
  }

  /**
   * Get the final seed as hex string.
   */
  getFinalSeedHex(): string | null {
    return this.state.finalSeed ?? null;
  }

  /**
   * Get statistics about the commit-reveal process.
   */
  getStats(): {
    phase: CommitRevealPhase;
    totalCommitments: number;
    totalReveals: number;
    missingReveals: number;
    isFinalized: boolean;
    timeToCommitDeadline: number;
    timeToRevealDeadline: number;
  } {
    const now = Date.now();
    const phase = this.getPhase();
    const commitments = Array.from(this.state.commitments.values());

    return {
      phase,
      totalCommitments: commitments.length,
      totalReveals: commitments.filter((c) => c.revealedSecret).length,
      missingReveals: commitments.filter((c) => !c.revealedSecret).length,
      isFinalized: phase === 'finalized',
      timeToCommitDeadline: Math.max(0, this.state.commitDeadline - now),
      timeToRevealDeadline: Math.max(0, this.state.revealDeadline - now),
    };
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================

  /**
   * Serialize state for persistence.
   */
  serialize(): string {
    const state = {
      ...this.state,
      commitments: Array.from(this.state.commitments.entries()),
    };
    return JSON.stringify(state);
  }

  /**
   * Deserialize state from persistence.
   */
  static deserialize(json: string, config?: Partial<CommitRevealConfig>): CommitRevealManager {
    const data = JSON.parse(json);
    const manager = new CommitRevealManager(data.gameId, config);

    manager.state = {
      ...data,
      commitments: new Map(data.commitments),
    };

    return manager;
  }
}

// =============================================================================
// Client-Side Helper
// =============================================================================

/**
 * Helper class for players to manage their commitment.
 */
export class PlayerCommitmentHelper {
  private secret: string;
  private wallet: string;
  private commitmentHash: string;

  constructor(wallet: string) {
    this.wallet = wallet;
    this.secret = generateSecret();
    this.commitmentHash = createCommitment(this.secret, wallet);
  }

  /**
   * Get the commitment hash to submit during commit phase.
   */
  getCommitmentHash(): string {
    return this.commitmentHash;
  }

  /**
   * Get the secret to reveal during reveal phase.
   */
  getSecret(): string {
    return this.secret;
  }

  /**
   * Verify the commitment matches (for debugging/testing).
   */
  verify(): boolean {
    return verifyReveal(this.commitmentHash, this.secret, this.wallet);
  }
}

// =============================================================================
// Exports
// =============================================================================

export default CommitRevealManager;
