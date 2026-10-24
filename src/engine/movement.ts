import type { Board } from "./board";
import { isTstKick, kicksFor } from "./kicks";
import { rotateBy } from "./pieces";
import type { PiecePos, Rotation, SpinKind } from "./types";

// Pure, integer-row piece movement shared by the real-time Game and the solver.

export function tryShift(board: Board, p: PiecePos, dx: number): PiecePos | null {
  const q = { ...p, x: p.x + dx };
  return board.fits(q) ? q : null;
}

export function canMoveDown(board: Board, p: PiecePos): boolean {
  return board.fits({ ...p, y: p.y - 1 });
}

export function dropToFloor(board: Board, p: PiecePos): PiecePos {
  let q = p;
  while (canMoveDown(board, q)) q = { ...q, y: q.y - 1 };
  return q;
}

export interface RotateResult {
  pos: PiecePos;
  /** -1 when the unkicked position fit, else the index into the kick list. */
  kickIndex: number;
  /** Applied offset, y-up. */
  kick: readonly [number, number];
  /** True when the TST/fin kick was used (forces a full T-spin). */
  tstKick: boolean;
}

/** SRS+ rotation by `amount` quarter turns (1 = CW, -1 = CCW, 2 = 180). */
export function tryRotate(board: Board, p: PiecePos, amount: 1 | -1 | 2): RotateResult | null {
  const from = p.rot;
  const to: Rotation = rotateBy(from, amount);
  const base = { ...p, rot: to };
  if (board.fits(base)) return { pos: base, kickIndex: -1, kick: [0, 0], tstKick: false };
  const kicks = kicksFor(p.type, from, to);
  for (let i = 0; i < kicks.length; i++) {
    const [dx, dy] = kicks[i];
    const q = { ...base, x: base.x + dx, y: base.y + dy };
    if (board.fits(q)) return { pos: q, kickIndex: i, kick: kicks[i], tstKick: isTstKick(from, to, kicks[i]) };
  }
  return null;
}

/**
 * TETR.IO T-spin detection under the default "T-spins" spin rule
 * (Triangle.js engine/index.ts #detectSpinFromCorners):
 *  - only T pieces, and only right after a successful rotation;
 *  - the piece must not be able to move down;
 *  - at least 3 of the 4 diagonal corners around the T's center are blocked
 *    (walls and floor count);
 *  - it is full if both "front" corners (the two beside the pointing side)
 *    are blocked, or if the rotation used the TST/fin kick; otherwise mini.
 */
export function detectTSpin(board: Board, p: PiecePos, tstKick: boolean): SpinKind {
  if (p.type !== "T") return "none";
  if (canMoveDown(board, p)) return "none";
  const cx = p.x + 1;
  const cy = p.y - 1;
  // Corners clockwise from top-left, each with the two rotations in which it is a front corner.
  const corners: [number, number, Rotation, Rotation][] = [
    [-1, 1, 3, 0],
    [1, 1, 0, 1],
    [1, -1, 1, 2],
    [-1, -1, 2, 3],
  ];
  let filled = 0;
  let front = 0;
  for (const [dx, dy, r1, r2] of corners) {
    if (board.occupied(cx + dx, cy + dy)) {
      filled++;
      if (p.rot === r1 || p.rot === r2) front++;
    }
  }
  if (filled < 3) return "none";
  if (tstKick) return "full";
  return front === 2 ? "full" : "mini";
}
