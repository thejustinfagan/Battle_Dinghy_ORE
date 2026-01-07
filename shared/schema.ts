import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Game statuses
export const gameStatusEnum = ["pending", "active", "completed", "cancelled"] as const;
export type GameStatus = typeof gameStatusEnum[number];

// Player statuses
export const playerStatusEnum = ["alive", "eliminated"] as const;
export type PlayerStatus = typeof playerStatusEnum[number];

// Ship types
export const shipTypeEnum = ["big_dinghy", "dinghy", "small_dinghy"] as const;
export type ShipType = typeof shipTypeEnum[number];

// Games table
export const games = pgTable("games", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gameNumber: integer("game_number").notNull(),
  status: text("status").notNull().$type<GameStatus>().default("pending"),
  entryFeeSol: integer("entry_fee_sol").notNull(), // in lamports
  prizePoolSol: integer("prize_pool_sol").notNull().default(0), // in lamports
  maxPlayers: integer("max_players").notNull().default(35),
  currentPlayers: integer("current_players").notNull().default(0),
  tweetId: text("tweet_id"),
  threadId: text("thread_id"),
  winnerId: varchar("winner_id"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  
  // Platform fee settings (stored in basis points: 500 = 5%, 550 = 5.5%)
  platformFeeBasisPoints: integer("platform_fee_basis_points").notNull().default(500), // 0-10000 (e.g., 500 = 5%)
  platformFeesCollected: integer("platform_fees_collected").notNull().default(0), // in lamports
  
  // ORE Mining fields - tracks active mining with prize pool
  oreMinerAddress: text("ore_miner_address"), // PDA for miner account
  oreMinerAuthority: text("ore_miner_authority"), // Escrow wallet authority
  oreMinerBump: integer("ore_miner_bump"), // PDA bump seed
  oreTotalMined: integer("ore_total_mined").default(0), // Total ORE mined (smallest units)
  oreCurrentRound: integer("ore_current_round").default(0), // Current mining round (1-25)
  oreDeployPerBlock: integer("ore_deploy_per_block").default(0), // SOL deployed per block (lamports)
  oreSolDeployedTotal: integer("ore_sol_deployed_total").default(0), // Total SOL deployed
  oreSolClaimedTotal: integer("ore_sol_claimed_total").default(0), // Total SOL claimed back
  oreSolNetProfit: integer("ore_sol_net_profit").default(0), // Net SOL profit/loss
  oreLastCheckpoint: timestamp("ore_last_checkpoint"), // Last checkpoint timestamp
  oreMinerClosedAt: timestamp("ore_miner_closed_at"), // When miner account was closed
});

// Players table
export const players = pgTable("players", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gameId: varchar("game_id").notNull().references(() => games.id),
  twitterHandle: text("twitter_handle").notNull(),
  walletAddress: text("wallet_address").notNull(),
  boardState: jsonb("board_state").notNull().$type<BoardState>(), // Ship positions and hit status
  hullPoints: integer("hull_points").notNull().default(6), // 3+2+1
  status: text("status").notNull().$type<PlayerStatus>().default("alive"),
  eliminatedAtShot: integer("eliminated_at_shot"),
  txSignature: text("tx_signature"), // Solana transaction signature for entry payment
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
}, (table) => ({
  // Prevent same wallet from joining the same game multiple times
  uniqueWalletPerGame: unique("unique_wallet_per_game").on(table.gameId, table.walletAddress),
  // Prevent same Twitter handle from joining the same game multiple times
  uniqueTwitterPerGame: unique("unique_twitter_per_game").on(table.gameId, table.twitterHandle),
}));

// Shots table - tracks each coordinate fired in the game
export const shots = pgTable("shots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gameId: varchar("game_id").notNull().references(() => games.id),
  shotNumber: integer("shot_number").notNull(), // 1-25
  coordinate: text("coordinate").notNull(), // e.g., "C3"
  oreBlockHash: text("ore_block_hash").notNull(),
  isDuplicate: boolean("is_duplicate").notNull().default(false),
  tweetId: text("tweet_id"),
  firedAt: timestamp("fired_at").defaultNow().notNull(),
}, (table) => ({
  // Prevent duplicate coordinates in the same game
  uniqueCoordinatePerGame: unique("unique_coordinate_per_game").on(table.gameId, table.coordinate),
  // Prevent duplicate shot numbers in the same game (concurrent safety)
  uniqueShotNumberPerGame: unique("unique_shot_number_per_game").on(table.gameId, table.shotNumber),
}));

// Shot results - records what happened to each player for each shot
export const shotResults = pgTable("shot_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shotId: varchar("shot_id").notNull().references(() => shots.id),
  playerId: varchar("player_id").notNull().references(() => players.id),
  result: text("result").notNull(), // "miss", "hit", "sunk", "eliminated"
  shipHit: text("ship_hit").$type<ShipType>(), // which ship was hit
  damageDealt: integer("damage_dealt").notNull().default(0),
});

// ORE Mining round status enum
export const oreMiningRoundStatusEnum = ["pending", "deployed", "checkpointed", "claimed", "failed"] as const;
export type OreMiningRoundStatus = typeof oreMiningRoundStatusEnum[number];

// ORE Mining rounds table - tracks detailed per-round mining activity
export const oreMiningRounds = pgTable("ore_mining_rounds", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gameId: varchar("game_id").notNull().references(() => games.id),
  roundNumber: integer("round_number").notNull(), // 1-25
  squaresBitmask: integer("squares_bitmask").notNull(), // 32-bit mask for 25 squares
  deployLamports: integer("deploy_lamports").notNull(), // SOL deployed this round
  status: text("status").notNull().$type<OreMiningRoundStatus>().default("pending"),
  
  // Transaction signatures for audit trail
  txDeploy: text("tx_deploy"), // Deploy instruction signature
  txCheckpoint: text("tx_checkpoint"), // Checkpoint instruction signature  
  txClaimSol: text("tx_claim_sol"), // ClaimSOL instruction signature
  txClaimOre: text("tx_claim_ore"), // ClaimORE instruction signature (final round only)
  
  // Rewards earned this round
  solClaimedLamports: integer("sol_claimed_lamports").default(0), // SOL won this round
  oreClaimed: integer("ore_claimed").default(0), // ORE won this round (smallest units)
  
  // Winning square info
  winningSquare: integer("winning_square"), // 0-24 index of winning square
  didWin: boolean("did_win").default(false), // Did we win this round?
  
  // Provably fair randomness audit trail
  usedFallback: boolean("used_fallback").default(false), // TRUE if hash-based fallback used (NOT provably fair)
  completedRoundId: integer("completed_round_id"), // Actual ORE round ID from board PDA (for audit)
  
  // Timestamps
  deployedAt: timestamp("deployed_at"),
  checkpointedAt: timestamp("checkpointed_at"),
  claimedAt: timestamp("claimed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Ensure unique rounds per game
  uniqueRoundPerGame: unique("unique_round_per_game").on(table.gameId, table.roundNumber),
}));

// OAuth tokens table - stores authentication tokens for external services (e.g., Twitter)
export const oauthTokens = pgTable("oauth_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: varchar("provider", { length: 50 }).notNull().unique(), // e.g., "twitter"
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Verification tokens table - temporary tokens to validate Twitter handle before payment
export const verificationTokens = pgTable("verification_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gameId: varchar("game_id").notNull().references(() => games.id),
  token: varchar("token", { length: 100 }).notNull().unique(),
  twitterHandle: text("twitter_handle").notNull(),
  walletAddress: text("wallet_address"), // Set when token is used for payment
  usedAt: timestamp("used_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Board state type definition
export type BoardState = {
  ships: Ship[];
  hits: string[]; // array of hit coordinates
};

export type Ship = {
  type: ShipType;
  size: number;
  hp: number;
  maxHp: number;
  coordinates: string[]; // e.g., ["A1", "A2", "A3"]
  orientation: "horizontal" | "vertical";
  isSunk: boolean;
};

// Zod schemas for inserts
export const insertGameSchema = createInsertSchema(games).omit({
  id: true,
  createdAt: true,
});

export const insertPlayerSchema = createInsertSchema(players).omit({
  id: true,
  joinedAt: true,
});

export const insertShotSchema = createInsertSchema(shots).omit({
  id: true,
  firedAt: true,
});

export const insertShotResultSchema = createInsertSchema(shotResults).omit({
  id: true,
});

export const insertOauthTokenSchema = createInsertSchema(oauthTokens).omit({
  id: true,
  updatedAt: true,
});

export const insertVerificationTokenSchema = createInsertSchema(verificationTokens).omit({
  id: true,
  createdAt: true,
});

export const insertOreMiningRoundSchema = createInsertSchema(oreMiningRounds).omit({
  id: true,
  createdAt: true,
});

// TypeScript types
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof games.$inferSelect;

export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Player = typeof players.$inferSelect;

export type InsertShot = z.infer<typeof insertShotSchema>;
export type Shot = typeof shots.$inferSelect;

export type InsertShotResult = z.infer<typeof insertShotResultSchema>;
export type ShotResult = typeof shotResults.$inferSelect;

export type InsertOauthToken = z.infer<typeof insertOauthTokenSchema>;
export type OauthToken = typeof oauthTokens.$inferSelect;

export type InsertVerificationToken = z.infer<typeof insertVerificationTokenSchema>;
export type VerificationToken = typeof verificationTokens.$inferSelect;

export type InsertOreMiningRound = z.infer<typeof insertOreMiningRoundSchema>;
export type OreMiningRound = typeof oreMiningRounds.$inferSelect;
