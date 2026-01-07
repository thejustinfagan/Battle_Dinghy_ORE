import type { Express } from "express";
import { createServer, type Server } from "http";
import { dbStorage as storage } from "./db-storage";
import { generateRandomBoard, oreHashToCoordinate, processShot, calculateTotalHullPoints } from "./game-engine";
import { generateBoardImage } from "./board-image-generator";
import { postGameAnnouncement, postShotAnnouncement, postWinnerAnnouncement, sendPlayerBoard, checkTwitterCredentials, initiateOAuthFlow, handleOAuthCallback } from "./twitter-bot";
import { oreMonitor } from "./ore-monitor";
import { OreActiveMiner } from "./ore-active-miner";
import { solanaEscrow } from "./solana-escrow";
import { requireAdminAuth } from "./auth-middleware";
import { PublicKey } from "@solana/web3.js";
import type { Player } from "@shared/schema";
import { insertGameSchema, insertPlayerSchema, insertShotSchema } from "@shared/schema";
import { fromZodError } from "zod-validation-error";

export async function registerRoutes(app: Express): Promise<Server> {
  
  // CORS middleware for Solana Actions API (spec-compliant)
  const actionsCorsMid = (req: any, res: any, next: any) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Actions-Request, Actions-Request-Signature");
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  };

  // Register OPTIONS handler explicitly for Actions API
  app.options("/api/actions/game/:gameId", actionsCorsMid);
  
  // API to check system status (Twitter, ORE monitor, Solana) - Admin only
  app.get("/api/status", requireAdminAuth, async (req, res) => {
    // Check each service independently - don't fail the whole request if one fails
    let twitterStatus;
    try {
      twitterStatus = await checkTwitterCredentials();
    } catch (error) {
      console.error("Error checking Twitter status:", error);
      twitterStatus = { configured: false, error: "Failed to check Twitter credentials" };
    }

    let oreStatus;
    try {
      oreStatus = oreMonitor.getStatus();
    } catch (error) {
      console.error("Error checking ORE status:", error);
      oreStatus = { status: "error", error: "Failed to check ORE monitor" };
    }

    let networkInfo;
    try {
      networkInfo = await solanaEscrow.getNetworkInfo();
    } catch (error) {
      console.error("Error checking Solana status:", error);
      // Provide fallback info when RPC fails
      networkInfo = {
        configured: !!process.env.ESCROW_WALLET_SECRET,
        network: process.env.SOLANA_NETWORK || 'devnet',
        escrowAddress: solanaEscrow.getEscrowAddress() || 'Not configured',
        balance: 'Unable to fetch (RPC error)',
        error: error instanceof Error ? error.message : "Failed to fetch network info"
      };
    }

    res.json({
      twitter: twitterStatus,
      oreMonitor: oreStatus,
      solana: networkInfo,
    });
  });

  // API to get Solana network info - Admin only
  app.get("/api/admin/solana/network", requireAdminAuth, async (req, res) => {
    try {
      const networkInfo = await solanaEscrow.getNetworkInfo();
      res.json(networkInfo);
    } catch (error) {
      console.error("Error getting network info:", error);
      res.status(500).json({ error: "Failed to get network info" });
    }
  });

  // API to request devnet airdrop - Admin only (devnet only)
  app.post("/api/admin/solana/airdrop", requireAdminAuth, async (req, res) => {
    try {
      const { walletAddress, amount } = req.body;
      
      // Validate wallet address
      if (!walletAddress || typeof walletAddress !== 'string') {
        return res.status(400).json({ error: "Missing or invalid walletAddress" });
      }

      // Validate amount if provided
      if (amount !== undefined) {
        const numAmount = Number(amount);
        if (isNaN(numAmount) || numAmount <= 0 || numAmount > 5) {
          return res.status(400).json({ 
            error: "Invalid amount. Must be a positive number between 0 and 5 SOL" 
          });
        }
      }

      let wallet: PublicKey;
      try {
        wallet = new PublicKey(walletAddress);
      } catch (err) {
        return res.status(400).json({ error: "Invalid Solana wallet address format" });
      }

      const lamports = amount ? Number(amount) * 1_000_000_000 : 1_000_000_000; // Default 1 SOL

      const signature = await solanaEscrow.requestDevnetAirdrop(wallet, lamports);
      
      res.json({
        success: true,
        signature,
        amount: lamports / 1_000_000_000,
        wallet: walletAddress,
      });
    } catch (error) {
      console.error("Error requesting airdrop:", error);
      const message = error instanceof Error ? error.message : "Failed to request airdrop";
      
      // Provide helpful guidance for common faucet failures
      if (message.includes("Internal error") || message.includes("airdrop")) {
        return res.status(500).json({ 
          error: message,
          help: "Devnet faucet may be rate-limited. Try: 1) https://faucet.solana.com, 2) Phantom wallet airdrop, or 3) Solana CLI. See DEVNET_TESTING.md for details."
        });
      }
      
      res.status(500).json({ error: message });
    }
  });

  // API to airdrop to escrow wallet - Admin only (devnet only)
  app.post("/api/admin/solana/airdrop-escrow", requireAdminAuth, async (req, res) => {
    try {
      const escrowAddress = solanaEscrow.getEscrowAddress();
      if (!escrowAddress) {
        return res.status(500).json({ error: "Escrow wallet not configured" });
      }

      const { amount } = req.body;
      
      // Validate amount if provided
      if (amount !== undefined) {
        const numAmount = Number(amount);
        if (isNaN(numAmount) || numAmount <= 0 || numAmount > 5) {
          return res.status(400).json({ 
            error: "Invalid amount. Must be a positive number between 0 and 5 SOL" 
          });
        }
      }

      const lamports = amount ? Number(amount) * 1_000_000_000 : 1_000_000_000; // Default 1 SOL

      const wallet = new PublicKey(escrowAddress);
      const signature = await solanaEscrow.requestDevnetAirdrop(wallet, lamports);
      
      const newBalance = await solanaEscrow.getEscrowBalance();
      
      res.json({
        success: true,
        signature,
        amount: lamports / 1_000_000_000,
        escrowAddress,
        newBalance: newBalance / 1_000_000_000,
      });
    } catch (error) {
      console.error("Error requesting escrow airdrop:", error);
      const message = error instanceof Error ? error.message : "Failed to request airdrop";
      
      // Provide helpful guidance for common faucet failures
      if (message.includes("Internal error") || message.includes("airdrop")) {
        const address = solanaEscrow.getEscrowAddress();
        return res.status(500).json({ 
          error: message,
          help: "Devnet faucet may be rate-limited. Try manual airdrop: 'solana airdrop 2 " + address + " --url devnet' or use https://faucet.solana.com. See DEVNET_TESTING.md for details."
        });
      }
      
      res.status(500).json({ error: message });
    }
  });

  // API to start ORE monitoring for a game - Admin only
  app.post("/api/admin/ore/start/:gameId", requireAdminAuth, async (req, res) => {
    try {
      const { gameId } = req.params;
      
      const game = await storage.getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      if (game.status !== "active") {
        return res.status(400).json({ 
          error: "Game must be active to start ORE monitoring",
          currentStatus: game.status
        });
      }

      await oreMonitor.startMonitoring(gameId);
      
      res.json({
        success: true,
        message: `ORE monitoring started for game #${game.gameNumber}`,
        oreStatus: oreMonitor.getStatus(),
      });
    } catch (error) {
      console.error("Error starting ORE monitoring:", error);
      res.status(500).json({ error: "Failed to start ORE monitoring" });
    }
  });

  // API to stop ORE monitoring - Admin only
  app.post("/api/admin/ore/stop", requireAdminAuth, async (req, res) => {
    try {
      const statusBefore = oreMonitor.getStatus();
      oreMonitor.stopMonitoring();
      
      res.json({
        success: true,
        message: "ORE monitoring stopped",
        previousStatus: statusBefore,
        currentStatus: oreMonitor.getStatus(),
      });
    } catch (error) {
      console.error("Error stopping ORE monitoring:", error);
      res.status(500).json({ error: "Failed to stop ORE monitoring" });
    }
  });

  // API to get ORE monitor status and recent shots - Admin only
  app.get("/api/admin/ore/status", requireAdminAuth, async (req, res) => {
    try {
      const oreStatus = oreMonitor.getStatus();
      
      // If monitoring a game, get recent shots
      interface ShotSummary {
        shotNumber: number;
        coordinate: string;
        oreBlockHash: string;
        isDuplicate: boolean;
      }
      
      interface GameSummary {
        gameNumber: number;
        status: string;
        currentPlayers: number;
        totalShots: number;
      }
      
      let recentShots: ShotSummary[] = [];
      let gameInfo: GameSummary | null = null;
      if (oreStatus.gameId) {
        const game = await storage.getGame(oreStatus.gameId);
        const shots = await storage.getShotsByGame(oreStatus.gameId);
        recentShots = shots.slice(-5); // Last 5 shots
        gameInfo = game ? {
          gameNumber: game.gameNumber,
          status: game.status,
          currentPlayers: game.currentPlayers,
          totalShots: shots.length,
        } : null;
      }
      
      res.json({
        oreMonitor: oreStatus,
        game: gameInfo,
        recentShots: recentShots.map(shot => ({
          shotNumber: shot.shotNumber,
          coordinate: shot.coordinate,
          oreBlockHash: shot.oreBlockHash?.slice(0, 12) + "...",
          isDuplicate: shot.isDuplicate,
        })),
      });
    } catch (error) {
      console.error("Error getting ORE status:", error);
      res.status(500).json({ error: "Failed to get ORE status" });
    }
  });

  // API to start ORE active mining for a game - Admin only
  app.post("/api/admin/ore/start-active/:gameId", requireAdminAuth, async (req, res) => {
    try {
      const { gameId } = req.params;
      
      const game = await storage.getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      if (game.status !== "active") {
        return res.status(400).json({ error: "Game must be active to start mining" });
      }

      // Get escrow keypair from solanaEscrow
      const escrowKeypair = solanaEscrow.getEscrowKeypair();

      // Create and start the active miner with the prize pool
      const miner = new OreActiveMiner(gameId, escrowKeypair);
      miner.start(game.prizePoolSol).catch(err => {
        console.error("Active miner error:", err);
      });

      res.json({ 
        success: true, 
        message: `ORE active mining started for game #${game.gameNumber}`,
        gameId 
      });
    } catch (error) {
      console.error("Error starting active miner:", error);
      const message = error instanceof Error ? error.message : "Failed to start active miner";
      res.status(500).json({ error: message });
    }
  });

  // API to manually trigger a shot (for testing) - Admin only
  // This uses the SAME logic as OreMonitor.processOreBlock to ensure parity
  app.post("/api/admin/ore/manual-shot", requireAdminAuth, async (req, res) => {
    try {
      const { gameId, coordinate } = req.body;
      
      if (!gameId) {
        return res.status(400).json({ error: "Missing gameId in request body" });
      }
      
      const game = await storage.getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      if (game.status !== "active") {
        return res.status(400).json({ 
          error: "Game must be active to fire shots",
          currentStatus: game.status
        });
      }

      // Validate coordinate format
      if (!coordinate || !/^[A-E][1-5]$/.test(coordinate)) {
        return res.status(400).json({ 
          error: "Invalid coordinate. Must be A1-E5 format",
          example: "A1"
        });
      }

      // Generate a manual hash for tracking
      const manualHash = `MANUAL-${Date.now()}-${coordinate}`;
      
      // Trigger the shot using OreMonitor's logic by calling processOreBlock
      // Pass the coordinate explicitly since manual hash can't be converted
      // This ensures Twitter announcements, winner detection, and game completion
      const result = await oreMonitor.processOreBlock(gameId, manualHash, coordinate);
      
      // Fetch updated game state
      const alivePlayers = await storage.getAlivePlayers(gameId);
      const allShots = await storage.getShotsByGame(gameId);
      
      // Handle different outcomes based on structured result
      if (result.status === 'game_not_active') {
        return res.status(400).json({ 
          error: "Game is not active",
          currentStatus: result.game?.status 
        });
      }
      
      if (result.status === 'game_complete') {
        return res.status(400).json({ 
          error: "Game already complete (25 shots fired)" 
        });
      }
      
      if (result.status === 'duplicate') {
        // Coordinate was duplicate - shot was not created (DUD)
        return res.json({
          success: false,
          isDuplicate: true,
          message: `Coordinate ${coordinate} is a duplicate (DUD) - shot was not fired`,
          coordinate,
          game: {
            status: result.game?.status,
            totalShots: allShots.length,
            alivePlayers: alivePlayers.length,
          },
        });
      }
      
      // Shot was successfully created (result.status === 'shot')
      res.json({
        success: true,
        shot: {
          shotNumber: result.shot?.shotNumber,
          coordinate: result.shot?.coordinate,
          isDuplicate: false,
          hash: manualHash,
          tweetId: result.shot?.tweetId,
        },
        game: {
          status: result.game?.status,
          totalShots: allShots.length,
          alivePlayers: alivePlayers.length,
          winnerId: result.game?.winnerId,
        },
        message: result.game?.status === "completed" 
          ? "Game completed! Check Twitter for winner announcement."
          : `Shot fired! ${alivePlayers.length} players remaining.`,
      });
    } catch (error) {
      console.error("Error firing manual shot:", error);
      res.status(500).json({ error: "Failed to fire manual shot" });
    }
  });
  
  // List all games - Admin only
  app.get("/api/admin/games", requireAdminAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { games } = await import("@shared/schema");
      const { desc } = await import("drizzle-orm");
      
      const allGames = await db.select().from(games).orderBy(desc(games.createdAt)).limit(10);
      res.json({ games: allGames });
    } catch (error) {
      console.error("Error listing games:", error);
      res.status(500).json({ error: "Failed to list games" });
    }
  });

  // Force complete a game - Admin only (for testing cleanup)
  app.post("/api/admin/games/:id/force-complete", requireAdminAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const game = await storage.getGame(id);
      
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      if (game.status === "completed") {
        return res.json({ success: true, message: "Game already completed", game });
      }

      await storage.updateGameStatus(id, "completed");
      const updatedGame = await storage.getGame(id);
      
      console.log(`Admin force-completed game ${id} (was: ${game.status})`);
      res.json({ success: true, message: "Game force-completed", game: updatedGame });
    } catch (error) {
      console.error("Error force-completing game:", error);
      res.status(500).json({ error: "Failed to force-complete game" });
    }
  });

  // API to create a new game - Admin only
  app.post("/api/games/create", requireAdminAuth, async (req, res) => {
    try {
      const { 
        entryFeeSol = 10_000_000, 
        maxPlayers = 35,
        platformFeePercentage = 5 // User-friendly input (0-100, can be decimal like 5.5)
      } = req.body; // Default 0.01 SOL, 35 players, 5% fee
      
      // Validate platform fee percentage (0-100, supports decimals)
      if (typeof platformFeePercentage !== 'number' || platformFeePercentage < 0 || platformFeePercentage > 100) {
        return res.status(400).json({ 
          error: "Platform fee percentage must be between 0 and 100" 
        });
      }
      
      // Convert percentage to basis points (5% -> 500, 5.5% -> 550)
      const platformFeeBasisPoints = Math.floor(platformFeePercentage * 100);
      
      const activeGame = await storage.getActiveGame();
      if (activeGame) {
        console.log(`Cannot create game - active game exists: ${activeGame.id} (status: ${activeGame.status})`);
        return res.status(400).json({ 
          error: "A game is already active",
          activeGameId: activeGame.id,
          activeGameStatus: activeGame.status,
          hint: "Use POST /api/admin/games/:id/force-complete to clean up"
        });
      }

      const { db } = await import("./db");
      const { games } = await import("@shared/schema");
      const { desc } = await import("drizzle-orm");
      
      const allGames = await db.select().from(games).orderBy(desc(games.gameNumber)).limit(1);
      const gameNumber = allGames.length > 0 ? allGames[0].gameNumber + 1 : 1;

      const game = await storage.createGame({
        gameNumber,
        status: "pending",
        entryFeeSol,
        maxPlayers,
        platformFeeBasisPoints,
      });

      res.json({ success: true, game });
    } catch (error) {
      console.error("Error creating game:", error);
      res.status(500).json({ error: "Failed to create game" });
    }
  });

  // Solana Actions API - GET endpoint (returns metadata)
  app.get("/api/actions/game/:gameId", actionsCorsMid, async (req, res) => {
    try {
      const { gameId } = req.params;
      const { token } = req.query;
      const game = await storage.getGame(gameId);

      if (!game) {
        return res.status(404).json({ 
          error: { message: "Game not found" }
        });
      }

      // Return disabled action (200) for valid games that can't accept players
      if (game.status !== "pending") {
        return res.status(200).json({
          icon: "https://ucarecdn.com/7aa5b5ab-888a-44d8-8a90-d99db3a3985f/anchor.png",
          title: `Battle Dinghy Game #${game.gameNumber}`,
          description: `This game has already ${game.status === "active" ? "started" : "ended"}.`,
          label: "Game Unavailable",
          disabled: true,
          error: { message: `Game has already ${game.status === "active" ? "started" : "ended"}` }
        });
      }

      if (game.currentPlayers >= game.maxPlayers) {
        return res.status(200).json({
          icon: "https://ucarecdn.com/7aa5b5ab-888a-44d8-8a90-d99db3a3985f/anchor.png",
          title: `Battle Dinghy Game #${game.gameNumber}`,
          description: `Game is full with ${game.maxPlayers} players.`,
          label: "Game Full",
          disabled: true,
          error: { message: "Game is full" }
        });
      }

      // Get the base URL from request headers or environment
      // Always use the deployed URL for Blinks, not localhost
      const host = req.get('host') || 'localhost:5000';
      const protocol = req.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
      const baseUrl = host.includes('localhost') 
        ? 'https://a89d81c7-872f-4d90-bfc7-974575ba1552-00-3ogyhjk2kukw1.picard.replit.dev'
        : `${protocol}://${host}`;

      // Add network indicator for safety
      const network = process.env.SOLANA_NETWORK || 'devnet';
      const networkName = network.toUpperCase();
      const networkEmoji = network === 'devnet' ? '🧪' : '⚡';
      
      // Format SOL amounts - show more decimals for very small amounts
      const formatSol = (lamports: number) => {
        const sol = lamports / 1_000_000_000;
        if (sol >= 0.001) return sol.toFixed(3);
        if (sol >= 0.00001) return sol.toFixed(5);
        return sol.toFixed(8);
      };

      // Build href with token if provided (CRITICAL for verification flow)
      const hrefUrl = `${baseUrl}/api/actions/game/${gameId}`;
      const href = token ? `${hrefUrl}?token=${token}` : hrefUrl;

      const actionResponse = {
        icon: "https://ucarecdn.com/7aa5b5ab-888a-44d8-8a90-d99db3a3985f/anchor.png",
        title: `${networkEmoji} Battle Dinghy Game #${game.gameNumber} [${networkName}]`,
        description: `⚓ Join the naval battle! ${game.currentPlayers}/${game.maxPlayers} players joined. Prize pool: ${formatSol(game.prizePoolSol)} SOL. Entry: ${formatSol(game.entryFeeSol)} SOL ${network === 'devnet' ? '(TEST SOL - No real money!)' : ''}`,
        label: `Join Battle [${networkName}]`,
        links: {
          actions: [
            {
              label: `Join for ${formatSol(game.entryFeeSol)} SOL`,
              href,
            },
          ],
        },
      };

      res.json(actionResponse);
    } catch (error) {
      console.error("Error fetching actions metadata:", error);
      res.status(500).json({ 
        error: { message: "Failed to fetch game metadata" }
      });
    }
  });

  // Solana Actions API - POST endpoint (returns transaction)
  app.post("/api/actions/game/:gameId", actionsCorsMid, async (req, res) => {
    try {
      const { gameId } = req.params;
      const { account } = req.body;
      const { token } = req.query;

      if (!account) {
        return res.status(400).json({ 
          error: { message: "Missing wallet account" }
        });
      }

      // Verification token is REQUIRED - no bypass allowed
      if (!token || typeof token !== 'string') {
        return res.status(400).json({
          error: { message: "Verification token required. Please visit the game join page to verify your Twitter handle first." }
        });
      }

      // Validate verification token
      let twitterHandle: string | undefined;
      if (token) {
        const verificationToken = await storage.getVerificationToken(token);
        
        if (!verificationToken) {
          return res.status(400).json({
            error: { message: "Invalid or expired verification token" }
          });
        }

        if (verificationToken.gameId !== gameId) {
          return res.status(400).json({
            error: { message: "Token is for a different game" }
          });
        }

        // Allow token reuse if the same wallet is trying to get the transaction again
        // (handles wallet refetching, user retries, etc.)
        if (verificationToken.usedAt) {
          if (verificationToken.walletAddress !== account) {
            return res.status(400).json({
              error: { message: "Token has already been used by a different wallet" }
            });
          }
          // Same wallet - allow refetching transaction (don't mark as used again)
          console.log(`Token ${token} reused by same wallet ${account} - allowing transaction refetch`);
        } else {
          // First use - mark token as used and store wallet address
          await storage.markVerificationTokenUsed(token, account);
        }

        if (new Date() > verificationToken.expiresAt) {
          return res.status(400).json({
            error: { message: "Token has expired. Please verify your Twitter handle again." }
          });
        }

        twitterHandle = verificationToken.twitterHandle;
      }

      const game = await storage.getGame(gameId);
      if (!game) {
        return res.status(404).json({ 
          error: { message: "Game not found" }
        });
      }

      if (game.status !== "pending") {
        return res.status(400).json({
          error: { message: "Game has already started or is completed" }
        });
      }

      if (game.currentPlayers >= game.maxPlayers) {
        return res.status(400).json({
          error: { message: "Game is full" }
        });
      }

      let playerWallet: PublicKey;
      try {
        playerWallet = new PublicKey(account);
      } catch (error) {
        return res.status(400).json({
          error: { message: "Invalid Solana wallet address" }
        });
      }

      const transaction = await solanaEscrow.createPaymentTransaction(
        playerWallet,
        game.entryFeeSol
      );

      res.json({
        transaction,
        message: `Joining Battle Dinghy Game #${game.gameNumber}${twitterHandle ? ` as @${twitterHandle}` : ''}`,
      });
    } catch (error) {
      console.error("Error creating payment transaction:", error);
      const message = error instanceof Error ? error.message : "Failed to create transaction";
      res.status(500).json({ 
        error: { message }
      });
    }
  });

  // Legacy Blink metadata endpoint (kept for backwards compatibility)
  app.get("/api/blink/game/:gameId", async (req, res) => {
    return res.redirect(301, `/api/actions/game/${req.params.gameId}`);
  });

  // POST /api/admin/games/:id/join-test - Join game without payment (testing only)
  app.post("/api/admin/games/:gameId/join-test", requireAdminAuth, async (req, res) => {
    try {
      const { gameId } = req.params;
      const { twitterHandle, walletAddress } = req.body;

      if (!twitterHandle || !walletAddress) {
        return res.status(400).json({ error: "Missing twitterHandle or walletAddress" });
      }

      const game = await storage.getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      if (game.status !== "pending") {
        return res.status(400).json({ error: "Game is not accepting players" });
      }

      const boardState = generateRandomBoard();
      
      // Use non-transactional join for testing (neon-http doesn't support transactions)
      const result = await storage.joinGameSimple(gameId, {
        gameId,
        twitterHandle,
        walletAddress,
        boardState,
        hullPoints: 6,
        status: "alive",
        txSignature: `test-${Date.now()}-${Math.random().toString(36).substring(7)}`, // Fake signature for testing
      });

      if (!result.success) {
        return res.status(400).json({ 
          error: result.error || "Failed to join game",
          details: result.details
        });
      }

      console.log(`Test player joined: @${twitterHandle} (${walletAddress})`);
      
      res.json({
        success: true,
        player: result.player,
        message: "Player joined successfully (test mode)",
      });
    } catch (error) {
      console.error("Error in test join:", error);
      res.status(500).json({ error: "Failed to join game" });
    }
  });

  // API to verify Twitter handle and generate verification token
  app.post("/api/games/:gameId/verify-twitter", async (req, res) => {
    try {
      const { gameId } = req.params;
      const { twitterHandle } = req.body;

      if (!twitterHandle) {
        return res.status(400).json({ error: "Twitter handle is required" });
      }

      // Clean and validate Twitter handle
      const cleanHandle = twitterHandle.replace('@', '').trim();
      if (!cleanHandle || cleanHandle.length === 0) {
        return res.status(400).json({ error: "Invalid Twitter handle" });
      }

      // Basic handle validation (alphanumeric, underscore, 1-15 chars)
      if (!/^[a-zA-Z0-9_]{1,15}$/.test(cleanHandle)) {
        return res.status(400).json({ error: "Twitter handle contains invalid characters" });
      }

      // Get game to verify it exists and is accepting players
      const game = await storage.getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      if (game.status !== "pending") {
        return res.status(400).json({ error: "Game is not accepting players" });
      }

      if (game.currentPlayers >= game.maxPlayers) {
        return res.status(400).json({ error: "Game is full" });
      }

      // Check if Twitter handle is already in this game
      const players = await storage.getPlayersByGame(gameId);
      const handleTaken = players.some(p => p.twitterHandle.toLowerCase() === cleanHandle.toLowerCase());
      if (handleTaken) {
        return res.status(400).json({ error: "This Twitter handle is already in this game" });
      }

      // TODO: Optional: Verify Twitter handle exists via Twitter API
      // For now, we'll skip this to avoid extra API calls
      // You can add this later: await verifyTwitterHandleExists(cleanHandle)

      // Generate verification token
      const token = `vt_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await storage.createVerificationToken({
        gameId,
        token,
        twitterHandle: cleanHandle,
        expiresAt,
      });

      // Generate Blink URL with token (wrapped with dial.to)
      // Always use deployed URL, not localhost
      const host = req.get('host') || 'localhost:5000';
      const baseUrl = host.includes('localhost') 
        ? 'https://a89d81c7-872f-4d90-bfc7-974575ba1552-00-3ogyhjk2kukw1.picard.replit.dev'
        : `https://${host}`;
      const actionUrl = `${baseUrl}/api/actions/game/${gameId}?token=${token}`;
      const blinkUrl = `https://dial.to/?action=solana-action:${actionUrl}`;

      res.json({
        success: true,
        token,
        twitterHandle: cleanHandle,
        blinkUrl,
      });
    } catch (error: any) {
      console.error("Error verifying Twitter handle:", error);
      const message = error instanceof Error ? error.message : "Failed to verify Twitter handle";
      res.status(500).json({ error: message });
    }
  });

  // API to join a game (called after Solana payment)
  app.post("/api/games/:gameId/join", async (req, res) => {
    try {
      const { gameId } = req.params;
      const { token, walletAddress, txSignature } = req.body;

      // SECURITY: Require verification token - no longer trust client-provided Twitter handle
      if (!token || !walletAddress || !txSignature) {
        return res.status(400).json({ error: "Missing required fields (token, walletAddress, txSignature)" });
      }

      // Validate and get Twitter handle from verification token
      const verificationToken = await storage.getVerificationToken(token);
      if (!verificationToken) {
        return res.status(400).json({ error: "Invalid or expired verification token" });
      }

      if (verificationToken.gameId !== gameId) {
        return res.status(400).json({ error: "Token is for a different game" });
      }

      if (!verificationToken.usedAt || !verificationToken.walletAddress) {
        return res.status(400).json({ error: "Token has not been used for payment yet" });
      }

      if (new Date() > verificationToken.expiresAt) {
        return res.status(400).json({ error: "Token has expired" });
      }

      // SECURITY: Verify wallet address matches the one that paid
      if (verificationToken.walletAddress !== walletAddress) {
        return res.status(400).json({ error: "Wallet address does not match payment" });
      }

      // Get Twitter handle from verified token (not from client input!)
      const twitterHandle = verificationToken.twitterHandle;

      // Get game to verify entry fee amount
      const game = await storage.getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      // Validate wallet address
      let playerWallet: PublicKey;
      try {
        playerWallet = new PublicKey(walletAddress);
      } catch (error) {
        return res.status(400).json({ error: "Invalid Solana wallet address" });
      }

      // Verify payment with proper checks
      const isValidPayment = await solanaEscrow.verifyPayment(
        txSignature,
        playerWallet,
        game.entryFeeSol
      );
      if (!isValidPayment) {
        return res.status(400).json({ error: "Payment verification failed" });
      }

      const boardState = generateRandomBoard();
      
      // Use joinGameSimple (Neon HTTP driver doesn't support transactions)
      const result = await storage.joinGameSimple(gameId, {
        gameId,
        twitterHandle,
        walletAddress,
        boardState,
        hullPoints: 6,
        status: "alive",
        txSignature,
      });

      if (!result.success) {
        return res.status(400).json({ 
          error: result.error || "Failed to join game",
          details: result.details
        });
      }

      const boardImage = generateBoardImage(boardState, true);

      // Get updated game state
      const updatedGame = await storage.getGame(gameId);
      if (!updatedGame) {
        return res.status(500).json({ error: "Failed to retrieve updated game state" });
      }

      // Send board card to player in Twitter thread (if game has started and has a thread)
      let boardTweetId: string | undefined;
      if (updatedGame.threadId) {
        try {
          boardTweetId = await sendPlayerBoard(
            twitterHandle,
            updatedGame.gameNumber,
            updatedGame.threadId,
            boardImage
          );
          console.log(`📤 Sent board card to @${twitterHandle} in thread: ${boardTweetId}`);
        } catch (error) {
          console.error(`Failed to send board card to @${twitterHandle}:`, error);
          // Don't fail the join if Twitter posting fails
        }
      }

      res.json({
        success: true,
        player: result.player,
        boardImage: boardImage.toString("base64"),
        boardTweetId,
        gameStatus: updatedGame.currentPlayers >= updatedGame.maxPlayers ? "starting" : "waiting",
        message: boardTweetId 
          ? "Successfully joined! Check the game thread for your board."
          : "Successfully joined! Your board will be posted when the game starts.",
      });
    } catch (error) {
      console.error("Error joining game:", error);
      
      // Handle unique constraint violations
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === '23505') {
          const errorMsg = String(error);
          if (errorMsg.includes('unique_wallet_per_game')) {
            return res.status(400).json({ 
              error: "This wallet has already joined this game" 
            });
          }
          if (errorMsg.includes('unique_twitter_per_game')) {
            return res.status(400).json({ 
              error: "This Twitter handle has already joined this game" 
            });
          }
        }
      }
      
      const message = error instanceof Error ? error.message : "Failed to join game";
      res.status(500).json({ error: message });
    }
  });

  // API to start a game without Twitter (testing only) - Admin only
  app.post("/api/admin/games/:gameId/start-test", requireAdminAuth, async (req, res) => {
    try {
      const { gameId } = req.params;
      const game = await storage.getGame(gameId);

      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      if (game.status !== "pending") {
        return res.status(400).json({ error: "Game already started" });
      }

      await storage.updateGameStatus(gameId, "active");
      
      console.log(`Test game ${gameId} started (no Twitter post)`);

      res.json({ success: true, message: "Game started (test mode - no Twitter)" });
    } catch (error) {
      console.error("Error starting test game:", error);
      res.status(500).json({ error: "Failed to start game" });
    }
  });

  // API to start a game (triggers Twitter announcement and ORE monitoring) - Admin only
  app.post("/api/games/:gameId/start", requireAdminAuth, async (req, res) => {
    try {
      const { gameId } = req.params;
      const game = await storage.getGame(gameId);

      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      if (game.status !== "pending") {
        return res.status(400).json({ error: "Game already started" });
      }

      await storage.updateGameStatus(gameId, "active");

      // Generate website join URL (where users verify Twitter handle)
      const host = req.get('host') || 'battle-dinghy.replit.app';
      const protocol = host.includes('localhost') ? 'http' : 'https';
      const joinUrl = `${protocol}://${host}/join/${gameId}`;
      
      const { tweetId, threadId } = await postGameAnnouncement(game, joinUrl);
      
      await storage.updateGameTweet(gameId, tweetId, threadId);

      await oreMonitor.startMonitoring(gameId);

      res.json({ success: true, tweetId, threadId, oreMonitorActive: true });
    } catch (error) {
      console.error("Error starting game:", error);
      res.status(500).json({ error: "Failed to start game" });
    }
  });

  // API to manually fire a shot (for testing only - production uses ORE monitor) - Admin only
  app.post("/api/games/:gameId/fire-shot", requireAdminAuth, async (req, res) => {
    try {
      const { gameId } = req.params;
      const { oreBlockHash } = req.body;

      if (!oreBlockHash) {
        return res.status(400).json({ error: "Missing ORE block hash" });
      }

      const game = await storage.getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      if (game.status !== "active") {
        return res.status(400).json({ error: "Game is not active" });
      }

      const shots = await storage.getShotsByGame(gameId);
      const shotNumber = shots.length + 1;

      if (shotNumber > 25) {
        return res.status(400).json({ error: "All shots have been fired" });
      }

      const coordinate = oreHashToCoordinate(oreBlockHash);
      
      const isDuplicate = shots.some(s => s.coordinate === coordinate);

      const shot = await storage.createShot({
        gameId,
        shotNumber,
        coordinate,
        oreBlockHash,
        isDuplicate,
      });

      const players = await storage.getPlayersByGame(gameId);
      const hitPlayers: Array<{ player: Player; result: string; shipHit: string | null }> = [];

      for (const player of players) {
        if (player.status === "eliminated") continue;

        const shotResult = processShot(player.boardState, coordinate);
        
        await storage.updatePlayerBoard(player.id, shotResult.updatedBoard);
        
        const newHullPoints = calculateTotalHullPoints(shotResult.updatedBoard);
        await storage.updatePlayerHullPoints(player.id, newHullPoints);

        if (shotResult.result === "eliminated") {
          await storage.updatePlayerStatus(player.id, "eliminated", shotNumber);
        }

        await storage.createShotResult({
          shotId: shot.id,
          playerId: player.id,
          result: shotResult.result,
          shipHit: shotResult.shipHit,
          damageDealt: shotResult.damageDealt,
        });

        if (shotResult.result !== "miss") {
          hitPlayers.push({
            player,
            result: shotResult.result,
            shipHit: shotResult.shipHit,
          });
        }
      }

      const alivePlayers = await storage.getAlivePlayers(gameId);

      const tweetId = await postShotAnnouncement(
        game,
        shotNumber,
        coordinate,
        hitPlayers,
        alivePlayers.length
      );

      await storage.updateShotTweet(shot.id, tweetId);

      if (alivePlayers.length === 1) {
        const winner = alivePlayers[0];
        await storage.setGameWinner(gameId, winner.id);
        await storage.updateGameStatus(gameId, "completed");

        await postWinnerAnnouncement(game, winner, {
          shotsTotal: shotNumber,
          hullRemaining: winner.hullPoints,
        });
      } else if (alivePlayers.length === 0 || shotNumber === 25) {
        await storage.updateGameStatus(gameId, "completed");
      }

      res.json({
        success: true,
        shot,
        coordinate,
        hitPlayers: hitPlayers.length,
        alivePlayers: alivePlayers.length,
      });
    } catch (error) {
      console.error("Error firing shot:", error);
      res.status(500).json({ error: "Failed to fire shot" });
    }
  });

  // API to get game status
  app.get("/api/games/:gameId", async (req, res) => {
    try {
      const { gameId } = req.params;
      const game = await storage.getGame(gameId);

      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      const players = await storage.getPlayersByGame(gameId);
      const shots = await storage.getShotsByGame(gameId);
      const alivePlayers = await storage.getAlivePlayers(gameId);

      res.json({
        game,
        players: players.length,
        alivePlayers: alivePlayers.length,
        shots: shots.length,
        oreMonitor: oreMonitor.getStatus(),
      });
    } catch (error) {
      console.error("Error fetching game:", error);
      res.status(500).json({ error: "Failed to fetch game" });
    }
  });

  // API to get Solana payment transaction for Blink
  app.post("/api/blink/game/:gameId/transaction", async (req, res) => {
    try {
      const { gameId } = req.params;
      const { account } = req.body;

      if (!account) {
        return res.status(400).json({ error: "Missing wallet account" });
      }

      const game = await storage.getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      if (game.status !== "pending") {
        return res.status(400).json({ error: "Game not accepting players" });
      }

      const playerWallet = new PublicKey(account);
      const transaction = await solanaEscrow.createPaymentTransaction(
        playerWallet,
        game.entryFeeSol
      );

      res.json({
        transaction,
        message: `Join Battle Dinghy Game #${game.gameNumber}`,
      });
    } catch (error) {
      console.error("Error creating transaction:", error);
      res.status(500).json({ error: "Failed to create transaction" });
    }
  });

  // API to manually trigger payout (for testing) - Admin only
  app.post("/api/games/:gameId/payout", requireAdminAuth, async (req, res) => {
    try {
      const { gameId } = req.params;
      const game = await storage.getGame(gameId);

      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      if (!game.winnerId) {
        return res.status(400).json({ error: "No winner determined" });
      }

      const winner = await storage.getPlayer(game.winnerId);
      if (!winner) {
        return res.status(404).json({ error: "Winner not found" });
      }

      const winnerWallet = new PublicKey(winner.walletAddress);
      const signature = await solanaEscrow.sendPrizeToWinner(
        winnerWallet,
        game.prizePoolSol
      );

      res.json({
        success: true,
        signature,
        winner: winner.twitterHandle,
        prize: game.prizePoolSol / 1_000_000_000,
      });
    } catch (error) {
      console.error("Error sending payout:", error);
      res.status(500).json({ error: "Failed to send payout" });
    }
  });

  // API to test Twitter credentials - Admin only
  app.post("/api/admin/test-twitter", requireAdminAuth, async (req, res) => {
    try {
      const twitterStatus = await checkTwitterCredentials();
      
      if (!twitterStatus.configured) {
        return res.status(400).json({
          error: "Twitter credentials not configured",
          details: twitterStatus,
        });
      }

      // Import and initialize the client
      const { initTwitterClient } = await import("./twitter-bot");
      const client = await initTwitterClient();

      // Post a test tweet
      const testTweet = await client.v2.tweet(
        "🚢 Battle Dinghy systems initializing... Testing tweet functionality!"
      );

      res.json({
        success: true,
        tweetId: testTweet.data.id,
        tweetUrl: `https://twitter.com/user/status/${testTweet.data.id}`,
        message: "Test tweet posted successfully!",
      });
    } catch (error: any) {
      console.error("Twitter test failed:", error);
      res.status(500).json({
        error: "Failed to post test tweet",
        details: error.message,
      });
    }
  });

  // API to initiate OAuth flow for @battle_dinghy authorization - Admin only
  app.get("/api/admin/oauth/start", requireAdminAuth, async (req, res) => {
    try {
      // Use environment variable for stable callback URL, fallback to current host
      const callbackUrl = process.env.TWITTER_OAUTH_CALLBACK_URL || 
        `https://${req.get('host')}/api/admin/oauth/callback`;
      
      console.log("🔐 OAuth Start - Callback URL:", callbackUrl);
      console.log("🔐 OAuth Start - Using env URL:", !!process.env.TWITTER_OAUTH_CALLBACK_URL);
      
      const authUrl = await initiateOAuthFlow(callbackUrl);
      
      console.log("🔐 OAuth Start - Redirect URL:", authUrl);
      
      res.redirect(authUrl);
    } catch (error: any) {
      console.error("OAuth initiation failed:", error);
      res.status(500).json({
        error: "Failed to initiate OAuth flow",
        details: error.message,
      });
    }
  });

  // API to handle OAuth callback and display tokens - NO AUTH REQUIRED (Twitter redirects here)
  app.get("/api/admin/oauth/callback", async (req, res) => {
    try {
      const { code, state } = req.query;

      if (!code || !state) {
        return res.status(400).json({
          error: "Missing OAuth parameters",
        });
      }

      const { accessToken, refreshToken, screenName } = await handleOAuthCallback(
        code as string,
        state as string
      );

      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Twitter Authorization Complete</title>
            <style>
              body {
                font-family: system-ui, -apple-system, sans-serif;
                max-width: 800px;
                margin: 40px auto;
                padding: 20px;
                background: #f5f5f5;
              }
              .container {
                background: white;
                padding: 30px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              }
              h1 { color: #1da1f2; }
              .success { color: #17bf63; font-weight: bold; }
              .token-box {
                background: #f8f9fa;
                border: 1px solid #dee2e6;
                border-radius: 4px;
                padding: 15px;
                margin: 10px 0;
                font-family: monospace;
                word-break: break-all;
              }
              .label { font-weight: bold; margin-bottom: 5px; }
              .instructions {
                background: #fff3cd;
                border: 1px solid #ffc107;
                border-radius: 4px;
                padding: 15px;
                margin: 20px 0;
              }
              .note {
                background: #e7f3ff;
                border: 1px solid #2196f3;
                border-radius: 4px;
                padding: 10px;
                margin: 15px 0;
                font-size: 0.9em;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>🚢 Twitter Authorization Complete!</h1>
              <p class="success">✓ Successfully authorized @${screenName}</p>
              
              <div class="instructions">
                <strong>Next Steps:</strong>
                <ol>
                  <li>Copy the Access Token below</li>
                  <li>Add it to your Replit Secrets as <strong>TWITTER_ACCESS_TOKEN</strong></li>
                  <li>Restart the application</li>
                </ol>
              </div>

              <h3>Add this to your Replit Secrets:</h3>
              
              <div class="label">TWITTER_ACCESS_TOKEN:</div>
              <div class="token-box">${accessToken}</div>
              
              ${refreshToken ? `
                <div class="note">
                  <strong>⏰ Note:</strong> OAuth 2.0 tokens expire after 2 hours. A refresh token has been provided to renew access automatically.
                </div>
                <div class="label">TWITTER_REFRESH_TOKEN (optional, for auto-renewal):</div>
                <div class="token-box">${refreshToken}</div>
              ` : ''}

              <p style="margin-top: 30px;">
                <a href="/admin">← Back to Admin Dashboard</a>
              </p>
            </div>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error("OAuth callback failed:", error);
      res.status(500).json({
        error: "Failed to complete OAuth flow",
        details: error.message,
      });
    }
  });

  // API to post game announcement to Twitter - Admin only
  app.post("/api/admin/post-game", requireAdminAuth, async (req, res) => {
    try {
      const { gameId } = req.body;

      if (!gameId) {
        return res.status(400).json({ error: "gameId is required" });
      }

      const game = await storage.getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      if (game.tweetId) {
        return res.status(400).json({
          error: "Game already announced",
          tweetId: game.tweetId,
        });
      }

      const twitterStatus = await checkTwitterCredentials();
      if (!twitterStatus.configured) {
        return res.status(400).json({
          error: "Twitter credentials not configured",
          details: twitterStatus,
        });
      }

      // Generate join URL - always use deployed URL, not localhost
      const host = req.get('host') || 'localhost:5000';
      const baseUrl = host.includes('localhost') 
        ? 'https://a89d81c7-872f-4d90-bfc7-974575ba1552-00-3ogyhjk2kukw1.picard.replit.dev'
        : `https://${host}`;
      const joinUrl = `${baseUrl}/join/${gameId}`;

      // Post the game announcement
      const { tweetId, threadId } = await postGameAnnouncement(game, joinUrl);

      // Update game with tweet IDs
      const { db } = await import("./db");
      const { games } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      await db.update(games)
        .set({ tweetId, threadId })
        .where(eq(games.id, gameId));

      res.json({
        success: true,
        tweetId,
        tweetUrl: `https://twitter.com/user/status/${tweetId}`,
        game: {
          id: game.id,
          gameNumber: game.gameNumber,
          players: `${game.currentPlayers}/${game.maxPlayers}`,
          prizePool: (game.prizePoolSol / 1_000_000_000).toFixed(2) + " SOL",
        },
      });
    } catch (error: any) {
      console.error("Failed to post game announcement:", error);
      res.status(500).json({
        error: "Failed to post game announcement",
        details: error.message,
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
