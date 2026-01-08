// Battle Dinghy - Admin Routes
//
// Protected routes for game management dashboard.

import { Router, Request, Response } from 'express';
import type { GameManager } from './game-manager.js';
import type { TwitterBot, GameAnnouncement } from './twitter-bot.js';
import type { GameOrchestrator } from './orchestrator.js';

// =============================================================================
// Types
// =============================================================================

export interface CreateAndPostRequest {
  entryFeeSol: number;
  maxPlayers: number;
  fillDeadlineMinutes?: number;
  customMessage?: string;
}

export interface CreateAndPostResponse {
  success: boolean;
  gameId?: string;
  tweetId?: string;
  tweetUrl?: string;
  tweetText?: string;
  error?: string;
}

export interface TweetPreviewRequest {
  entryFeeSol: number;
  maxPlayers: number;
  fillDeadlineMinutes?: number;
  customMessage?: string;
}

export interface TweetPreviewResponse {
  text: string;
  characterCount: number;
  blinkUrl: string;
}

// =============================================================================
// Route Factory
// =============================================================================

export function createAdminRoutes(
  gameManager: GameManager,
  twitterBot: TwitterBot | null,
  baseUrl: string,
  orchestrator?: GameOrchestrator | null
): Router {
  const router = Router();

  // ===========================================================================
  // Status
  // ===========================================================================

  /**
   * GET /admin/status - Get system status for admin dashboard
   */
  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      twitter: {
        configured: twitterBot !== null,
        hasApiKey: !!process.env.TWITTER_APP_KEY,
        hasApiSecret: !!process.env.TWITTER_APP_SECRET,
        hasAccessToken: !!process.env.TWITTER_ACCESS_TOKEN,
        hasAccessSecret: !!process.env.TWITTER_ACCESS_SECRET,
      },
      server: {
        baseUrl,
        uptime: process.uptime(),
      },
    });
  });

  // ===========================================================================
  // Tweet Preview
  // ===========================================================================

  /**
   * POST /admin/preview-tweet - Generate tweet preview without posting
   */
  router.post('/preview-tweet', (req: Request, res: Response) => {
    const body = req.body as TweetPreviewRequest;

    // Validate inputs
    if (!body.entryFeeSol || body.entryFeeSol < 0.0001) {
      res.status(400).json({ error: 'entryFeeSol must be at least 0.0001' });
      return;
    }

    if (!body.maxPlayers || body.maxPlayers < 2 || body.maxPlayers > 100) {
      res.status(400).json({ error: 'maxPlayers must be between 2 and 100' });
      return;
    }

    // Generate a placeholder game ID for preview
    const previewGameId = 'GAME_ID';
    const blinkUrl = `${baseUrl}/blinks/join/${previewGameId}`;
    const fillDeadlineMinutes = body.fillDeadlineMinutes || 60;

    // Format deadline display
    let deadlineText = '';
    if (fillDeadlineMinutes >= 60) {
      const hours = Math.floor(fillDeadlineMinutes / 60);
      deadlineText = `${hours} hour${hours > 1 ? 's' : ''}`;
    } else {
      deadlineText = `${fillDeadlineMinutes} min`;
    }

    // Build tweet text
    let text = '';

    if (body.customMessage && body.customMessage.trim()) {
      text += `${body.customMessage.trim()}\n\n`;
    }

    text += `⚓ BATTLE DINGHY ⚓

💰 Buy-in: ${body.entryFeeSol} SOL
👥 Max Players: ${body.maxPlayers}
⏰ Starts in: ${deadlineText}
🏆 Winner takes all!

Join the battle 👇

${blinkUrl}`;

    res.json({
      text,
      characterCount: text.length,
      blinkUrl,
    } as TweetPreviewResponse);
  });

  // ===========================================================================
  // Create & Post Game
  // ===========================================================================

  /**
   * POST /admin/games/create-and-post - Create game and post to Twitter in one action
   */
  router.post('/games/create-and-post', async (req: Request, res: Response) => {
    const body = req.body as CreateAndPostRequest;

    // Validate inputs
    if (!body.entryFeeSol || body.entryFeeSol < 0.0001) {
      res.status(400).json({
        success: false,
        error: 'entryFeeSol must be at least 0.0001',
      } as CreateAndPostResponse);
      return;
    }

    if (!body.maxPlayers || body.maxPlayers < 2 || body.maxPlayers > 100) {
      res.status(400).json({
        success: false,
        error: 'maxPlayers must be between 2 and 100',
      } as CreateAndPostResponse);
      return;
    }

    // Check Twitter is configured
    if (!twitterBot) {
      res.status(503).json({
        success: false,
        error: 'Twitter bot is not configured',
      } as CreateAndPostResponse);
      return;
    }

    // Generate a unique game ID
    const gameId = `BD-${Date.now().toString(36).toUpperCase()}`;

    // Create the game
    const buyInLamports = Math.floor(body.entryFeeSol * 1_000_000_000);
    const createResult = gameManager.createGame(gameId, {
      maxPlayers: body.maxPlayers,
      buyIn: buyInLamports,
    });

    if (!createResult.success) {
      res.status(400).json({
        success: false,
        error: createResult.error || 'Failed to create game',
      } as CreateAndPostResponse);
      return;
    }

    // Post to Twitter
    const fillDeadlineMinutes = body.fillDeadlineMinutes || 60;
    const announcement: GameAnnouncement = {
      gameId,
      buyInSol: body.entryFeeSol,
      maxPlayers: body.maxPlayers,
      fillDeadlineMinutes,
      customMessage: body.customMessage,
    };

    try {
      const tweetId = await twitterBot.announceNewGame(announcement);

      if (!tweetId) {
        // Game was created but tweet failed - still return success but note the issue
        res.status(200).json({
          success: true,
          gameId,
          error: 'Game created but tweet failed to post',
        } as CreateAndPostResponse);
        return;
      }

      // Build the tweet preview text for the response
      const { text: tweetText } = twitterBot.generateTweetPreview(announcement);

      res.status(201).json({
        success: true,
        gameId,
        tweetId,
        tweetUrl: `https://twitter.com/battle_dinghy/status/${tweetId}`,
        tweetText,
      } as CreateAndPostResponse);
    } catch (error) {
      console.error('Error posting tweet:', error);
      res.status(200).json({
        success: true,
        gameId,
        error: 'Game created but tweet failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
      } as CreateAndPostResponse);
    }
  });

  // ===========================================================================
  // Test Twitter
  // ===========================================================================

  /**
   * POST /admin/test-twitter - Post a test tweet
   */
  router.post('/test-twitter', async (_req: Request, res: Response) => {
    if (!twitterBot) {
      res.status(503).json({
        success: false,
        error: 'Twitter bot is not configured',
      });
      return;
    }

    try {
      // We need to access the client directly for a test tweet
      // For now, just verify the bot exists
      res.json({
        success: true,
        message: 'Twitter bot is configured and ready',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // ===========================================================================
  // List Games
  // ===========================================================================

  /**
   * GET /admin/games - List all games (including completed)
   */
  router.get('/games', (_req: Request, res: Response) => {
    const games = gameManager.getActiveGames();
    res.json({ games });
  });

  // ===========================================================================
  // Payout Management (Manual Payout Flow for Pilot)
  // ===========================================================================

  /**
   * GET /admin/payouts/pending - List all games pending payout
   */
  router.get('/payouts/pending', (_req: Request, res: Response) => {
    if (!orchestrator) {
      res.status(503).json({
        success: false,
        error: 'Orchestrator not configured - escrow wallet required',
      });
      return;
    }

    const pendingPayouts = orchestrator.getPendingPayouts();
    res.json({
      success: true,
      payouts: pendingPayouts,
      count: pendingPayouts.length,
    });
  });

  /**
   * GET /admin/payouts/:gameId - Get payout details for a specific game
   */
  router.get('/payouts/:gameId', (req: Request, res: Response) => {
    if (!orchestrator) {
      res.status(503).json({
        success: false,
        error: 'Orchestrator not configured - escrow wallet required',
      });
      return;
    }

    const { gameId } = req.params;
    const details = orchestrator.getPayoutDetails(gameId);

    if (!details.success) {
      res.status(400).json(details);
      return;
    }

    res.json(details);
  });

  /**
   * POST /admin/payouts/:gameId/mark-paid - Mark a game as paid after manual transfer
   * Body: { txSignature?: string } - Optional transaction signature for record-keeping
   */
  router.post('/payouts/:gameId/mark-paid', (req: Request, res: Response) => {
    if (!orchestrator) {
      res.status(503).json({
        success: false,
        error: 'Orchestrator not configured - escrow wallet required',
      });
      return;
    }

    const { gameId } = req.params;
    const { txSignature } = req.body as { txSignature?: string };

    const result = orchestrator.markGamePaid(gameId, txSignature);

    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    res.json({
      success: true,
      message: `Game ${gameId} marked as paid`,
      txSignature: txSignature || null,
    });
  });

  return router;
}
