// Battle Dinghy - Server Entry Point
//
// Express + WebSocket server for managing Battle Dinghy games.
// Includes Blinks integration and Twitter bot for game announcements.

import express, { Express } from 'express';
import { createServer, Server } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Connection, PublicKey } from '@solana/web3.js';
import { GameManager } from './game-manager.js';
import { createRoutes } from './routes.js';
import { setupWebSocket } from './websocket.js';
import { createBlinksRoutes } from './blinks.js';
import { createTwitterBot } from './twitter-bot.js';
import { createOrchestrator } from './orchestrator.js';
import { createWebhookRoutes } from './webhooks.js';
import { createAdminRoutes } from './admin-routes.js';
import {
  RateLimiter,
  createApiRateLimiter,
  createBlinksRateLimiter,
  createWebhookRateLimiter,
} from './rate-limiter.js';

// =============================================================================
// Configuration
// =============================================================================

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const ESCROW_WALLET = process.env.ESCROW_WALLET || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const ENABLE_RATE_LIMITING = process.env.DISABLE_RATE_LIMITING !== 'true';

// =============================================================================
// Server Setup
// =============================================================================

export interface CreateAppOptions {
  enableBlinks?: boolean;
  enableTwitter?: boolean;
  enableOrchestrator?: boolean;
  autoCreateGames?: boolean;
  enableRateLimiting?: boolean;
}

export function createApp(options?: CreateAppOptions): {
  app: Express;
  server: Server;
  gameManager: GameManager;
  wss: ReturnType<typeof setupWebSocket>;
  twitterBot: ReturnType<typeof createTwitterBot>;
  orchestrator: ReturnType<typeof createOrchestrator>;
  cleanup: () => void;
  rateLimiters: RateLimiter[];
} {
  const app = express();
  const server = createServer(app);
  const gameManager = new GameManager();

  // Rate limiters (Security Mitigation E1)
  const rateLimiters: RateLimiter[] = [];
  const apiRateLimiter = createApiRateLimiter();
  const blinksRateLimiter = createBlinksRateLimiter();
  const webhookRateLimiter = createWebhookRateLimiter();
  rateLimiters.push(apiRateLimiter, blinksRateLimiter, webhookRateLimiter);

  // Middleware
  app.use(express.json());

  // CORS for development
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Signature');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Apply rate limiting (Security Mitigation E1)
  const shouldRateLimit = options?.enableRateLimiting ?? ENABLE_RATE_LIMITING;
  if (shouldRateLimit) {
    // API rate limiting: 100 req/min per IP
    app.use('/api', apiRateLimiter.middleware());
    console.log('Rate limiting enabled for /api');
  }

  // API routes
  app.use('/api', createRoutes(gameManager));

  // Blinks routes (Solana Actions)
  if (options?.enableBlinks !== false && ESCROW_WALLET) {
    const connection = new Connection(SOLANA_RPC);
    const escrowPubkey = new PublicKey(ESCROW_WALLET);

    // Rate limit Blinks routes
    if (shouldRateLimit) {
      app.use('/blinks', blinksRateLimiter.middleware());
      console.log('Rate limiting enabled for /blinks');
    }

    app.use('/', createBlinksRoutes(gameManager, connection, escrowPubkey));
    console.log('Blinks routes enabled');
  }

  // Twitter bot
  let twitterBot = null;
  if (options?.enableTwitter !== false) {
    twitterBot = createTwitterBot(gameManager);
    if (twitterBot) {
      console.log('Twitter bot enabled');
    }
  }

  // Game orchestrator
  let orchestrator = null;
  if (options?.enableOrchestrator !== false) {
    orchestrator = createOrchestrator(gameManager, twitterBot, {
      autoCreateGames: options?.autoCreateGames ?? false,
    });
    if (orchestrator) {
      orchestrator.start();
      console.log('Game orchestrator enabled');
    }
  }

  // Webhook routes with rate limiting
  if (shouldRateLimit) {
    app.use('/webhooks', webhookRateLimiter.middleware());
    console.log('Rate limiting enabled for /webhooks');
  }
  app.use('/webhooks', createWebhookRoutes(orchestrator, WEBHOOK_SECRET));

  // Admin routes (pass orchestrator for payout management)
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  app.use('/api/admin', createAdminRoutes(gameManager, twitterBot, baseUrl, orchestrator));
  console.log('Admin routes enabled at /api/admin');

  // Admin dashboard (static HTML)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  app.get('/admin', (_req, res) => {
    res.sendFile(join(__dirname, 'public', 'admin.html'));
  });
  console.log('Admin dashboard available at /admin');

  // WebSocket
  const wss = setupWebSocket(server, gameManager);

  // Error handling
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  );

  // Cleanup function for rate limiters
  const cleanup = () => {
    rateLimiters.forEach(rl => rl.stop());
  };

  return { app, server, gameManager, wss, twitterBot, orchestrator, cleanup, rateLimiters };
}

// =============================================================================
// Start Server
// =============================================================================

if (process.env.NODE_ENV !== 'test') {
  const { server, gameManager, cleanup } = createApp();

  server.listen(PORT, HOST, () => {
    console.log(`Battle Dinghy server running at http://${HOST}:${PORT}`);
    console.log(`WebSocket available at ws://${HOST}:${PORT}/ws`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    cleanup();
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  // Log game events
  gameManager.on('game_created', (e) => console.log('Game created:', e.gameId));
  gameManager.on('player_joined', (e) =>
    console.log(`Player ${e.playerWallet} joined ${e.gameId}`)
  );
  gameManager.on('game_started', (e) =>
    console.log(`Game ${e.gameId} started with ${e.players.length} players`)
  );
  gameManager.on('round_complete', (e) =>
    console.log(`Game ${e.gameId} round ${e.summary.roundNumber} complete`)
  );
  gameManager.on('game_complete', (e) =>
    console.log(`Game ${e.gameId} complete! Winner: ${e.winner}`)
  );
}

// Export for testing
export { GameManager } from './game-manager.js';
export * from './types.js';
export * from './card-renderer.js';
export { TwitterBot, createTwitterBot } from './twitter-bot.js';
export { createBlinksRoutes, confirmBuyIn } from './blinks.js';
export { GameOrchestrator, createOrchestrator } from './orchestrator.js';
export { createWebhookRoutes, generateWebhookSignature } from './webhooks.js';
export { OreMonitorLive, createOreMonitor, parseOreWebhook } from './ore-integration.js';
export { RateLimiter, createApiRateLimiter, createBlinksRateLimiter, createWebhookRateLimiter } from './rate-limiter.js';
export { createAdminRoutes } from './admin-routes.js';
