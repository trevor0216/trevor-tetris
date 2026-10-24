import type { Board } from "../engine/board";
import type { Game } from "../engine/game";
import { pieceCells, SHAPES } from "../engine/pieces";
import { GARBAGE, cellPiece, type PiecePos, type PieceType } from "../engine/types";

/** Everything the renderer draws; a live Game or a static replay frame. */
export interface RenderState {
  board: Board;
  piece: PiecePos | null;
  ghost: PiecePos | null;
  hold: PieceType | null;
  holdLocked: boolean;
  next: PieceType[];
}

export function gameRenderState(game: Game): RenderState {
  return {
    board: game.board,
    piece: game.piece,
    ghost: game.ghost,
    hold: game.hold,
    holdLocked: game.holdLocked,
    next: game.queue.peek(5),
  };
}

/** Original palette (not TETR.IO's). */
export const PIECE_COLORS: Record<PieceType, string> = {
  I: "#3fc1c9",
  J: "#4a6cd4",
  L: "#e8913a",
  O: "#e8c93a",
  S: "#62c462",
  T: "#a35bd6",
  Z: "#e0525a",
};
const GARBAGE_COLOR = "#6b6f7a";

export interface Overlay {
  /** Extra ghost placements to draw (e.g. puzzle hints). */
  hints?: PiecePos[];
}

export const CELL = 28;
const SIDE = CELL * 5;
const BUFFER_ROWS_SHOWN = 3;

export function canvasSize(): { width: number; height: number } {
  return { width: SIDE * 2 + CELL * 10, height: CELL * (20 + BUFFER_ROWS_SHOWN) };
}

export function render(ctx: CanvasRenderingContext2D, game: RenderState, overlay: Overlay = {}): void {
  const { width, height } = canvasSize();
  const css = getComputedStyle(ctx.canvas);
  const bg = css.getPropertyValue("--board-bg").trim() || "#111318";
  const grid = css.getPropertyValue("--board-grid").trim() || "#1c1f27";
  const text = css.getPropertyValue("--text").trim() || "#e6e6e6";

  ctx.clearRect(0, 0, width, height);
  const bx = SIDE;
  const top = BUFFER_ROWS_SHOWN;
  const toScreen = (x: number, y: number) => [bx + x * CELL, (top + 19 - y) * CELL] as const;

  ctx.fillStyle = bg;
  ctx.fillRect(bx, top * CELL, CELL * 10, CELL * 20);
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  for (let x = 1; x < 10; x++) line(ctx, bx + x * CELL, top * CELL, bx + x * CELL, height);
  for (let y = 1; y < 20; y++) line(ctx, bx, (top + y) * CELL, bx + 10 * CELL, (top + y) * CELL);

  const b = game.board;
  for (let y = 0; y < Math.min(b.height, 20 + BUFFER_ROWS_SHOWN); y++) {
    for (let x = 0; x < b.width; x++) {
      const v = b.get(x, y);
      if (!v) continue;
      const p = cellPiece(v);
      const [sx, sy] = toScreen(x, y);
      block(ctx, sx, sy, CELL, v === GARBAGE || !p ? GARBAGE_COLOR : PIECE_COLORS[p]);
    }
  }

  for (const h of overlay.hints ?? []) {
    for (const [x, y] of pieceCells(h)) {
      const [sx, sy] = toScreen(x, y);
      ctx.strokeStyle = "#ffd84a";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sx + 2, sy + 2, CELL - 4, CELL - 4);
      ctx.setLineDash([]);
    }
  }

  const ghost = game.ghost;
  const piece = game.piece;
  if (ghost && piece) {
    ctx.globalAlpha = 0.28;
    for (const [x, y] of pieceCells(ghost)) {
      const [sx, sy] = toScreen(x, y);
      block(ctx, sx, sy, CELL, PIECE_COLORS[ghost.type]);
    }
    ctx.globalAlpha = 1;
    for (const [x, y] of pieceCells(piece)) {
      const [sx, sy] = toScreen(x, y);
      block(ctx, sx, sy, CELL, PIECE_COLORS[piece.type]);
    }
  }

  ctx.strokeStyle = text;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2;
  ctx.strokeRect(bx - 1, top * CELL - 1, CELL * 10 + 2, CELL * 20 + 2);
  ctx.globalAlpha = 1;

  ctx.fillStyle = text;
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.fillText("HOLD", 12, top * CELL + 14);
  ctx.fillText("NEXT", bx + CELL * 10 + 14, top * CELL + 14);
  if (game.hold) {
    ctx.globalAlpha = game.holdLocked ? 0.35 : 1;
    mini(ctx, game.hold, 12, top * CELL + 26);
    ctx.globalAlpha = 1;
  }
  game.next.forEach((t, i) => mini(ctx, t, bx + CELL * 10 + 14, top * CELL + 26 + i * 64));
}

function mini(ctx: CanvasRenderingContext2D, type: PieceType, x: number, y: number) {
  const s = 20;
  const cells = SHAPES[type][0];
  const minY = Math.min(...cells.map(([, cy]) => cy));
  for (const [cx, cy] of cells) block(ctx, x + cx * s, y + (cy - minY) * s, s, PIECE_COLORS[type]);
}

function block(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x + 1, y + 1, size - 2, Math.max(2, size * 0.14));
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1 + 0.5, y1 + 0.5);
  ctx.lineTo(x2 + 0.5, y2 + 0.5);
  ctx.stroke();
}
