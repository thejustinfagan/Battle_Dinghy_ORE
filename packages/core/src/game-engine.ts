// Battle Dinghy - Game Engine
//
// The GameEngine processes rounds deterministically based on ORE mining results.
// Game state is FULLY DERIVABLE from:
// - Game config (seed, players)
// - ORE round history
// This means we can always recover by replaying.

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import {
  CellIndex,
  PlayerCard,
  GameStatus,
  RoundResult,
  GameState,
  TOTAL_SHIP_CELLS,
  SUDDEN_DEATH_ROUND_1,
  SUDDEN_DEATH_ROUND_2,
  MAX_ROUNDS,
  TOTAL_CELLS,
  createCellIndex,
} from './types.js';
import { generateAllCards, GeneratedCard } from './card-generator.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for initializing a game
 */
export interface GameConfig {
  readonly gameId: string;
  readonly seed: Uint8Array;
  readonly players: readonly string[];
}

// Re-export OreRoundResult from ore-monitor for convenience
// (avoiding circular dependency by using type-only import pattern)
/**
 * ORE round result input
 */
export interface OreRoundResult {
  readonly roundNumber: number;
  readonly winningBlock: number;
  readonly timestamp?: number;
  readonly proof: string;
}

/**
 * Summary of a processed round
 */
export interface RoundSummary {
  readonly roundNumber: number;
  readonly shots: readonly CellIndex[];
  readonly hits: ReadonlyMap<string, readonly CellIndex[]>;
  readonly eliminations: readonly string[];
  readonly remainingPlayers: readonly string[];
  readonly isGameComplete: boolean;
  readonly winner: string | null;
}

/**
 * Result of applying a single shot
 */
export interface ShotResult {
  readonly cell: CellIndex;
  readonly hits: ReadonlyMap<string, boolean>;
  readonly eliminations: readonly string[];
}

/**
 * Internal mutable player card state
 */
interface MutablePlayerCard {
  playerId: string;
  generatedCard: GeneratedCard;
  hitCells: Set<CellIndex>;
  isEliminated: boolean;
  eliminatedAtRound: number | null;
}

/**
 * Serialized game state for persistence
 */
export interface SerializedGameState {
  config: {
    gameId: string;
    seed: string; // hex encoded
    players: string[];
  };
  currentRound: number;
  rounds: RoundResult[];
  cards: {
    playerId: string;
    hitCells: number[];
    isEliminated: boolean;
    eliminatedAtRound: number | null;
  }[];
  isComplete: boolean;
  winner: string | null;
}

// =============================================================================
// GameEngine Class
// =============================================================================

export class GameEngine extends EventEmitter {
  private readonly config: GameConfig;
  private readonly cards: Map<string, MutablePlayerCard>;
  private readonly generatedCards: Map<string, GeneratedCard>;
  private currentRound: number;
  private readonly rounds: RoundResult[];
  private _isComplete: boolean;
  private _winner: string | null;

  constructor(config: GameConfig) {
    super();
    this.config = config;
    this.currentRound = 0;
    this.rounds = [];
    this._isComplete = false;
    this._winner = null;

    // Generate all player cards deterministically
    this.generatedCards = generateAllCards(config.seed, config.players);

    // Initialize mutable card state
    this.cards = new Map();
    for (const [playerId, generated] of this.generatedCards) {
      this.cards.set(playerId, {
        playerId,
        generatedCard: generated,
        hitCells: new Set(),
        isEliminated: false,
        eliminatedAtRound: null,
      });
    }
  }

  // ===========================================================================
  // Core Round Processing
  // ===========================================================================

  /**
   * Process a round with the given ORE result.
   * This is the main entry point for advancing the game.
   */
  processRound(oreResult: OreRoundResult): RoundSummary {
    if (this._isComplete) {
      throw new Error('Game is already complete');
    }

    if (oreResult.roundNumber !== this.currentRound + 1) {
      throw new Error(
        `Expected round ${this.currentRound + 1}, got ${oreResult.roundNumber}`
      );
    }

    this.currentRound = oreResult.roundNumber;

    // Calculate shots for this round
    const shots = this.calculateShots(oreResult);

    // Track hits and eliminations for this round
    const roundHits = new Map<string, CellIndex[]>();
    const roundEliminations: string[] = [];

    // Apply each shot
    for (const shot of shots) {
      const result = this.applyShot(shot);

      // Collect hits
      for (const [playerId, wasHit] of result.hits) {
        if (wasHit) {
          if (!roundHits.has(playerId)) {
            roundHits.set(playerId, []);
          }
          roundHits.get(playerId)!.push(shot);
        }
      }

      // Collect eliminations
      roundEliminations.push(...result.eliminations);
    }

    // Create round result for history
    const roundResult: RoundResult = {
      roundNumber: this.currentRound,
      primaryShot: shots[0],
      derivedShots: shots.slice(1),
      eliminations: roundEliminations,
      oreProof: oreResult.proof,
    };
    this.rounds.push(roundResult);

    // Emit elimination events
    for (const eliminated of roundEliminations) {
      this.emit('player_eliminated', { player: eliminated, round: this.currentRound });
    }

    // Check for game completion
    const remaining = this.getRemainingPlayers();
    let winner: string | null = null;

    if (remaining.length === 1) {
      // Single survivor wins
      winner = remaining[0];
      this._winner = winner;
      this._isComplete = true;
    } else if (remaining.length === 0) {
      // All eliminated in same round - use tiebreaker
      winner = this.resolveTiebreaker(roundEliminations);
      this._winner = winner;
      this._isComplete = true;
    } else if (this.currentRound >= MAX_ROUNDS) {
      // Round 50 reached with multiple survivors
      winner = this.resolveMaxRoundWinner(remaining);
      this._winner = winner;
      this._isComplete = true;
    }

    // Create summary
    const summary: RoundSummary = {
      roundNumber: this.currentRound,
      shots,
      hits: roundHits,
      eliminations: roundEliminations,
      remainingPlayers: remaining,
      isGameComplete: this._isComplete,
      winner,
    };

    // Emit events
    this.emit('round_complete', summary);

    if (this._isComplete) {
      this.emit('game_complete', {
        winner: this._winner,
        totalRounds: this.currentRound,
      });
    }

    return summary;
  }

  /**
   * Calculate shots for a round based on sudden death rules.
   * - Rounds 1-30: 1 shot
   * - Rounds 31-40: 2 shots
   * - Rounds 41-50: 3 shots
   */
  calculateShots(oreResult: OreRoundResult): CellIndex[] {
    const shots: CellIndex[] = [];

    // Primary shot from ORE winning block
    const primaryShot = createCellIndex(oreResult.winningBlock % TOTAL_CELLS);
    shots.push(primaryShot);

    // Calculate number of additional shots based on round
    let additionalShots = 0;
    if (oreResult.roundNumber >= SUDDEN_DEATH_ROUND_2) {
      additionalShots = 2; // 3 total shots
    } else if (oreResult.roundNumber >= SUDDEN_DEATH_ROUND_1) {
      additionalShots = 1; // 2 total shots
    }

    // Generate derived shots
    for (let i = 1; i <= additionalShots; i++) {
      const derivedShot = this.deriveShotFromProof(
        oreResult.proof,
        oreResult.roundNumber,
        i
      );
      shots.push(derivedShot);
    }

    return shots;
  }

  /**
   * Derive a shot from proof using hash.
   * derivedShot = hash(proof + roundNumber + shotIndex) mod 25
   */
  private deriveShotFromProof(
    proof: string,
    roundNumber: number,
    shotIndex: number
  ): CellIndex {
    const hash = createHash('sha256');
    hash.update(proof);
    hash.update(Buffer.from([roundNumber]));
    hash.update(Buffer.from([shotIndex]));
    const digest = hash.digest();

    // Use first 4 bytes as uint32, mod 25
    const value = digest.readUInt32BE(0);
    return createCellIndex(value % TOTAL_CELLS);
  }

  /**
   * Apply a shot to all non-eliminated players.
   */
  applyShot(cell: CellIndex): ShotResult {
    const hits = new Map<string, boolean>();
    const eliminations: string[] = [];

    for (const [playerId, card] of this.cards) {
      if (card.isEliminated) {
        continue;
      }

      // Check if this cell is part of player's ships
      const isHit = card.generatedCard.allCells.includes(cell);
      hits.set(playerId, isHit);

      if (isHit && !card.hitCells.has(cell)) {
        card.hitCells.add(cell);

        // Check for elimination (all 6 cells hit)
        if (card.hitCells.size >= TOTAL_SHIP_CELLS) {
          card.isEliminated = true;
          card.eliminatedAtRound = this.currentRound;
          eliminations.push(playerId);
        }
      }
    }

    return { cell, hits, eliminations };
  }

  // ===========================================================================
  // Winner Determination
  // ===========================================================================

  /**
   * Resolve tiebreaker when multiple players eliminated in same round.
   * Winner = hash(round + sorted wallets), pick player with lowest hash position.
   */
  private resolveTiebreaker(eliminatedPlayers: string[]): string {
    if (eliminatedPlayers.length === 0) {
      throw new Error('No players to tiebreak');
    }
    if (eliminatedPlayers.length === 1) {
      return eliminatedPlayers[0];
    }

    // Sort wallets for deterministic ordering
    const sorted = [...eliminatedPlayers].sort();

    // Hash round + sorted wallets
    const hash = createHash('sha256');
    hash.update(Buffer.from([this.currentRound]));
    for (const wallet of sorted) {
      hash.update(wallet);
    }
    const digest = hash.digest();

    // Use hash to select winner index
    const winnerIndex = digest.readUInt32BE(0) % sorted.length;
    return sorted[winnerIndex];
  }

  /**
   * Resolve winner at round 50 with multiple survivors.
   * Winner = most remaining cells, then tiebreaker.
   */
  private resolveMaxRoundWinner(remaining: string[]): string {
    if (remaining.length === 0) {
      throw new Error('No remaining players');
    }
    if (remaining.length === 1) {
      return remaining[0];
    }

    // Calculate remaining cells for each player
    const cellCounts: { playerId: string; remaining: number }[] = [];
    for (const playerId of remaining) {
      const card = this.cards.get(playerId)!;
      const remaining = TOTAL_SHIP_CELLS - card.hitCells.size;
      cellCounts.push({ playerId, remaining });
    }

    // Sort by remaining cells descending
    cellCounts.sort((a, b) => b.remaining - a.remaining);

    // Get players with max remaining cells
    const maxCells = cellCounts[0].remaining;
    const topPlayers = cellCounts
      .filter(c => c.remaining === maxCells)
      .map(c => c.playerId);

    if (topPlayers.length === 1) {
      return topPlayers[0];
    }

    // Tiebreaker among top players
    return this.resolveTiebreaker(topPlayers);
  }

  // ===========================================================================
  // State Access Methods
  // ===========================================================================

  getPlayerCard(wallet: string): PlayerCard | null {
    const card = this.cards.get(wallet);
    if (!card) return null;

    return {
      playerId: card.playerId,
      ships: card.generatedCard.ships,
      hitCells: new Set(card.hitCells),
      isEliminated: card.isEliminated,
      eliminatedAtRound: card.eliminatedAtRound,
    };
  }

  getAllCards(): Map<string, PlayerCard> {
    const result = new Map<string, PlayerCard>();
    for (const [wallet, card] of this.cards) {
      result.set(wallet, {
        playerId: card.playerId,
        ships: card.generatedCard.ships,
        hitCells: new Set(card.hitCells),
        isEliminated: card.isEliminated,
        eliminatedAtRound: card.eliminatedAtRound,
      });
    }
    return result;
  }

  getGeneratedCard(wallet: string): GeneratedCard | undefined {
    return this.generatedCards.get(wallet);
  }

  getRoundHistory(): readonly RoundResult[] {
    return [...this.rounds];
  }

  getCurrentRound(): number {
    return this.currentRound;
  }

  getRemainingPlayers(): string[] {
    const remaining: string[] = [];
    for (const [playerId, card] of this.cards) {
      if (!card.isEliminated) {
        remaining.push(playerId);
      }
    }
    return remaining;
  }

  isGameComplete(): boolean {
    return this._isComplete;
  }

  getWinner(): string | null {
    return this._winner;
  }

  getGameState(): GameState {
    return {
      gameId: this.config.gameId,
      status: this._isComplete ? GameStatus.COMPLETE : GameStatus.ACTIVE,
      players: this.getAllCards(),
      currentRound: this.currentRound,
      rounds: this.rounds,
      winner: this._winner,
    };
  }

  getConfig(): GameConfig {
    return this.config;
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================

  /**
   * Serialize game state to JSON string for persistence.
   */
  serialize(): string {
    const state: SerializedGameState = {
      config: {
        gameId: this.config.gameId,
        seed: Buffer.from(this.config.seed).toString('hex'),
        players: [...this.config.players],
      },
      currentRound: this.currentRound,
      rounds: this.rounds.map(r => ({
        roundNumber: r.roundNumber,
        primaryShot: r.primaryShot,
        derivedShots: [...r.derivedShots],
        eliminations: [...r.eliminations],
        oreProof: r.oreProof,
      })),
      cards: Array.from(this.cards.values()).map(card => ({
        playerId: card.playerId,
        hitCells: Array.from(card.hitCells),
        isEliminated: card.isEliminated,
        eliminatedAtRound: card.eliminatedAtRound,
      })),
      isComplete: this._isComplete,
      winner: this._winner,
    };

    return JSON.stringify(state);
  }

  /**
   * Deserialize game state from JSON string.
   */
  static deserialize(json: string): GameEngine {
    const state: SerializedGameState = JSON.parse(json);

    // Reconstruct seed
    const seed = new Uint8Array(
      Buffer.from(state.config.seed, 'hex')
    );

    // Create config
    const config: GameConfig = {
      gameId: state.config.gameId,
      seed,
      players: state.config.players,
    };

    // Create engine (this regenerates cards)
    const engine = new GameEngine(config);

    // Restore state
    engine.currentRound = state.currentRound;
    engine._isComplete = state.isComplete;
    engine._winner = state.winner;

    // Restore rounds
    engine.rounds.length = 0;
    for (const r of state.rounds) {
      engine.rounds.push({
        roundNumber: r.roundNumber,
        primaryShot: r.primaryShot as CellIndex,
        derivedShots: r.derivedShots as CellIndex[],
        eliminations: r.eliminations,
        oreProof: r.oreProof,
      });
    }

    // Restore card states
    for (const cardState of state.cards) {
      const card = engine.cards.get(cardState.playerId);
      if (card) {
        card.hitCells = new Set(cardState.hitCells.map(c => c as CellIndex));
        card.isEliminated = cardState.isEliminated;
        card.eliminatedAtRound = cardState.eliminatedAtRound;
      }
    }

    return engine;
  }

  /**
   * Recover game state by replaying ORE history.
   * This is the canonical way to recover from crashes.
   */
  static recover(config: GameConfig, oreHistory: OreRoundResult[]): GameEngine {
    const engine = new GameEngine(config);

    // Replay all rounds
    for (const oreResult of oreHistory) {
      if (engine.isGameComplete()) {
        break;
      }
      engine.processRound(oreResult);
    }

    return engine;
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate mock ORE results for testing.
 */
export function generateMockOreResults(
  numRounds: number,
  seed?: Uint8Array
): OreRoundResult[] {
  const results: OreRoundResult[] = [];
  const prng = seed ? createPrngFromSeed(seed) : null;

  for (let i = 1; i <= numRounds; i++) {
    const winningBlock = prng
      ? prng() % TOTAL_CELLS
      : Math.floor(Math.random() * TOTAL_CELLS);

    const proof = createHash('sha256')
      .update(`mock-proof-${i}-${winningBlock}`)
      .digest('hex');

    results.push({
      roundNumber: i,
      winningBlock,
      proof,
      timestamp: Date.now() + i * 1000,
    });
  }

  return results;
}

/**
 * Simple seeded PRNG for deterministic mock data.
 */
function createPrngFromSeed(seed: Uint8Array): () => number {
  let state = 0;
  for (let i = 0; i < Math.min(seed.length, 4); i++) {
    state |= seed[i] << (i * 8);
  }
  if (state === 0) state = 1;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return Math.abs(state);
  };
}
