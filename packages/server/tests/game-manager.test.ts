import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GameManager } from '../src/game-manager.js';

// =============================================================================
// Test Setup
// =============================================================================

describe('GameManager', () => {
  let manager: GameManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new GameManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================================================
  // Create Game
  // ===========================================================================

  describe('createGame', () => {
    it('creates a game successfully', () => {
      const result = manager.createGame('test-game-1');

      expect(result.success).toBe(true);
      expect(result.seed).toBeDefined();
      expect(result.seed).toBeInstanceOf(Uint8Array);
      expect(result.seed!.length).toBe(32);
    });

    it('generates unique seeds for different games', () => {
      const result1 = manager.createGame('game-1');
      const result2 = manager.createGame('game-2');

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      const seed1Hex = Buffer.from(result1.seed!).toString('hex');
      const seed2Hex = Buffer.from(result2.seed!).toString('hex');
      expect(seed1Hex).not.toBe(seed2Hex);
    });

    it('rejects duplicate game IDs', () => {
      manager.createGame('test-game');
      const result = manager.createGame('test-game');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Game already exists');
    });

    it('emits game_created event', () => {
      const handler = vi.fn();
      manager.on('game_created', handler);

      manager.createGame('test-game');

      expect(handler).toHaveBeenCalledWith({
        gameId: 'test-game',
        maxPlayers: 10,
      });
    });
  });

  // ===========================================================================
  // Join Game
  // ===========================================================================

  describe('joinGame', () => {
    beforeEach(() => {
      manager.createGame('test-game');
    });

    it('adds player to game', () => {
      const result = manager.joinGame('test-game', 'wallet-1');

      expect(result.success).toBe(true);
      expect(result.playerIndex).toBe(0);
    });

    it('assigns sequential player indices', () => {
      const r1 = manager.joinGame('test-game', 'wallet-1');
      const r2 = manager.joinGame('test-game', 'wallet-2');
      const r3 = manager.joinGame('test-game', 'wallet-3');

      expect(r1.playerIndex).toBe(0);
      expect(r2.playerIndex).toBe(1);
      expect(r3.playerIndex).toBe(2);
    });

    it('rejects non-existent game', () => {
      const result = manager.joinGame('no-such-game', 'wallet-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Game not found');
    });

    it('rejects duplicate player', () => {
      manager.joinGame('test-game', 'wallet-1');
      const result = manager.joinGame('test-game', 'wallet-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Player already joined');
    });

    it('rejects when game is full', () => {
      for (let i = 0; i < 10; i++) {
        manager.joinGame('test-game', `wallet-${i}`);
      }

      const result = manager.joinGame('test-game', 'wallet-extra');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Game is full');
    });

    it('emits player_joined event', () => {
      const handler = vi.fn();
      manager.on('player_joined', handler);

      manager.joinGame('test-game', 'wallet-1');

      expect(handler).toHaveBeenCalledWith({
        gameId: 'test-game',
        playerWallet: 'wallet-1',
        playerIndex: 0,
      });
    });
  });

  // ===========================================================================
  // Start Game
  // ===========================================================================

  describe('startGame', () => {
    beforeEach(() => {
      manager.createGame('test-game');
    });

    it('starts game with enough players', () => {
      manager.joinGame('test-game', 'wallet-1');
      manager.joinGame('test-game', 'wallet-2');

      const result = manager.startGame('test-game');

      expect(result.success).toBe(true);
    });

    it('rejects with only 1 player', () => {
      manager.joinGame('test-game', 'wallet-1');

      const result = manager.startGame('test-game');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Need at least 2 players to start');
    });

    it('rejects non-existent game', () => {
      const result = manager.startGame('no-such-game');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Game not found');
    });

    it('rejects starting an already active game', () => {
      manager.joinGame('test-game', 'wallet-1');
      manager.joinGame('test-game', 'wallet-2');
      manager.startGame('test-game');

      const result = manager.startGame('test-game');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Game is not in waiting state');
    });

    it('emits game_started event', () => {
      const handler = vi.fn();
      manager.on('game_started', handler);

      manager.joinGame('test-game', 'wallet-1');
      manager.joinGame('test-game', 'wallet-2');
      manager.startGame('test-game');

      expect(handler).toHaveBeenCalledWith({
        gameId: 'test-game',
        players: ['wallet-1', 'wallet-2'],
      });
    });

    it('prevents new players after start', () => {
      manager.joinGame('test-game', 'wallet-1');
      manager.joinGame('test-game', 'wallet-2');
      manager.startGame('test-game');

      const result = manager.joinGame('test-game', 'wallet-3');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Game is not accepting players');
    });
  });

  // ===========================================================================
  // Game Status
  // ===========================================================================

  describe('getGameStatus', () => {
    it('returns null for non-existent game', () => {
      const status = manager.getGameStatus('no-such-game');
      expect(status).toBeNull();
    });

    it('returns waiting status for new game', () => {
      manager.createGame('test-game');

      const status = manager.getGameStatus('test-game');

      expect(status).not.toBeNull();
      expect(status!.gameId).toBe('test-game');
      expect(status!.status).toBe('waiting');
      expect(status!.players).toEqual([]);
      expect(status!.currentRound).toBe(0);
    });

    it('includes players after joining', () => {
      manager.createGame('test-game');
      manager.joinGame('test-game', 'wallet-1');
      manager.joinGame('test-game', 'wallet-2');

      const status = manager.getGameStatus('test-game');

      expect(status!.players).toEqual(['wallet-1', 'wallet-2']);
    });

    it('returns active status after start', () => {
      manager.createGame('test-game');
      manager.joinGame('test-game', 'wallet-1');
      manager.joinGame('test-game', 'wallet-2');
      manager.startGame('test-game');

      const status = manager.getGameStatus('test-game');

      expect(status!.status).toBe('active');
      expect(status!.startedAt).not.toBeNull();
    });
  });

  // ===========================================================================
  // Cancel Game
  // ===========================================================================

  describe('cancelGame', () => {
    it('cancels a waiting game', () => {
      manager.createGame('test-game');

      const result = manager.cancelGame('test-game');

      expect(result.success).toBe(true);

      const status = manager.getGameStatus('test-game');
      expect(status!.status).toBe('cancelled');
    });

    it('rejects cancelling active game without force', () => {
      manager.createGame('test-game');
      manager.joinGame('test-game', 'wallet-1');
      manager.joinGame('test-game', 'wallet-2');
      manager.startGame('test-game');

      const result = manager.cancelGame('test-game');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot cancel active game without force');
    });

    it('force cancels active game', () => {
      manager.createGame('test-game');
      manager.joinGame('test-game', 'wallet-1');
      manager.joinGame('test-game', 'wallet-2');
      manager.startGame('test-game');

      const result = manager.cancelGame('test-game', true);

      expect(result.success).toBe(true);

      const status = manager.getGameStatus('test-game');
      expect(status!.status).toBe('cancelled');
    });
  });

  // ===========================================================================
  // Active Games
  // ===========================================================================

  describe('getActiveGames', () => {
    it('returns empty array with no games', () => {
      const games = manager.getActiveGames();
      expect(games).toEqual([]);
    });

    it('returns waiting and active games', () => {
      manager.createGame('game-1');
      manager.createGame('game-2');
      manager.joinGame('game-2', 'wallet-1');
      manager.joinGame('game-2', 'wallet-2');
      manager.startGame('game-2');

      const games = manager.getActiveGames();

      expect(games.length).toBe(2);
      expect(games.map((g) => g.gameId).sort()).toEqual(['game-1', 'game-2']);
    });

    it('excludes cancelled games', () => {
      manager.createGame('game-1');
      manager.createGame('game-2');
      manager.cancelGame('game-1');

      const games = manager.getActiveGames();

      expect(games.length).toBe(1);
      expect(games[0].gameId).toBe('game-2');
    });
  });

  // ===========================================================================
  // Player Card
  // ===========================================================================

  describe('getPlayerCard', () => {
    it('returns null for non-started game', () => {
      manager.createGame('test-game');
      manager.joinGame('test-game', 'wallet-1');

      const card = manager.getPlayerCard('test-game', 'wallet-1');

      expect(card).toBeNull();
    });

    it('returns card after game starts', () => {
      manager.createGame('test-game');
      manager.joinGame('test-game', 'wallet-1');
      manager.joinGame('test-game', 'wallet-2');
      manager.startGame('test-game');

      const card = manager.getPlayerCard('test-game', 'wallet-1');

      expect(card).not.toBeNull();
      expect(card!.playerId).toBe('wallet-1');
      expect(card!.ships.length).toBe(3);
      expect(card!.allCells.length).toBe(6);
      expect(card!.hitCells).toEqual([]);
      expect(card!.isEliminated).toBe(false);
    });

    it('returns null for non-player', () => {
      manager.createGame('test-game');
      manager.joinGame('test-game', 'wallet-1');
      manager.joinGame('test-game', 'wallet-2');
      manager.startGame('test-game');

      const card = manager.getPlayerCard('test-game', 'not-a-player');

      expect(card).toBeNull();
    });
  });

  // ===========================================================================
  // Trigger Round
  // ===========================================================================

  describe('triggerRound', () => {
    beforeEach(() => {
      manager.createGame('test-game');
      manager.joinGame('test-game', 'wallet-1');
      manager.joinGame('test-game', 'wallet-2');
    });

    it('triggers round for active game', () => {
      manager.startGame('test-game');

      const result = manager.triggerRound('test-game', 0);

      expect(result).toBe(true);

      const status = manager.getGameStatus('test-game');
      expect(status!.currentRound).toBe(1);
    });

    it('returns false for non-started game', () => {
      const result = manager.triggerRound('test-game');
      expect(result).toBe(false);
    });

    it('emits round_complete event', () => {
      const handler = vi.fn();
      manager.on('round_complete', handler);

      manager.startGame('test-game');
      manager.triggerRound('test-game', 0);

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0].gameId).toBe('test-game');
      expect(handler.mock.calls[0][0].summary.roundNumber).toBe(1);
    });
  });

  // ===========================================================================
  // Full Game Simulation
  // ===========================================================================

  describe('Full Game Simulation', () => {
    it('plays through to completion', () => {
      manager.createGame('test-game');
      manager.joinGame('test-game', 'wallet-1');
      manager.joinGame('test-game', 'wallet-2');
      manager.startGame('test-game');

      const gameCompleteHandler = vi.fn();
      manager.on('game_complete', gameCompleteHandler);

      // Trigger rounds until game completes
      for (let i = 0; i < 50; i++) {
        const status = manager.getGameStatus('test-game');
        if (status!.status === 'complete') break;
        manager.triggerRound('test-game');
      }

      expect(gameCompleteHandler).toHaveBeenCalled();

      const status = manager.getGameStatus('test-game');
      expect(status!.status).toBe('complete');
      expect(status!.winner).not.toBeNull();
      expect(['wallet-1', 'wallet-2']).toContain(status!.winner);
    });

    it('tracks eliminations', () => {
      manager.createGame('test-game');
      manager.joinGame('test-game', 'wallet-1');
      manager.joinGame('test-game', 'wallet-2');
      manager.startGame('test-game');

      const eliminatedHandler = vi.fn();
      manager.on('player_eliminated', eliminatedHandler);

      // Trigger rounds until game completes
      for (let i = 0; i < 50; i++) {
        const status = manager.getGameStatus('test-game');
        if (status!.status === 'complete') break;
        manager.triggerRound('test-game');
      }

      // At least one player should be eliminated (the loser)
      expect(eliminatedHandler.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
