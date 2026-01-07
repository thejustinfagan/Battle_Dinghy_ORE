// Battle Dinghy - Game Orchestrator
//
// Manages the full game lifecycle:
// 1. Creates new games on schedule or manually
// 2. Posts game announcements to Twitter with Blinks
// 3. Monitors player buy-ins via transaction webhooks
// 4. Starts games when full or after deadline
// 5. Processes ORE rounds and posts results
// 6. Announces winners and triggers payouts

import { EventEmitter } from 'events';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { GameManager } from './game-manager.js';
import { TwitterBot } from './twitter-bot.js';

// =============================================================================
// Types
// =============================================================================

export interface OrchestratorConfig {
  connection: Connection;
  escrowWallet: PublicKey;
  gameManager: GameManager;
  twitterBot: TwitterBot | null;

  // Game settings
  defaultBuyIn: number; // in lamports
  defaultMaxPlayers: number;
  autoStartOnFull: boolean;
  fillDeadlineMinutes: number;

  // Scheduling
  autoCreateGames: boolean;
  gameIntervalMinutes: number;
}

export interface PendingGame {
  gameId: string;
  tweetId: string | null;
  createdAt: number;
  fillDeadline: number;
  confirmedPlayers: Map<string, string>; // wallet -> txSignature
}

export interface PaidGame {
  paidAt: number;
  txSignature: string | null;
}

export type OrchestratorEvent =
  | 'game_announced'
  | 'player_confirmed'
  | 'game_auto_started'
  | 'payout_pending'
  | 'payout_completed'
  | 'error';

// =============================================================================
// Orchestrator
// =============================================================================

export class GameOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private pendingGames: Map<string, PendingGame> = new Map();
  private paidGames: Map<string, PaidGame> = new Map();
  private gameCheckInterval: NodeJS.Timeout | null = null;
  private gameCreateInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(config: OrchestratorConfig) {
    super();
    this.config = config;
    this.setupEventListeners();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('Game Orchestrator started');

    // Check pending games every 30 seconds
    this.gameCheckInterval = setInterval(() => {
      this.checkPendingGames();
    }, 30_000);

    // Auto-create games on schedule
    if (this.config.autoCreateGames) {
      this.gameCreateInterval = setInterval(() => {
        this.createScheduledGame();
      }, this.config.gameIntervalMinutes * 60_000);

      // Create first game immediately
      this.createScheduledGame();
    }
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.gameCheckInterval) {
      clearInterval(this.gameCheckInterval);
      this.gameCheckInterval = null;
    }

    if (this.gameCreateInterval) {
      clearInterval(this.gameCreateInterval);
      this.gameCreateInterval = null;
    }

    console.log('Game Orchestrator stopped');
  }

  // ===========================================================================
  // Game Creation
  // ===========================================================================

  async createGame(gameId?: string): Promise<string | null> {
    const id = gameId || this.generateGameId();

    const result = this.config.gameManager.createGame(id, {
      maxPlayers: this.config.defaultMaxPlayers,
      buyIn: this.config.defaultBuyIn,
    });

    if (!result.success) {
      console.error(`Failed to create game ${id}:`, result.error);
      return null;
    }

    const fillDeadline = Date.now() + this.config.fillDeadlineMinutes * 60_000;

    const pending: PendingGame = {
      gameId: id,
      tweetId: null,
      createdAt: Date.now(),
      fillDeadline,
      confirmedPlayers: new Map(),
    };

    this.pendingGames.set(id, pending);

    // Announce on Twitter
    if (this.config.twitterBot) {
      const tweetId = await this.config.twitterBot.announceNewGame({
        gameId: id,
        buyInSol: this.config.defaultBuyIn / LAMPORTS_PER_SOL,
        maxPlayers: this.config.defaultMaxPlayers,
      });

      pending.tweetId = tweetId;
      this.emit('game_announced', { gameId: id, tweetId });
    }

    console.log(`Game ${id} created, deadline: ${new Date(fillDeadline).toISOString()}`);
    return id;
  }

  private async createScheduledGame(): Promise<void> {
    // Check if there's already a waiting game
    const activeGames = this.config.gameManager.getActiveGames();
    const waitingGames = activeGames.filter(g => g.status === 'waiting');

    if (waitingGames.length > 0) {
      console.log('Skipping scheduled game creation - waiting game exists');
      return;
    }

    await this.createGame();
  }

  private generateGameId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `bd-${timestamp}-${random}`;
  }

  // ===========================================================================
  // Transaction Confirmation
  // ===========================================================================

  async confirmPlayerBuyIn(
    gameId: string,
    playerWallet: string,
    txSignature: string
  ): Promise<{ success: boolean; error?: string }> {
    const pending = this.pendingGames.get(gameId);
    if (!pending) {
      return { success: false, error: 'Game not found or already started' };
    }

    // Verify transaction on-chain
    try {
      const tx = await this.config.connection.getTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        return { success: false, error: 'Transaction not found' };
      }

      if (tx.meta?.err) {
        return { success: false, error: 'Transaction failed' };
      }

      // Verify transfer to escrow
      const preBalances = tx.meta?.preBalances || [];
      const postBalances = tx.meta?.postBalances || [];
      const accountKeys = tx.transaction.message.getAccountKeys();

      let transferVerified = false;
      for (let i = 0; i < accountKeys.length; i++) {
        if (accountKeys.get(i)?.equals(this.config.escrowWallet)) {
          const received = postBalances[i] - preBalances[i];
          if (received >= this.config.defaultBuyIn) {
            transferVerified = true;
            break;
          }
        }
      }

      if (!transferVerified) {
        return { success: false, error: 'Buy-in transfer not verified' };
      }

      // Add player to game
      const joinResult = this.config.gameManager.joinGame(gameId, playerWallet);
      if (!joinResult.success) {
        return { success: false, error: joinResult.error };
      }

      pending.confirmedPlayers.set(playerWallet, txSignature);
      this.emit('player_confirmed', { gameId, playerWallet, txSignature });

      // Send player their card via Twitter
      if (this.config.twitterBot && pending.tweetId) {
        await this.config.twitterBot.sendPlayerCard(gameId, playerWallet, pending.tweetId);
      }

      // Check if game is full
      const status = this.config.gameManager.getGameStatus(gameId);
      if (status && status.players.length >= this.config.defaultMaxPlayers) {
        if (this.config.autoStartOnFull) {
          await this.startGame(gameId);
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Error confirming buy-in:', error);
      return { success: false, error: 'Failed to verify transaction' };
    }
  }

  // ===========================================================================
  // Game Management
  // ===========================================================================

  private checkPendingGames(): void {
    const now = Date.now();

    for (const [gameId, pending] of this.pendingGames) {
      const status = this.config.gameManager.getGameStatus(gameId);
      if (!status) {
        this.pendingGames.delete(gameId);
        continue;
      }

      // Skip if already started
      if (status.status !== 'waiting') {
        this.pendingGames.delete(gameId);
        continue;
      }

      // Check deadline
      if (now >= pending.fillDeadline) {
        if (status.players.length >= 2) {
          // Start with available players
          console.log(`Starting game ${gameId} at deadline with ${status.players.length} players`);
          this.startGame(gameId);
        } else {
          // Cancel - not enough players
          console.log(`Cancelling game ${gameId} - not enough players at deadline`);
          this.cancelGame(gameId);
        }
      }
    }
  }

  async startGame(gameId: string): Promise<boolean> {
    const result = this.config.gameManager.startGame(gameId);
    if (!result.success) {
      console.error(`Failed to start game ${gameId}:`, result.error);
      return false;
    }

    this.pendingGames.delete(gameId);
    this.emit('game_auto_started', { gameId });

    console.log(`Game ${gameId} started`);
    return true;
  }

  async cancelGame(gameId: string): Promise<boolean> {
    const pending = this.pendingGames.get(gameId);
    if (!pending) {
      return false;
    }

    const result = this.config.gameManager.cancelGame(gameId);
    if (!result.success) {
      console.error(`Failed to cancel game ${gameId}:`, result.error);
      return false;
    }

    this.pendingGames.delete(gameId);

    // TODO: Process refunds for confirmed players
    if (pending.confirmedPlayers.size > 0) {
      console.log(`Game ${gameId} cancelled - ${pending.confirmedPlayers.size} refunds needed`);
      // Refund logic would go here
    }

    return true;
  }

  // ===========================================================================
  // Payout
  // ===========================================================================

  /**
   * Calculate payout details for a completed game.
   * Returns the winner wallet and amount - operator executes payout manually.
   */
  getPayoutDetails(gameId: string): {
    success: boolean;
    gameId?: string;
    winnerWallet?: string;
    prizePoolLamports?: number;
    prizePoolSol?: number;
    playerCount?: number;
    buyInLamports?: number;
    payoutStatus?: 'pending' | 'paid';
    error?: string;
  } {
    const status = this.config.gameManager.getGameStatus(gameId);
    if (!status) {
      return { success: false, error: 'Game not found' };
    }

    if (status.status !== 'complete') {
      return { success: false, error: `Game is ${status.status}, not complete` };
    }

    if (!status.winner) {
      return { success: false, error: 'No winner recorded' };
    }

    const prizePoolLamports = status.players.length * this.config.defaultBuyIn;
    const payoutStatus = this.paidGames.has(gameId) ? 'paid' : 'pending';

    return {
      success: true,
      gameId,
      winnerWallet: status.winner,
      prizePoolLamports,
      prizePoolSol: prizePoolLamports / LAMPORTS_PER_SOL,
      playerCount: status.players.length,
      buyInLamports: this.config.defaultBuyIn,
      payoutStatus,
    };
  }

  /**
   * Mark a game as paid (after operator manually sends payout).
   */
  markGamePaid(gameId: string, txSignature?: string): { success: boolean; error?: string } {
    const status = this.config.gameManager.getGameStatus(gameId);
    if (!status || status.status !== 'complete') {
      return { success: false, error: 'Game not complete' };
    }

    if (this.paidGames.has(gameId)) {
      return { success: false, error: 'Game already marked as paid' };
    }

    this.paidGames.set(gameId, {
      paidAt: Date.now(),
      txSignature: txSignature || null,
    });

    this.emit('payout_completed', {
      gameId,
      winnerWallet: status.winner,
      txSignature,
    });

    console.log(`Game ${gameId} marked as paid${txSignature ? ` (tx: ${txSignature})` : ''}`);
    return { success: true };
  }

  /**
   * Get all games pending payout.
   */
  getPendingPayouts(): Array<{
    gameId: string;
    winnerWallet: string;
    prizePoolSol: number;
  }> {
    const results: Array<{
      gameId: string;
      winnerWallet: string;
      prizePoolSol: number;
    }> = [];

    const activeGames = this.config.gameManager.getActiveGames();
    for (const game of activeGames) {
      if (game.status === 'complete' && game.winner && !this.paidGames.has(game.gameId)) {
        const prizePoolLamports = game.players.length * this.config.defaultBuyIn;
        results.push({
          gameId: game.gameId,
          winnerWallet: game.winner,
          prizePoolSol: prizePoolLamports / LAMPORTS_PER_SOL,
        });
      }
    }

    return results;
  }

  async processWinnerPayout(
    gameId: string,
    winnerWallet: string
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    const status = this.config.gameManager.getGameStatus(gameId);
    if (!status || status.status !== 'complete') {
      return { success: false, error: 'Game not complete' };
    }

    if (status.winner !== winnerWallet) {
      return { success: false, error: 'Wallet is not the winner' };
    }

    // Calculate prize pool
    const prizePool = status.players.length * this.config.defaultBuyIn;
    console.log(`Payout pending: ${prizePool / LAMPORTS_PER_SOL} SOL to ${winnerWallet}`);
    console.log(`Use GET /api/admin/payouts/pending to see pending payouts`);
    console.log(`Use POST /api/admin/payouts/:gameId/mark-paid to mark as paid after manual transfer`);

    // Emit event for tracking - operator handles actual transfer
    this.emit('payout_pending', { gameId, winnerWallet, amount: prizePool });

    return { success: true };
  }

  // ===========================================================================
  // Event Listeners
  // ===========================================================================

  private setupEventListeners(): void {
    // When a game completes, process payout
    this.config.gameManager.on('game_complete', async (event) => {
      const { gameId, winner } = event;
      console.log(`Game ${gameId} complete, winner: ${winner}`);

      // Process payout
      await this.processWinnerPayout(gameId, winner);
    });
  }

  // ===========================================================================
  // Status
  // ===========================================================================

  getStatus(): {
    isRunning: boolean;
    pendingGames: number;
    activeGames: number;
  } {
    const activeGames = this.config.gameManager.getActiveGames();
    return {
      isRunning: this.isRunning,
      pendingGames: this.pendingGames.size,
      activeGames: activeGames.length,
    };
  }

  getPendingGames(): PendingGame[] {
    return Array.from(this.pendingGames.values());
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createOrchestrator(
  gameManager: GameManager,
  twitterBot: TwitterBot | null,
  options?: Partial<Omit<OrchestratorConfig, 'gameManager' | 'twitterBot' | 'connection' | 'escrowWallet'>>
): GameOrchestrator | null {
  const rpcUrl = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
  const escrowWallet = process.env.ESCROW_WALLET;

  if (!escrowWallet) {
    console.warn('ESCROW_WALLET not configured, orchestrator disabled');
    return null;
  }

  const connection = new Connection(rpcUrl);
  const escrowPubkey = new PublicKey(escrowWallet);

  return new GameOrchestrator({
    connection,
    escrowWallet: escrowPubkey,
    gameManager,
    twitterBot,
    defaultBuyIn: options?.defaultBuyIn ?? 0.001 * LAMPORTS_PER_SOL,
    defaultMaxPlayers: options?.defaultMaxPlayers ?? 10,
    autoStartOnFull: options?.autoStartOnFull ?? true,
    fillDeadlineMinutes: options?.fillDeadlineMinutes ?? 60,
    autoCreateGames: options?.autoCreateGames ?? false,
    gameIntervalMinutes: options?.gameIntervalMinutes ?? 120,
  });
}
