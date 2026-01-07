// Battle Dinghy - Server Types

import type { GameConfig, RoundSummary } from '@battle-dinghy/core';
import type { WebSocket } from 'ws';

// =============================================================================
// Game Types
// =============================================================================

export type GameStatus = 'waiting' | 'active' | 'complete' | 'cancelled';

export interface ManagedGame {
  gameId: string;
  config: GameConfig;
  status: GameStatus;
  players: Set<string>;
  spectators: Set<WebSocket>;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

// =============================================================================
// API Request/Response Types
// =============================================================================

export interface CreateGameRequest {
  gameId: string;
  maxPlayers?: number;
  buyIn?: number;
}

export interface CreateGameResponse {
  success: boolean;
  gameId: string;
  seed: string; // hex-encoded
  message?: string;
}

export interface JoinGameRequest {
  gameId: string;
  playerWallet: string;
}

export interface JoinGameResponse {
  success: boolean;
  playerIndex: number;
  message?: string;
}

export interface GameStatusResponse {
  gameId: string;
  status: GameStatus;
  players: string[];
  currentRound: number;
  maxPlayers: number;
  winner: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

export interface PlayerCardResponse {
  playerId: string;
  ships: { size: number; cells: number[] }[];
  allCells: number[];
  hitCells: number[];
  isEliminated: boolean;
  eliminatedAtRound: number | null;
}

// =============================================================================
// WebSocket Message Types
// =============================================================================

export type WSMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'game_state'
  | 'round_complete'
  | 'player_eliminated'
  | 'game_complete'
  | 'error';

export interface WSMessage {
  type: WSMessageType;
  gameId?: string;
  payload?: unknown;
}

export interface WSSubscribeMessage extends WSMessage {
  type: 'subscribe';
  gameId: string;
}

export interface WSUnsubscribeMessage extends WSMessage {
  type: 'unsubscribe';
  gameId: string;
}

export interface WSGameStateMessage extends WSMessage {
  type: 'game_state';
  gameId: string;
  payload: {
    status: GameStatus;
    currentRound: number;
    players: string[];
    activePlayers: string[];
    winner: string | null;
  };
}

export interface WSRoundCompleteMessage extends WSMessage {
  type: 'round_complete';
  gameId: string;
  payload: RoundSummary;
}

export interface WSPlayerEliminatedMessage extends WSMessage {
  type: 'player_eliminated';
  gameId: string;
  payload: {
    player: string;
    round: number;
  };
}

export interface WSGameCompleteMessage extends WSMessage {
  type: 'game_complete';
  gameId: string;
  payload: {
    winner: string;
    totalRounds: number;
  };
}

export interface WSErrorMessage extends WSMessage {
  type: 'error';
  payload: {
    code: string;
    message: string;
  };
}
