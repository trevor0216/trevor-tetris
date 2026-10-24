import type { PiecePos, PieceType, Rotation } from "./types";

// Standard SRS rotation states, drawn top row first inside each piece's
// bounding box. These match TETR.IO's piece matrices as reimplemented in
// Triangle.js (src/engine/utils/tetromino/data.ts, see NOTES.md); O uses a
// 2x2 box so it never wobbles.
const SHAPE_ROWS: Record<PieceType, [string[], string[], string[], string[]]> = {
  I: [
    ["....", "####", "....", "...."],
    ["..#.", "..#.", "..#.", "..#."],
    ["....", "....", "####", "...."],
    [".#..", ".#..", ".#..", ".#.."],
  ],
  J: [
    ["#..", "###", "..."],
    [".##", ".#.", ".#."],
    ["...", "###", "..#"],
    [".#.", ".#.", "##."],
  ],
  L: [
    ["..#", "###", "..."],
    [".#.", ".#.", ".##"],
    ["...", "###", "#.."],
    ["##.", ".#.", ".#."],
  ],
  O: [
    ["##", "##"],
    ["##", "##"],
    ["##", "##"],
    ["##", "##"],
  ],
  S: [
    [".##", "##.", "..."],
    [".#.", ".##", "..#"],
    ["...", ".##", "##."],
    ["#..", "##.", ".#."],
  ],
  T: [
    [".#.", "###", "..."],
    [".#.", ".##", ".#."],
    ["...", "###", ".#."],
    [".#.", "##.", ".#."],
  ],
  Z: [
    ["##.", ".##", "..."],
    ["..#", ".##", ".#."],
    ["...", "##.", ".##"],
    [".#.", "##.", "#.."],
  ],
};

/** Box-relative cell offsets [cx, cy] (cy downward) per piece and rotation. */
export const SHAPES: Record<PieceType, [number, number][][]> = Object.fromEntries(
  Object.entries(SHAPE_ROWS).map(([type, states]) => [
    type,
    states.map((rows) => {
      const cells: [number, number][] = [];
      rows.forEach((row, cy) => {
        [...row].forEach((ch, cx) => {
          if (ch === "#") cells.push([cx, cy]);
        });
      });
      return cells;
    }),
  ]),
) as Record<PieceType, [number, number][][]>;

export function boxSize(type: PieceType): number {
  return SHAPE_ROWS[type][0].length;
}

/** Absolute board cells [x, y] (y-up) occupied by a piece. */
export function pieceCells(p: PiecePos): [number, number][] {
  return SHAPES[p.type][p.rot].map(([cx, cy]) => [p.x + cx, p.y - cy]);
}

/**
 * TETR.IO spawn: box left at floor(width/2 - boxWidth/2), box top at row
 * visibleHeight + 2 (the engine adds a 0.04 sub-row offset on top of this,
 * see Game). So the lowest spawn cells sit in row 21, two rows above the top
 * visible row (row 19).
 */
export function spawnPos(type: PieceType, width: number, visibleHeight: number): PiecePos {
  return {
    type,
    rot: 0,
    x: Math.floor(width / 2 - boxSize(type) / 2),
    y: visibleHeight + 2,
  };
}

export function rotateBy(rot: Rotation, amount: number): Rotation {
  return ((((rot + amount) % 4) + 4) % 4) as Rotation;
}
