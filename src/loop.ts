import type { Game, LockResult } from "./engine/game";
import { FRAME_MS } from "./engine/handling";
import type { Action, InputEvent } from "./engine/types";

interface TimedInput {
  time: number;
  type: InputEvent["type"];
  action: Action;
}

/**
 * Fixed-timestep driver: the game advances in exact 1/60 s frames regardless
 * of display refresh rate, and each key event is delivered with its offset
 * inside the frame it happened in (its subframe).
 */
export class GameLoop {
  private pending: TimedInput[] = [];
  private simTime = 0;
  private raf = 0;

  constructor(
    public game: Game,
    private onFrame: (game: Game) => void,
    private onLock: (r: LockResult) => void = () => {},
  ) {}

  start(): void {
    this.simTime = performance.now();
    const step = (now: number) => {
      // Don't try to catch up after a long stall (tab hidden etc).
      if (now - this.simTime > 250) this.simTime = now - FRAME_MS;
      while (this.simTime + FRAME_MS <= now) {
        const frameEnd = this.simTime + FRAME_MS;
        const events: InputEvent[] = [];
        while (this.pending.length && this.pending[0].time < frameEnd) {
          const e = this.pending.shift()!;
          const subframe = Math.min(0.999, Math.max(0, (e.time - this.simTime) / FRAME_MS));
          events.push({ type: e.type, action: e.action, subframe });
        }
        for (const r of this.game.tick(events)) this.onLock(r);
        this.simTime = frameEnd;
      }
      this.onFrame(this.game);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  input(type: InputEvent["type"], action: Action, time = performance.now()): void {
    this.pending.push({ time: Math.max(time, this.simTime), type, action });
  }

  /** Swap in a new game (restart) without dropping the loop. */
  reset(game: Game): void {
    this.game = game;
    this.pending = [];
  }
}
