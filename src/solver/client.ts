import type { HintPlan, SolverRequest } from "../modes/hints";

type Result = { plan: HintPlan | null; exhausted: boolean };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (r: Result) => void>();

/** Solves on a shared background worker. */
export function solveInWorker(req: SolverRequest): Promise<Result> {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number } & Result>) => {
      const { id, ...result } = e.data;
      pending.get(id)?.(result);
      pending.delete(id);
    };
  }
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage({ id, req });
  });
}
