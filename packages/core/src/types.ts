// Battle Dinghy - Core Types

// =============================================================================
// Game Constants
// =============================================================================

export const GRID_SIZE = 5;
export const TOTAL_CELLS = 25;
export const MAX_PLAYERS = 10;
export const SHIP_SIZES: readonly ShipSize[] = [3, 2, 1] as const;
export const TOTAL_SHIP_CELLS = 6;
export const SUDDEN_DEATH_ROUND_1 = 31;
export const SUDDEN_DEATH_ROUND_2 = 41;
export const MAX_ROUNDS = 50;

// =============================================================================
// Core Types
// =============================================================================

/** Cell index from 0-24 representing a position on the 5x5 grid */
export type CellIndex = number & { readonly __brand: unique symbol };

/** Grid position with row and column (0-4 each) */
export interface GridPosition {
  readonly row: number;
  readonly col: number;
}

/** Ship sizes: 3 = Giant Dinghy, 2 = Mid Dinghy, 1 = Tiny Dinghy */
export type ShipSize = 1 | 2 | 3;

/** A ship with its size and occupied cells */
export interface Ship {
  readonly size: ShipSize;
  readonly cells: readonly CellIndex[];
}

/** Direction for ship placement */
export type PlacementDirection = 'horizontal' | 'vertical';

/** Ship placement specification */
export interface ShipPlacement {
  readonly startCell: CellIndex;
  readonly direction: PlacementDirection;
  readonly size: ShipSize;
}

/** A player's card containing their ship configuration and game state */
export interface PlayerCard {
  readonly playerId: string;
  readonly ships: readonly Ship[];
  readonly hitCells: Set<CellIndex>;
  readonly isEliminated: boolean;
  readonly eliminatedAtRound: number | null;
}

/** Game status enum */
export enum GameStatus {
  OPEN = 'OPEN',
  FILLED = 'FILLED',
  ACTIVE = 'ACTIVE',
  COMPLETE = 'COMPLETE',
  CANCELLED = 'CANCELLED',
  PAUSED = 'PAUSED',
}

/** Result of a single round */
export interface RoundResult {
  readonly roundNumber: number;
  readonly primaryShot: CellIndex;
  readonly derivedShots: readonly CellIndex[];
  readonly eliminations: readonly string[];
  readonly oreProof: string;
}

/** Complete game state */
export interface GameState {
  readonly gameId: string;
  readonly status: GameStatus;
  readonly players: Map<string, PlayerCard>;
  readonly currentRound: number;
  readonly rounds: readonly RoundResult[];
  readonly winner: string | null;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates a branded CellIndex from a number
 * @throws Error if cell is out of range
 */
export function createCellIndex(cell: number): CellIndex {
  if (!isValidCell(cell)) {
    throw new Error(`Invalid cell index: ${cell}. Must be between 0 and ${TOTAL_CELLS - 1}`);
  }
  return cell as CellIndex;
}

/**
 * Converts a cell index (0-24) to a grid position
 */
export function cellToPosition(cell: CellIndex): GridPosition {
  return {
    row: Math.floor(cell / GRID_SIZE),
    col: cell % GRID_SIZE,
  };
}

/**
 * Converts a grid position to a cell index (0-24)
 * @throws Error if position is out of bounds
 */
export function positionToCell(pos: GridPosition): CellIndex {
  if (pos.row < 0 || pos.row >= GRID_SIZE || pos.col < 0 || pos.col >= GRID_SIZE) {
    throw new Error(`Invalid position: row=${pos.row}, col=${pos.col}. Must be between 0 and ${GRID_SIZE - 1}`);
  }
  return (pos.row * GRID_SIZE + pos.col) as CellIndex;
}

/**
 * Checks if a cell index is valid (0-24)
 */
export function isValidCell(cell: number): cell is CellIndex {
  return Number.isInteger(cell) && cell >= 0 && cell < TOTAL_CELLS;
}

/**
 * Checks if a grid position is valid (within bounds)
 */
export function isValidPosition(pos: GridPosition): boolean {
  return (
    Number.isInteger(pos.row) &&
    Number.isInteger(pos.col) &&
    pos.row >= 0 &&
    pos.row < GRID_SIZE &&
    pos.col >= 0 &&
    pos.col < GRID_SIZE
  );
}
