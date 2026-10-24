import { useEffect, useRef } from "react";
import type { Game, LockResult } from "../engine/game";
import type { Handling } from "../engine/handling";
import type { Action } from "../engine/types";
import { GameLoop } from "../loop";
import { canvasSize, render, type Overlay } from "../render/renderer";
import { codeToAction, type Keybinds } from "./settings";

interface Props {
  /** Builds a fresh game; called on mount and on restart. */
  createGame: () => Game;
  handling: Handling;
  keybinds: Keybinds;
  onLock?: (r: LockResult, game: Game) => void;
  /** Called every rendered frame (for HUD state). */
  onFrame?: (game: Game) => void;
  onRestart?: (game: Game) => void;
  onForfeit?: () => void;
  overlay?: () => Overlay;
  /** Changing this value restarts the game. */
  resetKey?: unknown;
}

/**
 * Canvas board driven by the fixed-timestep loop. While mounted it owns the
 * keyboard: bound keys never reach the page (no scrolling, no slider nudging).
 */
export function GameView({ createGame, handling, keybinds, onLock, onFrame, onRestart, onForfeit, overlay, resetKey }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef<GameLoop | null>(null);
  // Keep the latest callbacks without restarting the loop.
  const latest = useRef({ createGame, onLock, onFrame, onRestart, onForfeit, overlay, keybinds });
  latest.current = { createGame, onLock, onFrame, onRestart, onForfeit, overlay, keybinds };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const { width, height } = canvasSize();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const game = latest.current.createGame();
    game.handling = { ...handling };
    const loop = new GameLoop(
      game,
      (g) => {
        render(ctx, g, latest.current.overlay?.());
        latest.current.onFrame?.(g);
      },
      (r) => latest.current.onLock?.(r, loop.game),
    );
    loopRef.current = loop;
    loop.start();
    (document.activeElement as HTMLElement | null)?.blur?.();

    const restart = () => {
      const g = latest.current.createGame();
      g.handling = { ...loop.game.handling };
      loop.reset(g);
      latest.current.onRestart?.(g);
    };

    const down = (e: KeyboardEvent) => {
      const action = codeToAction(latest.current.keybinds).get(e.code);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (action === "restart") return restart();
      if (action === "forfeit") return latest.current.onForfeit?.();
      loop.input("down", action as Action, e.timeStamp);
    };
    const up = (e: KeyboardEvent) => {
      const action = codeToAction(latest.current.keybinds).get(e.code);
      if (!action) return;
      e.preventDefault();
      if (action !== "restart" && action !== "forfeit") loop.input("up", action as Action, e.timeStamp);
    };
    // Releasing everything on blur avoids keys "sticking" when focus leaves the window.
    const blur = () => {
      for (const a of ["moveLeft", "moveRight", "softDrop"] as Action[]) loop.input("up", a);
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      loop.stop();
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Handling changes apply live to the running game.
  useEffect(() => {
    if (loopRef.current) loopRef.current.game.handling = { ...handling };
  }, [handling]);

  const { width, height } = canvasSize();
  return <canvas ref={canvasRef} className="board" style={{ width, height }} />;
}
