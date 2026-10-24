import { Board } from "../engine/board";
import { Game, type LockResult } from "../engine/game";
import type { Handling } from "../engine/handling";
import { FixedQueue } from "../engine/queue";
import type { PiecePos, PieceType } from "../engine/types";
import { GOALS, type GoalId } from "./goals";
import { placementToPos, type Puzzle } from "./packs";
import type { RenderState } from "../render/renderer";

export function createPuzzleGame(puzzle: Puzzle, handling: Handling): Game {
  return new Game({
    board: Board.fromRows(puzzle.board),
    queue: new FixedQueue([...puzzle.queue] as PieceType[]),
    hold: puzzle.hold,
    allowHold: puzzle.allowHold,
    handling,
  });
}

export type PuzzleStatus = { state: "playing" } | { state: "won" } | { state: "failed"; reason: string };

/**
 * Evaluates the puzzle after a lock. Fails only when the goal is provably out
 * of reach: top out, the queue ran out, or the piece the goal needs is gone.
 */
export function puzzleStatusAfterLock(goal: GoalId, game: Game, r: LockResult): PuzzleStatus {
  if (GOALS[goal].isMet(r)) return { state: "won" };
  if (game.over === "topout") return { state: "failed", reason: "Topped out." };
  if (game.over === "queue-empty") return { state: "failed", reason: "Out of pieces." };
  const need = (GOALS[goal] as { requiresPiece?: PieceType }).requiresPiece;
  if (need && !pieceStillAvailable(game, need)) return { state: "failed", reason: `No ${need} piece left.` };
  return { state: "playing" };
}

export function pieceStillAvailable(game: Game, type: PieceType): boolean {
  if (game.piece?.type === type) return true;
  if (game.allowHold && game.hold === type) return true;
  // Endless queues always deal every piece again.
  if (!(game.queue instanceof FixedQueue)) return true;
  return game.queue.peek(game.queue.remaining).includes(type);
}

/**
 * Frames for the "show full solution" animation: for each step, one frame with
 * the piece hovering in place, then one with it locked and lines cleared.
 */
export function solutionFrames(puzzle: Puzzle): RenderState[] {
  const board = Board.fromRows(puzzle.board);
  let queue = [...puzzle.queue] as PieceType[];
  let hold: PieceType | null = puzzle.hold;
  const frames: RenderState[] = [];
  const snapshot = (piece: PiecePos | null): RenderState => ({
    board: board.clone(),
    piece,
    ghost: piece,
    hold,
    holdLocked: false,
    next: queue.slice(0, 5),
  });

  frames.push(snapshot(null));
  for (const step of puzzle.solution) {
    // Take the piece the step uses: from the queue front, or via hold.
    if (queue[0] === step.piece) {
      queue = queue.slice(1);
    } else if (hold === step.piece) {
      hold = queue[0] ?? null;
      queue = queue.slice(1);
    } else if (queue[1] === step.piece) {
      hold = queue[0];
      queue = queue.slice(2);
    }
    const pos = placementToPos(step);
    frames.push(snapshot(pos));
    board.place(pos);
    board.clearLines();
    frames.push(snapshot(null));
  }
  return frames;
}
