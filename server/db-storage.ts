import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  games,
  players,
  shots,
  shotResults,
  oauthTokens,
  verificationTokens,
  oreMiningRounds,
  type Game,
  type InsertGame,
  type Player,
  type InsertPlayer,
  type Shot,
  type InsertShot,
  type ShotResult,
  type InsertShotResult,
  type OauthToken,
  type InsertOauthToken,
  type VerificationToken,
  type InsertVerificationToken,
  type GameStatus,
  type BoardState,
  type OreMiningRound,
  type InsertOreMiningRound,
} from "@shared/schema";
import type { IStorage } from "./storage";

export class DbStorage implements IStorage {
  // Game operations
  async createGame(insertGame: InsertGame): Promise<Game> {
    const gameData = {
      ...insertGame,
      currentPlayers: insertGame.currentPlayers ?? 0,
      prizePoolSol: insertGame.prizePoolSol ?? 0,
      maxPlayers: insertGame.maxPlayers ?? 35,
    };
    const [game] = await db.insert(games).values([gameData as any]).returning();
    return game;
  }

  async getGame(id: string): Promise<Game | undefined> {
    const [game] = await db.select().from(games).where(eq(games.id, id));
    return game;
  }

  async getGameByNumber(gameNumber: number): Promise<Game | undefined> {
    const [game] = await db
      .select()
      .from(games)
      .where(eq(games.gameNumber, gameNumber));
    return game;
  }

  async getActiveGame(): Promise<Game | undefined> {
    const [game] = await db
      .select()
      .from(games)
      .where(eq(games.status, "pending"))
      .limit(1);
    
    if (game) return game;

    const [activeGame] = await db
      .select()
      .from(games)
      .where(eq(games.status, "active"))
      .limit(1);
    
    return activeGame;
  }

  async updateGameStatus(id: string, status: GameStatus): Promise<void> {
    const updates: any = { status };
    
    if (status === "active") {
      updates.startedAt = new Date();
    } else if (status === "completed") {
      updates.completedAt = new Date();
    }

    await db.update(games).set(updates).where(eq(games.id, id));
  }

  async updateGamePlayers(
    id: string,
    currentPlayers: number,
    prizePoolSol: number
  ): Promise<void> {
    await db.execute(sql`
      UPDATE ${games} 
      SET current_players = current_players + 1,
          prize_pool_sol = prize_pool_sol + ${prizePoolSol}
      WHERE id = ${id}
    `);
  }

  async updateGameTweet(
    id: string,
    tweetId: string,
    threadId: string
  ): Promise<void> {
    await db
      .update(games)
      .set({ tweetId, threadId })
      .where(eq(games.id, id));
  }

  async setGameWinner(id: string, winnerId: string): Promise<void> {
    await db.update(games).set({ winnerId }).where(eq(games.id, id));
  }

  // Player operations
  async createPlayer(insertPlayer: InsertPlayer): Promise<Player> {
    const playerData = {
      ...insertPlayer,
      hullPoints: insertPlayer.hullPoints ?? 6,
      status: insertPlayer.status ?? "alive",
    };
    const [player] = await db.insert(players).values([playerData as any]).returning();
    return player;
  }

  async getPlayer(id: string): Promise<Player | undefined> {
    const [player] = await db.select().from(players).where(eq(players.id, id));
    return player;
  }

  async getPlayersByGame(gameId: string): Promise<Player[]> {
    return await db
      .select()
      .from(players)
      .where(eq(players.gameId, gameId));
  }

  async getAlivePlayers(gameId: string): Promise<Player[]> {
    return await db
      .select()
      .from(players)
      .where(
        and(
          eq(players.gameId, gameId),
          eq(players.status, "alive")
        )
      );
  }

  async updatePlayerStatus(
    id: string,
    status: "alive" | "eliminated",
    eliminatedAtShot?: number
  ): Promise<void> {
    const updates: any = { status };
    if (eliminatedAtShot !== undefined) {
      updates.eliminatedAtShot = eliminatedAtShot;
    }
    await db.update(players).set(updates).where(eq(players.id, id));
  }

  async updatePlayerHullPoints(id: string, hullPoints: number): Promise<void> {
    await db.update(players).set({ hullPoints }).where(eq(players.id, id));
  }

  async updatePlayerBoard(id: string, boardState: BoardState): Promise<void> {
    await db.update(players).set({ boardState }).where(eq(players.id, id));
  }

  // Shot operations
  async createShot(insertShot: InsertShot): Promise<Shot> {
    const shotData = {
      ...insertShot,
      isDuplicate: insertShot.isDuplicate ?? false,
    };
    const [shot] = await db.insert(shots).values([shotData]).returning();
    return shot;
  }

  async getShot(id: string): Promise<Shot | undefined> {
    const [shot] = await db.select().from(shots).where(eq(shots.id, id));
    return shot;
  }

  async getShotsByGame(gameId: string): Promise<Shot[]> {
    return await db
      .select()
      .from(shots)
      .where(eq(shots.gameId, gameId))
      .orderBy(shots.shotNumber);
  }

  async updateShotTweet(id: string, tweetId: string): Promise<void> {
    await db.update(shots).set({ tweetId }).where(eq(shots.id, id));
  }

  // Shot result operations
  async createShotResult(insertResult: InsertShotResult): Promise<ShotResult> {
    const resultData = {
      ...insertResult,
      damageDealt: insertResult.damageDealt ?? 0,
    };
    const [result] = await db
      .insert(shotResults)
      .values([resultData as any])
      .returning();
    return result;
  }

  async getShotResults(shotId: string): Promise<ShotResult[]> {
    return await db
      .select()
      .from(shotResults)
      .where(eq(shotResults.shotId, shotId));
  }

  // Non-transactional player join for testing (neon-http doesn't support transactions)
  async joinGameSimple(
    gameId: string,
    insertPlayer: InsertPlayer
  ): Promise<{ success: boolean; player?: Player; error?: string; details?: any }> {
    try {
      const game = await this.getGame(gameId);
      if (!game) {
        return { success: false, error: "Game not found" };
      }

      if (game.status !== "pending") {
        return { success: false, error: "Game is not accepting players" };
      }

      if (game.currentPlayers >= game.maxPlayers) {
        return { success: false, error: "Game is full" };
      }

      // Check for duplicate player
      const existingPlayers = await db
        .select()
        .from(players)
        .where(eq(players.gameId, gameId));

      const isDuplicate = existingPlayers.some(
        p => p.walletAddress === insertPlayer.walletAddress || 
             p.twitterHandle === insertPlayer.twitterHandle
      );

      if (isDuplicate) {
        return { success: false, error: "Player already joined this game" };
      }

      // Create player
      const playerData = {
        ...insertPlayer,
        hullPoints: insertPlayer.hullPoints ?? 6,
        status: insertPlayer.status ?? "alive",
      };
      const [player] = await db.insert(players).values([playerData as any]).returning();

      // Update game player count and prize pool
      await db.execute(sql`
        UPDATE ${games} 
        SET current_players = current_players + 1,
            prize_pool_sol = prize_pool_sol + ${game.entryFeeSol}
        WHERE id = ${gameId}
      `);

      return { success: true, player };
    } catch (error) {
      console.error("Error in joinGameSimple:", error);
      return { 
        success: false, 
        error: "Failed to join game",
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // Transactional player join - atomically creates player and updates game
  async joinGameTransaction(
    gameId: string,
    insertPlayer: InsertPlayer
  ): Promise<{ player: Player; game: Game }> {
    return await db.transaction(async (tx) => {
      // Lock the game row for update to prevent race conditions
      // NOTE: Drizzle doesn't support .forUpdate() yet, so we use raw SQL
      // and must manually map the result to camelCase
      const result = await tx.execute(sql`
        SELECT * FROM ${games} 
        WHERE id = ${gameId} 
        FOR UPDATE
      `);
      
      const rawGame = result.rows[0] as any;
      
      if (!rawGame) {
        throw new Error("Game not found");
      }

      // Map snake_case DB columns to camelCase
      const game: Game = {
        id: rawGame.id,
        gameNumber: rawGame.game_number,
        status: rawGame.status,
        entryFeeSol: rawGame.entry_fee_sol,
        maxPlayers: rawGame.max_players,
        currentPlayers: rawGame.current_players,
        prizePoolSol: rawGame.prize_pool_sol,
        tweetId: rawGame.tweet_id,
        threadId: rawGame.thread_id,
        winnerId: rawGame.winner_id,
        createdAt: rawGame.created_at,
        startedAt: rawGame.started_at,
        completedAt: rawGame.completed_at,
      };

      if (game.status !== "pending") {
        throw new Error("Game is not accepting players");
      }

      if (game.currentPlayers >= game.maxPlayers) {
        throw new Error("Game is full");
      }

      // Check for duplicate player (same wallet or twitter handle)
      const existingPlayers = await tx
        .select()
        .from(players)
        .where(eq(players.gameId, gameId));

      const isDuplicate = existingPlayers.some(
        p => p.walletAddress === insertPlayer.walletAddress || 
             p.twitterHandle === insertPlayer.twitterHandle
      );

      if (isDuplicate) {
        throw new Error("Player already joined this game");
      }

      // Create the player
      const playerData = {
        ...insertPlayer,
        hullPoints: insertPlayer.hullPoints ?? 6,
        status: insertPlayer.status ?? "alive",
      };
      const [player] = await tx.insert(players).values([playerData as any]).returning();

      // Update game counts atomically using SQL expressions
      const [updatedGame] = await tx
        .update(games)
        .set({
          currentPlayers: sql`${games.currentPlayers} + 1`,
          prizePoolSol: sql`${games.prizePoolSol} + ${game.entryFeeSol}`,
        })
        .where(eq(games.id, gameId))
        .returning();

      return { player, game: updatedGame };
    });
  }

  // OAuth token operations
  async getOauthToken(provider: string): Promise<OauthToken | undefined> {
    const [token] = await db
      .select()
      .from(oauthTokens)
      .where(eq(oauthTokens.provider, provider));
    return token;
  }

  async upsertOauthToken(insertToken: InsertOauthToken): Promise<OauthToken> {
    // Try to insert, on conflict update the existing row
    const [token] = await db
      .insert(oauthTokens)
      .values([{
        ...insertToken,
        updatedAt: new Date(),
      } as any])
      .onConflictDoUpdate({
        target: oauthTokens.provider,
        set: {
          accessToken: insertToken.accessToken,
          refreshToken: insertToken.refreshToken,
          expiresAt: insertToken.expiresAt,
          updatedAt: new Date(),
        },
      })
      .returning();
    return token;
  }

  // Verification token operations
  async createVerificationToken(insertToken: InsertVerificationToken): Promise<VerificationToken> {
    const [token] = await db
      .insert(verificationTokens)
      .values([insertToken as any])
      .returning();
    return token;
  }

  async getVerificationToken(token: string): Promise<VerificationToken | undefined> {
    const [verificationToken] = await db
      .select()
      .from(verificationTokens)
      .where(eq(verificationTokens.token, token));
    return verificationToken;
  }

  async getAllVerificationTokens(): Promise<VerificationToken[]> {
    const tokens = await db
      .select()
      .from(verificationTokens);
    return tokens;
  }

  async markVerificationTokenUsed(token: string, walletAddress: string): Promise<void> {
    await db
      .update(verificationTokens)
      .set({ usedAt: new Date(), walletAddress })
      .where(eq(verificationTokens.token, token));
  }

  async cleanupExpiredTokens(): Promise<void> {
    await db
      .delete(verificationTokens)
      .where(sql`${verificationTokens.expiresAt} < NOW()`);
  }

  // ORE Mining operations
  async updateGame(id: string, updates: Partial<Game>): Promise<void> {
    await db.update(games).set(updates as any).where(eq(games.id, id));
  }

  async createOreMiningRound(insertRound: InsertOreMiningRound): Promise<OreMiningRound> {
    const roundData = {
      ...insertRound,
      status: insertRound.status ?? "pending",
      solClaimedLamports: insertRound.solClaimedLamports ?? 0,
      oreClaimed: insertRound.oreClaimed ?? 0,
      didWin: insertRound.didWin ?? false,
    };
    const [round] = await db.insert(oreMiningRounds).values([roundData as any]).returning();
    return round;
  }

  async updateOreMiningRound(id: string, updates: Partial<OreMiningRound>): Promise<void> {
    await db.update(oreMiningRounds).set(updates as any).where(eq(oreMiningRounds.id, id));
  }

  async getOreMiningRounds(gameId: string): Promise<OreMiningRound[]> {
    return await db
      .select()
      .from(oreMiningRounds)
      .where(eq(oreMiningRounds.gameId, gameId))
      .orderBy(oreMiningRounds.roundNumber);
  }

  async getOreMiningRound(gameId: string, roundNumber: number): Promise<OreMiningRound | undefined> {
    const [round] = await db
      .select()
      .from(oreMiningRounds)
      .where(sql`${oreMiningRounds.gameId} = ${gameId} AND ${oreMiningRounds.roundNumber} = ${roundNumber}`);
    return round;
  }
}

export const dbStorage = new DbStorage();
