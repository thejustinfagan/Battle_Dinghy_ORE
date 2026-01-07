import { Connection, PublicKey } from "@solana/web3.js";
import { dbStorage as storage } from "./db-storage";
import { oreHashToCoordinate, processShot, calculateTotalHullPoints } from "./game-engine";
import { postShotAnnouncement, postWinnerAnnouncement } from "./twitter-bot";
import type { Player } from "@shared/schema";

// Network configuration - same as solana-escrow.ts
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || "devnet";

// Build Helius RPC URL if API key is provided
const buildHeliusUrl = (network: string) => {
  const apiKey = process.env.HELIUS_API_KEY;
  if (apiKey) {
    return `https://${network}.helius-rpc.com/?api-key=${apiKey}`;
  }
  return null;
};

const SOLANA_RPC_URLS = {
  devnet: buildHeliusUrl("devnet") || process.env.SOLANA_DEVNET_RPC || "https://api.devnet.solana.com",
  mainnet: buildHeliusUrl("mainnet-beta") || process.env.SOLANA_MAINNET_RPC || "https://api.mainnet-beta.solana.com",
};

const SOLANA_RPC_URL = SOLANA_RPC_URLS[SOLANA_NETWORK as keyof typeof SOLANA_RPC_URLS];

// ORE Program ID - v3 on mainnet
const ORE_PROGRAM_ID = process.env.ORE_PROGRAM_ID 
  ? new PublicKey(process.env.ORE_PROGRAM_ID)
  : new PublicKey("oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv");

console.log(`⛏️  ORE Monitor - Network: ${SOLANA_NETWORK.toUpperCase()}`);
console.log(`⛏️  ORE Monitor - RPC: ${SOLANA_RPC_URL}`);

export class OreMonitor {
  private connection: Connection;
  private isMonitoring: boolean = false;
  private activeGameId: string | null = null;
  private subscriptionId: number | null = null;

  constructor() {
    this.connection = new Connection(SOLANA_RPC_URL, "confirmed");
  }

  async startMonitoring(gameId: string): Promise<void> {
    if (this.isMonitoring && this.activeGameId === gameId) {
      console.log(`ORE monitor already running for game ${gameId}`);
      return;
    }

    if (this.isMonitoring) {
      console.log("Stopping previous ORE monitor before starting new one");
      this.stopMonitoring();
    }

    this.activeGameId = gameId;
    this.isMonitoring = true;
    
    console.log(`Starting ORE monitoring for game ${gameId}`);

    this.subscriptionId = this.connection.onLogs(
      ORE_PROGRAM_ID,
      async (logs) => {
        if (!this.isMonitoring || !this.activeGameId) return;

        try {
          const blockHash = logs.signature;
          await this.processOreBlock(this.activeGameId, blockHash);
        } catch (error) {
          console.error("Error processing ORE block:", error);
        }
      },
      "confirmed"
    );

    console.log(`ORE monitor started with subscription ID: ${this.subscriptionId}`);
  }

  async processOreBlock(gameId: string, blockHash: string, manualCoordinate?: string): Promise<{
    status: 'shot' | 'duplicate' | 'game_complete' | 'game_not_active';
    shot?: any;
    game?: any;
  }> {
    try {
      const game = await storage.getGame(gameId);
      if (!game || game.status !== "active") {
        console.log(`Game ${gameId} not active, stopping ORE monitor`);
        this.stopMonitoring();
        return { status: 'game_not_active', game };
      }

      // Use manual coordinate if provided, otherwise convert ORE hash
      const coordinate = manualCoordinate || oreHashToCoordinate(blockHash);

      // Retry loop for shot creation with fresh state on each attempt
      let shot;
      let shotNumber;
      let isDuplicate;
      const MAX_RETRIES = 50; // High limit to handle sustained concurrency
      
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        // Fetch fresh shots on each attempt to avoid stale duplicate/number checks
        const freshShots = await storage.getShotsByGame(gameId);
        shotNumber = freshShots.length + 1;

        // Check completion before attempting insert
        if (shotNumber > 25) {
          console.log(`Game ${gameId} complete (25 shots fired)`);
          await storage.updateGameStatus(gameId, "completed");
          this.stopMonitoring();
          const updatedGame = await storage.getGame(gameId);
          return { status: 'game_complete', game: updatedGame };
        }

        // Re-check duplicate status with fresh shots
        isDuplicate = freshShots.some(s => s.coordinate === coordinate);

        if (isDuplicate) {
          console.log(`Shot ${shotNumber}: ${coordinate} is a duplicate (DUD) - skipping`);
          const freshGame = await storage.getGame(gameId);
          return { status: 'duplicate', game: freshGame };
        }

        // Try to create shot
        try {
          shot = await storage.createShot({
            gameId,
            shotNumber,
            coordinate,
            oreBlockHash: blockHash,
            isDuplicate,
          });
          break; // Success!
        } catch (error: any) {
          // Handle unique constraint violations
          if (error.code === '23505') {
            if (error.message?.includes('unique_coordinate_per_game')) {
              // Coordinate was taken by concurrent request - verify and return duplicate
              console.log(`Coordinate ${coordinate} taken concurrently - verifying duplicate`);
              const freshGame = await storage.getGame(gameId);
              return { status: 'duplicate', game: freshGame };
            } else if (error.message?.includes('unique_shot_number_per_game')) {
              // Shot number taken - retry with exponential backoff + jitter
              const baseDelay = Math.min(100 * Math.pow(1.5, attempt), 2000); // Cap at 2s
              const jitter = Math.random() * baseDelay * 0.5; // Add 0-50% jitter
              const delay = Math.floor(baseDelay + jitter);
              console.log(`Shot number ${shotNumber} taken (attempt ${attempt + 1}/${MAX_RETRIES}) - retrying in ${delay}ms`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
          }
          // Re-throw unexpected errors
          throw error;
        }
      }
      
      // Retry exhaustion - verify the coordinate wasn't inserted before failing
      if (!shot) {
        console.error(`Failed to create shot after ${MAX_RETRIES} retries - verifying state`);
        const verifyShots = await storage.getShotsByGame(gameId);
        const coordinateExists = verifyShots.some(s => s.coordinate === coordinate);
        
        if (coordinateExists) {
          // Another request successfully inserted it - return duplicate
          console.log(`Coordinate ${coordinate} was inserted by concurrent request - duplicate`);
          const freshGame = await storage.getGame(gameId);
          return { status: 'duplicate', game: freshGame };
        } else {
          // Coordinate was never inserted - this is an error state
          console.error(`CRITICAL: Failed to insert shot for coordinate ${coordinate} after ${MAX_RETRIES} retries - coordinate not found in DB`);
          throw new Error(`Shot insertion failed after ${MAX_RETRIES} retries without constraint violation - database contention too high`);
        }
      }

      console.log(`Shot ${shotNumber}: ${coordinate} (hash: ${blockHash.slice(0, 8)}...)`);

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
          console.log(`  💀 @${player.twitterHandle} ELIMINATED`);
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
      console.log(`  👥 ${alivePlayers.length} players remaining`);

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

        console.log(`🏆 WINNER: @${winner.twitterHandle}`);

        await postWinnerAnnouncement(game, winner, {
          shotsTotal: shotNumber,
          hullRemaining: winner.hullPoints,
        });

        this.stopMonitoring();
        
        // Re-fetch game to get updated status and winnerId
        const updatedGame = await storage.getGame(gameId);
        return { status: 'shot', shot, game: updatedGame };
      } else if (alivePlayers.length === 0) {
        await storage.updateGameStatus(gameId, "completed");
        console.log(`Game ${gameId} completed with no survivors (all eliminated)`);
        this.stopMonitoring();
        
        // Re-fetch game to get updated status
        const updatedGame = await storage.getGame(gameId);
        return { status: 'shot', shot, game: updatedGame };
      } else if (shotNumber === 25) {
        await storage.updateGameStatus(gameId, "completed");
        console.log(`Game ${gameId} completed after 25 shots with ${alivePlayers.length} survivors`);
        
        const topPlayer = alivePlayers.sort((a, b) => b.hullPoints - a.hullPoints)[0];
        await storage.setGameWinner(gameId, topPlayer.id);
        
        await postWinnerAnnouncement(game, topPlayer, {
          shotsTotal: 25,
          hullRemaining: topPlayer.hullPoints,
        });

        this.stopMonitoring();
        
        // Re-fetch game to get updated status and winnerId
        const updatedGame = await storage.getGame(gameId);
        return { status: 'shot', shot, game: updatedGame };
      }
      
      // Re-fetch game before returning to capture any concurrent completions
      const freshGame = await storage.getGame(gameId);
      return { status: 'shot', shot, game: freshGame };
    } catch (error) {
      console.error(`Error processing ORE block for game ${gameId}:`, error);
      throw error;
    }
  }

  stopMonitoring(): void {
    if (this.subscriptionId !== null) {
      this.connection.removeOnLogsListener(this.subscriptionId);
      console.log(`Removed ORE log subscription ${this.subscriptionId}`);
      this.subscriptionId = null;
    }
    
    this.isMonitoring = false;
    this.activeGameId = null;
    console.log("ORE monitor stopped");
  }

  getStatus(): { isMonitoring: boolean; gameId: string | null; subscriptionId: number | null } {
    return {
      isMonitoring: this.isMonitoring,
      gameId: this.activeGameId,
      subscriptionId: this.subscriptionId,
    };
  }
}

export const oreMonitor = new OreMonitor();
