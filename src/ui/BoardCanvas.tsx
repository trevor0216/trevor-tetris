import { useEffect, useRef } from "react";
import { canvasSize, render, type Overlay, type RenderState } from "../render/renderer";

/** A static board drawing (used for the solution replay). */
export function BoardCanvas({ state, overlay }: { state: RenderState; overlay?: Overlay }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height } = canvasSize();

  useEffect(() => {
    const canvas = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(ctx, state, overlay);
  }, [state, overlay, width, height]);

  return <canvas ref={ref} className="board" style={{ width, height }} />;
}
