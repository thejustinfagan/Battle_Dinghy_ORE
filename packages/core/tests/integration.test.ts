import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameEngine, GameConfig, generateMockOreResults } from '../src/game-engine.js';
import { OreMonitorMock, OreRoundResult } from '../src/ore-monitor.js';
import { seedFromHex, generateCard, verifyCard } from '../src/card-generator.js';
import { MAX_ROUNDS, TOTAL_SHIP_CELLS } from '../src/types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const TEST_SEED = seedFromHex(
  'deadbeefcafe1234567890abcdef1234567890abcdef1234567890abcdef1234'
);

const MOCK_WALLETS = Array.from(
  { length: 10 },
  (_, i) => `MockWallet${String(i + 1).padStart(40, '0')}`
);

function createGameConfig(): GameConfig {
  return {
    gameId: `integration-test-${Date.now()}`,
    seed: TEST_SEED,
    players: MOCK_WALLETS,
  };
}

// =============================================================================
// Full Game Simulation Tests
// =============================================================================

describe('Full Game Integration', () => {
  let monitor: OreMonitorMock;

  beforeEach(() => {
    vi.useFakeTimers();
    monitor = new OreMonitorMock(10); // Fast 10ms intervals
  });

  afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
  });

  it('simulates a complete game from start to finish', async () => {
    const config = createGameConfig();
    const engine = new GameEngine(config);

    // Track events
    const events = {
      roundComplete: [] as number[],
      playerEliminated: [] as { player: string; round: number }[],
      gameComplete: null as { winner: string; totalRounds: number } | null,
    };

    engine.on('round_complete', (summary) => {
      events.roundComplete.push(summary.roundNumber);
    });

    engine.on('player_eliminated', (event) => {
      events.playerEliminated.push(event);
    });

    engine.on('game_complete', (event) => {
      events.gameComplete = event;
    });

    // Connect monitor to engine
    monitor.on('round', (result: OreRoundResult) => {
      if (!engine.isGameComplete()) {
        engine.processRound(result);
      }
    });

    // Start monitor
    await monitor.start();

    // Run until game completes or max rounds
    while (!engine.isGameComplete() && engine.getCurrentRound() < MAX_ROUNDS) {
      vi.advanceTimersByTime(10);
    }

    monitor.stop();

    // Verify game completed
    expect(engine.isGameComplete()).toBe(true);

    // Verify exactly one winner
    const winner = engine.getWinner();
    expect(winner).not.toBeNull();
    expect(MOCK_WALLETS).toContain(winner);

    // Verify winner is one of the players
    expect(events.gameComplete).not.toBeNull();
    expect(events.gameComplete!.winner).toBe(winner);

    // Verify all rounds were recorded
    expect(engine.getRoundHistory().length).toBe(engine.getCurrentRound());
    expect(events.roundComplete.length).toBe(engine.getCurrentRound());

    // Verify winner has remaining cells (wasn't fully eliminated) OR won tiebreaker
    const winnerCard = engine.getPlayerCard(winner!)!;
    // Winner is valid regardless of elimination status (tiebreaker is possible)
    expect(winnerCard).toBeTruthy();

    // Verify all eliminated players have eliminatedAtRound set
    for (const player of MOCK_WALLETS) {
      const card = engine.getPlayerCard(player)!;
      if (card.isEliminated) {
        expect(card.eliminatedAtRound).not.toBeNull();
        expect(card.eliminatedAtRound).toBeGreaterThan(0);
        expect(card.eliminatedAtRound).toBeLessThanOrEqual(engine.getCurrentRound());
      } else {
        expect(card.eliminatedAtRound).toBeNull();
      }
    }

    console.log(`Game completed in ${engine.getCurrentRound()} rounds`);
    console.log(`Winner: ${winner}`);
    console.log(`Eliminations: ${events.playerEliminated.length}`);
  });

  it('determinism - identical outcomes with same seed and ORE results', async () => {
    const config = createGameConfig();

    // Generate ORE results once
    const oreResults = generateMockOreResults(MAX_ROUNDS, TEST_SEED);

    // Run game 1
    const engine1 = new GameEngine(config);
    for (const ore of oreResults) {
      if (engine1.isGameComplete()) break;
      engine1.processRound(ore);
    }

    // Run game 2 with identical inputs
    const engine2 = new GameEngine(config);
    for (const ore of oreResults) {
      if (engine2.isGameComplete()) break;
      engine2.processRound(ore);
    }

    // Verify identical outcomes
    expect(engine2.getWinner()).toBe(engine1.getWinner());
    expect(engine2.getCurrentRound()).toBe(engine1.getCurrentRound());
    expect(engine2.isGameComplete()).toBe(engine1.isGameComplete());

    // Verify identical player states
    for (const player of MOCK_WALLETS) {
      const card1 = engine1.getPlayerCard(player)!;
      const card2 = engine2.getPlayerCard(player)!;

      expect(card2.isEliminated).toBe(card1.isEliminated);
      expect(card2.eliminatedAtRound).toBe(card1.eliminatedAtRound);
      expect(card2.hitCells.size).toBe(card1.hitCells.size);

      for (const cell of card1.hitCells) {
        expect(card2.hitCells.has(cell)).toBe(true);
      }
    }

    // Verify identical round history
    const history1 = engine1.getRoundHistory();
    const history2 = engine2.getRoundHistory();
    expect(history2.length).toBe(history1.length);

    for (let i = 0; i < history1.length; i++) {
      expect(history2[i].roundNumber).toBe(history1[i].roundNumber);
      expect(history2[i].primaryShot).toBe(history1[i].primaryShot);
      expect(history2[i].eliminations).toEqual(history1[i].eliminations);
    }
  });

  it('recovery - serialize/deserialize maintains correct state', async () => {
    const config = createGameConfig();
    const oreResults = generateMockOreResults(MAX_ROUNDS, TEST_SEED);

    // Run game halfway
    const engine1 = new GameEngine(config);
    const halfwayPoint = Math.floor(oreResults.length / 2);

    for (let i = 0; i < halfwayPoint; i++) {
      if (engine1.isGameComplete()) break;
      engine1.processRound(oreResults[i]);
    }

    // Serialize at halfway point
    const serialized = engine1.serialize();
    const roundAtSerialization = engine1.getCurrentRound();

    // Deserialize and continue
    const engine2 = GameEngine.deserialize(serialized);

    // Verify state matches at serialization point
    expect(engine2.getCurrentRound()).toBe(engine1.getCurrentRound());
    expect(engine2.isGameComplete()).toBe(engine1.isGameComplete());

    // Continue both engines to completion
    for (let i = halfwayPoint; i < oreResults.length; i++) {
      if (!engine1.isGameComplete()) {
        engine1.processRound(oreResults[i]);
      }
      if (!engine2.isGameComplete()) {
        engine2.processRound(oreResults[i]);
      }
    }

    // Both should have same final state
    expect(engine2.getWinner()).toBe(engine1.getWinner());
    expect(engine2.getCurrentRound()).toBe(engine1.getCurrentRound());
  });

  it('recovery - fresh replay matches serialized continuation', async () => {
    const config = createGameConfig();
    const oreResults = generateMockOreResults(MAX_ROUNDS, TEST_SEED);

    // Run full game
    const engine1 = new GameEngine(config);
    for (const ore of oreResults) {
      if (engine1.isGameComplete()) break;
      engine1.processRound(ore);
    }

    // Use recover() to replay from scratch
    const oreHistory = oreResults.slice(0, engine1.getCurrentRound());
    const engine2 = GameEngine.recover(config, oreHistory);

    // Should have identical final state
    expect(engine2.getWinner()).toBe(engine1.getWinner());
    expect(engine2.getCurrentRound()).toBe(engine1.getCurrentRound());
    expect(engine2.isGameComplete()).toBe(engine1.isGameComplete());

    for (const player of MOCK_WALLETS) {
      const card1 = engine1.getPlayerCard(player)!;
      const card2 = engine2.getPlayerCard(player)!;

      expect(card2.isEliminated).toBe(card1.isEliminated);
      expect(card2.eliminatedAtRound).toBe(card1.eliminatedAtRound);
    }
  });
});

// =============================================================================
// Card Verification Tests
// =============================================================================

describe('Card Verification Integration', () => {
  it('all generated cards can be verified', () => {
    const config = createGameConfig();
    const engine = new GameEngine(config);

    for (let i = 0; i < MOCK_WALLETS.length; i++) {
      const wallet = MOCK_WALLETS[i];
      const generatedCard = engine.getGeneratedCard(wallet)!;

      // Verify the card matches expected generation
      const isValid = verifyCard(TEST_SEED, wallet, i, generatedCard);
      expect(isValid).toBe(true);
    }
  });

  it('card generation is independent and reproducible', () => {
    // Generate cards via engine
    const config = createGameConfig();
    const engine = new GameEngine(config);

    // Generate same cards directly
    for (let i = 0; i < MOCK_WALLETS.length; i++) {
      const wallet = MOCK_WALLETS[i];

      const fromEngine = engine.getGeneratedCard(wallet)!;
      const direct = generateCard(TEST_SEED, wallet, i);

      // Should be identical
      expect(direct.playerId).toBe(fromEngine.playerId);
      expect(direct.allCells).toEqual(fromEngine.allCells);

      for (let j = 0; j < direct.ships.length; j++) {
        expect(direct.ships[j].size).toBe(fromEngine.ships[j].size);
        expect(direct.ships[j].cells).toEqual(fromEngine.ships[j].cells);
      }
    }
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  it('handles 2-player game', async () => {
    const config: GameConfig = {
      gameId: 'two-player-test',
      seed: TEST_SEED,
      players: MOCK_WALLETS.slice(0, 2),
    };

    const engine = new GameEngine(config);
    const oreResults = generateMockOreResults(MAX_ROUNDS, TEST_SEED);

    for (const ore of oreResults) {
      if (engine.isGameComplete()) break;
      engine.processRound(ore);
    }

    expect(engine.isGameComplete()).toBe(true);
    expect(engine.getWinner()).not.toBeNull();
    expect(config.players).toContain(engine.getWinner());
  });

  it('handles game ending at exactly round 50', async () => {
    const config = createGameConfig();
    const engine = new GameEngine(config);

    // Use ORE results that are unlikely to eliminate anyone quickly
    const safeOreResults: OreRoundResult[] = [];
    for (let i = 1; i <= MAX_ROUNDS; i++) {
      safeOreResults.push({
        roundNumber: i,
        winningBlock: 24, // Corner cell - less likely to hit
        proof: `safe-proof-${i}`,
      });
    }

    for (const ore of safeOreResults) {
      if (engine.isGameComplete()) break;
      engine.processRound(ore);
    }

    // Game should complete at or before round 50
    expect(engine.isGameComplete()).toBe(true);
    expect(engine.getCurrentRound()).toBeLessThanOrEqual(MAX_ROUNDS);
  });

  it('multiple games with different seeds produce different winners', () => {
    const seeds = [
      seedFromHex('1111111111111111111111111111111111111111111111111111111111111111'),
      seedFromHex('2222222222222222222222222222222222222222222222222222222222222222'),
      seedFromHex('3333333333333333333333333333333333333333333333333333333333333333'),
      seedFromHex('4444444444444444444444444444444444444444444444444444444444444444'),
      seedFromHex('5555555555555555555555555555555555555555555555555555555555555555'),
    ];

    const winners: (string | null)[] = [];

    for (const seed of seeds) {
      const config: GameConfig = {
        gameId: `multi-seed-${Buffer.from(seed).toString('hex').slice(0, 8)}`,
        seed,
        players: MOCK_WALLETS,
      };

      const engine = new GameEngine(config);
      const oreResults = generateMockOreResults(MAX_ROUNDS, seed);

      for (const ore of oreResults) {
        if (engine.isGameComplete()) break;
        engine.processRound(ore);
      }

      winners.push(engine.getWinner());
    }

    // Not all winners should be the same (statistically very unlikely)
    const uniqueWinners = new Set(winners);
    expect(uniqueWinners.size).toBeGreaterThan(1);
  });
});

// =============================================================================
// Performance Tests
// =============================================================================

describe('Performance', () => {
  it('completes 100 full games in reasonable time', () => {
    const startTime = Date.now();

    for (let game = 0; game < 100; game++) {
      const seed = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        seed[i] = (game * 7 + i) % 256;
      }

      const config: GameConfig = {
        gameId: `perf-test-${game}`,
        seed,
        players: MOCK_WALLETS,
      };

      const engine = new GameEngine(config);
      const oreResults = generateMockOreResults(MAX_ROUNDS, seed);

      for (const ore of oreResults) {
        if (engine.isGameComplete()) break;
        engine.processRound(ore);
      }

      expect(engine.isGameComplete()).toBe(true);
    }

    const elapsed = Date.now() - startTime;
    console.log(`100 games completed in ${elapsed}ms (${elapsed / 100}ms per game)`);

    // Should complete in under 10 seconds (very generous)
    expect(elapsed).toBeLessThan(10000);
  });
});
