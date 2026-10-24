/// <reference lib="webworker" />
import { runSolverRequest, type SolverRequest } from "../modes/hints";

// Runs hint searches off the main thread so the game never stutters.
self.onmessage = (e: MessageEvent<{ id: number; req: SolverRequest }>) => {
  const { id, req } = e.data;
  self.postMessage({ id, ...runSolverRequest(req) });
};
