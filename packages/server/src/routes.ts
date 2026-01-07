// Battle Dinghy - Express Routes

import { Router, Request, Response } from 'express';
import { CellIndex } from '@battle-dinghy/core';
import type { GameManager } from './game-manager.js';
import { renderCard } from './card-renderer.js';
import type {
  CreateGameRequest,
  CreateGameResponse,
  JoinGameRequest,
  JoinGameResponse,
  GameStatusResponse,
  PlayerCardResponse,
} from './types.js';

// =============================================================================
// Route Factory
// =============================================================================

export function createRoutes(gameManager: GameManager): Router {
  const router = Router();

  // ===========================================================================
  // Health Check
  // ===========================================================================

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      uptime: process.uptime(),
    });
  });

  // ===========================================================================
  // Game Management
  // ===========================================================================

  /**
   * POST /games - Create a new game
   */
  router.post('/games', (req: Request, res: Response) => {
    const body = req.body as CreateGameRequest;

    if (!body.gameId || typeof body.gameId !== 'string') {
      res.status(400).json({
        success: false,
        gameId: '',
        message: 'gameId is required',
      } as CreateGameResponse);
      return;
    }

    if (body.gameId.length > 32) {
      res.status(400).json({
        success: false,
        gameId: body.gameId,
        message: 'gameId must be 32 characters or less',
      } as CreateGameResponse);
      return;
    }

    const result = gameManager.createGame(body.gameId, {
      maxPlayers: body.maxPlayers,
      buyIn: body.buyIn,
    });

    if (!result.success) {
      res.status(409).json({
        success: false,
        gameId: body.gameId,
        message: result.error,
      } as CreateGameResponse);
      return;
    }

    res.status(201).json({
      success: true,
      gameId: body.gameId,
      seed: Buffer.from(result.seed!).toString('hex'),
    } as CreateGameResponse);
  });

  /**
   * GET /games - List active games
   */
  router.get('/games', (_req: Request, res: Response) => {
    const games = gameManager.getActiveGames();
    res.json({ games });
  });

  /**
   * GET /games/:gameId - Get game status
   */
  router.get('/games/:gameId', (req: Request, res: Response) => {
    const { gameId } = req.params;
    const status = gameManager.getGameStatus(gameId);

    if (!status) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    res.json(status as GameStatusResponse);
  });

  /**
   * POST /games/:gameId/join - Join a game
   */
  router.post('/games/:gameId/join', (req: Request, res: Response) => {
    const { gameId } = req.params;
    const body = req.body as JoinGameRequest;

    if (!body.playerWallet || typeof body.playerWallet !== 'string') {
      res.status(400).json({
        success: false,
        playerIndex: -1,
        message: 'playerWallet is required',
      } as JoinGameResponse);
      return;
    }

    const result = gameManager.joinGame(gameId, body.playerWallet);

    if (!result.success) {
      const statusCode = result.error === 'Game not found' ? 404 : 400;
      res.status(statusCode).json({
        success: false,
        playerIndex: -1,
        message: result.error,
      } as JoinGameResponse);
      return;
    }

    res.json({
      success: true,
      playerIndex: result.playerIndex,
    } as JoinGameResponse);
  });

  /**
   * POST /games/:gameId/start - Start a game
   */
  router.post('/games/:gameId/start', (req: Request, res: Response) => {
    const { gameId } = req.params;
    const result = gameManager.startGame(gameId);

    if (!result.success) {
      const statusCode = result.error === 'Game not found' ? 404 : 400;
      res.status(statusCode).json({
        success: false,
        message: result.error,
      });
      return;
    }

    res.json({ success: true });
  });

  /**
   * POST /games/:gameId/cancel - Cancel a game
   */
  router.post('/games/:gameId/cancel', (req: Request, res: Response) => {
    const { gameId } = req.params;
    const force = req.query.force === 'true';
    const result = gameManager.cancelGame(gameId, force);

    if (!result.success) {
      const statusCode = result.error === 'Game not found' ? 404 : 400;
      res.status(statusCode).json({
        success: false,
        message: result.error,
      });
      return;
    }

    res.json({ success: true });
  });

  /**
   * GET /games/:gameId/players/:wallet - Get player card
   */
  router.get('/games/:gameId/players/:wallet', (req: Request, res: Response) => {
    const { gameId, wallet } = req.params;
    const card = gameManager.getPlayerCard(gameId, wallet);

    if (!card) {
      res.status(404).json({ error: 'Player card not found' });
      return;
    }

    res.json(card as PlayerCardResponse);
  });

  /**
   * GET /games/:gameId/players/:wallet/image - Get player card as PNG image
   */
  router.get('/games/:gameId/players/:wallet/image', (req: Request, res: Response) => {
    const { gameId, wallet } = req.params;
    const card = gameManager.getPlayerCard(gameId, wallet);
    const status = gameManager.getGameStatus(gameId);

    if (!card || !status) {
      res.status(404).json({ error: 'Player card not found' });
      return;
    }

    const playerIndex = status.players.indexOf(wallet);

    const imageBuffer = renderCard({
      playerId: wallet,
      playerIndex,
      gameId,
      shipCells: new Set(card.allCells as CellIndex[]),
      hitCells: new Set(card.hitCells as CellIndex[]),
      isEliminated: card.isEliminated,
      currentRound: status.currentRound,
      showShips: true, // Owner can see their own ships
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', imageBuffer.length);
    res.send(imageBuffer);
  });

  /**
   * GET /games/:gameId/seed - Get game seed (for verification)
   */
  router.get('/games/:gameId/seed', (req: Request, res: Response) => {
    const { gameId } = req.params;
    const seed = gameManager.getGameSeed(gameId);

    if (!seed) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    res.json({ seed: Buffer.from(seed).toString('hex') });
  });

  // ===========================================================================
  // Testing Endpoints (only enabled in development)
  // ===========================================================================

  if (process.env.NODE_ENV !== 'production') {
    /**
     * POST /games/:gameId/trigger-round - Manually trigger a round
     */
    router.post('/games/:gameId/trigger-round', (req: Request, res: Response) => {
      const { gameId } = req.params;
      const winningBlock = req.body.winningBlock as number | undefined;

      const success = gameManager.triggerRound(gameId, winningBlock);

      if (!success) {
        res.status(404).json({ error: 'Game not found or not active' });
        return;
      }

      res.json({ success: true });
    });
  }

  return router;
}
