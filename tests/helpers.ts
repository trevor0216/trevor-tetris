import { Board } from "../src/engine/board";
import { Game, type GameOptions, type LockResult } from "../src/engine/game";
import { FixedQueue } from "../src/engine/queue";
import type { Action, PieceType } from "../src/engine/types";

export function makeGame(rows: string[], queue: string, opts: Partial<GameOptions> = {}): Game {
  return new Game({
    board: Board.fromRows(rows),
    queue: new FixedQueue([...queue] as PieceType[]),
    ...opts,
  });
}

/** Runs `n` empty frames, collecting lock results. */
export function wait(game: Game, n: number): LockResult[] {
  const out: LockResult[] = [];
  for (let i = 0; i < n; i++) out.push(...game.tick());
  return out;
}

export function press(game: Game, action: Action, subframe = 0): LockResult[] {
  return game.tick([{ type: "down", action, subframe }]);
}

export function release(game: Game, action: Action, subframe = 0): LockResult[] {
  return game.tick([{ type: "up", action, subframe }]);
}

/** Press and release within one frame. */
export function tap(game: Game, action: Action): LockResult[] {
  return game.tick([
    { type: "down", action, subframe: 0 },
    { type: "up", action, subframe: 0.5 },
  ]);
}

/** Soft drops (∞ SDF, so instantly) until the piece is grounded, then releases. */
export function softDropToFloor(game: Game): void {
  const sdf = game.handling.sdf;
  game.handling.sdf = 41;
  game.tick([
    { type: "down", action: "softDrop", subframe: 0 },
    { type: "up", action: "softDrop", subframe: 0.5 },
  ]);
  game.handling.sdf = sdf;
}
