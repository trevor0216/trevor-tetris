import { describe, expect, it } from "vitest";
import { DEFAULT_HANDLING } from "../src/engine/handling";
import { lockFollowsPlan, nextHintNeedsHold, packPlan, runSolverRequest, solverRequest, visibleHints } from "../src/modes/hints";
import { discoverPacks } from "../src/modes/packs";
import { createPuzzleGame } from "../src/modes/puzzle";
import { tap } from "./helpers";

const starter = discoverPacks().find((p) => p.ok && p.pack.id === "starter");
const pack = starter?.ok ? starter.pack : null!;
const build = pack.puzzles.find((p) => p.id === "overhang-build")!;

const planHints = (p: typeof build, _goal: "tst", g: ReturnType<typeof createPuzzleGame>) =>
  runSolverRequest(solverRequest(p, "tst", g, 200_000)!).plan;

describe("pack-solution hints", () => {
  it("start at the current step", () => {
    expect(packPlan(build, 0)!.steps).toHaveLength(2);
    expect(packPlan(build, 1)!.steps[0].placement.piece).toBe("T");
    expect(packPlan(build, 2)).toBeNull();
  });
});

describe("solver-planned hints", () => {
  it("plans from the current state and steps through the plan", () => {
    const g = createPuzzleGame(build, DEFAULT_HANDLING);
    const plan = planHints(build, "tst", g)!;
    expect(plan.source).toBe("solver");
    expect(plan.steps.map((s) => s.placement.piece)).toEqual(["O", "T"]);
    expect(visibleHints(plan, 0, 1)).toHaveLength(1);
    expect(visibleHints(plan, 0, 5)).toHaveLength(2);
    expect(visibleHints(plan, 1, 1)[0].type).toBe("T");
  });

  it("detects when a lock leaves the plan", () => {
    const g = createPuzzleGame(build, DEFAULT_HANDLING);
    const plan = planHints(build, "tst", g)!;
    const [r] = tap(g, "hardDrop"); // O dropped in the middle, not on the left
    expect(lockFollowsPlan(plan, r, g.stats.pieces)).toBe(false);
  });

  it("says when the next step needs hold", () => {
    const p = { ...build, board: ["GG........", "G.........", "G.GGGGGGGG", "G..GGGGGGG", "G.GGGGGGGG"], queue: "IT" };
    const g = createPuzzleGame(p, DEFAULT_HANDLING);
    const plan = planHints(p, "tst", g)!;
    expect(plan.steps).toHaveLength(1);
    expect(nextHintNeedsHold(plan, g)).toBe(true);
  });

  it("returns null when there's no solution from here", () => {
    const g = createPuzzleGame({ ...build, queue: "IO" }, DEFAULT_HANDLING);
    expect(planHints({ ...build, queue: "IO" }, "tst", g)).toBeNull();
  });
});
