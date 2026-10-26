import { Board } from "../engine/board";
import { isTstKick, kicksFor } from "../engine/kicks";
import { detectTSpin } from "../engine/movement";
import { SHAPES, pieceCells, rotateBy, spawnPos } from "../engine/pieces";
import type { PiecePos, PieceType, Rotation, SpinKind } from "../engine/types";
import { GOALS, type Goal, type GoalId, type GoalLock } from "../modes/goals";
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

const MOVES: Move[] = ["left", "right", "cw", "ccw", "180", "down", "sonic"];
const ROTATIONS: [1 | -1 | 2, number][] = [
  [1, 2],
  [-1, 3],
  [2, 4],
];

// State index layout: rotation × box x (offset so negative x fits) × box y.
const X_OFF = 8;
const X_SPAN = 32;
const Y_SPAN = 64;
const N_STATES = 4 * X_SPAN * Y_SPAN;
const idx = (x: number, y: number, rot: number) => (rot * X_SPAN + x + X_OFF) * Y_SPAN + y;

/** Every resting position reachable for `type` on `board`, each with its best spin and a shortest path. */
export function reachablePlacements(board: Board, type: PieceType): Reachable[] {
  const start = spawnPos(type, board.width, board.visibleHeight);
  if (!board.fits(start)) return [];

  const shapes = SHAPES[type];
  const fits = (x: number, y: number, rot: number) => {
    for (const [cx, cy] of shapes[rot]) if (board.occupied(x + cx, y - cy)) return false;
    return true;
  };

  // parent: -2 = unvisited, -1 = start. Spin landings are tracked separately
  // because the spin depends on the rotation that arrives, not just the state.
  const parent = new Int32Array(N_STATES).fill(-2);
  const parentMove = new Int8Array(N_STATES);
  const spinRank = new Int8Array(N_STATES);
  const spinFrom = new Int32Array(N_STATES);
  const spinMove = new Int8Array(N_STATES);
  const queue = new Int32Array(N_STATES);
  let head = 0;
  let tail = 0;

  const startIdx = idx(start.x, start.y, start.rot);
  parent[startIdx] = -1;
  queue[tail++] = startIdx;

  while (head < tail) {
    const s = queue[head++];
    const y = s % Y_SPAN;
    const x = (((s / Y_SPAN) | 0) % X_SPAN) - X_OFF;
    const rot = (s / (Y_SPAN * X_SPAN)) | 0;
    const visit = (nx: number, ny: number, nrot: number, move: number) => {
      const k = idx(nx, ny, nrot);
      if (parent[k] !== -2) return;
      parent[k] = s;
      parentMove[k] = move;
      queue[tail++] = k;
    };

    if (fits(x - 1, y, rot)) visit(x - 1, y, rot, 0);
    if (fits(x + 1, y, rot)) visit(x + 1, y, rot, 1);

    for (const [amount, move] of ROTATIONS) {
      const to = rotateBy(rot as Rotation, amount);
      let kick: readonly [number, number] | null = fits(x, y, to) ? [0, 0] : null;
      let kicked = false;
      if (!kick) {
        for (const k of kicksFor(type, rot as Rotation, to)) {
          if (fits(x + k[0], y + k[1], to)) {
            kick = k;
            kicked = true;
            break;
          }
        }
      }
      if (!kick) continue;
      const nx = x + kick[0];
      const ny = y + kick[1];
      visit(nx, ny, to, move);
      if (type === "T" && !fits(nx, ny - 1, to)) {
        const spin = detectTSpin(board, { type, rot: to, x: nx, y: ny }, kicked && isTstKick(rot as Rotation, to, kick));
        const k = idx(nx, ny, to);
        if (SPIN_RANK[spin] > spinRank[k]) {
          spinRank[k] = SPIN_RANK[spin];
          spinFrom[k] = s;
          spinMove[k] = move;
        }
      }
    }

    if (fits(x, y - 1, rot)) {
      visit(x, y - 1, rot, 5);
      let d = y - 1;
      while (fits(x, d - 1, rot)) d--;
      if (d !== y - 1) visit(x, d, rot, 6);
    }
  }

  const pathTo = (k: number): Move[] => {
    const out: Move[] = [];
    for (let e = k; parent[e] !== -1; e = parent[e]) out.push(MOVES[parentMove[e]]);
    return out.reverse();
  };
  const SPINS: SpinKind[] = ["none", "mini", "full"];

  const out: Reachable[] = [];
  for (let i = 0; i < tail; i++) {
    const k = queue[i];
    const y = k % Y_SPAN;
    const x = (((k / Y_SPAN) | 0) % X_SPAN) - X_OFF;
    const rot = ((k / (Y_SPAN * X_SPAN)) | 0) as Rotation;
    if (fits(x, y - 1, rot)) continue;
    const pos: PiecePos = { type, rot, x, y };
    if (spinRank[k] > 0) out.push({ pos, spin: SPINS[spinRank[k]], path: [...pathTo(spinFrom[k]), MOVES[spinMove[k]]] });
    else out.push({ pos, spin: "none", path: pathTo(k) });
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
  const goal: Goal = GOALS[input.goal];
  const need = goal.requiresPiece;
  // A state that failed with `d` pieces left to use also fails with fewer.
  const failedAtDepth = new Map<string, number>();
  let nodes = 0;
  let outOfBudget = false;
  const maxPieces = input.queue.length + (input.hold ? 1 : 0);

  const dfs = (board: Board, queue: PieceType[], hold: PieceType | null, depth: number): SolutionStep[] | null => {
    if (depth === 0) return null;
    if (queue.length === 0 && !hold) return null;
    if (need && !queue.includes(need) && !(input.allowHold && hold === need)) return null;
    const stateKey = `${String.fromCharCode(...board.cells)}|${queue.join("")}|${hold ?? "-"}`;
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
        const lock: GoalLock = { piece: c.piece, lines, spin: r.spin, tst: r.spin === "full" && lines === 3, perfectClear: lines > 0 && next.isEmpty() };
        if (goal.isMet(lock)) return [step];
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
