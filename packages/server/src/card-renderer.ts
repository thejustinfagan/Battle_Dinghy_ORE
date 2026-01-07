// Battle Dinghy - Card Image Renderer
//
// Generates PNG images of player battle cards for Twitter posting.

import { createCanvas, CanvasRenderingContext2D } from 'canvas';
import {
  GRID_SIZE,
  TOTAL_CELLS,
  CellIndex,
  cellToPosition,
} from '@battle-dinghy/core';

// =============================================================================
// Constants
// =============================================================================

const CELL_SIZE = 60;
const GRID_PADDING = 40;
const HEADER_HEIGHT = 80;
const FOOTER_HEIGHT = 60;

const CANVAS_WIDTH = GRID_SIZE * CELL_SIZE + GRID_PADDING * 2;
const CANVAS_HEIGHT =
  HEADER_HEIGHT + GRID_SIZE * CELL_SIZE + GRID_PADDING + FOOTER_HEIGHT;

// Colors
const COLORS = {
  background: '#0a1628',
  gridBg: '#1a2a4a',
  gridLine: '#2a4a6a',
  water: '#1e3a5f',
  ship: '#4a9eff',
  shipHit: '#ff4a4a',
  miss: '#3a5a7a',
  text: '#ffffff',
  textMuted: '#8899aa',
  accent: '#00ff88',
  eliminated: '#ff4a4a',
};

// =============================================================================
// Types
// =============================================================================

export interface CardRenderOptions {
  playerId: string;
  playerIndex: number;
  gameId: string;
  shipCells: Set<CellIndex>;
  hitCells: Set<CellIndex>;
  isEliminated: boolean;
  currentRound: number;
  showShips: boolean; // false for opponent view
}

// =============================================================================
// Card Renderer
// =============================================================================

export function renderCard(options: CardRenderOptions): Buffer {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Header
  drawHeader(ctx, options);

  // Grid
  const gridX = GRID_PADDING;
  const gridY = HEADER_HEIGHT;
  drawGrid(ctx, gridX, gridY, options);

  // Footer
  drawFooter(ctx, options);

  return canvas.toBuffer('image/png');
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  options: CardRenderOptions
): void {
  const centerX = CANVAS_WIDTH / 2;

  // Title
  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BATTLE DINGHY', centerX, 35);

  // Player info
  ctx.fillStyle = options.isEliminated ? COLORS.eliminated : COLORS.text;
  ctx.font = '16px sans-serif';
  const playerLabel = `Player ${options.playerIndex + 1}`;
  const statusLabel = options.isEliminated ? ' [ELIMINATED]' : '';
  ctx.fillText(playerLabel + statusLabel, centerX, 60);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  options: CardRenderOptions
): void {
  const { shipCells, hitCells, showShips } = options;

  // Draw cells
  for (let cell = 0; cell < TOTAL_CELLS; cell++) {
    const cellIndex = cell as CellIndex;
    const pos = cellToPosition(cellIndex);
    const x = startX + pos.col * CELL_SIZE;
    const y = startY + pos.row * CELL_SIZE;

    const isShip = shipCells.has(cellIndex);
    const isHit = hitCells.has(cellIndex);

    // Cell background
    if (isShip && isHit) {
      // Ship hit - red
      ctx.fillStyle = COLORS.shipHit;
    } else if (isShip && showShips) {
      // Ship (visible) - blue
      ctx.fillStyle = COLORS.ship;
    } else if (isHit) {
      // Miss - darker water
      ctx.fillStyle = COLORS.miss;
    } else {
      // Water
      ctx.fillStyle = COLORS.water;
    }

    ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);

    // Hit marker
    if (isHit) {
      ctx.fillStyle = isShip ? '#ffffff' : COLORS.textMuted;
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isShip ? '✕' : '•', x + CELL_SIZE / 2, y + CELL_SIZE / 2);
    }
  }

  // Grid lines
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 1;

  // Vertical lines
  for (let col = 0; col <= GRID_SIZE; col++) {
    const x = startX + col * CELL_SIZE;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, startY + GRID_SIZE * CELL_SIZE);
    ctx.stroke();
  }

  // Horizontal lines
  for (let row = 0; row <= GRID_SIZE; row++) {
    const y = startY + row * CELL_SIZE;
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(startX + GRID_SIZE * CELL_SIZE, y);
    ctx.stroke();
  }

  // Column labels (A-E)
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  for (let col = 0; col < GRID_SIZE; col++) {
    const label = String.fromCharCode(65 + col); // A, B, C, D, E
    ctx.fillText(
      label,
      startX + col * CELL_SIZE + CELL_SIZE / 2,
      startY - 10
    );
  }

  // Row labels (1-5)
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let row = 0; row < GRID_SIZE; row++) {
    ctx.fillText(
      String(row + 1),
      startX - 10,
      startY + row * CELL_SIZE + CELL_SIZE / 2
    );
  }
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  options: CardRenderOptions
): void {
  const centerX = CANVAS_WIDTH / 2;
  const footerY = HEADER_HEIGHT + GRID_SIZE * CELL_SIZE + GRID_PADDING + 25;

  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Game: ${options.gameId}`, centerX, footerY);
  ctx.fillText(`Round: ${options.currentRound}`, centerX, footerY + 18);
}

// =============================================================================
// Round Result Renderer
// =============================================================================

export interface RoundResultOptions {
  gameId: string;
  roundNumber: number;
  shotCell: CellIndex;
  hits: string[]; // player IDs that were hit
  eliminations: string[]; // player IDs eliminated this round
  remainingPlayers: number;
}

export function renderRoundResult(options: RoundResultOptions): Buffer {
  const width = 400;
  const height = 300;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  // Header
  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BATTLE DINGHY', width / 2, 40);

  // Round number
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`Round ${options.roundNumber}`, width / 2, 80);

  // Shot info
  const pos = cellToPosition(options.shotCell);
  const cellLabel = `${String.fromCharCode(65 + pos.col)}${pos.row + 1}`;
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '16px sans-serif';
  ctx.fillText(`Shot fired at: ${cellLabel}`, width / 2, 120);

  // Hits
  let yPos = 155;
  if (options.hits.length > 0) {
    ctx.fillStyle = COLORS.shipHit;
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`💥 ${options.hits.length} HIT${options.hits.length > 1 ? 'S' : ''}!`, width / 2, yPos);
    yPos += 25;
  } else {
    ctx.fillStyle = COLORS.textMuted;
    ctx.font = '16px sans-serif';
    ctx.fillText('No hits this round', width / 2, yPos);
    yPos += 25;
  }

  // Eliminations
  if (options.eliminations.length > 0) {
    ctx.fillStyle = COLORS.eliminated;
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(
      `☠️ ${options.eliminations.length} ELIMINATED`,
      width / 2,
      yPos
    );
    yPos += 25;
  }

  // Remaining players
  ctx.fillStyle = COLORS.text;
  ctx.font = '14px sans-serif';
  ctx.fillText(
    `${options.remainingPlayers} players remaining`,
    width / 2,
    yPos + 20
  );

  // Footer
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '12px sans-serif';
  ctx.fillText(`Game: ${options.gameId}`, width / 2, height - 20);

  return canvas.toBuffer('image/png');
}

// =============================================================================
// Winner Announcement Renderer
// =============================================================================

export interface WinnerOptions {
  gameId: string;
  winnerWallet: string;
  winnerIndex: number;
  totalRounds: number;
  prizePool: string; // formatted string like "0.01 SOL"
}

export function renderWinner(options: WinnerOptions): Buffer {
  const width = 400;
  const height = 350;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  // Trophy emoji / celebration
  ctx.font = '60px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🏆', width / 2, 70);

  // Header
  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText('WINNER!', width / 2, 120);

  // Winner info
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`Player ${options.winnerIndex + 1}`, width / 2, 165);

  // Wallet (truncated)
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '14px monospace';
  const shortWallet = `${options.winnerWallet.slice(0, 8)}...${options.winnerWallet.slice(-6)}`;
  ctx.fillText(shortWallet, width / 2, 195);

  // Prize
  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(`Prize: ${options.prizePool}`, width / 2, 245);

  // Stats
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '14px sans-serif';
  ctx.fillText(`Completed in ${options.totalRounds} rounds`, width / 2, 285);

  // Footer
  ctx.font = '12px sans-serif';
  ctx.fillText(`Game: ${options.gameId}`, width / 2, height - 20);

  return canvas.toBuffer('image/png');
}
