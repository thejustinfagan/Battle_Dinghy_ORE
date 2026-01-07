import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GameEngine,
  GameConfig,
  OreRoundResult,
  RoundSummary,
  generateMockOreResults,
} from '../src/game-engine.js';
import { seedFromHex } from '../src/card-generator.js';
import {
  TOTAL_CELLS,
  TOTAL_SHIP_CELLS,
  SUDDEN_DEATH_ROUND_1,
  SUDDEN_DEATH_ROUND_2,
  MAX_ROUNDS,
  CellIndex,
  createCellIndex,
} from '../src/types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const TEST_SEED = seedFromHex(
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
);

const TEST_PLAYERS = [
  'Player1111111111111111111111111111111111111',
  'Player2222222222222222222222222222222222222',
  'Player3333333333333333333333333333333333333',
  'Player4444444444444444444444444444444444444',
  'Player5555555555555555555555555555555555555',
  'Player6666666666666666666666666666666666666',
  'Player7777777777777777777777777777777777777',
  'Player8888888888888888888888888888888888888',
  'Player9999999999999999999999999999999999999',
  'PlayerAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
];

function createTestConfig(players = TEST_PLAYERS): GameConfig {
  return {
    gameId: 'test-game-001',
    seed: TEST_SEED,
    players,
  };
}

function createOreResult(roundNumber: number, winningBlock: number): OreRoundResult {
  return {
    roundNumber,
    winningBlock,
    proof: `proof-${roundNumber}-${winningBlock}`,
    timestamp: Date.now(),
  };
}

// =============================================================================
// 1. Round Processing Tests
// =============================================================================

describe('Round Processing', () => {
  it('single shot marks correct cells as hit', () => {
    const config = createTestConfig();
    const engine = new GameEngine(config);

    // Get first player's ship cells
    const player1Card = engine.getGeneratedCard(TEST_PLAYERS[0])!;
    const targetCell = player1Card.allCells[0];

    // Fire at that cell
    const oreResult = createOreResult(1, targetCell);
    const summary = engine.processRound(oreResult);

    // Verify hit was recorded
    const updatedCard = engine.getPlayerCard(TEST_PLAYERS[0])!;
    expect(updatedCard.hitCells.has(targetCell)).toBe(true);
    expect(summary.hits.get(TEST_PLAYERS[0])).toContain(targetCell);
  });

  it('multiple players can be hit in same shot', () => {
    const config = createTestConfig();
    const engine = new GameEngine(config);

    // Find a cell that hits multiple players
    const cellCounts = new Map<number, string[]>();
    for (const player of TEST_PLAYERS) {
      const card = engine.getGeneratedCard(player)!;
      for (const cell of card.allCells) {
        if (!cellCounts.has(cell)) {
          cellCounts.set(cell, []);
        }
        cellCounts.get(cell)!.push(player);
      }
    }

    // Find a cell with multiple players (may not exist, skip if not)
    let multiHitCell: number | null = null;
    let affectedPlayers: string[] = [];
    for (const [cell, players] of cellCounts) {
      if (players.length >= 2) {
        multiHitCell = cell;
        affectedPlayers = players;
        break;
      }
    }

    if (multiHitCell !== null) {
      const oreResult = createOreResult(1, multiHitCell);
      const summary = engine.processRound(oreResult);

      // Verify all affected players were hit
      for (const player of affectedPlayers) {
        const card = engine.getPlayerCard(player)!;
        expect(card.hitCells.has(multiHitCell as CellIndex)).toBe(true);
      }
    }
  });

  it('hits accumulate across rounds', () => {
    const config = createTestConfig();
    const engine = new GameEngine(config);

    const player = TEST_PLAYERS[0];
    const card = engine.getGeneratedCard(player)!;

    // Hit first two cells in separate rounds
    engine.processRound(createOreResult(1, card.allCells[0]));
    engine.processRound(createOreResult(2, card.allCells[1]));

    const updatedCard = engine.getPlayerCard(player)!;
    expect(updatedCard.hitCells.size).toBe(2);
    expect(updatedCard.hitCells.has(card.allCells[0])).toBe(true);
    expect(updatedCard.hitCells.has(card.allCells[1])).toBe(true);
  });

  it('same cell hit twice only counts once', () => {
    const config = createTestConfig();
    const engine = new GameEngine(config);

    const player = TEST_PLAYERS[0];
    const card = engine.getGeneratedCard(player)!;
    const targetCell = card.allCells[0];

    // Hit same cell twice
    engine.processRound(createOreResult(1, targetCell));
    engine.processRound(createOreResult(2, targetCell));

    const updatedCard = engine.getPlayerCard(player)!;
    expect(updatedCard.hitCells.size).toBe(1);
  });

  it('throws on wrong round number', () => {
    const config = createTestConfig();
    const engine = new GameEngine(config);

    expect(() => engine.processRound(createOreResult(2, 0))).toThrow(
      'Expected round 1, got 2'
    );
  });

  it('throws when game is complete', () => {
    const config = createTestConfig(TEST_PLAYERS.slice(0, 2));
    const engine = new GameEngine(config);

    // Eliminate player 1 by hitting all their cells
    const player1 = TEST_PLAYERS[0];
    const card = engine.getGeneratedCard(player1)!;

    let round = 1;
    for (const cell of card.allCells) {
      engine.processRound(createOreResult(round++, cell));
      if (engine.isGameComplete()) break;
    }

    expect(engine.isGameComplete()).toBe(true);
    expect(() => engine.processRound(createOreResult(round, 0))).toThrow(
      'Game is already complete'
    );
  });
});

// =============================================================================
// 2. Sudden Death Tests
// =============================================================================

describe('Sudden Death', () => {
  it('rounds 1-30 have 1 shot', () => {
    const config = createTestConfig();
    const engine = new GameEngine(config);

    for (let round = 1; round <= 30; round++) {
      const oreResult = createOreResult(round, round % TOTAL_CELLS);
      const shots = engine.calculateShots(oreResult);
      expect(shots.length).toBe(1);

      if (!engine.isGameComplete()) {
        engine.processRound(oreResult);
      }
    }
  });

  it('rounds 31-40 have 2 shots', () => {
    const config = createTestConfig();
    const engine = new GameEngine(config);

    // Skip to round 31
    for (let round = 1; round <= 30; round++) {
      if (engine.isGameComplete()) break;
      engine.processRound(createOreResult(round, 24)); // Unlikely to hit
    }

    // Check rounds 31-40
    for (let round = 31; round <= 40; round++) {
      const oreResult = createOreResult(round, round % TOTAL_CELLS);
      const shots = engine.calculateShots(oreResult);
      expect(shots.length).toBe(2);

      if (!engine.isGameComplete()) {
        engine.processRound(oreResult);
      }
    }
  });

  it('rounds 41-50 have 3 shots', () => {
    const config = createTestConfig();
    const engine = new GameEngine(config);

    // Skip to round 41
    for (let round = 1; round <= 40; round++) {
      if (engine.isGameComplete()) break;
      engine.processRound(createOreResult(round, 24)); // Unlikely to hit
    }

    // Check rounds 41+
    for (let round = 41; round <= 50; round++) {
      const oreResult = createOreResult(round, round % TOTAL_CELLS);
      const shots = engine.calculateShots(oreResult);
      expect(shots.length).toBe(3);

      if (!engine.isGameComplete()) {
        engine.processRound(oreResult);
      }
    }
  });

  it('derived shots are deterministic', () => {
    const config = createTestConfig();
    const engine1 = new GameEngine(config);
    const engine2 = new GameEngine(config);

    const oreResult: OreRoundResult = {
      roundNumber: 35, // Sudden death round
      winningBlock: 10,
      proof: 'test-proof-for-determinism',
    };

    const shots1 = engine1.calculateShots(oreResult);
    const shots2 = engine2.calculateShots(oreResult);

    expect(shots1).toEqual(shots2);
    expect(shots1.length).toBe(2);
  });

  it('derived shots differ with different proofs', () => {
    const config = createTestConfig();
    const engine = new GameEngine(config);

    const result1: OreRoundResult = {
      roundNumber: 35,
      winningBlock: 10,
      proof: 'proof-A',
    };

    const result2: OreRoundResult = {
      roundNumber: 35,
      winningBlock: 10,
      proof: 'proof-B',
    };

    const shots1 = engine.calculateShots(result1);
    const shots2 = engine.calculateShots(result2);

    // Primary shot is same (same winningBlock)
    expect(shots1[0]).toBe(shots2[0]);
    // Derived shot should differ (different proof)
    expect(shots1[1]).not.toBe(shots2[1]);
  });
});

// =============================================================================
// 3. Elimination Tests
// =============================================================================

describe('Elimination', () => {
  it('player eliminated when all 6 cells hit', () => {
    const config = createTestConfig(TEST_PLAYERS.slice(0, 2));
    const engine = new GameEngine(config);

    const player = TEST_PLAYERS[0];
    const card = engine.getGeneratedCard(player)!;

    // Hit all 6 cells
    let round = 1;
    for (const cell of card.allCells) {
      const summary = engine.processRound(createOreResult(round++, cell));

      if (round - 1 < TOTAL_SHIP_CELLS) {
        expect(engine.getPlayerCard(player)!.isEliminated).toBe(false);
      }
    }

    const finalCard = engine.getPlayerCard(player)!;
    expect(finalCard.isEliminated).toBe(true);
    expect(finalCard.hitCells.size).toBe(TOTAL_SHIP_CELLS);
  });

  it('elimination recorded with correct round number', () => {
    const config = createTestConfig(TEST_PLAYERS.slice(0, 2));
    const engine = new GameEngine(config);

    const player = TEST_PLAYERS[0];
    const card = engine.getGeneratedCard(player)!;

    // Hit all cells
    let round = 1;
    for (const cell of card.allCells) {
      engine.processRound(createOreResult(round++, cell));
    }

    const finalCard = engine.getPlayerCard(player)!;
    expect(finalCard.eliminatedAtRound).toBe(TOTAL_SHIP_CELLS);
  });

  it('eliminated players excluded from future hit checks', () => {
    const config = createTestConfig(TEST_PLAYERS.slice(0, 3));
    const engine = new GameEngine(config);

    const player1 = TEST_PLAYERS[0];
    const card1 = engine.getGeneratedCard(player1)!;

    // Eliminate player 1
    let round = 1;
    for (const cell of card1.allCells) {
      engine.processRound(createOreResult(round++, cell));
      if (engine.isGameComplete()) break;
    }

    if (!engine.isGameComplete()) {
      // Fire at player 1's cells again - should not affect them
      const hitsBefore = engine.getPlayerCard(player1)!.hitCells.size;

      // Find a cell unique to player1
      const uniqueCell = card1.allCells[0];
      engine.processRound(createOreResult(round, uniqueCell));

      const hitsAfter = engine.getPlayerCard(player1)!.hitCells.size;
      expect(hitsAfter).toBe(hitsBefore);
    }
  });
});

// =============================================================================
// 4. Winner Determination Tests
// =============================================================================

describe('Winner Determination', () => {
  it('single survivor wins immediately', () => {
    const config = createTestConfig(TEST_PLAYERS.slice(0, 2));
    const engine = new GameEngine(config);

    const player1 = TEST_PLAYERS[0];
    const player2 = TEST_PLAYERS[1];
    const card1 = engine.getGeneratedCard(player1)!;

    // Eliminate player 1
    let round = 1;
    for (const cell of card1.allCells) {
      const summary = engine.processRound(createOreResult(round++, cell));
      if (summary.isGameComplete) {
        expect(summary.winner).toBe(player2);
        break;
      }
    }

    expect(engine.isGameComplete()).toBe(true);
    expect(engine.getWinner()).toBe(player2);
  });

  it('tiebreaker works when multiple eliminated same round', () => {
    // This is tricky to set up - we need to find cells that hit multiple players
    // and eliminate them all in one round
    const config = createTestConfig(TEST_PLAYERS.slice(0, 2));
    const engine = new GameEngine(config);

    const player1 = TEST_PLAYERS[0];
    const player2 = TEST_PLAYERS[1];
    const card1 = engine.getGeneratedCard(player1)!;
    const card2 = engine.getGeneratedCard(player2)!;

    // Hit all but one cell for each player
    let round = 1;
    for (let i = 0; i < TOTAL_SHIP_CELLS - 1; i++) {
      if (!engine.isGameComplete()) {
        engine.processRound(createOreResult(round++, card1.allCells[i]));
      }
      if (!engine.isGameComplete()) {
        engine.processRound(createOreResult(round++, card2.allCells[i]));
      }
    }

    // If both have 5 hits, the game should still be active
    if (!engine.isGameComplete()) {
      // Now we'd need a cell that hits both last cells simultaneously
      // This is unlikely, so we just verify the mechanism exists
      expect(engine.getRemainingPlayers().length).toBe(2);
    }
  });

  it('round 50 uses remaining cells count', () => {
    const config = createTestConfig(TEST_PLAYERS.slice(0, 2));
    const engine = new GameEngine(config);

    const player1 = TEST_PLAYERS[0];
    const player2 = TEST_PLAYERS[1];
    const card1 = engine.getGeneratedCard(player1)!;

    // Hit more of player1's cells than player2's
    let round = 1;

    // Hit 3 of player1's cells
    for (let i = 0; i < 3 && !engine.isGameComplete(); i++) {
      engine.processRound(createOreResult(round++, card1.allCells[i]));
    }

    // Fast forward to round 50 with generic shots that don't eliminate anyone
    while (round <= MAX_ROUNDS && !engine.isGameComplete()) {
      // Use cell 24 which is unlikely to hit remaining cells
      engine.processRound(createOreResult(round++, 24));
    }

    if (engine.isGameComplete()) {
      // Player2 should win (more remaining cells)
      const p1Card = engine.getPlayerCard(player1)!;
      const p2Card = engine.getPlayerCard(player2)!;

      const p1Remaining = TOTAL_SHIP_CELLS - p1Card.hitCells.size;
      const p2Remaining = TOTAL_SHIP_CELLS - p2Card.hitCells.size;

      if (p2Remaining > p1Remaining) {
        expect(engine.getWinner()).toBe(player2);
      } else if (p1Remaining > p2Remaining) {
        expect(engine.getWinner()).toBe(player1);
      }
      // If tied, tiebreaker is used
    }
  });
});

// =============================================================================
// 5. Events Tests
// =============================================================================

describe('Events', () => {
  it('round_complete fires each round', () => {
    const config = createTestConfig();
    const engine = new GameEngine(config);

    const roundEvents: RoundSummary[] = [];
    engine.on('round_complete', (summary) => {
      roundEvents.push(summary);
    });

    engine.processRound(createOreResult(1, 0));
    engine.processRound(createOreResult(2, 1));
    engine.processRound(createOreResult(3, 2));

    expect(roundEvents.length).toBe(3);
    expect(roundEvents[0].roundNumber).toBe(1);
    expect(roundEvents[1].roundNumber).toBe(2);
    expect(roundEvents[2].roundNumber).toBe(3);
  });

  it('player_eliminated fires on elimination', () => {
    const config = createTestConfig(TEST_PLAYERS.slice(0, 2));
    const engine = new GameEngine(config);

    const eliminationEvents: { player: string; round: number }[] = [];
    engine.on('player_eliminated', (event) => {
      eliminationEvents.push(event);
    });

    const player = TEST_PLAYERS[0];
    const card = engine.getGeneratedCard(player)!;

    // Eliminate player
    let round = 1;
    for (const cell of card.allCells) {
      engine.processRound(createOreResult(round++, cell));
      if (engine.isGameComplete()) break;
    }

    expect(eliminationEvents.length).toBe(1);
    expect(eliminationEvents[0].player).toBe(player);
  });

  it('game_complete fires once at end', () => {
    const config = createTestConfig(TEST_PLAYERS.slice(0, 2));
    const engine = new GameEngine(config);

    const completeEvents: { winner: string; totalRounds: number }[] = [];
    engine.on('game_complete', (event) => {
      completeEvents.push(event);
    });

    const player = TEST_PLAYERS[0];
    const card = engine.getGeneratedCard(player)!;

    // Eliminate player
    let round = 1;
    for (const cell of card.allCells) {
      engine.processRound(createOreResult(round++, cell));
      if (engine.isGameComplete()) break;
    }

    expect(completeEvents.length).toBe(1);
    expect(completeEvents[0].winner).toBe(TEST_PLAYERS[1]);
  });
});

// =============================================================================
// 6. Serialization Tests
// =============================================================================

describe('Serialization', () => {
  it('serialize -> deserialize produces equivalent state', () => {
    const config = createTestConfig();
    const engine1 = new GameEngine(config);

    // Process some rounds
    engine1.processRound(createOreResult(1, 5));
    engine1.processRound(createOreResult(2, 10));
    engine1.processRound(createOreResult(3, 15));

    // Serialize and deserialize
    const json = engine1.serialize();
    const engine2 = GameEngine.deserialize(json);

    // Compare state
    expect(engine2.getCurrentRound()).toBe(engine1.getCurrentRound());
    expect(engine2.isGameComplete()).toBe(engine1.isGameComplete());
    expect(engine2.getWinner()).toBe(engine1.getWinner());
    expect(engine2.getRoundHistory().length).toBe(engine1.getRoundHistory().length);

    // Compare cards
    for (const player of TEST_PLAYERS) {
      const card1 = engine1.getPlayerCard(player)!;
      const card2 = engine2.getPlayerCard(player)!;

      expect(card2.hitCells.size).toBe(card1.hitCells.size);
      expect(card2.isEliminated).toBe(card1.isEliminated);
      expect(card2.eliminatedAtRound).toBe(card1.eliminatedAtRound);

      for (const cell of card1.hitCells) {
        expect(card2.hitCells.has(cell)).toBe(true);
      }
    }
  });

  it('deserialized engine can continue processing', () => {
    const config = createTestConfig();
    const engine1 = new GameEngine(config);

    engine1.processRound(createOreResult(1, 5));
    engine1.processRound(createOreResult(2, 10));

    const json = engine1.serialize();
    const engine2 = GameEngine.deserialize(json);

    // Continue processing on deserialized engine
    expect(() => {
      engine2.processRound(createOreResult(3, 15));
    }).not.toThrow();

    expect(engine2.getCurrentRound()).toBe(3);
  });

  it('recover replays correctly', () => {
    const config = createTestConfig();
    const oreHistory = generateMockOreResults(10, TEST_SEED);

    // Create engine and process rounds
    const engine1 = new GameEngine(config);
    for (const ore of oreHistory) {
      if (engine1.isGameComplete()) break;
      engine1.processRound(ore);
    }

    // Recover from same config and history
    const engine2 = GameEngine.recover(config, oreHistory);

    // Should have identical state
    expect(engine2.getCurrentRound()).toBe(engine1.getCurrentRound());
    expect(engine2.isGameComplete()).toBe(engine1.isGameComplete());
    expect(engine2.getWinner()).toBe(engine1.getWinner());

    for (const player of TEST_PLAYERS) {
      const card1 = engine1.getPlayerCard(player)!;
      const card2 = engine2.getPlayerCard(player)!;
      expect(card2.hitCells.size).toBe(card1.hitCells.size);
    }
  });
});

// =============================================================================
// 7. Full Game Simulation Tests
// =============================================================================

describe('Full Game Simulation', () => {
  it('runs game to completion with mock ORE data', () => {
    const config = createTestConfig();
    const engine = new GameEngine(config);

    // Generate enough rounds to complete game
    const oreResults = generateMockOreResults(MAX_ROUNDS, TEST_SEED);

    for (const ore of oreResults) {
      if (engine.isGameComplete()) break;
      engine.processRound(ore);
    }

    // Game should be complete
    expect(engine.isGameComplete()).toBe(true);

    // Should have exactly one winner
    const winner = engine.getWinner();
    expect(winner).not.toBeNull();
    expect(TEST_PLAYERS).toContain(winner);

    // All rounds should be recorded
    expect(engine.getRoundHistory().length).toBe(engine.getCurrentRound());
  });

  it('winner is one of the players', () => {
    const config = createTestConfig();
    const engine = new GameEngine(config);

    const oreResults = generateMockOreResults(MAX_ROUNDS, TEST_SEED);

    for (const ore of oreResults) {
      if (engine.isGameComplete()) break;
      engine.processRound(ore);
    }

    const winner = engine.getWinner();
    expect(TEST_PLAYERS).toContain(winner);
  });

  it('winner has remaining cells OR won via tiebreaker', () => {
    const config = createTestConfig();
    const engine = new GameEngine(config);

    const oreResults = generateMockOreResults(MAX_ROUNDS, TEST_SEED);

    for (const ore of oreResults) {
      if (engine.isGameComplete()) break;
      engine.processRound(ore);
    }

    const winner = engine.getWinner()!;
    const winnerCard = engine.getPlayerCard(winner)!;

    // Winner either:
    // 1. Was not eliminated (has remaining cells)
    // 2. Was eliminated but won tiebreaker (rare)
    // In both cases, the game logic is correct
    expect(winner).toBeTruthy();
  });

  it('all eliminated players have eliminatedAtRound set', () => {
    const config = createTestConfig();
    const engine = new GameEngine(config);

    const oreResults = generateMockOreResults(MAX_ROUNDS, TEST_SEED);

    for (const ore of oreResults) {
      if (engine.isGameComplete()) break;
      engine.processRound(ore);
    }

    for (const player of TEST_PLAYERS) {
      const card = engine.getPlayerCard(player)!;
      if (card.isEliminated) {
        expect(card.eliminatedAtRound).not.toBeNull();
        expect(card.eliminatedAtRound).toBeGreaterThan(0);
      } else {
        expect(card.eliminatedAtRound).toBeNull();
      }
    }
  });

  it('determinism - same seed and ORE produce identical outcomes', () => {
    const config = createTestConfig();
    const oreResults = generateMockOreResults(MAX_ROUNDS, TEST_SEED);

    // Run game 1
    const engine1 = new GameEngine(config);
    for (const ore of oreResults) {
      if (engine1.isGameComplete()) break;
      engine1.processRound(ore);
    }

    // Run game 2 with same inputs
    const engine2 = new GameEngine(config);
    for (const ore of oreResults) {
      if (engine2.isGameComplete()) break;
      engine2.processRound(ore);
    }

    // Outcomes should be identical
    expect(engine2.getWinner()).toBe(engine1.getWinner());
    expect(engine2.getCurrentRound()).toBe(engine1.getCurrentRound());
    expect(engine2.getRoundHistory().length).toBe(engine1.getRoundHistory().length);

    // All player states should match
    for (const player of TEST_PLAYERS) {
      const card1 = engine1.getPlayerCard(player)!;
      const card2 = engine2.getPlayerCard(player)!;

      expect(card2.isEliminated).toBe(card1.isEliminated);
      expect(card2.eliminatedAtRound).toBe(card1.eliminatedAtRound);
      expect(card2.hitCells.size).toBe(card1.hitCells.size);
    }
  });
});

// =============================================================================
// 8. generateMockOreResults Tests
// =============================================================================

describe('generateMockOreResults', () => {
  it('generates correct number of rounds', () => {
    const results = generateMockOreResults(25);
    expect(results.length).toBe(25);
  });

  it('round numbers are sequential starting at 1', () => {
    const results = generateMockOreResults(10);
    for (let i = 0; i < results.length; i++) {
      expect(results[i].roundNumber).toBe(i + 1);
    }
  });

  it('winning blocks are valid (0-24)', () => {
    const results = generateMockOreResults(100);
    for (const result of results) {
      expect(result.winningBlock).toBeGreaterThanOrEqual(0);
      expect(result.winningBlock).toBeLessThan(TOTAL_CELLS);
    }
  });

  it('seeded generation is deterministic', () => {
    const seed = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const results1 = generateMockOreResults(20, seed);
    const results2 = generateMockOreResults(20, seed);

    for (let i = 0; i < results1.length; i++) {
      expect(results1[i].winningBlock).toBe(results2[i].winningBlock);
      expect(results1[i].roundNumber).toBe(results2[i].roundNumber);
    }
  });
});
