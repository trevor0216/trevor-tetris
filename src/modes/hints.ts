import { Board } from "../engine/board";
import type { Game, LockResult } from "../engine/game";
import { pieceCells } from "../engine/pieces";
import { FixedQueue } from "../engine/queue";
import type { PiecePos, PieceType } from "../engine/types";
import { solve } from "../solver";
import type { GoalId } from "./goals";
import { placementToPos, type Placement, type Puzzle } from "./packs";

/** A hint plan, anchored at the number of pieces placed when it was computed. */
export interface HintPlan {
  base: number;
  steps: { placement: Placement; hold: boolean }[];
  source: "solver" | "pack";
}

/** The pack's own (verified) solution from the current step. Only valid while the player is on-script. */
export function packPlan(puzzle: Puzzle, piecesPlaced: number): HintPlan | null {
  const steps = puzzle.solution.slice(piecesPlaced).map((placement) => ({ placement, hold: false }));
  return steps.length ? { base: piecesPlaced, steps, source: "pack" } : null;
}

/** Plain-data solver request, so it can cross a Worker boundary. */
export interface SolverRequest {
  rows: string[];
  queue: PieceType[];
  hold: PieceType | null;
  allowHold: boolean;
  goal: GoalId;
  base: number;
  budget: number;
}

export function solverRequest(puzzle: Puzzle, goal: GoalId, game: Game, budget: number): SolverRequest | null {
  if (!game.piece) return null;
  const rest = game.queue instanceof FixedQueue ? game.queue.peek(game.queue.remaining) : [];
  return {
    rows: game.board.toRows(),
    queue: [game.piece.type, ...rest],
    hold: game.hold,
    allowHold: puzzle.allowHold,
    goal,
    base: game.stats.pieces,
    budget,
  };
}

/** Runs the solver for a request; `null` plan means no answer (or out of budget, see `exhausted`). */
export function runSolverRequest(req: SolverRequest): { plan: HintPlan | null; exhausted: boolean } {
  const res = solve(
    { board: Board.fromRows(req.rows), queue: req.queue, hold: req.hold, allowHold: req.allowHold, goal: req.goal },
    req.budget,
  );
  return {
    plan: res.steps && { base: req.base, steps: res.steps.map((s) => ({ placement: s.placement, hold: s.hold })), source: "solver" },
    exhausted: res.exhausted,
  };
}

/** The next `count` hinted placements given how many pieces have been placed. */
export function visibleHints(plan: HintPlan | null, piecesPlaced: number, count: number): PiecePos[] {
  if (!plan) return [];
  const k = piecesPlaced - plan.base;
  return plan.steps.slice(k, k + count).map((s) => placementToPos(s.placement));
}

/** Whether the next hinted step starts by pressing hold. */
export function nextHintNeedsHold(plan: HintPlan | null, game: Game): boolean {
  if (!plan || !game.piece) return false;
  const step = plan.steps[game.stats.pieces - plan.base];
  return !!step && (step.hold || step.placement.piece !== game.piece.type);
}

/** True if a lock landed exactly on `placement`'s cells. */
export function lockMatches(placement: Placement | undefined, r: LockResult): boolean {
  if (!placement || r.piece !== placement.piece) return false;
  const key = (p: PiecePos) => pieceCells(p).map(String).sort().join(";");
  return key(r.pos) === key(placementToPos(placement));
}

/** True if a lock followed the plan's step for that piece. */
export function lockFollowsPlan(plan: HintPlan, r: LockResult, piecesPlacedAfter: number): boolean {
  return lockMatches(plan.steps[piecesPlacedAfter - 1 - plan.base]?.placement, r);
}
