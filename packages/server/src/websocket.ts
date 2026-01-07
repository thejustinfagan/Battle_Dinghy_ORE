// Battle Dinghy - WebSocket Handler

import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { GameManager } from './game-manager.js';
import type {
  WSMessage,
  WSSubscribeMessage,
  WSUnsubscribeMessage,
  WSErrorMessage,
} from './types.js';

// =============================================================================
// WebSocket Setup
// =============================================================================

export function setupWebSocket(server: Server, gameManager: GameManager): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    console.log('WebSocket client connected');

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as WSMessage;
        handleMessage(ws, message, gameManager);
      } catch (error) {
        sendError(ws, 'PARSE_ERROR', 'Invalid JSON message');
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      gameManager.unsubscribeAll(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      gameManager.unsubscribeAll(ws);
    });

    // Send welcome message
    ws.send(
      JSON.stringify({
        type: 'connected',
        payload: { message: 'Connected to Battle Dinghy server' },
      })
    );
  });

  return wss;
}

// =============================================================================
// Message Handling
// =============================================================================

function handleMessage(
  ws: WebSocket,
  message: WSMessage,
  gameManager: GameManager
): void {
  switch (message.type) {
    case 'subscribe':
      handleSubscribe(ws, message as WSSubscribeMessage, gameManager);
      break;

    case 'unsubscribe':
      handleUnsubscribe(ws, message as WSUnsubscribeMessage, gameManager);
      break;

    default:
      sendError(ws, 'UNKNOWN_MESSAGE', `Unknown message type: ${message.type}`);
  }
}

function handleSubscribe(
  ws: WebSocket,
  message: WSSubscribeMessage,
  gameManager: GameManager
): void {
  if (!message.gameId) {
    sendError(ws, 'MISSING_GAME_ID', 'gameId is required for subscribe');
    return;
  }

  const success = gameManager.subscribe(message.gameId, ws);

  if (!success) {
    sendError(ws, 'GAME_NOT_FOUND', `Game ${message.gameId} not found`);
    return;
  }

  console.log(`Client subscribed to game ${message.gameId}`);
}

function handleUnsubscribe(
  ws: WebSocket,
  message: WSUnsubscribeMessage,
  gameManager: GameManager
): void {
  if (!message.gameId) {
    sendError(ws, 'MISSING_GAME_ID', 'gameId is required for unsubscribe');
    return;
  }

  gameManager.unsubscribe(message.gameId, ws);
  console.log(`Client unsubscribed from game ${message.gameId}`);
}

function sendError(ws: WebSocket, code: string, message: string): void {
  const errorMsg: WSErrorMessage = {
    type: 'error',
    payload: { code, message },
  };

  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(errorMsg));
  }
}
