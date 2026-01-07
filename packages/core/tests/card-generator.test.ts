import { describe, it, expect } from 'vitest';
import {
  generateCard,
  generateAllCards,
  verifyCard,
  getAllValidPlacements,
  getShipCells,
  seedFromHex,
  derivePlayerSeed,
  GeneratedCard,
} from '../src/card-generator.js';
import {
  GRID_SIZE,
  TOTAL_CELLS,
  SHIP_SIZES,
  TOTAL_SHIP_CELLS,
  CellIndex,
  createCellIndex,
  cellToPosition,
} from '../src/types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const TEST_SEED = seedFromHex(
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
);

const TEST_SEED_2 = seedFromHex(
  'f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f5e6d7c8b9a0f1e2'
);

const TEST_WALLETS = [
  'Wallet1111111111111111111111111111111111111',
  'Wallet2222222222222222222222222222222222222',
  'Wallet3333333333333333333333333333333333333',
  'Wallet4444444444444444444444444444444444444',
  'Wallet5555555555555555555555555555555555555',
  'Wallet6666666666666666666666666666666666666',
  'Wallet7777777777777777777777777777777777777',
  'Wallet8888888888888888888888888888888888888',
  'Wallet9999999999999999999999999999999999999',
  'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
];

// =============================================================================
// Helper Functions
// =============================================================================

function isContiguous(cells: readonly CellIndex[]): boolean {
  if (cells.length <= 1) return true;

  const positions = cells.map(cellToPosition);

  // Check if all in same row (horizontal)
  const sameRow = positions.every(p => p.row === positions[0].row);
  if (sameRow) {
    const cols = positions.map(p => p.col).sort((a, b) => a - b);
    for (let i = 1; i < cols.length; i++) {
      if (cols[i] !== cols[i - 1] + 1) return false;
    }
    return true;
  }

  // Check if all in same column (vertical)
  const sameCol = positions.every(p => p.col === positions[0].col);
  if (sameCol) {
    const rows = positions.map(p => p.row).sort((a, b) => a - b);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] !== rows[i - 1] + 1) return false;
    }
    return true;
  }

  return false;
}

function hasOverlap(ships: readonly { cells: readonly CellIndex[] }[]): boolean {
  const allCells = new Set<number>();
  for (const ship of ships) {
    for (const cell of ship.cells) {
      if (allCells.has(cell)) return true;
      allCells.add(cell);
    }
  }
  return false;
}

// =============================================================================
// 1. Determinism Tests
// =============================================================================

describe('Determinism', () => {
  it('same inputs produce identical cards', () => {
    const card1 = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    const card2 = generateCard(TEST_SEED, TEST_WALLETS[0], 0);

    expect(card1.playerId).toBe(card2.playerId);
    expect(card1.ships.length).toBe(card2.ships.length);

    for (let i = 0; i < card1.ships.length; i++) {
      expect(card1.ships[i].size).toBe(card2.ships[i].size);
      expect(card1.ships[i].cells).toEqual(card2.ships[i].cells);
    }

    expect(card1.allCells).toEqual(card2.allCells);
  });

  it('different seeds produce different cards', () => {
    const card1 = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    const card2 = generateCard(TEST_SEED_2, TEST_WALLETS[0], 0);

    // Very unlikely to be equal with different seeds
    const cells1 = card1.allCells.join(',');
    const cells2 = card2.allCells.join(',');
    expect(cells1).not.toBe(cells2);
  });

  it('different player indexes produce different cards', () => {
    const card1 = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    const card2 = generateCard(TEST_SEED, TEST_WALLETS[0], 1);

    const cells1 = card1.allCells.join(',');
    const cells2 = card2.allCells.join(',');
    expect(cells1).not.toBe(cells2);
  });

  it('different wallets produce different cards', () => {
    const card1 = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    const card2 = generateCard(TEST_SEED, TEST_WALLETS[1], 0);

    const cells1 = card1.allCells.join(',');
    const cells2 = card2.allCells.join(',');
    expect(cells1).not.toBe(cells2);
  });

  it('derivePlayerSeed is deterministic', () => {
    const seed1 = derivePlayerSeed(TEST_SEED, TEST_WALLETS[0], 0);
    const seed2 = derivePlayerSeed(TEST_SEED, TEST_WALLETS[0], 0);

    expect(Buffer.from(seed1).toString('hex')).toBe(
      Buffer.from(seed2).toString('hex')
    );
  });

  it('generateAllCards produces deterministic results', () => {
    const cards1 = generateAllCards(TEST_SEED, TEST_WALLETS);
    const cards2 = generateAllCards(TEST_SEED, TEST_WALLETS);

    expect(cards1.size).toBe(cards2.size);

    for (const wallet of TEST_WALLETS) {
      const c1 = cards1.get(wallet)!;
      const c2 = cards2.get(wallet)!;
      expect(c1.allCells).toEqual(c2.allCells);
    }
  });
});

// =============================================================================
// 2. Validity Tests
// =============================================================================

describe('Validity', () => {
  it('all ships have correct sizes (3, 2, 1)', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);

    expect(card.ships.length).toBe(3);
    expect(card.ships[0].size).toBe(3);
    expect(card.ships[1].size).toBe(2);
    expect(card.ships[2].size).toBe(1);
  });

  it('ship cell counts match ship sizes', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);

    for (const ship of card.ships) {
      expect(ship.cells.length).toBe(ship.size);
    }
  });

  it('no ships overlap', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    expect(hasOverlap(card.ships)).toBe(false);
  });

  it('all cells are within 0-24', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);

    for (const cell of card.allCells) {
      expect(cell).toBeGreaterThanOrEqual(0);
      expect(cell).toBeLessThan(TOTAL_CELLS);
    }
  });

  it('ships are contiguous (horizontal or vertical)', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);

    for (const ship of card.ships) {
      expect(isContiguous(ship.cells)).toBe(true);
    }
  });

  it('total ship cells equals TOTAL_SHIP_CELLS (6)', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    expect(card.allCells.length).toBe(TOTAL_SHIP_CELLS);
  });

  it('allCells matches flattened ship cells', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);

    const fromShips: number[] = [];
    for (const ship of card.ships) {
      fromShips.push(...ship.cells);
    }

    expect(card.allCells.length).toBe(fromShips.length);
    for (let i = 0; i < card.allCells.length; i++) {
      expect(card.allCells[i]).toBe(fromShips[i]);
    }
  });

  it('validity holds for multiple generated cards', () => {
    for (let i = 0; i < 10; i++) {
      const card = generateCard(TEST_SEED, TEST_WALLETS[i % TEST_WALLETS.length], i);

      // Correct sizes
      expect(card.ships.map(s => s.size)).toEqual([3, 2, 1]);

      // No overlap
      expect(hasOverlap(card.ships)).toBe(false);

      // All contiguous
      for (const ship of card.ships) {
        expect(isContiguous(ship.cells)).toBe(true);
      }

      // All cells in bounds
      for (const cell of card.allCells) {
        expect(cell).toBeGreaterThanOrEqual(0);
        expect(cell).toBeLessThan(TOTAL_CELLS);
      }
    }
  });
});

// =============================================================================
// 3. Uniqueness Tests
// =============================================================================

describe('Uniqueness', () => {
  it('10 cards for a game are all different', () => {
    const cards = generateAllCards(TEST_SEED, TEST_WALLETS);
    const cellStrings = new Set<string>();

    for (const [, card] of cards) {
      const cellStr = card.allCells.join(',');
      cellStrings.add(cellStr);
    }

    expect(cellStrings.size).toBe(10);
  });

  it('no two cards have identical ship placements', () => {
    const cards = generateAllCards(TEST_SEED, TEST_WALLETS);
    const placements = new Set<string>();

    for (const [, card] of cards) {
      // Create a string representation of all ship placements
      const placementStr = card.ships
        .map(s => `${s.size}:${[...s.cells].sort((a, b) => a - b).join(',')}`)
        .join('|');
      placements.add(placementStr);
    }

    expect(placements.size).toBe(10);
  });

  it('different seeds produce different card sets', () => {
    const cards1 = generateAllCards(TEST_SEED, TEST_WALLETS);
    const cards2 = generateAllCards(TEST_SEED_2, TEST_WALLETS);

    let differences = 0;
    for (const wallet of TEST_WALLETS) {
      const c1 = cards1.get(wallet)!;
      const c2 = cards2.get(wallet)!;
      if (c1.allCells.join(',') !== c2.allCells.join(',')) {
        differences++;
      }
    }

    // All 10 should be different
    expect(differences).toBe(10);
  });
});

// =============================================================================
// 4. Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  it('handles zero-filled seed', () => {
    const zeroSeed = new Uint8Array(32).fill(0);
    const card = generateCard(zeroSeed, TEST_WALLETS[0], 0);

    // Should still produce valid card
    expect(card.ships.length).toBe(3);
    expect(card.allCells.length).toBe(TOTAL_SHIP_CELLS);
    expect(hasOverlap(card.ships)).toBe(false);
  });

  it('handles long wallet address', () => {
    const longWallet = 'A'.repeat(100);
    const card = generateCard(TEST_SEED, longWallet, 0);

    expect(card.playerId).toBe(longWallet);
    expect(card.ships.length).toBe(3);
    expect(card.allCells.length).toBe(TOTAL_SHIP_CELLS);
  });

  it('handles short wallet address', () => {
    const shortWallet = 'ABC';
    const card = generateCard(TEST_SEED, shortWallet, 0);

    expect(card.playerId).toBe(shortWallet);
    expect(card.ships.length).toBe(3);
  });

  it('handles empty wallet string', () => {
    const card = generateCard(TEST_SEED, '', 0);

    expect(card.playerId).toBe('');
    expect(card.ships.length).toBe(3);
    expect(card.allCells.length).toBe(TOTAL_SHIP_CELLS);
  });

  it('player index 0 produces valid card', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    expect(card.ships.length).toBe(3);
    expect(hasOverlap(card.ships)).toBe(false);
  });

  it('player index 9 produces valid card', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[9], 9);
    expect(card.ships.length).toBe(3);
    expect(hasOverlap(card.ships)).toBe(false);
  });

  it('high player index produces valid card', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 255);
    expect(card.ships.length).toBe(3);
    expect(hasOverlap(card.ships)).toBe(false);
  });

  it('seedFromHex handles 0x prefix', () => {
    const withPrefix = seedFromHex('0x' + 'a'.repeat(64));
    const withoutPrefix = seedFromHex('a'.repeat(64));
    expect(Buffer.from(withPrefix)).toEqual(Buffer.from(withoutPrefix));
  });

  it('seedFromHex throws on wrong length', () => {
    expect(() => seedFromHex('abc')).toThrow();
    expect(() => seedFromHex('a'.repeat(63))).toThrow();
    expect(() => seedFromHex('a'.repeat(65))).toThrow();
  });
});

// =============================================================================
// 5. Verification Tests
// =============================================================================

describe('Verification', () => {
  it('valid card passes verification', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    expect(verifyCard(TEST_SEED, TEST_WALLETS[0], 0, card)).toBe(true);
  });

  it('verification works for all players', () => {
    const cards = generateAllCards(TEST_SEED, TEST_WALLETS);

    let index = 0;
    for (const [wallet, card] of cards) {
      expect(verifyCard(TEST_SEED, wallet, index, card)).toBe(true);
      index++;
    }
  });

  it('wrong playerId fails verification', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    const tamperedCard: GeneratedCard = {
      ...card,
      playerId: 'TamperedWallet',
    };
    expect(verifyCard(TEST_SEED, TEST_WALLETS[0], 0, tamperedCard)).toBe(false);
  });

  it('wrong ship size fails verification', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    const tamperedShips = [...card.ships];
    tamperedShips[0] = { ...tamperedShips[0], size: 2 as const };

    const tamperedCard: GeneratedCard = {
      ...card,
      ships: tamperedShips,
    };
    expect(verifyCard(TEST_SEED, TEST_WALLETS[0], 0, tamperedCard)).toBe(false);
  });

  it('wrong cell fails verification', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    const tamperedShips = [...card.ships];
    const newCells = [...tamperedShips[0].cells];
    // Swap a cell
    newCells[0] = createCellIndex((newCells[0] + 1) % TOTAL_CELLS);
    tamperedShips[0] = { ...tamperedShips[0], cells: newCells };

    const tamperedCard: GeneratedCard = {
      ...card,
      ships: tamperedShips,
    };
    expect(verifyCard(TEST_SEED, TEST_WALLETS[0], 0, tamperedCard)).toBe(false);
  });

  it('wrong player index fails verification', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    // Verify with wrong index
    expect(verifyCard(TEST_SEED, TEST_WALLETS[0], 1, card)).toBe(false);
  });

  it('wrong seed fails verification', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    // Verify with different seed
    expect(verifyCard(TEST_SEED_2, TEST_WALLETS[0], 0, card)).toBe(false);
  });

  it('extra ship fails verification', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    const tamperedCard: GeneratedCard = {
      ...card,
      ships: [...card.ships, { size: 1 as const, cells: [createCellIndex(0)] }],
    };
    expect(verifyCard(TEST_SEED, TEST_WALLETS[0], 0, tamperedCard)).toBe(false);
  });

  it('missing ship fails verification', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    const tamperedCard: GeneratedCard = {
      ...card,
      ships: card.ships.slice(0, 2),
    };
    expect(verifyCard(TEST_SEED, TEST_WALLETS[0], 0, tamperedCard)).toBe(false);
  });

  it('tampered allCells fails verification', () => {
    const card = generateCard(TEST_SEED, TEST_WALLETS[0], 0);
    const tamperedAllCells = [...card.allCells];
    tamperedAllCells[0] = createCellIndex((tamperedAllCells[0] + 1) % TOTAL_CELLS);

    const tamperedCard: GeneratedCard = {
      ...card,
      allCells: tamperedAllCells,
    };
    expect(verifyCard(TEST_SEED, TEST_WALLETS[0], 0, tamperedCard)).toBe(false);
  });
});

// =============================================================================
// 6. getAllValidPlacements Tests
// =============================================================================

describe('getAllValidPlacements', () => {
  it('returns placements for size 1 on empty grid', () => {
    const placements = getAllValidPlacements(1, new Set());
    // Size 1 can go anywhere, 2 directions each (but effectively same for size 1)
    // 25 cells * 2 directions = 50 placements
    expect(placements.length).toBe(50);
  });

  it('returns placements for size 3 on empty grid', () => {
    const placements = getAllValidPlacements(3, new Set());
    // Horizontal: rows 0-4, cols 0-2 = 5 * 3 = 15
    // Vertical: rows 0-2, cols 0-4 = 3 * 5 = 15
    // Total = 30
    expect(placements.length).toBe(30);
  });

  it('excludes placements that overlap occupied cells', () => {
    const occupied = new Set<CellIndex>([createCellIndex(12)]); // Center cell
    const placementsBefore = getAllValidPlacements(1, new Set());
    const placementsAfter = getAllValidPlacements(1, occupied);

    // Should exclude 2 placements (h and v at cell 12)
    expect(placementsAfter.length).toBe(placementsBefore.length - 2);
  });

  it('getShipCells returns null for out-of-bounds horizontal', () => {
    const placement = {
      startCell: createCellIndex(3), // col 3
      direction: 'horizontal' as const,
      size: 3 as const,
    };
    // Would need cols 3, 4, 5 - but col 5 doesn't exist
    expect(getShipCells(placement)).toBeNull();
  });

  it('getShipCells returns null for out-of-bounds vertical', () => {
    const placement = {
      startCell: createCellIndex(20), // row 4
      direction: 'vertical' as const,
      size: 3 as const,
    };
    // Would need rows 4, 5, 6 - but rows 5, 6 don't exist
    expect(getShipCells(placement)).toBeNull();
  });

  it('getShipCells returns valid cells for valid placement', () => {
    const placement = {
      startCell: createCellIndex(0),
      direction: 'horizontal' as const,
      size: 3 as const,
    };
    const cells = getShipCells(placement);
    expect(cells).not.toBeNull();
    expect(cells!.length).toBe(3);
    expect(cells).toEqual([
      createCellIndex(0),
      createCellIndex(1),
      createCellIndex(2),
    ]);
  });
});

// =============================================================================
// 7. Stress Tests
// =============================================================================

describe('Stress Tests', () => {
  it('generates 100 valid cards with high uniqueness', () => {
    const uniqueCards = new Set<string>();

    for (let i = 0; i < 100; i++) {
      // Generate unique seed for each card using better distribution
      const seedBytes = new Uint8Array(32);
      for (let j = 0; j < 32; j++) {
        // Use prime multipliers for better distribution
        seedBytes[j] = ((i * 251 + j * 241 + 17) * 239) % 256;
      }

      const card = generateCard(seedBytes, `UniqueWallet_${i}_${Date.now()}`, i);

      // Validate - these are the important tests
      expect(card.ships.length).toBe(3);
      expect(card.allCells.length).toBe(TOTAL_SHIP_CELLS);
      expect(hasOverlap(card.ships)).toBe(false);

      for (const ship of card.ships) {
        expect(isContiguous(ship.cells)).toBe(true);
      }

      for (const cell of card.allCells) {
        expect(cell).toBeGreaterThanOrEqual(0);
        expect(cell).toBeLessThan(TOTAL_CELLS);
      }

      uniqueCards.add(card.allCells.join(','));
    }

    // With a 5x5 grid and only 6 ship cells, there's a finite number of
    // possible arrangements. We expect high uniqueness but allow for
    // occasional collisions (shouldn't happen in practice with good seeds)
    expect(uniqueCards.size).toBeGreaterThanOrEqual(95);
  });

  it('determinism holds under stress', () => {
    // Generate the same 50 cards twice and verify they match
    for (let i = 0; i < 50; i++) {
      const seedBytes = new Uint8Array(32);
      for (let j = 0; j < 32; j++) {
        seedBytes[j] = (i * 13 + j * 17) % 256;
      }

      const wallet = `StressWallet${i}`;
      const card1 = generateCard(seedBytes, wallet, i % 10);
      const card2 = generateCard(seedBytes, wallet, i % 10);

      expect(card1.allCells).toEqual(card2.allCells);
      expect(verifyCard(seedBytes, wallet, i % 10, card1)).toBe(true);
    }
  });
});
