import { describe, expect, it } from "vitest";
import { Board } from "../src/engine/board";
import { pieceCells } from "../src/engine/pieces";
import { discoverPacks, mirrorPuzzle, placementToPos } from "../src/modes/packs";
import { reachablePlacements, solve } from "../src/solver";
import { verifyPlacements, verifyPuzzle } from "../src/solver/verify";

const TST_BOARD = ["GG........", "G.........", "G.GGGGGGGG", "G..GGGGGGG", "G.GGGGGGGG"];
const ISO_BOARD = ["GGGGG..GGG", "GGG....GGG", "GGGG.GGGGG", "GGG..GGGGG", "GGGG.GGGGG"];

describe("reachablePlacements", () => {
  it("finds the TST slot as a full spin, entered by a CW rotation", () => {
    const r = reachablePlacements(Board.fromRows(TST_BOARD), "T").find((p) => p.pos.rot === 1 && p.pos.x === 0 && p.pos.y === 2);
    expect(r).toBeDefined();
    expect(r!.spin).toBe("full");
    expect(r!.path.at(-1)).toBe("cw");
  });

  it("finds the Iso TST, which needs a 180", () => {
    const r = reachablePlacements(Board.fromRows(ISO_BOARD), "T").find((p) => p.pos.rot === 3 && p.pos.x === 3 && p.pos.y === 2);
    expect(r?.spin).toBe("full");
    expect(r!.path).toContain("180");
  });

  it("finds tucks under an overhang that a hard drop can't reach", () => {
    // O tucked into the gap under the roof on the left.
    const board = Board.fromRows(["GGGG......", "..........", "..........", "GGGGGGGG.."]);
    const tuck = reachablePlacements(board, "O").find((p) => pieceCells(p.pos).some(([x, y]) => x === 0 && y === 1));
    expect(tuck).toBeDefined();
    expect(tuck!.path).toContain("left");
  });

  it("only returns resting positions, without duplicates", () => {
    const board = new Board();
    const all = reachablePlacements(board, "I");
    // Flat I: 7 columns; vertical I: 10 columns.
    expect(all).toHaveLength(17);
    for (const r of all) expect(pieceCells(r.pos).some(([, y]) => y === 0)).toBe(true);
  });

  it("returns nothing when the spawn is blocked", () => {
    const board = Board.fromRows(Array.from({ length: 23 }, () => "GGGG.GGGGG"));
    expect(reachablePlacements(board, "T")).toEqual([]);
  });
});

describe("solve", () => {
  it("solves a one-piece TST", () => {
    const res = solve({ board: Board.fromRows(TST_BOARD), queue: ["T"], hold: null, allowHold: true, goal: "tst" });
    expect(res.steps).toHaveLength(1);
    expect(res.steps![0].placement).toMatchObject({ piece: "T", rot: "right", x: 1, y: 0, spin: true });
  });

  it("builds the overhang first when needed", () => {
    const board = Board.fromRows(["G.........", "G.GGGGGGGG", "G..GGGGGGG", "G.GGGGGGGG"]);
    const res = solve({ board, queue: ["O", "T"], hold: null, allowHold: false, goal: "tst" });
    expect(res.steps?.map((s) => s.placement.piece)).toEqual(["O", "T"]);
  });

  it("uses hold to reach a T behind a useless piece", () => {
    const res = solve({ board: Board.fromRows(TST_BOARD), queue: ["I", "T"], hold: null, allowHold: true, goal: "tst" });
    expect(res.steps).toHaveLength(1);
    expect(res.steps![0].hold).toBe(true);
  });

  it("returns null with the search exhausted when there is no answer", () => {
    const res = solve({ board: Board.fromRows(TST_BOARD), queue: ["I", "O"], hold: null, allowHold: true, goal: "tst" });
    expect(res.steps).toBeNull();
    expect(res.exhausted).toBe(true);
  });

  it("reports when it runs out of budget", () => {
    const res = solve({ board: new Board(), queue: ["I", "O", "L", "J", "S", "Z", "T"], hold: null, allowHold: true, goal: "tst" }, 50);
    expect(res.steps).toBeNull();
    expect(res.exhausted).toBe(false);
  });
});

describe("verification through the real engine", () => {
  const starter = discoverPacks().find((p) => p.ok && p.pack.id === "starter");
  const pack = starter?.ok ? starter.pack : null!;

  it.each(pack.puzzles.map((p) => [p.id, p] as const))("starter/%s solution plays out to a TST", (_, puzzle) => {
    const v = verifyPuzzle(puzzle, "tst");
    expect(v.error).toBeUndefined();
    expect(v.ok).toBe(true);
    expect(v.results.at(-1)!.tst).toBe(true);
  });

  it.each(pack.puzzles.map((p) => [p.id, p] as const))("starter/%s mirrored also verifies", (_, puzzle) => {
    expect(verifyPuzzle(mirrorPuzzle(puzzle), "tst")).toMatchObject({ ok: true });
  });

  it("solver output always verifies", () => {
    for (const puzzle of pack.puzzles) {
      const res = solve({ board: Board.fromRows(puzzle.board), queue: [...puzzle.queue] as never, hold: puzzle.hold, allowHold: puzzle.allowHold, goal: "tst" });
      expect(res.steps).not.toBeNull();
      expect(verifyPlacements(puzzle, res.steps!.map((s) => s.placement), "tst").ok).toBe(true);
    }
  });

  it("rejects an unreachable placement", () => {
    // The slot is covered, so a plain drop can't put the T there with a spin... or at all from above.
    const v = verifyPlacements(
      { board: TST_BOARD, queue: "T", hold: null, allowHold: true },
      [{ piece: "T", x: 1, y: 0, rot: "spawn", spin: false }],
      "tst",
    );
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/not reachable/);
  });

  it("rejects a solution that doesn't reach the goal", () => {
    const v = verifyPlacements(
      { board: TST_BOARD, queue: "T", hold: null, allowHold: true },
      [{ piece: "T", x: 3, y: 3, rot: "spawn", spin: false }],
      "tst",
    );
    expect(v).toMatchObject({ ok: false, error: expect.stringContaining("not met") });
  });

  it("placement positions match engine positions", () => {
    expect(pieceCells(placementToPos({ piece: "T", x: 1, y: 0, rot: "right" }))).toEqual([[1, 2], [1, 1], [2, 1], [1, 0]]);
  });
});

describe("goals", () => {
  const TSD_BOARD = ["GG........", "G...GGGGGG", "GG.GGGGGGG"];
  it("tsd needs a full T-spin clearing exactly two lines", () => {
    const res = solve({ board: Board.fromRows(TSD_BOARD), queue: ["T"], hold: null, allowHold: true, goal: "tsd" });
    expect(res.steps).toHaveLength(1);
    const v = verifyPlacements({ board: TSD_BOARD, queue: "T", hold: null, allowHold: true }, res.steps!.map((s) => s.placement), "tsd");
    expect(v.results[0]).toMatchObject({ spin: "full", lines: 2 });
    // The TST board has no TSD with one T: the slot clears three.
    expect(solve({ board: Board.fromRows(TST_BOARD), queue: ["T"], hold: null, allowHold: true, goal: "tsd" }).steps).toBeNull();
  });

  it("pc, quad and clearN don't need a T", () => {
    const board = ["GGGGGGGGG.", "GGGGGGGGG.", "GGGGGGGGG.", "GGGGGGGGG."];
    for (const goal of ["pc", "quad", "clear3"] as const) {
      expect(solve({ board: Board.fromRows(board), queue: ["I"], hold: null, allowHold: true, goal }).steps).toHaveLength(1);
    }
    expect(solve({ board: Board.fromRows(board), queue: ["O"], hold: null, allowHold: true, goal: "pc" }).steps).toBeNull();
  });
});
