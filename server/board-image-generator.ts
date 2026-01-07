import { createCanvas } from "canvas";
import type { BoardState } from "@shared/schema";

const CELL_SIZE = 60;
const GRID_SIZE = 5;
const PADDING = 40;
const LABEL_OFFSET = 30;

const COLORS = {
  ocean: "#87CEEB",
  bigDinghy: "#1E3A8A",
  dinghy: "#3B82F6",
  smallDinghy: "#60A5FA",
  gridLines: "#0F172A",
  hit: "#DC2626",
  miss: "#94A3B8",
  text: "#0F172A",
};

export function generateBoardImage(
  boardState: BoardState,
  showShips: boolean = true
): Buffer {
  const canvasWidth = GRID_SIZE * CELL_SIZE + PADDING * 2 + LABEL_OFFSET;
  const canvasHeight = GRID_SIZE * CELL_SIZE + PADDING * 2 + LABEL_OFFSET;
  
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = COLORS.ocean;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const gridX = PADDING + LABEL_OFFSET;
  const gridY = PADDING + LABEL_OFFSET;

  ctx.fillStyle = "#AAD8E6";
  ctx.fillRect(gridX, gridY, GRID_SIZE * CELL_SIZE, GRID_SIZE * CELL_SIZE);

  if (showShips) {
    for (const ship of boardState.ships) {
      const color = ship.type === "big_dinghy" 
        ? COLORS.bigDinghy 
        : ship.type === "dinghy" 
        ? COLORS.dinghy 
        : COLORS.smallDinghy;

      ctx.fillStyle = ship.isSunk ? "#7F1D1D" : color;

      for (const coord of ship.coordinates) {
        const [row, col] = coordToPosition(coord);
        const x = gridX + col * CELL_SIZE;
        const y = gridY + row * CELL_SIZE;
        
        ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      }
    }
  }

  ctx.strokeStyle = COLORS.gridLines;
  ctx.lineWidth = 2;
  
  for (let i = 0; i <= GRID_SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(gridX, gridY + i * CELL_SIZE);
    ctx.lineTo(gridX + GRID_SIZE * CELL_SIZE, gridY + i * CELL_SIZE);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(gridX + i * CELL_SIZE, gridY);
    ctx.lineTo(gridX + i * CELL_SIZE, gridY + GRID_SIZE * CELL_SIZE);
    ctx.stroke();
  }

  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 20px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const rows = ["A", "B", "C", "D", "E"];
  for (let i = 0; i < GRID_SIZE; i++) {
    ctx.fillText(rows[i], PADDING + 15, gridY + i * CELL_SIZE + CELL_SIZE / 2);
  }

  for (let i = 0; i < GRID_SIZE; i++) {
    ctx.fillText(String(i + 1), gridX + i * CELL_SIZE + CELL_SIZE / 2, PADDING + 15);
  }

  for (const hitCoord of boardState.hits) {
    const [row, col] = coordToPosition(hitCoord);
    const x = gridX + col * CELL_SIZE + CELL_SIZE / 2;
    const y = gridY + row * CELL_SIZE + CELL_SIZE / 2;

    const isHit = boardState.ships.some(ship => 
      ship.coordinates.includes(hitCoord)
    );

    if (isHit) {
      ctx.strokeStyle = COLORS.hit;
      ctx.lineWidth = 4;
      const size = 15;
      ctx.beginPath();
      ctx.moveTo(x - size, y - size);
      ctx.lineTo(x + size, y + size);
      ctx.moveTo(x + size, y - size);
      ctx.lineTo(x - size, y + size);
      ctx.stroke();
    } else {
      ctx.fillStyle = COLORS.miss;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return canvas.toBuffer("image/png");
}

function coordToPosition(coord: string): [number, number] {
  const rows = ["A", "B", "C", "D", "E"];
  const row = rows.indexOf(coord[0]);
  const col = parseInt(coord[1]) - 1;
  return [row, col];
}
