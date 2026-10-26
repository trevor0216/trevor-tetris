/**
 * Turns one board diagram into verified puzzles:
 *  - "pre": the diagram itself (or with its depicted finisher piece removed)
 *    already allows the goal with just the finisher piece;
 *  - "completion": it doesn't, but a short queue of 1-2 extra pieces + the
 *    finisher does (e.g. partial building-block diagrams);
 *  - "variant": a "pre" board with the 1-2 topmost setup pieces nearest the
 *    goal placement taken out and moved into the queue, so the player has to
 *    build the overhang. Kept only if the finisher alone no longer works.
 * Every result is solved by the solver and replayed through the real engine.
 */
import { Board } from "../../src/engine/board";
import { pieceCells } from "../../src/engine/pieces";
import type { PieceType } from "../../src/engine/types";
import { GOALS, type Goal, type GoalId } from "../../src/modes/goals";
import { ROT_NAMES, placementToPos, type Placement } from "../../src/modes/packs";
import { solve } from "../../src/solver";
import { verifyPlacements } from "../../src/solver/verify";
import type { DiagramBoard } from "./harddrop-wiki";

export interface Generated {
  kind: "pre" | "completion" | "variant";
  rows: string[];
  queue: string;
  solution: Placement[];
  /** Pieces moved from the board into the queue (variants). */
  removed?: PieceType[];
}

const EXTRA_PIECES: PieceType[] = ["I", "O", "L", "J", "S", "Z", "T"];
const cellKey = (cells: [number, number][]) => cells.map(([x, y]) => `${x},${y}`).sort().join(";");

/** The piece every solution must end on, if the goal fixes one (T for T-spin goals). */
function finisherOf(goal: GoalId): PieceType | null {
  return (GOALS[goal] as Goal).requiresPiece ?? null;
}

const hasFullRow = (rows: string[]) => rows.some((r) => !r.includes("."));
/** Clears full rows, as the engine would after the depicted piece locked ("drop + line clear" diagrams). */
const clearFull = (rows: string[]) => trimTop(rows.filter((r) => r.includes(".")));

function trySolve(rows: string[], queue: PieceType[], goal: GoalId, budget: number): Placement[] | null {
  const res = solve({ board: Board.fromRows(rows), queue, hold: null, allowHold: true, goal }, budget);
  if (!res.steps) return null;
  const solution = res.steps.map((s) => s.placement);
  const v = verifyPlacements({ board: rows, queue: queue.join(""), hold: null, allowHold: true }, solution, goal);
  return v.ok ? solution : null;
}

function withCells(rows: string[], cells: [number, number][], ch: string): string[] {
  const grid = rows.map((r) => [...r]);
  for (const [x, y] of cells) {
    const r = rows.length - 1 - y;
    if (r >= 0) grid[r][x] = ch;
  }
  return trimTop(grid.map((r) => r.join("")));
}

function trimTop(rows: string[]): string[] {
  let i = 0;
  while (i < rows.length - 1 && /^\.+$/.test(rows[i])) i++;
  return rows.slice(i);
}

/** Matches a cell set to a piece of `type` in some rotation; returns the placement or null. */
function asPiece(type: PieceType, cells: [number, number][]): Placement | null {
  if (cells.length !== 4) return null;
  const minX = Math.min(...cells.map(([x]) => x));
  const minY = Math.min(...cells.map(([, y]) => y));
  for (const rot of ROT_NAMES) {
    const cand = placementToPos({ piece: type, rot, x: minX, y: minY });
    if (cellKey(pieceCells(cand)) === cellKey(cells)) return { piece: type, rot, x: minX, y: minY, spin: false };
  }
  return null;
}

/** Splits same-letter cells into 4-connected groups. */
function components(cells: [number, number][]): [number, number][][] {
  const left = new Set(cells.map(([x, y]) => `${x},${y}`));
  const out: [number, number][][] = [];
  for (const start of cells) {
    const k0 = `${start[0]},${start[1]}`;
    if (!left.has(k0)) continue;
    left.delete(k0);
    const group: [number, number][] = [];
    const stack = [start];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      group.push([x, y]);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const k = `${x + dx},${y + dy}`;
        if (left.has(k)) {
          left.delete(k);
          stack.push([x + dx, y + dy]);
        }
      }
    }
    out.push(group);
  }
  return out;
}

export function generateFromDiagram(
  d: DiagramBoard,
  goal: GoalId,
  opts: { variants: number; budget: number; completion: boolean },
): Generated[] {
  const fixed = finisherOf(goal);
  const lastPieces = fixed ? [fixed] : EXTRA_PIECES;
  const out: Generated[] = [];

  // 1. Pre-goal board: as drawn, or minus a depicted finishing piece (prefer the
  //    one the solution then lands exactly on). With no fixed finisher (pc,
  //    clear-N) any depicted piece may be the last one, and any piece may finish.
  const depicted: { piece: PieceType; cells: [number, number][] }[] = [];
  if (fixed) {
    for (const g of d.tGroups) if (asPiece(fixed, g)) depicted.push({ piece: fixed, cells: g });
  } else {
    for (const [letter, cells] of [...d.upper, ["T", d.tGroups.flat()] as const]) {
      for (const comp of components([...cells])) if (asPiece(letter as PieceType, comp)) depicted.push({ piece: letter as PieceType, cells: comp });
    }
    // Topmost first: the last piece placed is usually on top.
    depicted.sort((a, b) => Math.max(...b.cells.map(([, y]) => y)) - Math.max(...a.cells.map(([, y]) => y)));
  }
  const candidates: { rows: string[]; queue: PieceType[]; removedCells?: [number, number][] }[] = [];
  // A diagram with a full row shows a piece that just completed it: the board
  // the player faces is the one after that clear.
  const drawnFull = hasFullRow(d.rows);
  for (const p of lastPieces) candidates.push({ rows: clearFull(d.rows), queue: [p] });
  for (const dp of depicted) {
    const rows = withCells(d.rows, dp.cells, ".");
    // Removed-cell matching needs the drawing's coordinates, so skip when a clear would shift them.
    if (!hasFullRow(rows)) candidates.push({ rows, queue: [dp.piece], removedCells: dp.cells });
  }
  let pre: Generated | null = null;
  for (const c of candidates) {
    if (pre && !c.removedCells) continue;
    const sol = trySolve(c.rows, c.queue, goal, opts.budget);
    if (!sol) continue;
    const g: Generated = { kind: "pre", rows: c.rows, queue: c.queue.join(""), solution: sol };
    const exact = c.removedCells && cellKey(pieceCells(placementToPos(sol[0]))) === cellKey(c.removedCells);
    if (!pre || exact) pre = g;
    if (exact || (!c.removedCells && fixed)) break;
  }

  if (!pre) {
    if (!opts.completion) return [];
    // 2. Completion: shortest extra queue (1 then 2 pieces) that makes the goal
    //    possible. With hold, [a, b, T] also covers b-before-a, so pairs are
    //    unordered. Without a fixed finisher only 1 extra piece is tried (the
    //    search space is 7x larger).
    for (const len of fixed ? [1, 2] : [1]) {
      const queues: PieceType[][] =
        len === 1 ? EXTRA_PIECES.map((p) => [p]) : EXTRA_PIECES.flatMap((a, i) => EXTRA_PIECES.slice(i).map((b) => [a, b]));
      for (const extra of queues) {
        for (const last of lastPieces) {
          const q = [...extra, last];
          const rows = clearFull(d.rows);
          const sol = trySolve(rows, q, goal, opts.budget);
          if (sol) return [{ kind: "completion", rows, queue: q.join(""), solution: sol }];
        }
      }
    }
    return [];
  }
  out.push(pre);
  const finisher = pre.solution.at(-1)!.piece;
  const finisherCells = cellKey(pieceCells(placementToPos(pre.solution.at(-1)!)));

  // 3. Variants: take out setup pieces nearest the goal placement, topmost first.
  const target = pieceCells(placementToPos(pre.solution.at(-1)!));
  const pieces: Placement[] = [];
  for (const [letter, cells] of d.upper) {
    for (const comp of components(cells)) {
      const pl = asPiece(letter as PieceType, comp);
      if (pl && cellKey(comp) !== finisherCells) pieces.push(pl);
    }
  }
  const dist = (pl: Placement) => {
    const cells = pieceCells(placementToPos(pl));
    return Math.min(...cells.flatMap(([x, y]) => target.map(([tx, ty]) => Math.abs(x - tx) + Math.abs(y - ty))));
  };
  const uncovered = (rows: string[], pl: Placement) => {
    const b = Board.fromRows(rows);
    const own = new Set(pieceCells(placementToPos(pl)).map(([x, y]) => `${x},${y}`));
    return pieceCells(placementToPos(pl)).every(([x, y]) => {
      for (let yy = y + 1; yy < b.height; yy++) if (!own.has(`${x},${yy}`) && b.get(x, yy)) return false;
      return true;
    });
  };

  // Drop + line clear: take pieces out of the drawing itself, so the player's
  // drop does the clear (the finisher's placement is in post-clear rows, which
  // is where the engine puts it after that clear).
  let rows = drawnFull ? d.rows : pre.rows;
  const removed: Placement[] = [];
  for (let n = 0; n < opts.variants; n++) {
    const next = pieces
      .filter((p) => !removed.includes(p) && uncovered(rows, p))
      .sort((a, b) => dist(a) - dist(b) || b.y - a.y)[0];
    if (!next) break;
    rows = withCells(rows, pieceCells(placementToPos(next)), ".");
    removed.push(next);
    // Placement order is the reverse of removal; the finisher goes last.
    const buildOrder = [...removed].reverse();
    const queue = [...buildOrder.map((p) => p.piece), finisher];
    if (hasFullRow(rows)) continue; // the clearing piece is still on the board
    if (trySolve(rows, [finisher], goal, opts.budget)) continue; // still solvable without building: not a real variant
    // Prefer the wiki's own placements; fall back to whatever the solver finds.
    const original = [...buildOrder, pre.solution.at(-1)!];
    const v = verifyPlacements({ board: rows, queue: queue.join(""), hold: null, allowHold: true }, original, goal);
    const solution = v.ok ? original : trySolve(rows, queue, goal, opts.budget);
    if (solution) out.push({ kind: "variant", rows, queue: queue.join(""), solution, removed: buildOrder.map((p) => p.piece) });
  }
  return out;
}
