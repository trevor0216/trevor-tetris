import { Board } from "../engine/board";
import { canMoveDown, detectTSpin, tryRotate, tryShift } from "../engine/movement";
import { pieceCells, spawnPos } from "../engine/pieces";
import type { PiecePos, PieceType, SpinKind } from "../engine/types";
import { GOALS, type GoalId } from "../modes/goals";
import { posToPlacement, type Placement } from "../modes/packs";

/**
 * Placement search over the real engine moves. For one piece, a BFS from the
 * spawn position over shift, rotate CW/CCW/180 (SRS+ kicks), one-row fall and
 * sonic drop finds every reachable resting position, including tucks and
 * spins, with a shortest input path to each. A depth-first search over the
 * queue (with hold) then looks for a sequence that meets the goal.
 *
 * Gravity is treated as slow enough to stand still in the air (TETR.IO's
 * 0.02 G). Paths can be checked against the real engine with
 * `replayPath` in ./verify.ts, which also enforces the 15-move lock reset limit.
 */

export type Move = "left" | "right" | "cw" | "ccw" | "180" | "down" | "sonic";

export interface Reachable {
  pos: PiecePos;
  spin: SpinKind;
  /** Inputs from spawn to the resting position (hard drop not included). */
  path: Move[];
}

const SPIN_RANK: Record<SpinKind, number> = { none: 0, mini: 1, full: 2 };

const key = (p: PiecePos) => (p.rot * 64 + (p.x + 8)) * 64 + p.y;

/** Every resting position reachable for `type` on `board`, each with its best spin and a shortest path. */
export function reachablePlacements(board: Board, type: PieceType): Reachable[] {
  const start = spawnPos(type, board.width, board.visibleHeight);
  if (!board.fits(start)) return [];

  const parent = new Map<number, { from: number; move: Move } | null>();
  const states = new Map<number, PiecePos>();
  // Best spin landing per resting key: reached by a rotation from `from`.
  const spinLanding = new Map<number, { spin: SpinKind; from: number; move: Move }>();

  const startKey = key(start);
  parent.set(startKey, null);
  states.set(startKey, start);
  const queue: number[] = [startKey];

  const visit = (from: number, to: PiecePos, move: Move) => {
    const k = key(to);
    if (!parent.has(k)) {
      parent.set(k, { from, move });
      states.set(k, to);
      queue.push(k);
    }
  };

  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    const p = states.get(k)!;
    for (const [dx, move] of [
      [-1, "left"],
      [1, "right"],
    ] as const) {
      const q = tryShift(board, p, dx);
      if (q) visit(k, q, move);
    }
    for (const [amount, move] of [
      [1, "cw"],
      [-1, "ccw"],
      [2, "180"],
    ] as const) {
      const r = tryRotate(board, p, amount);
      if (!r) continue;
      visit(k, r.pos, move);
      if (!canMoveDown(board, r.pos)) {
        const spin = detectTSpin(board, r.pos, r.tstKick);
        const rk = key(r.pos);
        const prev = spinLanding.get(rk);
        if (spin !== "none" && (!prev || SPIN_RANK[spin] > SPIN_RANK[prev.spin])) {
          spinLanding.set(rk, { spin, from: k, move });
        }
      }
    }
    if (canMoveDown(board, p)) {
      visit(k, { ...p, y: p.y - 1 }, "down");
      let d = p;
      while (canMoveDown(board, d)) d = { ...d, y: d.y - 1 };
      if (d.y !== p.y - 1) visit(k, d, "sonic");
    }
  }

  const pathTo = (k: number): Move[] => {
    const out: Move[] = [];
    for (let e = parent.get(k); e; e = parent.get(e.from)) out.push(e.move);
    return out.reverse();
  };

  const out: Reachable[] = [];
  for (const [k, p] of states) {
    if (canMoveDown(board, p)) continue;
    const landing = spinLanding.get(k);
    if (landing) out.push({ pos: p, spin: landing.spin, path: [...pathTo(landing.from), landing.move] });
    else out.push({ pos: p, spin: "none", path: pathTo(k) });
  }
  return dedupeByCells(out);
}

/** Different rotations of I/S/Z/O can cover identical cells; keep the best (spin first, then shorter path). */
function dedupeByCells(list: Reachable[]): Reachable[] {
  const best = new Map<string, Reachable>();
  for (const r of list) {
    const k = r.pos.type + pieceCells(r.pos).map(([x, y]) => `${x},${y}`).sort().join(";");
    const prev = best.get(k);
    if (!prev || SPIN_RANK[r.spin] > SPIN_RANK[prev.spin] || (r.spin === prev.spin && r.path.length < prev.path.length)) best.set(k, r);
  }
  return [...best.values()];
}

// ---- sequence search -------------------------------------------------------

export interface SolveInput {
  board: Board;
  /** The falling piece first, then the rest of the queue. */
  queue: PieceType[];
  hold: PieceType | null;
  allowHold: boolean;
  goal: GoalId;
}

export interface SolutionStep {
  placement: Placement;
  /** Hold before playing this piece. */
  hold: boolean;
  path: Move[];
}

export interface SolveResult {
  steps: SolutionStep[] | null;
  /** Search nodes expanded; `exhausted` is false when the budget ran out first. */
  nodes: number;
  exhausted: boolean;
}

/**
 * Finds the shortest (fewest pieces) placement sequence that achieves `goal`,
 * or null, by iterative deepening. Explores at most `maxNodes` placements in
 * total (keeps hint lookups fast in the UI).
 */
export function solve(input: SolveInput, maxNodes = 200_000): SolveResult {
  const goal = GOALS[input.goal];
  const need = (goal as { requiresPiece?: PieceType }).requiresPiece;
  // A state that failed with `d` pieces left to use also fails with fewer.
  const failedAtDepth = new Map<string, number>();
  let nodes = 0;
  let outOfBudget = false;
  const maxPieces = input.queue.length + (input.hold ? 1 : 0);

  const dfs = (board: Board, queue: PieceType[], hold: PieceType | null, depth: number): SolutionStep[] | null => {
    if (depth === 0) return null;
    if (queue.length === 0 && !hold) return null;
    if (need && !queue.includes(need) && !(input.allowHold && hold === need)) return null;
    const stateKey = `${board.cells.join("")}|${queue.join("")}|${hold ?? "-"}`;
    if ((failedAtDepth.get(stateKey) ?? 0) >= depth) return null;

    // Choices: play the current piece, or hold it and play the held/next piece.
    const choices: { piece: PieceType; useHold: boolean; rest: PieceType[]; hold: PieceType | null }[] = [];
    if (queue.length > 0) choices.push({ piece: queue[0], useHold: false, rest: queue.slice(1), hold });
    if (input.allowHold && queue.length > 0) {
      if (hold && hold !== queue[0]) choices.push({ piece: hold, useHold: true, rest: queue.slice(1), hold: queue[0] });
      if (!hold && queue.length > 1 && queue[1] !== queue[0]) {
        choices.push({ piece: queue[1], useHold: true, rest: queue.slice(2), hold: queue[0] });
      }
    }
    // With an empty queue the held piece spawns by itself (no hold press).
    if (queue.length === 0 && hold && input.allowHold) choices.push({ piece: hold, useHold: false, rest: [], hold: null });

    for (const c of choices) {
      const placements = reachablePlacements(board, c.piece);
      // Try spins first: they're what goals usually need.
      placements.sort((a, b) => SPIN_RANK[b.spin] - SPIN_RANK[a.spin]);
      for (const r of placements) {
        if (++nodes > maxNodes) {
          outOfBudget = true;
          return null;
        }
        const next = board.clone();
        next.place(r.pos);
        const lines = next.clearLines().length;
        const step: SolutionStep = { placement: posToPlacement(r.pos, isRotation(r.path.at(-1))), hold: c.useHold, path: r.path };
        const lock = { lines, spin: r.spin, tst: r.spin === "full" && lines === 3, perfectClear: lines > 0 && next.isEmpty() };
        if (goal.isMet(lock as never)) return [step];
        if (stackTooHigh(next)) continue;
        const rest = dfs(next, c.rest, c.hold, depth - 1);
        if (rest) return [step, ...rest];
        if (outOfBudget) return null;
      }
    }
    failedAtDepth.set(stateKey, depth);
    return null;
  };

  for (let depth = 1; depth <= maxPieces; depth++) {
    const steps = dfs(input.board, input.queue, input.hold, depth);
    if (steps) return { steps, nodes, exhausted: true };
    if (outOfBudget) break;
  }
  return { steps: null, nodes, exhausted: !outOfBudget };
}

function isRotation(m: Move | undefined): boolean {
  return m === "cw" || m === "ccw" || m === "180";
}

/** Anything at or above row 21 would block the next spawn. */
function stackTooHigh(b: Board): boolean {
  for (let x = 0; x < b.width; x++) if (b.get(x, b.visibleHeight + 1)) return true;
  return false;
}
