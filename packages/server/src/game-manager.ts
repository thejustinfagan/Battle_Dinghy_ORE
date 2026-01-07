// Battle Dinghy - Game Manager
//
// Manages multiple concurrent games, connecting the GameEngine to WebSocket clients.

import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import type { WebSocket } from 'ws';
import {
  GameEngine,
  OreMonitorMock,
  OreRoundResult,
  RoundSummary,
  MAX_PLAYERS,
} from '@battle-dinghy/core';
import type {
  ManagedGame,
  GameStatusResponse,
  PlayerCardResponse,
  WSMessage,
  WSGameStateMessage,
  WSRoundCompleteMessage,
  WSPlayerEliminatedMessage,
  WSGameCompleteMessage,
} from './types.js';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_PLAYERS = 10;
const ORE_POLL_INTERVAL_MS = 60_000; // 1 minute for real ORE

// =============================================================================
// GameManager
// =============================================================================

export class GameManager extends EventEmitter {
  private games: Map<string, ManagedGame> = new Map();
  private engines: Map<string, GameEngine> = new Map();
  private monitors: Map<string, OreMonitorMock> = new Map();
  private subscriptions: Map<string, Set<WebSocket>> = new Map();

  /**
   * Create a new game.
   */
  createGame(
    gameId: string,
    options: { maxPlayers?: number; buyIn?: number } = {}
  ): { success: boolean; seed?: Uint8Array; error?: string } {
    if (this.games.has(gameId)) {
      return { success: false, error: 'Game already exists' };
    }

    const seed = randomBytes(32);
    const maxPlayers = Math.min(
      options.maxPlayers ?? DEFAULT_MAX_PLAYERS,
      MAX_PLAYERS
    );

    const game: ManagedGame = {
      gameId,
      config: {
        gameId,
        seed,
        players: [],
      },
      status: 'waiting',
      players: new Set(),
      spectators: new Set(),
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };

    this.games.set(gameId, game);
    this.subscriptions.set(gameId, new Set());

    this.emit('game_created', { gameId, maxPlayers });

    return { success: true, seed };
  }

  /**
   * Add a player to a waiting game.
   */
  joinGame(
    gameId: string,
    playerWallet: string
  ): { success: boolean; playerIndex?: number; error?: string } {
    const game = this.games.get(gameId);
    if (!game) {
      return { success: false, error: 'Game not found' };
    }

    if (game.status !== 'waiting') {
      return { success: false, error: 'Game is not accepting players' };
    }

    if (game.players.has(playerWallet)) {
      return { success: false, error: 'Player already joined' };
    }

    if (game.players.size >= MAX_PLAYERS) {
      return { success: false, error: 'Game is full' };
    }

    game.players.add(playerWallet);
    // Cast to mutable to update players array
    (game.config as { players: string[] }).players = Array.from(game.players);

    const playerIndex = game.config.players.indexOf(playerWallet);

    this.emit('player_joined', { gameId, playerWallet, playerIndex });
    this.broadcastGameState(gameId);

    return { success: true, playerIndex };
  }

  /**
   * Start a game (requires at least 2 players).
   */
  startGame(gameId: string): { success: boolean; error?: string } {
    const game = this.games.get(gameId);
    if (!game) {
      return { success: false, error: 'Game not found' };
    }

    if (game.status !== 'waiting') {
      return { success: false, error: 'Game is not in waiting state' };
    }

    if (game.players.size < 2) {
      return { success: false, error: 'Need at least 2 players to start' };
    }

    // Create game engine
    const engine = new GameEngine(game.config);
    this.engines.set(gameId, engine);

    // Set up engine event handlers
    engine.on('round_complete', (summary: RoundSummary) => {
      this.onRoundComplete(gameId, summary);
    });

    engine.on('player_eliminated', (event: { player: string; round: number }) => {
      this.onPlayerEliminated(gameId, event);
    });

    engine.on('game_complete', (event: { winner: string; totalRounds: number }) => {
      this.onGameComplete(gameId, event);
    });

    // Create ORE monitor (mock for now)
    const monitor = new OreMonitorMock(ORE_POLL_INTERVAL_MS);
    this.monitors.set(gameId, monitor);

    monitor.on('round', (result: OreRoundResult) => {
      if (!engine.isGameComplete()) {
        engine.processRound(result);
      } else {
        monitor.stop();
      }
    });

    // Update game state
    game.status = 'active';
    game.startedAt = Date.now();

    // Start the monitor
    monitor.start();

    this.emit('game_started', { gameId, players: game.config.players });
    this.broadcastGameState(gameId);

    return { success: true };
  }

  /**
   * Cancel a game (only if waiting or can force cancel active games).
   */
  cancelGame(
    gameId: string,
    force = false
  ): { success: boolean; error?: string } {
    const game = this.games.get(gameId);
    if (!game) {
      return { success: false, error: 'Game not found' };
    }

    if (game.status === 'complete' || game.status === 'cancelled') {
      return { success: false, error: 'Game is already finished' };
    }

    if (game.status === 'active' && !force) {
      return { success: false, error: 'Cannot cancel active game without force' };
    }

    // Stop monitor if active
    const monitor = this.monitors.get(gameId);
    if (monitor) {
      monitor.stop();
      this.monitors.delete(gameId);
    }

    game.status = 'cancelled';
    game.completedAt = Date.now();

    this.emit('game_cancelled', { gameId });
    this.broadcastGameState(gameId);

    return { success: true };
  }

  /**
   * Get game status.
   */
  getGameStatus(gameId: string): GameStatusResponse | null {
    const game = this.games.get(gameId);
    if (!game) {
      return null;
    }

    const engine = this.engines.get(gameId);

    return {
      gameId: game.gameId,
      status: game.status,
      players: Array.from(game.players),
      currentRound: engine?.getCurrentRound() ?? 0,
      maxPlayers: MAX_PLAYERS,
      winner: engine?.getWinner() ?? null,
      startedAt: game.startedAt,
      completedAt: game.completedAt,
    };
  }

  /**
   * Get player card info (only for active/complete games).
   */
  getPlayerCard(
    gameId: string,
    playerWallet: string
  ): PlayerCardResponse | null {
    const engine = this.engines.get(gameId);
    if (!engine) {
      return null;
    }

    const card = engine.getPlayerCard(playerWallet);
    if (!card) {
      return null;
    }

    const generatedCard = engine.getGeneratedCard(playerWallet);
    if (!generatedCard) {
      return null;
    }

    return {
      playerId: card.playerId,
      ships: generatedCard.ships.map((s) => ({
        size: s.size,
        cells: [...s.cells],
      })),
      allCells: [...generatedCard.allCells],
      hitCells: [...card.hitCells],
      isEliminated: card.isEliminated,
      eliminatedAtRound: card.eliminatedAtRound,
    };
  }

  /**
   * Get all active games.
   */
  getActiveGames(): GameStatusResponse[] {
    const activeGames: GameStatusResponse[] = [];
    for (const gameId of this.games.keys()) {
      const status = this.getGameStatus(gameId);
      if (status && (status.status === 'waiting' || status.status === 'active')) {
        activeGames.push(status);
      }
    }
    return activeGames;
  }

  /**
   * Subscribe a WebSocket to game updates.
   */
  subscribe(gameId: string, ws: WebSocket): boolean {
    const subs = this.subscriptions.get(gameId);
    if (!subs) {
      return false;
    }
    subs.add(ws);

    // Send current state immediately
    const status = this.getGameStatus(gameId);
    if (status) {
      const engine = this.engines.get(gameId);
      const activePlayers = engine
        ? Array.from(this.games.get(gameId)!.players).filter((p) => {
            const card = engine.getPlayerCard(p);
            return card && !card.isEliminated;
          })
        : Array.from(this.games.get(gameId)!.players);

      const msg: WSGameStateMessage = {
        type: 'game_state',
        gameId,
        payload: {
          status: status.status,
          currentRound: status.currentRound,
          players: status.players,
          activePlayers,
          winner: status.winner,
        },
      };
      this.sendToSocket(ws, msg);
    }

    return true;
  }

  /**
   * Unsubscribe a WebSocket from game updates.
   */
  unsubscribe(gameId: string, ws: WebSocket): void {
    const subs = this.subscriptions.get(gameId);
    if (subs) {
      subs.delete(ws);
    }
  }

  /**
   * Unsubscribe a WebSocket from all games (on disconnect).
   */
  unsubscribeAll(ws: WebSocket): void {
    for (const subs of this.subscriptions.values()) {
      subs.delete(ws);
    }
  }

  /**
   * Manually trigger a round (for testing).
   */
  triggerRound(gameId: string, winningBlock?: number): boolean {
    const monitor = this.monitors.get(gameId);
    if (!monitor) {
      return false;
    }
    monitor.triggerRound(winningBlock);
    return true;
  }

  /**
   * Get game seed (for verification).
   */
  getGameSeed(gameId: string): Uint8Array | null {
    const game = this.games.get(gameId);
    return game?.config.seed ?? null;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private onRoundComplete(gameId: string, summary: RoundSummary): void {
    const msg: WSRoundCompleteMessage = {
      type: 'round_complete',
      gameId,
      payload: summary,
    };
    this.broadcast(gameId, msg);
    this.emit('round_complete', { gameId, summary });
  }

  private onPlayerEliminated(
    gameId: string,
    event: { player: string; round: number }
  ): void {
    const msg: WSPlayerEliminatedMessage = {
      type: 'player_eliminated',
      gameId,
      payload: event,
    };
    this.broadcast(gameId, msg);
    this.emit('player_eliminated', { gameId, ...event });
  }

  private onGameComplete(
    gameId: string,
    event: { winner: string; totalRounds: number }
  ): void {
    const game = this.games.get(gameId);
    if (game) {
      game.status = 'complete';
      game.completedAt = Date.now();
    }

    // Stop the monitor
    const monitor = this.monitors.get(gameId);
    if (monitor) {
      monitor.stop();
    }

    const msg: WSGameCompleteMessage = {
      type: 'game_complete',
      gameId,
      payload: event,
    };
    this.broadcast(gameId, msg);
    this.emit('game_complete', { gameId, ...event });
  }

  private broadcastGameState(gameId: string): void {
    const status = this.getGameStatus(gameId);
    if (!status) return;

    const engine = this.engines.get(gameId);
    const game = this.games.get(gameId)!;
    const activePlayers = engine
      ? Array.from(game.players).filter((p) => {
          const card = engine.getPlayerCard(p);
          return card && !card.isEliminated;
        })
      : Array.from(game.players);

    const msg: WSGameStateMessage = {
      type: 'game_state',
      gameId,
      payload: {
        status: status.status,
        currentRound: status.currentRound,
        players: status.players,
        activePlayers,
        winner: status.winner,
      },
    };
    this.broadcast(gameId, msg);
  }

  private broadcast(gameId: string, message: WSMessage): void {
    const subs = this.subscriptions.get(gameId);
    if (!subs) return;

    const data = JSON.stringify(message);
    for (const ws of subs) {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    }
  }

  private sendToSocket(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}
