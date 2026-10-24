import { Board } from "../engine/board";
import { Game, type LockResult } from "../engine/game";
import { SDF_INFINITE } from "../engine/handling";
import { pieceCells } from "../engine/pieces";
import { FixedQueue } from "../engine/queue";
import type { Action, PiecePos, PieceType } from "../engine/types";
import { GOALS, type GoalId } from "../modes/goals";
import { placementToPos, type Placement, type Puzzle } from "../modes/packs";
import { reachablePlacements, type Move } from "./index";

export interface VerifyResult {
  ok: boolean;
  error?: string;
  /** Index of the failing solution step, if any. */
  step?: number;
  results: LockResult[];
}

const sameCells = (a: PiecePos, b: PiecePos) =>
  a.type === b.type &&
  pieceCells(a).map(String).sort().join(";") === pieceCells(b).map(String).sort().join(";");

/**
 * Plays `steps` through the real Game engine with key inputs (gravity off, so
 * pieces stay put between inputs) and checks every lock lands where the step
 * says, then that the last lock meets the goal.
 */
export function verifyPlacements(
  start: { board: string[] | Board; queue: string; hold: PieceType | null; allowHold: boolean },
  steps: Placement[],
  goal: GoalId,
): VerifyResult {
  const g = new Game({
    board: Array.isArray(start.board) ? Board.fromRows(start.board) : start.board.clone(),
    queue: new FixedQueue([...start.queue] as PieceType[]),
    hold: start.hold,
    allowHold: start.allowHold,
    gravity: 0,
  });
  const results: LockResult[] = [];
  const fail = (step: number, error: string): VerifyResult => ({ ok: false, error, step, results });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const target = placementToPos(step);
    if (g.over || !g.piece) return fail(i, `no piece to play (${g.over ?? "empty"})`);

    if (g.piece.type !== step.piece) {
      if (!start.allowHold) return fail(i, `needs ${step.piece} but ${g.piece.type} is falling and hold is disabled`);
      tap(g, "hold");
      if (!g.piece || g.piece.type !== step.piece) return fail(i, `${step.piece} is not available (current or via hold)`);
    }

    const reach = reachablePlacements(g.board, step.piece).find((r) => sameCells(r.pos, target));
    if (!reach) return fail(i, `${step.piece} ${step.rot} at x=${step.x},y=${step.y} is not reachable`);

    const early = runPath(g, reach.path);
    if (early.length) return fail(i, "piece locked before the path finished (lock reset limit?)");
    const locked = tap(g, "hardDrop");
    if (locked.length !== 1) return fail(i, "hard drop did not lock exactly one piece");
    const r = locked[0];
    results.push(r);
    if (!sameCells(r.pos, target)) return fail(i, `locked at the wrong position (${JSON.stringify(r.pos)})`);

    const isLast = i === steps.length - 1;
    if (GOALS[goal].isMet(r)) {
      return isLast ? { ok: true, results } : fail(i, `goal met early at step ${i + 1} of ${steps.length}`);
    }
  }
  return { ok: false, error: `goal "${goal}" not met by the final placement`, step: steps.length - 1, results };
}

export function verifyPuzzle(puzzle: Puzzle, goal: GoalId): VerifyResult {
  return verifyPlacements(puzzle, puzzle.solution, goal);
}

function tap(g: Game, action: Action): LockResult[] {
  return g.tick([
    { type: "down", action, subframe: 0 },
    { type: "up", action, subframe: 0.5 },
  ]);
}

const MOVE_ACTION: Partial<Record<Move, Action>> = {
  left: "moveLeft",
  right: "moveRight",
  cw: "rotateCW",
  ccw: "rotateCCW",
  "180": "rotate180",
};

/** Feeds a solver path into the game. Returns any locks that happened (there should be none). */
function runPath(g: Game, path: Move[]): LockResult[] {
  const locks: LockResult[] = [];
  const sdf = g.handling.sdf;
  for (const m of path) {
    const action = MOVE_ACTION[m];
    if (action) {
      locks.push(...tap(g, action));
    } else if (m === "sonic") {
      g.handling.sdf = SDF_INFINITE;
      locks.push(...tap(g, "softDrop"));
    } else {
      // One row: slow soft drop (0.25 rows/frame at SDF 5 with no gravity) until the row changes.
      g.handling.sdf = 5;
      const row = g.piece!.y;
      locks.push(...g.tick([{ type: "down", action: "softDrop", subframe: 0 }]));
      for (let n = 0; g.piece && g.piece.y === row && n < 8; n++) locks.push(...g.tick());
      locks.push(...g.tick([{ type: "up", action: "softDrop", subframe: 0 }]));
    }
    g.handling.sdf = sdf;
    if (locks.length) break;
  }
  return locks;
}
