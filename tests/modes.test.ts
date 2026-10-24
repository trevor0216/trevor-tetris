import { describe, expect, it } from "vitest";
import { Board } from "../src/engine/board";
import { pieceCells } from "../src/engine/pieces";
import { PIECE_TYPES } from "../src/engine/types";
import { toastsFor } from "../src/modes/freeplay";
import {
  ROT_NAMES,
  discoverPacks,
  mirrorPlacement,
  mirrorPuzzle,
  parsePack,
  placementToPos,
  posToPlacement,
  type Puzzle,
} from "../src/modes/packs";
import { markSolved } from "../src/modes/progress";
import { createPuzzleGame, puzzleStatusAfterLock, solutionFrames } from "../src/modes/puzzle";
import { DEFAULT_HANDLING } from "../src/engine/handling";
import { softDropToFloor, tap } from "./helpers";
import type { LockResult } from "../src/engine/game";

const lock = (over: Partial<LockResult>): LockResult => ({
  piece: "T",
  pos: { type: "T", rot: 0, x: 0, y: 0 },
  lines: 0,
  spin: "none",
  tst: false,
  perfectClear: false,
  b2b: 0,
  combo: 0,
  hardDrop: true,
  frame: 0,
  ...over,
});

describe("free play toasts", () => {
  it("names every spin type", () => {
    expect(toastsFor(lock({ spin: "full", lines: 3, tst: true }))[0].text).toBe("T-SPIN TRIPLE");
    expect(toastsFor(lock({ spin: "full", lines: 0 }))[0].text).toBe("T-SPIN");
    expect(toastsFor(lock({ spin: "mini", lines: 1 }))[0].text).toBe("T-SPIN MINI SINGLE");
    expect(toastsFor(lock({ lines: 4 }))[0].text).toBe("QUAD");
    expect(toastsFor(lock({ lines: 1 }))).toEqual([]);
  });

  it("adds B2B, combo and all clear", () => {
    const t = toastsFor(lock({ spin: "full", lines: 2, b2b: 2, combo: 3, perfectClear: true })).map((x) => x.text);
    expect(t).toEqual(["T-SPIN DOUBLE", "B2B ×2", "3 COMBO", "ALL CLEAR"]);
  });
});

describe("placements", () => {
  const all = PIECE_TYPES.flatMap((piece) => ROT_NAMES.map((rot) => ({ piece, rot, x: 3, y: 5, spin: false })));

  it("round-trip between placement and engine position", () => {
    for (const pl of all) expect(posToPlacement(placementToPos(pl))).toEqual(pl);
  });

  it("x/y are the leftmost column and lowest row of the cells", () => {
    for (const pl of all) {
      const cells = pieceCells(placementToPos(pl));
      expect(Math.min(...cells.map(([x]) => x))).toBe(3);
      expect(Math.min(...cells.map(([, y]) => y))).toBe(5);
    }
  });

  it("mirroring a placement mirrors its exact cells", () => {
    for (const pl of all) {
      const original = pieceCells(placementToPos(pl)).map(([x, y]) => `${9 - x},${y}`).sort();
      const mirrored = pieceCells(placementToPos(mirrorPlacement(pl))).map(([x, y]) => `${x},${y}`).sort();
      expect(mirrored).toEqual(original);
    }
  });
});

const starter = discoverPacks().find((p) => p.ok && p.pack.id === "starter");

describe("packs", () => {
  it("auto-discovers and validates /packs/*.json", () => {
    expect(starter?.ok).toBe(true);
  });

  it("rejects unknown goals, bad rows, bad queues and duplicate ids", () => {
    const base = { id: "x", title: "X", goal: "tst", puzzles: [] as unknown[] };
    const puzzle = { id: "a", name: "A", board: [".........."], queue: "T", solution: [{ piece: "T", x: 0, y: 0, rot: "spawn" }] };
    expect(parsePack("x.json", { ...base, puzzles: [puzzle] }).ok).toBe(true);
    const bad = (p: object) => parsePack("x.json", p);
    expect(bad({ ...base, goal: "nope", puzzles: [puzzle] })).toMatchObject({ ok: false, error: expect.stringContaining("unknown goal") });
    expect(bad({ ...base, puzzles: [{ ...puzzle, board: ["....."] }] }).ok).toBe(false);
    expect(bad({ ...base, puzzles: [{ ...puzzle, queue: "TX" }] }).ok).toBe(false);
    expect(bad({ ...base, puzzles: [puzzle, puzzle] })).toMatchObject({ ok: false, error: expect.stringContaining("duplicate") });
  });

  it("mirroring a puzzle twice is the identity and swaps L/J, S/Z", () => {
    const p: Puzzle = {
      id: "m",
      name: "m",
      board: ["L.......SG"],
      queue: "LJSZT",
      hold: "S",
      allowHold: true,
      solution: [{ piece: "L", x: 0, y: 1, rot: "right", spin: false }],
    };
    const m = mirrorPuzzle(p);
    expect(m.board).toEqual(["GZ.......J"]);
    expect(m.queue).toBe("JLZST");
    expect(m.hold).toBe("Z");
    expect(m.solution[0]).toMatchObject({ piece: "J", rot: "left" });
    expect(mirrorPuzzle(m)).toEqual(p);
  });
});

describe("puzzle rules", () => {
  const pack = starter?.ok ? starter.pack : null!;
  const slide = pack.puzzles.find((p) => p.id === "overhang-slide")!;

  it("wins on a full TST", () => {
    const g = createPuzzleGame(slide, DEFAULT_HANDLING);
    softDropToFloor(g);
    tap(g, "moveLeft");
    tap(g, "moveLeft");
    tap(g, "rotateCW");
    const [r] = tap(g, "hardDrop");
    expect(puzzleStatusAfterLock("tst", g, r)).toEqual({ state: "won" });
  });

  it("fails when the queue runs out", () => {
    const g = createPuzzleGame(slide, DEFAULT_HANDLING);
    const [r] = tap(g, "hardDrop");
    expect(puzzleStatusAfterLock("tst", g, r)).toMatchObject({ state: "failed", reason: "Out of pieces." });
  });

  it("fails early once no T is left anywhere", () => {
    const g = createPuzzleGame({ ...slide, queue: "TII" }, DEFAULT_HANDLING);
    const [r] = tap(g, "hardDrop");
    expect(puzzleStatusAfterLock("tst", g, r)).toMatchObject({ state: "failed", reason: "No T piece left." });
  });

  it("keeps playing while a T is still in hold", () => {
    const g = createPuzzleGame({ ...slide, queue: "TII" }, DEFAULT_HANDLING);
    tap(g, "hold");
    const [r] = tap(g, "hardDrop");
    expect(puzzleStatusAfterLock("tst", g, r)).toEqual({ state: "playing" });
  });

  it("solution replay places each step and ends in the solved board", () => {
    const build = pack.puzzles.find((p) => p.id === "overhang-build")!;
    const frames = solutionFrames(build);
    expect(frames).toHaveLength(1 + 2 * build.solution.length);
    expect(frames.at(-1)!.board.toRows()).toEqual(Board.fromRows(["OO........", "OO........", "G........."]).toRows());
    expect(frames.at(-1)!.next).toEqual([]);
  });

  it("solution replay follows hold", () => {
    const p: Puzzle = { ...slide, queue: "IT", solution: [{ piece: "T", x: 1, y: 0, rot: "right", spin: true }] };
    const frames = solutionFrames(p);
    expect(frames[1].hold).toBe("I");
    expect(frames[1].piece!.type).toBe("T");
  });
});

describe("progress", () => {
  it("records normal and mirrored solves and keeps clean once earned", () => {
    const st = { data: {} as Record<string, string>, getItem: (k: string) => st.data[k] ?? null, setItem: (k: string, v: string) => void (st.data[k] = v) };
    let p = markSolved({}, "pack", "a", { mirrored: false, clean: true }, st);
    p = markSolved(p, "pack", "a", { mirrored: true, clean: false }, st);
    expect(p.pack.a).toEqual({ solved: true, solvedMirrored: true, clean: true });
    expect(JSON.parse(st.data["tst-trainer:progress:v1"])).toEqual(p);
  });
});

