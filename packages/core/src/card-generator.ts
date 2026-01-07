// Battle Dinghy - Card Generator
//
// DETERMINISM REQUIREMENT:
// All functions in this module MUST be deterministic. Given the same inputs
// (gameSeed, playerWallet, playerIndex), the output MUST always be identical.
// This is critical for:
// 1. Verifying player cards match expected generation
// 2. Allowing any party to independently verify game fairness
// 3. Recovering game state from seed + player list
//
// We achieve determinism by:
// - Using SHA256 to derive player-specific seeds
// - Using a seeded PRNG (xorshift128+) for all randomness
// - Processing ship placements in a fixed order (size 3, 2, 1)

import { createHash } from 'crypto';
import {
  CellIndex,
  Ship,
  ShipPlacement,
  ShipSize,
  PlacementDirection,
  GRID_SIZE,
  TOTAL_CELLS,
  SHIP_SIZES,
  createCellIndex,
  cellToPosition,
  positionToCell,
} from './types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * A generated card containing ships and metadata
 */
export interface GeneratedCard {
  readonly playerId: string;
  readonly ships: readonly Ship[];
  readonly allCells: readonly CellIndex[];
}

/**
 * Internal state for xorshift128+ PRNG
 */
interface XorShiftState {
  s0: bigint;
  s1: bigint;
}

// =============================================================================
// Seeded PRNG (xorshift128+)
// =============================================================================

/**
 * Creates a seeded xorshift128+ PRNG state from a 32-byte seed.
 * Uses first 16 bytes for s0, second 16 bytes for s1.
 */
function createPrngState(seed: Uint8Array): XorShiftState {
  if (seed.length < 32) {
    throw new Error('Seed must be at least 32 bytes');
  }

  // Read first 16 bytes as s0, next 16 bytes as s1
  let s0 = BigInt(0);
  let s1 = BigInt(0);

  for (let i = 0; i < 8; i++) {
    s0 |= BigInt(seed[i]) << BigInt(i * 8);
  }
  for (let i = 0; i < 8; i++) {
    s1 |= BigInt(seed[i + 8]) << BigInt(i * 8);
  }

  // Ensure non-zero state
  if (s0 === BigInt(0) && s1 === BigInt(0)) {
    s0 = BigInt(1);
  }

  return { s0, s1 };
}

/**
 * Generates next random 64-bit value and updates state.
 * Implementation of xorshift128+.
 */
function nextRandom(state: XorShiftState): bigint {
  const mask64 = BigInt('0xFFFFFFFFFFFFFFFF');

  let s1 = state.s0;
  const s0 = state.s1;

  state.s0 = s0;
  s1 ^= (s1 << BigInt(23)) & mask64;
  s1 ^= s1 >> BigInt(17);
  s1 ^= s0;
  s1 ^= s0 >> BigInt(26);
  state.s1 = s1 & mask64;

  return (state.s0 + state.s1) & mask64;
}

/**
 * Generates a random integer in range [0, max) using the PRNG.
 * Uses rejection sampling to avoid modulo bias.
 */
function randomInt(state: XorShiftState, max: number): number {
  if (max <= 0) {
    throw new Error('max must be positive');
  }

  const maxBigInt = BigInt(max);
  const mask64 = BigInt('0xFFFFFFFFFFFFFFFF');
  const threshold = mask64 - (mask64 % maxBigInt);

  let rand: bigint;
  do {
    rand = nextRandom(state);
  } while (rand >= threshold);

  return Number(rand % maxBigInt);
}

// =============================================================================
// Seed Derivation
// =============================================================================

/**
 * Derives a player-specific 32-byte seed from the game seed, wallet, and index.
 * This ensures each player gets unique but deterministic randomness.
 *
 * @param gameSeed - The game's master seed (32 bytes)
 * @param playerWallet - Player's wallet address string
 * @param playerIndex - Player's index in the game (0-9)
 * @returns 32-byte player-specific seed
 */
export function derivePlayerSeed(
  gameSeed: Uint8Array,
  playerWallet: string,
  playerIndex: number
): Uint8Array {
  const hash = createHash('sha256');
  hash.update(gameSeed);
  hash.update(playerWallet);
  hash.update(Buffer.from([playerIndex]));
  return new Uint8Array(hash.digest());
}

// =============================================================================
// Ship Placement Logic
// =============================================================================

/**
 * Gets all cells occupied by a ship given its placement.
 *
 * @param placement - The ship placement specification
 * @returns Array of cell indices the ship occupies, or null if invalid
 */
export function getShipCells(placement: ShipPlacement): CellIndex[] | null {
  const startPos = cellToPosition(placement.startCell);
  const cells: CellIndex[] = [];

  for (let i = 0; i < placement.size; i++) {
    let row = startPos.row;
    let col = startPos.col;

    if (placement.direction === 'horizontal') {
      col += i;
    } else {
      row += i;
    }

    // Check bounds
    if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) {
      return null;
    }

    cells.push(positionToCell({ row, col }));
  }

  return cells;
}

/**
 * Returns all valid placements for a ship of given size, avoiding occupied cells.
 *
 * @param size - Size of ship to place
 * @param occupiedCells - Set of cells already occupied by other ships
 * @returns Array of all valid placements
 */
export function getAllValidPlacements(
  size: ShipSize,
  occupiedCells: Set<CellIndex>
): ShipPlacement[] {
  const placements: ShipPlacement[] = [];
  const directions: PlacementDirection[] = ['horizontal', 'vertical'];

  for (let cellNum = 0; cellNum < TOTAL_CELLS; cellNum++) {
    const startCell = createCellIndex(cellNum);

    for (const direction of directions) {
      const placement: ShipPlacement = { startCell, direction, size };
      const cells = getShipCells(placement);

      if (cells === null) {
        continue; // Ship doesn't fit on grid
      }

      // Check for overlap with occupied cells
      const hasOverlap = cells.some(cell => occupiedCells.has(cell));
      if (!hasOverlap) {
        placements.push(placement);
      }
    }
  }

  return placements;
}

/**
 * Places all ships on the grid using deterministic random selection.
 * Ships are placed in order: size 3, then 2, then 1.
 *
 * @param prngState - The PRNG state for random selection
 * @returns Array of placed ships
 */
function placeShips(prngState: XorShiftState): Ship[] {
  const ships: Ship[] = [];
  const occupiedCells = new Set<CellIndex>();

  for (const size of SHIP_SIZES) {
    const validPlacements = getAllValidPlacements(size, occupiedCells);

    if (validPlacements.length === 0) {
      throw new Error(`No valid placements for ship of size ${size}`);
    }

    // Deterministically select a placement
    const placementIndex = randomInt(prngState, validPlacements.length);
    const selectedPlacement = validPlacements[placementIndex];
    const cells = getShipCells(selectedPlacement)!;

    ships.push({
      size,
      cells: cells as readonly CellIndex[],
    });

    // Mark cells as occupied
    for (const cell of cells) {
      occupiedCells.add(cell);
    }
  }

  return ships;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Generates a deterministic player card from game seed and player info.
 *
 * DETERMINISM: This function is fully deterministic. Given the same
 * gameSeed, playerWallet, and playerIndex, it will ALWAYS return the
 * same card with the same ship placements.
 *
 * @param gameSeed - 32-byte game seed
 * @param playerWallet - Player's wallet address
 * @param playerIndex - Player's index in the game (0-9)
 * @returns Generated card with ships
 */
export function generateCard(
  gameSeed: Uint8Array,
  playerWallet: string,
  playerIndex: number
): GeneratedCard {
  // Derive player-specific seed
  const playerSeed = derivePlayerSeed(gameSeed, playerWallet, playerIndex);

  // Initialize PRNG with player seed
  const prngState = createPrngState(playerSeed);

  // Place ships deterministically
  const ships = placeShips(prngState);

  // Collect all cells
  const allCells: CellIndex[] = [];
  for (const ship of ships) {
    allCells.push(...ship.cells);
  }

  return {
    playerId: playerWallet,
    ships: ships as readonly Ship[],
    allCells: allCells as readonly CellIndex[],
  };
}

/**
 * Generates cards for all players in a game.
 *
 * @param gameSeed - 32-byte game seed
 * @param players - Array of player wallet addresses
 * @returns Map of player wallet to generated card
 */
export function generateAllCards(
  gameSeed: Uint8Array,
  players: readonly string[]
): Map<string, GeneratedCard> {
  const cards = new Map<string, GeneratedCard>();

  for (let i = 0; i < players.length; i++) {
    const wallet = players[i];
    const card = generateCard(gameSeed, wallet, i);
    cards.set(wallet, card);
  }

  return cards;
}

/**
 * Verifies that a claimed card matches deterministic generation.
 *
 * This allows any party to verify a player's card is legitimate
 * by regenerating it from the game seed and comparing.
 *
 * @param gameSeed - 32-byte game seed
 * @param playerWallet - Player's wallet address
 * @param playerIndex - Player's index in the game
 * @param claimedCard - The card being verified
 * @returns true if card matches expected generation
 */
export function verifyCard(
  gameSeed: Uint8Array,
  playerWallet: string,
  playerIndex: number,
  claimedCard: GeneratedCard
): boolean {
  const expectedCard = generateCard(gameSeed, playerWallet, playerIndex);

  // Compare player ID
  if (expectedCard.playerId !== claimedCard.playerId) {
    return false;
  }

  // Compare ships
  if (expectedCard.ships.length !== claimedCard.ships.length) {
    return false;
  }

  for (let i = 0; i < expectedCard.ships.length; i++) {
    const expectedShip = expectedCard.ships[i];
    const claimedShip = claimedCard.ships[i];

    if (expectedShip.size !== claimedShip.size) {
      return false;
    }

    if (expectedShip.cells.length !== claimedShip.cells.length) {
      return false;
    }

    for (let j = 0; j < expectedShip.cells.length; j++) {
      if (expectedShip.cells[j] !== claimedShip.cells[j]) {
        return false;
      }
    }
  }

  // Compare all cells
  if (expectedCard.allCells.length !== claimedCard.allCells.length) {
    return false;
  }

  for (let i = 0; i < expectedCard.allCells.length; i++) {
    if (expectedCard.allCells[i] !== claimedCard.allCells[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Creates a 32-byte seed from a hex string.
 * Utility function for testing and initialization.
 */
export function seedFromHex(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (cleanHex.length !== 64) {
    throw new Error('Hex seed must be 64 characters (32 bytes)');
  }

  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Generates a random 32-byte seed.
 * NOTE: This uses crypto.randomBytes which is NOT deterministic.
 * Only use for creating new game seeds, not for card generation.
 */
export function generateRandomSeed(): Uint8Array {
  const { randomBytes } = require('crypto');
  return new Uint8Array(randomBytes(32));
}
