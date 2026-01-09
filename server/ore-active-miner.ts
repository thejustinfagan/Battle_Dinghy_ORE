import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { 
  OreMiner, 
  calculateAllSquaresMask, 
  calculateMaxDeployPerBlock,
  fetchRoundData,
  oreSquareIndexToCoordinate,
  getBoardPda,
  fetchBoardCurrentRound
} from "./ore-miner";
import { dbStorage as storage } from "./db-storage";
import { oreHashToCoordinate, processShot, calculateTotalHullPoints } from "./game-engine";
import { postShotAnnouncement, postWinnerAnnouncement } from "./twitter-bot";
import type { Game, Player, OreMiningRound } from "@shared/schema";

// Network configuration
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || "devnet";

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

// Round duration in milliseconds (1 minute)
const ROUND_DURATION_MS = 60 * 1000;

console.log(`⚡ ORE Active Miner - Network: ${SOLANA_NETWORK.toUpperCase()}`);
console.log(`⚡ ORE Active Miner - RPC: ${SOLANA_RPC_URL}`);

/**
 * Active ORE Mining Orchestrator
 * Manages the Deploy → Wait → Checkpoint → ClaimSOL → Repeat loop for a single game
 */
export class OreActiveMiner {
  private gameId: string;
  private oreMiner: OreMiner;
  private connection: Connection;
  private escrowKeypair: Keypair; // Store for balance checking
  private isRunning: boolean = false;
  private currentRound: number = 0;
  private nextRoundTimer: NodeJS.Timeout | null = null;
  
  constructor(gameId: string, escrowKeypair: Keypair) {
    this.gameId = gameId;
    this.escrowKeypair = escrowKeypair;
    this.oreMiner = new OreMiner(escrowKeypair);
    this.connection = new Connection(SOLANA_RPC_URL, "confirmed");
    
    console.log(`⚡ OreActiveMiner initialized for game ${gameId}`);
  }
  
  /**
   * Start active mining for this game
   */
  async start(prizePoolLamports: number): Promise<void> {
    if (this.isRunning) {
      console.log(`Mining already running for game ${this.gameId}`);
      return;
    }
    
    this.isRunning = true;
    const game = await storage.getGame(this.gameId);
    
    if (!game) {
      throw new Error(`Game ${this.gameId} not found`);
    }
    
    // Calculate max deployment per block
    const deployPerBlock = calculateMaxDeployPerBlock(prizePoolLamports);
    const squaresMask = calculateAllSquaresMask();
    
    // Store miner info in game
    const minerInfo = this.oreMiner.getMinerInfo();
    await storage.updateGame(this.gameId, {
      oreMinerAddress: minerInfo.address,
      oreMinerAuthority: this.oreMiner['authority'].toString(),
      oreMinerBump: minerInfo.bump,
      oreDeployPerBlock: deployPerBlock,
      oreCurrentRound: 0,
    });
    
    console.log(`🚀 Starting active ORE mining for game ${this.gameId}`);
    console.log(`  Prize Pool: ${prizePoolLamports / LAMPORTS_PER_SOL} SOL`);
    console.log(`  Deploy per block: ${deployPerBlock / LAMPORTS_PER_SOL} SOL`);
    console.log(`  Squares mask: 0x${squaresMask.toString(16)}`);
    
    // Start the mining loop
    await this.executeRound(1, deployPerBlock, squaresMask);
  }
  
  /**
   * Execute a single mining round
   */
  private async executeRound(roundNumber: number, deployPerBlock: number, squaresMask: number): Promise<void> {
    if (!this.isRunning) {
      console.log(`Mining stopped for game ${this.gameId}`);
      return;
    }
    
    try {
      console.log(`\n⛏️  Round ${roundNumber}/25 - Game ${this.gameId}`);
      
      // Create round record
      const round = await storage.createOreMiningRound({
        gameId: this.gameId,
        roundNumber,
        squaresBitmask: squaresMask,
        deployLamports: deployPerBlock * 25, // Total deployment
        status: "pending",
      });
      
      // 1. Deploy SOL to all 25 blocks
      console.log(`  📤 Deploying ${deployPerBlock / LAMPORTS_PER_SOL} SOL to each of 25 blocks...`);
      const deployTx = await this.oreMiner.deploy(deployPerBlock);
      
      await storage.updateOreMiningRound(round.id, {
        status: "deployed",
        txDeploy: deployTx,
        deployedAt: new Date(),
      });
      
      console.log(`  ✅ Deploy successful: ${deployTx}`);
      
      // 2. Wait for round to complete (~60 seconds)
      console.log(`  ⏳ Waiting ${ROUND_DURATION_MS / 1000}s for round to complete...`);
      await this.sleep(ROUND_DURATION_MS);
      
      // 3. Checkpoint to record rewards
      console.log(`  📊 Checkpointing round ${roundNumber}...`);
      const checkpointTx = await this.oreMiner.checkpoint(roundNumber);
      
      await storage.updateOreMiningRound(round.id, {
        status: "checkpointed",
        txCheckpoint: checkpointTx,
        checkpointedAt: new Date(),
      });
      
      console.log(`  ✅ Checkpoint successful: ${checkpointTx}`);
      
      // 4. Claim SOL immediately for next round and track ACTUAL delta
      console.log(`  💰 Claiming SOL rewards...`);
      
      // CRITICAL FIX: Track escrow wallet balance before/after claim to measure actual SOL received
      const escrowBalanceBefore = await this.connection.getBalance(this.escrowKeypair.publicKey);
      console.log(`  📊 Escrow balance BEFORE claim: ${escrowBalanceBefore / LAMPORTS_PER_SOL} SOL`);
      
      const claimSolTx = await this.oreMiner.claimSol();
      
      // Poll balance until it stabilizes (confirms claim transaction processed)
      let escrowBalanceAfter = escrowBalanceBefore;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const newBalance = await this.connection.getBalance(this.escrowKeypair.publicKey);
        
        if (newBalance !== escrowBalanceAfter) {
          escrowBalanceAfter = newBalance;
          console.log(`  📊 Balance updated: ${escrowBalanceAfter / LAMPORTS_PER_SOL} SOL`);
          // Wait one more second to ensure no more changes
          await new Promise(resolve => setTimeout(resolve, 1000));
          const finalCheck = await this.connection.getBalance(this.escrowKeypair.publicKey);
          if (finalCheck === escrowBalanceAfter) {
            break; // Balance stabilized
          }
          escrowBalanceAfter = finalCheck;
        }
        attempts++;
      }
      
      console.log(`  📊 Escrow balance AFTER claim: ${escrowBalanceAfter / LAMPORTS_PER_SOL} SOL (${attempts} polls)`);
      
      // Calculate the actual SOL delta (profit/loss) for this round
      // Delta = (SOL received from claim) - (SOL deployed this round)
      const deployedThisRound = deployPerBlock * 25;
      const claimedAmount = escrowBalanceAfter - escrowBalanceBefore;
      const solDeltaThisRound = claimedAmount - deployedThisRound;
      
      console.log(`  ✅ ClaimSOL successful: ${claimSolTx}`);
      console.log(`  💵 Deployed: ${deployedThisRound / LAMPORTS_PER_SOL} SOL`);
      console.log(`  💰 Claimed: ${claimedAmount / LAMPORTS_PER_SOL} SOL`);
      console.log(`  📈 Delta this round: ${solDeltaThisRound >= 0 ? "+" : ""}${solDeltaThisRound / LAMPORTS_PER_SOL} SOL`);
      
      // 5. Get winning square from ORE round PDA - PROVABLY FAIR RANDOMNESS!
      console.log(`  🔍 Fetching ORE round data for provably fair randomness...`);
      
      let roundData = null;
      let coordinate = "";
      let usedFallback = false;
      
      // CRITICAL: Try to get round data from ORE board PDA, but don't crash if unavailable
      // This allows fallback to hash-based randomness for game progression
      
      // Try to read board PDA for authoritative completed round ID (with retries for checkpoint lag)
      let boardCurrentRound: number | null = null;
      const maxBoardRetries = 10; // Extended retries for devnet lag
      
      for (let retryAttempt = 0; retryAttempt < maxBoardRetries; retryAttempt++) {
        boardCurrentRound = await fetchBoardCurrentRound(this.connection);
        
        // If we got a valid round number > 0, we can proceed
        if (boardCurrentRound !== null && boardCurrentRound > 0) {
          console.log(`  ✅ Board round fetched: ${boardCurrentRound} (attempt ${retryAttempt + 1})`);
          break;
        }
        
        // For round 1, board may still be at round 0 - this is expected!
        console.log(`  ⏳ Board round ${boardCurrentRound ?? 'null'} (attempt ${retryAttempt + 1}/${maxBoardRetries}), waiting 2s...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // If we successfully got a board round, try to fetch the completed round data
      let completedRoundId: number | null = null;
      if (boardCurrentRound !== null && boardCurrentRound > 0) {
        completedRoundId = boardCurrentRound - 1;
        console.log(`  🔢 Board current round: ${boardCurrentRound}, Completed round: ${completedRoundId}`);
        
        // Try to fetch the actual round PDA data
        for (let attempt = 0; attempt < 5; attempt++) {
          roundData = await fetchRoundData(this.connection, completedRoundId);
          
          if (roundData) {
            // Validate round number matches what we expect
            if (Number(roundData.roundNumber) !== completedRoundId) {
              console.log(`  ⚠️  Round number mismatch! Expected ${completedRoundId}, got ${roundData.roundNumber}`);
              roundData = null;
              await new Promise(resolve => setTimeout(resolve, 3000));
              continue;
            }
            
            // Validate winning square index is in valid range (0-24)
            if (roundData.winningSquareIndex < 0 || roundData.winningSquareIndex > 24) {
              console.error(`  ❌ Invalid winning square index: ${roundData.winningSquareIndex} - using fallback`);
              roundData = null;
              break;
            }
            
            console.log(`  ✅ Round data fetched and validated!`);
            console.log(`  🎲 Winning square index: ${roundData.winningSquareIndex}`);
            console.log(`  💰 Total SOL deployed in round: ${Number(roundData.totalSolDeployed) / LAMPORTS_PER_SOL} SOL`);
            console.log(`  🎰 Motherlode triggered: ${roundData.motherlodeTriggered ? "YES! 🎉" : "No"}`);
            
            // Convert winning square index (0-24) to coordinate (A1-E5)
            coordinate = oreSquareIndexToCoordinate(roundData.winningSquareIndex);
            console.log(`  🎯 Provably fair coordinate: ${coordinate}`);
            break;
          }
          
          console.log(`  ⏳ Round data not available (attempt ${attempt + 1}/5), waiting 3s...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      } else {
        console.log(`  ⚠️  Board round unavailable after ${maxBoardRetries} retries`);
      }
      
      // Fallback to hash-based coordinate if round data unavailable
      // This ensures game can progress even if ORE board PDA is lagging
      if (!roundData || !coordinate) {
        usedFallback = true;
        coordinate = oreHashToCoordinate(deployTx);
        console.log(`  ⚠️  WARNING: Using hash-based fallback coordinate: ${coordinate}`);
        console.log(`  ⚠️  This is NOT provably fair - board PDA data was unavailable`);
        console.log(`  ⚠️  Ops should investigate ORE board PDA lag on this network`);
      }
      
      // CRITICAL: Persist ALL round data including SOL claim + fallback state in ONE update
      await storage.updateOreMiningRound(round.id, {
        status: "claimed",
        txClaimSol: claimSolTx,
        claimedAt: new Date(),
        solClaimedLamports: solDeltaThisRound, // Delta, not absolute balance
        usedFallback,
        completedRoundId: completedRoundId ?? undefined,
      });
      
      // Fire shot using existing game logic
      // CRITICAL: Use completedRoundId (not roundNumber) in blockHash for accurate audit trail
      const blockHash = roundData && completedRoundId !== null
        ? `ORE_ROUND_${completedRoundId}_SQUARE_${roundData.winningSquareIndex}`
        : `${deployTx}_HASH_FALLBACK`;
      
      await this.fireShot(roundNumber, coordinate, blockHash);
      
      // Update game progress with proper SOL accounting (accumulate, don't overwrite!)
      const currentGame = await storage.getGame(this.gameId);
      if (!currentGame) throw new Error("Game not found");
      
      const totalDeployed = (currentGame.oreSolDeployedTotal ?? 0) + deployedThisRound;
      const totalClaimed = (currentGame.oreSolClaimedTotal ?? 0) + solDeltaThisRound;
      const netProfit = totalClaimed; // Net profit is the sum of all deltas!
      
      await storage.updateGame(this.gameId, {
        oreCurrentRound: roundNumber,
        oreLastCheckpoint: new Date(),
        oreSolDeployedTotal: totalDeployed,
        oreSolClaimedTotal: totalClaimed,
        oreSolNetProfit: netProfit,
      });
      
      // Check if game is complete
      const game = await storage.getGame(this.gameId);
      if (!game || game.status === "completed") {
        console.log(`  🏁 Game completed, stopping mining`);
        await this.finalizeGame();
        return;
      }
      
      // Schedule next round
      if (roundNumber < 25) {
        console.log(`  ⏭️  Scheduling round ${roundNumber + 1}...`);
        this.nextRoundTimer = setTimeout(() => {
          this.executeRound(roundNumber + 1, deployPerBlock, squaresMask);
        }, 5000); // Small buffer before next round
      } else {
        // All 25 rounds complete
        console.log(`  🎉 All 25 rounds complete!`);
        await this.finalizeGame();
      }
      
    } catch (error) {
      console.error(`❌ CRITICAL ERROR in round ${roundNumber}:`, error);
      
      // Mark round as failed with error details
      const rounds = await storage.getOreMiningRounds(this.gameId);
      const failedRound = rounds.find(r => r.roundNumber === roundNumber);
      
      if (failedRound) {
        await storage.updateOreMiningRound(failedRound.id, {
          status: "failed",
        });
      }
      
      // Properly stop mining and clear timers
      this.isRunning = false;
      if (this.nextRoundTimer) {
        clearTimeout(this.nextRoundTimer);
        this.nextRoundTimer = null;
      }
      
      // Persist error state in game record
      await storage.updateGame(this.gameId, {
        oreMinerClosedAt: new Date(), // Mark as closed due to error
      });
      
      console.log(`⏹️  Mining stopped due to error - game ${this.gameId}`);
      console.log(`  ⚠️  Admin intervention required for recovery`);
      
      // TODO: Expose admin recovery endpoint to restart from last successful round
      throw error; // Re-throw so caller knows about failure
    }
  }
  
  /**
   * Fire a shot in the game
   */
  private async fireShot(shotNumber: number, coordinate: string, blockHash: string): Promise<void> {
    const game = await storage.getGame(this.gameId);
    if (!game) return;
    
    // Create shot
    const shot = await storage.createShot({
      gameId: this.gameId,
      shotNumber,
      coordinate,
      oreBlockHash: blockHash,
      isDuplicate: false,
    });
    
    console.log(`  🔫 Shot ${shotNumber}: ${coordinate}`);
    
    // Process shot against all players
    const players = await storage.getPlayersByGame(this.gameId);
    const hitPlayers: Array<{ player: Player; result: string; shipHit: string | null }> = [];
    
    for (const player of players) {
      if (player.status === "eliminated") continue;
      
      const shotResult = processShot(player.boardState, coordinate);
      
      await storage.updatePlayerBoard(player.id, shotResult.updatedBoard);
      
      const newHullPoints = calculateTotalHullPoints(shotResult.updatedBoard);
      await storage.updatePlayerHullPoints(player.id, newHullPoints);
      
      if (shotResult.result === "eliminated") {
        await storage.updatePlayerStatus(player.id, "eliminated", shotNumber);
        console.log(`    💀 @${player.twitterHandle} ELIMINATED`);
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
    
    const alivePlayers = await storage.getAlivePlayers(this.gameId);
    console.log(`    👥 ${alivePlayers.length} players remaining`);
    
    // Post shot announcement
    const tweetId = await postShotAnnouncement(
      game,
      shotNumber,
      coordinate,
      hitPlayers,
      alivePlayers.length
    );
    
    await storage.updateShotTweet(shot.id, tweetId);
    
    // Check for winner
    if (alivePlayers.length === 1) {
      const winner = alivePlayers[0];
      await storage.setGameWinner(this.gameId, winner.id);
      await storage.updateGameStatus(this.gameId, "completed");
      
      console.log(`  🏆 WINNER: @${winner.twitterHandle}`);
      
      await postWinnerAnnouncement(game, winner, {
        shotsTotal: shotNumber,
        hullRemaining: winner.hullPoints,
      });
    } else if (shotNumber === 25 && alivePlayers.length > 1) {
      // 25 shots complete, pick winner with most hull points
      const topPlayer = alivePlayers.sort((a, b) => b.hullPoints - a.hullPoints)[0];
      await storage.setGameWinner(this.gameId, topPlayer.id);
      await storage.updateGameStatus(this.gameId, "completed");
      
      await postWinnerAnnouncement(game, topPlayer, {
        shotsTotal: 25,
        hullRemaining: topPlayer.hullPoints,
      });
    }
  }
  
  /**
   * Finalize game - transfer prize to winner, claim ORE and close miner
   * CRITICAL: Checks actual escrow balance before payout to handle mining losses
   */
  private async finalizeGame(): Promise<void> {
    console.log(`\n🏁 Finalizing game ${this.gameId}...`);

    try {
      const game = await storage.getGame(this.gameId);
      if (!game || !game.winnerId) {
        console.error(`  ❌ No winner found for game ${this.gameId}`);
        return;
      }

      const winner = await storage.getPlayer(game.winnerId);
      if (!winner) {
        console.error(`  ❌ Winner player not found: ${game.winnerId}`);
        return;
      }

      // CRITICAL: Get ACTUAL escrow balance to handle mining losses
      const escrowBalance = await this.connection.getBalance(this.escrowKeypair.publicKey);
      const RENT_EXEMPT_MIN = 890880; // ~0.00089 SOL minimum for rent exemption
      const availableBalance = Math.max(0, escrowBalance - RENT_EXEMPT_MIN);

      console.log(`  📊 Escrow balance: ${escrowBalance / LAMPORTS_PER_SOL} SOL`);
      console.log(`  📊 Available for payout: ${availableBalance / LAMPORTS_PER_SOL} SOL`);
      console.log(`  📊 Expected prize pool: ${game.prizePoolSol / LAMPORTS_PER_SOL} SOL`);

      // CRITICAL: Check if we have enough to pay the winner
      const platformFeeBasisPoints = game.platformFeeBasisPoints || 0;

      // Calculate expected vs actual payout
      const expectedPayout = game.prizePoolSol - Math.floor((game.prizePoolSol * platformFeeBasisPoints) / 10000);

      let actualPayoutLamports: number;
      let actualPlatformFeeLamports: number;

      if (availableBalance >= expectedPayout) {
        // Normal case: we have enough SOL
        actualPlatformFeeLamports = Math.floor((game.prizePoolSol * platformFeeBasisPoints) / 10000);
        actualPayoutLamports = game.prizePoolSol - actualPlatformFeeLamports;
      } else {
        // SHORTFALL: Mining lost SOL - pay winner what we have (minus minimal platform fee)
        console.warn(`  ⚠️ PRIZE SHORTFALL DETECTED!`);
        console.warn(`  ⚠️ Expected: ${expectedPayout / LAMPORTS_PER_SOL} SOL`);
        console.warn(`  ⚠️ Available: ${availableBalance / LAMPORTS_PER_SOL} SOL`);
        console.warn(`  ⚠️ Shortfall: ${(expectedPayout - availableBalance) / LAMPORTS_PER_SOL} SOL`);

        // In shortfall scenario, reduce platform fee proportionally and pay winner the rest
        const shortfallRatio = availableBalance / game.prizePoolSol;
        actualPlatformFeeLamports = Math.floor((availableBalance * platformFeeBasisPoints) / 10000);
        actualPayoutLamports = availableBalance - actualPlatformFeeLamports;

        // Log the discrepancy for auditing
        await storage.updateGame(this.gameId, {
          oreSolNetProfit: availableBalance - game.prizePoolSol, // Negative = loss
        });
      }

      const platformFeePercentage = platformFeeBasisPoints / 100;
      console.log(`  💰 Original Prize Pool: ${game.prizePoolSol / LAMPORTS_PER_SOL} SOL`);
      console.log(`  💸 Platform Fee (${platformFeePercentage}%): ${actualPlatformFeeLamports / LAMPORTS_PER_SOL} SOL`);
      console.log(`  🏆 Winner Payout: ${actualPayoutLamports / LAMPORTS_PER_SOL} SOL`);

      // Ensure we have something to pay
      if (actualPayoutLamports <= 0) {
        console.error(`  ❌ CRITICAL: No funds available for winner payout!`);
        await storage.updateGame(this.gameId, {
          oreMinerClosedAt: new Date(),
        });
        this.stop();
        return;
      }

      // Transfer prize to winner
      const { solanaEscrow } = await import("./solana-escrow");
      const { PublicKey } = await import("@solana/web3.js");

      const winnerPublicKey = new PublicKey(winner.walletAddress);
      const txSignature = await solanaEscrow.sendPrizeToWinner(winnerPublicKey, actualPayoutLamports);

      console.log(`  ✅ Prize transferred to @${winner.twitterHandle}`);
      console.log(`     TX: ${txSignature}`);

      // Update platform fees collected
      await storage.updateGame(this.gameId, {
        platformFeesCollected: actualPlatformFeeLamports,
        winnerPayoutLamports: actualPayoutLamports,
        winnerPayoutTx: txSignature,
      });

      // TODO: Create miner's ORE token account
      // TODO: ClaimORE instruction
      // TODO: Close miner account
      // TODO: Transfer ORE to winner

      console.log(`  📝 Game finalization complete (ORE claim/transfer pending full implementation)`);

      await storage.updateGame(this.gameId, {
        oreMinerClosedAt: new Date(),
      });

      this.stop();
    } catch (error) {
      console.error(`❌ Error finalizing game:`, error);
    }
  }
  
  /**
   * Stop mining
   */
  stop(): void {
    if (this.nextRoundTimer) {
      clearTimeout(this.nextRoundTimer);
      this.nextRoundTimer = null;
    }
    
    this.isRunning = false;
    console.log(`⏹️  Mining stopped for game ${this.gameId}`);
  }
  
  /**
   * Helper to sleep for a duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Get mining status
   */
  getStatus(): { isRunning: boolean; currentRound: number; gameId: string } {
    return {
      isRunning: this.isRunning,
      currentRound: this.currentRound,
      gameId: this.gameId,
    };
  }
}

/**
 * Active Mining Manager - singleton to manage all active miners
 * Includes periodic cleanup to prevent memory leaks
 */
class OreActiveMiningService {
  private activeMiners: Map<string, OreActiveMiner> = new Map();
  private escrowKeypair: Keypair | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize with escrow keypair
   */
  initialize(escrowKeypair: Keypair): void {
    this.escrowKeypair = escrowKeypair;
    console.log(`⚡ OreActiveMiningService initialized with escrow wallet`);

    // Start periodic cleanup to remove stopped miners (prevents memory leaks)
    if (!this.cleanupInterval) {
      this.cleanupInterval = setInterval(() => {
        this.cleanupStoppedMiners();
      }, 60_000); // Check every minute
    }
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.escrowKeypair !== null;
  }

  /**
   * Remove stopped miners from the map (memory cleanup)
   */
  private cleanupStoppedMiners(): void {
    const toRemove: string[] = [];

    for (const [gameId, miner] of this.activeMiners) {
      const status = miner.getStatus();
      if (!status.isRunning) {
        toRemove.push(gameId);
      }
    }

    for (const gameId of toRemove) {
      this.activeMiners.delete(gameId);
      console.log(`🧹 Cleaned up stopped miner for game ${gameId}`);
    }

    if (toRemove.length > 0) {
      console.log(`🧹 Cleanup complete: removed ${toRemove.length} stopped miners, ${this.activeMiners.size} active`);
    }
  }
  
  /**
   * Start mining for a game
   */
  async startMining(gameId: string, prizePoolLamports: number): Promise<void> {
    if (!this.escrowKeypair) {
      throw new Error("Escrow keypair not initialized");
    }
    
    if (this.activeMiners.has(gameId)) {
      console.log(`Mining already active for game ${gameId}`);
      return;
    }
    
    const miner = new OreActiveMiner(gameId, this.escrowKeypair);
    this.activeMiners.set(gameId, miner);
    
    await miner.start(prizePoolLamports);
  }
  
  /**
   * Stop mining for a game
   */
  stopMining(gameId: string): void {
    const miner = this.activeMiners.get(gameId);
    
    if (miner) {
      miner.stop();
      this.activeMiners.delete(gameId);
    }
  }
  
  /**
   * Get status of all active miners
   */
  getStatus(): Array<{ gameId: string; isRunning: boolean; currentRound: number }> {
    return Array.from(this.activeMiners.values()).map(miner => miner.getStatus());
  }
  
  /**
   * Stop all miners and cleanup resources
   */
  stopAll(): void {
    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Stop all active miners
    for (const [gameId, miner] of this.activeMiners) {
      miner.stop();
    }
    this.activeMiners.clear();
    console.log(`⏹️  All miners stopped and resources cleaned up`);
  }
}

export const oreActiveMiningService = new OreActiveMiningService();
