import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';
import type { Express } from 'express';
import type { Server } from 'http';
import type { GameManager } from '../src/game-manager.js';

// =============================================================================
// Test Setup
// =============================================================================

describe('API Routes', () => {
  let app: Express;
  let server: Server;
  let gameManager: GameManager;

  beforeEach(() => {
    vi.useFakeTimers();
    const result = createApp();
    app = result.app;
    server = result.server;
    gameManager = result.gameManager;
  });

  afterEach(() => {
    vi.useRealTimers();
    server.close();
  });

  // ===========================================================================
  // Health Check
  // ===========================================================================

  describe('GET /api/health', () => {
    it('returns ok status', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.uptime).toBeDefined();
    });
  });

  // ===========================================================================
  // Create Game
  // ===========================================================================

  describe('POST /api/games', () => {
    it('creates a game', async () => {
      const res = await request(app)
        .post('/api/games')
        .send({ gameId: 'test-game' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.gameId).toBe('test-game');
      expect(res.body.seed).toBeDefined();
      expect(res.body.seed.length).toBe(64); // hex-encoded 32 bytes
    });

    it('rejects missing gameId', async () => {
      const res = await request(app).post('/api/games').send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('gameId is required');
    });

    it('rejects long gameId', async () => {
      const res = await request(app)
        .post('/api/games')
        .send({ gameId: 'a'.repeat(33) });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('gameId must be 32 characters or less');
    });

    it('rejects duplicate gameId', async () => {
      await request(app).post('/api/games').send({ gameId: 'test-game' });

      const res = await request(app)
        .post('/api/games')
        .send({ gameId: 'test-game' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });
  });

  // ===========================================================================
  // List Games
  // ===========================================================================

  describe('GET /api/games', () => {
    it('returns empty array initially', async () => {
      const res = await request(app).get('/api/games');

      expect(res.status).toBe(200);
      expect(res.body.games).toEqual([]);
    });

    it('returns created games', async () => {
      await request(app).post('/api/games').send({ gameId: 'game-1' });
      await request(app).post('/api/games').send({ gameId: 'game-2' });

      const res = await request(app).get('/api/games');

      expect(res.status).toBe(200);
      expect(res.body.games.length).toBe(2);
    });
  });

  // ===========================================================================
  // Get Game Status
  // ===========================================================================

  describe('GET /api/games/:gameId', () => {
    it('returns game status', async () => {
      await request(app).post('/api/games').send({ gameId: 'test-game' });

      const res = await request(app).get('/api/games/test-game');

      expect(res.status).toBe(200);
      expect(res.body.gameId).toBe('test-game');
      expect(res.body.status).toBe('waiting');
      expect(res.body.players).toEqual([]);
    });

    it('returns 404 for non-existent game', async () => {
      const res = await request(app).get('/api/games/no-such-game');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Game not found');
    });
  });

  // ===========================================================================
  // Join Game
  // ===========================================================================

  describe('POST /api/games/:gameId/join', () => {
    beforeEach(async () => {
      await request(app).post('/api/games').send({ gameId: 'test-game' });
    });

    it('joins a game', async () => {
      const res = await request(app)
        .post('/api/games/test-game/join')
        .send({ playerWallet: 'wallet-1' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.playerIndex).toBe(0);
    });

    it('rejects missing playerWallet', async () => {
      const res = await request(app)
        .post('/api/games/test-game/join')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('playerWallet is required');
    });

    it('rejects non-existent game', async () => {
      const res = await request(app)
        .post('/api/games/no-such-game/join')
        .send({ playerWallet: 'wallet-1' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ===========================================================================
  // Start Game
  // ===========================================================================

  describe('POST /api/games/:gameId/start', () => {
    beforeEach(async () => {
      await request(app).post('/api/games').send({ gameId: 'test-game' });
      await request(app)
        .post('/api/games/test-game/join')
        .send({ playerWallet: 'wallet-1' });
      await request(app)
        .post('/api/games/test-game/join')
        .send({ playerWallet: 'wallet-2' });
    });

    it('starts a game', async () => {
      const res = await request(app).post('/api/games/test-game/start');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const statusRes = await request(app).get('/api/games/test-game');
      expect(statusRes.body.status).toBe('active');
    });

    it('rejects starting with too few players', async () => {
      await request(app).post('/api/games').send({ gameId: 'game-2' });
      await request(app)
        .post('/api/games/game-2/join')
        .send({ playerWallet: 'wallet-1' });

      const res = await request(app).post('/api/games/game-2/start');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ===========================================================================
  // Cancel Game
  // ===========================================================================

  describe('POST /api/games/:gameId/cancel', () => {
    it('cancels a waiting game', async () => {
      await request(app).post('/api/games').send({ gameId: 'test-game' });

      const res = await request(app).post('/api/games/test-game/cancel');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const statusRes = await request(app).get('/api/games/test-game');
      expect(statusRes.body.status).toBe('cancelled');
    });
  });

  // ===========================================================================
  // Player Card
  // ===========================================================================

  describe('GET /api/games/:gameId/players/:wallet', () => {
    beforeEach(async () => {
      await request(app).post('/api/games').send({ gameId: 'test-game' });
      await request(app)
        .post('/api/games/test-game/join')
        .send({ playerWallet: 'wallet-1' });
      await request(app)
        .post('/api/games/test-game/join')
        .send({ playerWallet: 'wallet-2' });
      await request(app).post('/api/games/test-game/start');
    });

    it('returns player card', async () => {
      const res = await request(app).get('/api/games/test-game/players/wallet-1');

      expect(res.status).toBe(200);
      expect(res.body.playerId).toBe('wallet-1');
      expect(res.body.ships.length).toBe(3);
      expect(res.body.allCells.length).toBe(6);
    });

    it('returns 404 for non-player', async () => {
      const res = await request(app).get(
        '/api/games/test-game/players/not-a-player'
      );

      expect(res.status).toBe(404);
    });
  });

  // ===========================================================================
  // Game Seed
  // ===========================================================================

  describe('GET /api/games/:gameId/seed', () => {
    it('returns game seed', async () => {
      await request(app).post('/api/games').send({ gameId: 'test-game' });

      const res = await request(app).get('/api/games/test-game/seed');

      expect(res.status).toBe(200);
      expect(res.body.seed).toBeDefined();
      expect(res.body.seed.length).toBe(64);
    });

    it('returns 404 for non-existent game', async () => {
      const res = await request(app).get('/api/games/no-such-game/seed');

      expect(res.status).toBe(404);
    });
  });

  // ===========================================================================
  // Trigger Round (Dev Only)
  // ===========================================================================

  describe('POST /api/games/:gameId/trigger-round', () => {
    beforeEach(async () => {
      await request(app).post('/api/games').send({ gameId: 'test-game' });
      await request(app)
        .post('/api/games/test-game/join')
        .send({ playerWallet: 'wallet-1' });
      await request(app)
        .post('/api/games/test-game/join')
        .send({ playerWallet: 'wallet-2' });
      await request(app).post('/api/games/test-game/start');
    });

    it('triggers a round', async () => {
      const res = await request(app)
        .post('/api/games/test-game/trigger-round')
        .send({ winningBlock: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const statusRes = await request(app).get('/api/games/test-game');
      expect(statusRes.body.currentRound).toBe(1);
    });
  });
});
