import type { BoardState, Ship, ShipType } from "@shared/schema";

// Grid coordinate utilities
const ROWS = ['A', 'B', 'C', 'D', 'E'];
const COLS = [1, 2, 3, 4, 5];

export function oreHashToCoordinate(blockHash: string): string {
  const hashInt = BigInt(blockHash);
  const position = Number(hashInt % BigInt(25));
  
  const row = Math.floor(position / 5);
  const col = position % 5;
  
  const rowLetter = ROWS[row];
  const colNumber = COLS[col];
  
  return `${rowLetter}${colNumber}`;
}

export function generateRandomBoard(): BoardState {
  const ships: Ship[] = [];
  const occupiedCoordinates = new Set<string>();
  const forbiddenCoordinates = new Set<string>();

  const shipConfigs: Array<{ type: ShipType; size: number; hp: number }> = [
    { type: "big_dinghy", size: 3, hp: 3 },
    { type: "dinghy", size: 2, hp: 2 },
    { type: "small_dinghy", size: 1, hp: 1 },
  ];

  for (const config of shipConfigs) {
    let placed = false;
    let attempts = 0;
    const maxAttempts = 100;

    while (!placed && attempts < maxAttempts) {
      attempts++;
      
      const orientation = Math.random() < 0.5 ? "horizontal" : "vertical";
      const startRow = Math.floor(Math.random() * 5);
      const startCol = Math.floor(Math.random() * 5);

      const coordinates: string[] = [];
      let canPlace = true;

      if (orientation === "horizontal") {
        if (startCol + config.size > 5) {
          continue;
        }
        
        for (let i = 0; i < config.size; i++) {
          const coord = `${ROWS[startRow]}${COLS[startCol + i]}`;
          if (occupiedCoordinates.has(coord) || forbiddenCoordinates.has(coord)) {
            canPlace = false;
            break;
          }
          coordinates.push(coord);
        }
      } else {
        if (startRow + config.size > 5) {
          continue;
        }
        
        for (let i = 0; i < config.size; i++) {
          const coord = `${ROWS[startRow + i]}${COLS[startCol]}`;
          if (occupiedCoordinates.has(coord) || forbiddenCoordinates.has(coord)) {
            canPlace = false;
            break;
          }
          coordinates.push(coord);
        }
      }

      if (canPlace) {
        ships.push({
          type: config.type,
          size: config.size,
          hp: config.hp,
          maxHp: config.hp,
          coordinates,
          orientation,
          isSunk: false,
        });

        coordinates.forEach(coord => {
          occupiedCoordinates.add(coord);
          
          const [row, col] = coordToRowCol(coord);
          const adjacents = getAdjacentCoordinates(row, col);
          adjacents.forEach(adj => forbiddenCoordinates.add(adj));
        });

        placed = true;
      }
    }

    if (!placed) {
      return generateRandomBoard();
    }
  }

  return {
    ships,
    hits: [],
  };
}

function coordToRowCol(coord: string): [number, number] {
  const row = ROWS.indexOf(coord[0]);
  const col = COLS.indexOf(parseInt(coord[1]));
  return [row, col];
}

function getAdjacentCoordinates(row: number, col: number): string[] {
  const adjacents: string[] = [];
  const directions = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1]
  ];

  for (const [dr, dc] of directions) {
    const newRow = row + dr;
    const newCol = col + dc;
    
    if (newRow >= 0 && newRow < 5 && newCol >= 0 && newCol < 5) {
      adjacents.push(`${ROWS[newRow]}${COLS[newCol]}`);
    }
  }

  return adjacents;
}

export function processShot(
  boardState: BoardState,
  coordinate: string
): {
  result: "miss" | "hit" | "sunk" | "eliminated";
  shipHit: ShipType | null;
  damageDealt: number;
  updatedBoard: BoardState;
} {
  if (boardState.hits.includes(coordinate)) {
    return {
      result: "miss",
      shipHit: null,
      damageDealt: 0,
      updatedBoard: boardState,
    };
  }

  const updatedBoard: BoardState = {
    ...boardState,
    hits: [...boardState.hits, coordinate],
    ships: [...boardState.ships],
  };

  let hitShipIndex = -1;
  for (let i = 0; i < updatedBoard.ships.length; i++) {
    if (updatedBoard.ships[i].coordinates.includes(coordinate)) {
      hitShipIndex = i;
      break;
    }
  }

  if (hitShipIndex === -1) {
    return {
      result: "miss",
      shipHit: null,
      damageDealt: 0,
      updatedBoard,
    };
  }

  const ship = { ...updatedBoard.ships[hitShipIndex] };
  ship.hp -= 1;
  
  const wasSunk = ship.hp <= 0;
  if (wasSunk) {
    ship.isSunk = true;
  }

  updatedBoard.ships[hitShipIndex] = ship;

  const allShipsSunk = updatedBoard.ships.every(s => s.isSunk);

  return {
    result: allShipsSunk ? "eliminated" : (wasSunk ? "sunk" : "hit"),
    shipHit: ship.type,
    damageDealt: 1,
    updatedBoard,
  };
}

export function calculateTotalHullPoints(boardState: BoardState): number {
  return boardState.ships.reduce((total, ship) => total + ship.hp, 0);
}

export function getAllCoordinates(): string[] {
  const coords: string[] = [];
  for (const row of ROWS) {
    for (const col of COLS) {
      coords.push(`${row}${col}`);
    }
  }
  return coords;
}
