import {
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
  type PlayerStatus,
  type ShipType,
  type BoardState,
} from "@shared/schema";
import { randomUUID } from "crypto";

// Re-export types for convenience
export type { VerificationToken, InsertVerificationToken };

export interface IStorage {
  // Game operations
  createGame(game: InsertGame): Promise<Game>;
  getGame(id: string): Promise<Game | undefined>;
  getGameByNumber(gameNumber: number): Promise<Game | undefined>;
  getActiveGame(): Promise<Game | undefined>;
  updateGameStatus(id: string, status: GameStatus): Promise<void>;
  updateGamePlayers(id: string, currentPlayers: number, prizePoolSol: number): Promise<void>;
  updateGameTweet(id: string, tweetId: string, threadId: string): Promise<void>;
  setGameWinner(id: string, winnerId: string): Promise<void>;
  
  // Player operations
  createPlayer(player: InsertPlayer): Promise<Player>;
  getPlayer(id: string): Promise<Player | undefined>;
  getPlayersByGame(gameId: string): Promise<Player[]>;
  getAlivePlayers(gameId: string): Promise<Player[]>;
  updatePlayerStatus(id: string, status: "alive" | "eliminated", eliminatedAtShot?: number): Promise<void>;
  updatePlayerHullPoints(id: string, hullPoints: number): Promise<void>;
  updatePlayerBoard(id: string, boardState: BoardState): Promise<void>;
  
  // Shot operations
  createShot(shot: InsertShot): Promise<Shot>;
  getShot(id: string): Promise<Shot | undefined>;
  getShotsByGame(gameId: string): Promise<Shot[]>;
  updateShotTweet(id: string, tweetId: string): Promise<void>;
  
  // Shot result operations
  createShotResult(result: InsertShotResult): Promise<ShotResult>;
  getShotResults(shotId: string): Promise<ShotResult[]>;
  
  // Transactional join
  joinGameTransaction(
    gameId: string,
    insertPlayer: InsertPlayer
  ): Promise<{ player: Player; game: Game }>;
  
  // OAuth token operations
  getOauthToken(provider: string): Promise<OauthToken | undefined>;
  upsertOauthToken(token: InsertOauthToken): Promise<OauthToken>;

  // Verification token operations
  createVerificationToken(token: InsertVerificationToken): Promise<VerificationToken>;
  getVerificationToken(token: string): Promise<VerificationToken | undefined>;
  getAllVerificationTokens(): Promise<VerificationToken[]>;
  markVerificationTokenUsed(token: string, walletAddress: string): Promise<void>;
  cleanupExpiredTokens(): Promise<void>;
  
  // Non-transactional join (for Neon HTTP driver)
  joinGameSimple(gameId: string, insertPlayer: InsertPlayer): Promise<{
    success: boolean;
    player?: Player;
    error?: string;
    details?: any;
  }>;
}

export class MemStorage implements IStorage {
  private games: Map<string, Game>;
  private players: Map<string, Player>;
  private shots: Map<string, Shot>;
  private shotResults: Map<string, ShotResult>;

  constructor() {
    this.games = new Map();
    this.players = new Map();
    this.shots = new Map();
    this.shotResults = new Map();
  }

  // Game operations
  async createGame(insertGame: InsertGame): Promise<Game> {
    const id = randomUUID();
    const game: Game = {
      id,
      gameNumber: insertGame.gameNumber,
      status: (insertGame.status || "pending") as GameStatus,
      entryFeeSol: insertGame.entryFeeSol,
      prizePoolSol: insertGame.prizePoolSol || 0,
      maxPlayers: insertGame.maxPlayers || 35,
      currentPlayers: insertGame.currentPlayers || 0,
      tweetId: insertGame.tweetId || null,
      threadId: insertGame.threadId || null,
      winnerId: insertGame.winnerId || null,
      startedAt: insertGame.startedAt || null,
      completedAt: insertGame.completedAt || null,
      createdAt: new Date(),
    };
    this.games.set(id, game);
    return game;
  }

  async getGame(id: string): Promise<Game | undefined> {
    return this.games.get(id);
  }

  async getGameByNumber(gameNumber: number): Promise<Game | undefined> {
    return Array.from(this.games.values()).find(
      (game) => game.gameNumber === gameNumber
    );
  }

  async getActiveGame(): Promise<Game | undefined> {
    return Array.from(this.games.values()).find(
      (game) => game.status === "pending" || game.status === "active"
    );
  }

  async updateGameStatus(id: string, status: GameStatus): Promise<void> {
    const game = this.games.get(id);
    if (game) {
      game.status = status;
      if (status === "active" && !game.startedAt) {
        game.startedAt = new Date();
      }
      if (status === "completed" && !game.completedAt) {
        game.completedAt = new Date();
      }
      this.games.set(id, game);
    }
  }

  async updateGamePlayers(id: string, currentPlayers: number, prizePoolSol: number): Promise<void> {
    const game = this.games.get(id);
    if (game) {
      game.currentPlayers = currentPlayers;
      game.prizePoolSol = prizePoolSol;
      this.games.set(id, game);
    }
  }

  async updateGameTweet(id: string, tweetId: string, threadId: string): Promise<void> {
    const game = this.games.get(id);
    if (game) {
      game.tweetId = tweetId;
      game.threadId = threadId;
      this.games.set(id, game);
    }
  }

  async setGameWinner(id: string, winnerId: string): Promise<void> {
    const game = this.games.get(id);
    if (game) {
      game.winnerId = winnerId;
      this.games.set(id, game);
    }
  }

  // Player operations
  async createPlayer(insertPlayer: InsertPlayer): Promise<Player> {
    const id = randomUUID();
    const player: Player = {
      id,
      gameId: insertPlayer.gameId,
      twitterHandle: insertPlayer.twitterHandle,
      walletAddress: insertPlayer.walletAddress,
      boardState: insertPlayer.boardState as BoardState,
      hullPoints: insertPlayer.hullPoints || 6,
      status: (insertPlayer.status || "alive") as PlayerStatus,
      eliminatedAtShot: insertPlayer.eliminatedAtShot || null,
      txSignature: insertPlayer.txSignature || null,
      joinedAt: new Date(),
    };
    this.players.set(id, player);
    return player;
  }

  async getPlayer(id: string): Promise<Player | undefined> {
    return this.players.get(id);
  }

  async getPlayersByGame(gameId: string): Promise<Player[]> {
    return Array.from(this.players.values()).filter(
      (player) => player.gameId === gameId
    );
  }

  async getAlivePlayers(gameId: string): Promise<Player[]> {
    return Array.from(this.players.values()).filter(
      (player) => player.gameId === gameId && player.status === "alive"
    );
  }

  async updatePlayerStatus(
    id: string,
    status: "alive" | "eliminated",
    eliminatedAtShot?: number
  ): Promise<void> {
    const player = this.players.get(id);
    if (player) {
      player.status = status;
      if (eliminatedAtShot !== undefined) {
        player.eliminatedAtShot = eliminatedAtShot;
      }
      this.players.set(id, player);
    }
  }

  async updatePlayerHullPoints(id: string, hullPoints: number): Promise<void> {
    const player = this.players.get(id);
    if (player) {
      player.hullPoints = hullPoints;
      this.players.set(id, player);
    }
  }

  async updatePlayerBoard(id: string, boardState: BoardState): Promise<void> {
    const player = this.players.get(id);
    if (player) {
      player.boardState = boardState;
      this.players.set(id, player);
    }
  }

  // Shot operations
  async createShot(insertShot: InsertShot): Promise<Shot> {
    const id = randomUUID();
    const shot: Shot = {
      id,
      gameId: insertShot.gameId,
      shotNumber: insertShot.shotNumber,
      coordinate: insertShot.coordinate,
      oreBlockHash: insertShot.oreBlockHash,
      isDuplicate: insertShot.isDuplicate || false,
      tweetId: insertShot.tweetId || null,
      firedAt: new Date(),
    };
    this.shots.set(id, shot);
    return shot;
  }

  async getShot(id: string): Promise<Shot | undefined> {
    return this.shots.get(id);
  }

  async getShotsByGame(gameId: string): Promise<Shot[]> {
    return Array.from(this.shots.values())
      .filter((shot) => shot.gameId === gameId)
      .sort((a, b) => a.shotNumber - b.shotNumber);
  }

  async updateShotTweet(id: string, tweetId: string): Promise<void> {
    const shot = this.shots.get(id);
    if (shot) {
      shot.tweetId = tweetId;
      this.shots.set(id, shot);
    }
  }

  // Shot result operations
  async createShotResult(insertResult: InsertShotResult): Promise<ShotResult> {
    const id = randomUUID();
    const result: ShotResult = {
      id,
      shotId: insertResult.shotId,
      playerId: insertResult.playerId,
      result: insertResult.result,
      shipHit: (insertResult.shipHit || null) as ShipType | null,
      damageDealt: insertResult.damageDealt || 0,
    };
    this.shotResults.set(id, result);
    return result;
  }

  async getShotResults(shotId: string): Promise<ShotResult[]> {
    return Array.from(this.shotResults.values()).filter(
      (result) => result.shotId === shotId
    );
  }

  async joinGameTransaction(
    gameId: string,
    insertPlayer: InsertPlayer
  ): Promise<{ player: Player; game: Game }> {
    throw new Error("joinGameTransaction not implemented in MemStorage - use DbStorage");
  }

  async getOauthToken(provider: string): Promise<OauthToken | undefined> {
    throw new Error("OAuth tokens not supported in MemStorage - use DbStorage");
  }

  async upsertOauthToken(token: InsertOauthToken): Promise<OauthToken> {
    throw new Error("OAuth tokens not supported in MemStorage - use DbStorage");
  }

  async createVerificationToken(token: InsertVerificationToken): Promise<VerificationToken> {
    throw new Error("Verification tokens not supported in MemStorage - use DbStorage");
  }

  async getVerificationToken(token: string): Promise<VerificationToken | undefined> {
    throw new Error("Verification tokens not supported in MemStorage - use DbStorage");
  }

  async markVerificationTokenUsed(token: string, walletAddress: string): Promise<void> {
    throw new Error("Verification tokens not supported in MemStorage - use DbStorage");
  }

  async cleanupExpiredTokens(): Promise<void> {
    throw new Error("Verification tokens not supported in MemStorage - use DbStorage");
  }

  async getAllVerificationTokens(): Promise<VerificationToken[]> {
    throw new Error("Verification tokens not supported in MemStorage - use DbStorage");
  }

  async joinGameSimple(gameId: string, insertPlayer: InsertPlayer): Promise<{
    success: boolean;
    player?: Player;
    error?: string;
    details?: any;
  }> {
    throw new Error("joinGameSimple not supported in MemStorage - use DbStorage");
  }
}

export const storage = new MemStorage();
