import { describe, expect, it } from "vitest";
import { Board } from "../src/engine/board";
import { detectTSpin, tryRotate } from "../src/engine/movement";
import { makeGame, softDropToFloor, tap } from "./helpers";

describe("T-spin triple via the TST kick", () => {
  // T slides under the overhang at (1,4), then rotates CW; the only fitting
  // test is kick #4 (-1,-2), dropping it into the 3-deep slot in column 1.
  const TST_BOARD = [
    "GG........",
    "G.........",
    "G.GGGGGGGG",
    "G..GGGGGGG",
    "G.GGGGGGGG",
  ];

  it("clears three lines as a full T-spin and reports a TST", () => {
    const g = makeGame(TST_BOARD, "T");
    softDropToFloor(g);
    expect(g.piece).toMatchObject({ rot: 0, x: 3, y: 4 });
    tap(g, "moveLeft");
    tap(g, "moveLeft");
    expect(g.piece).toMatchObject({ rot: 0, x: 1, y: 4 });
    tap(g, "rotateCW");
    expect(g.piece).toMatchObject({ rot: 1, x: 0, y: 2 });
    expect(g.lastSpin).toBe("full");
    const [res] = tap(g, "hardDrop");
    expect(res).toMatchObject({ piece: "T", lines: 3, spin: "full", tst: true });
    expect(g.board.toRows()).toEqual(["GG........", "G........."]);
    expect(g.stats.tspins.full[3]).toBe(1);
  });

  it("the TST kick upgrades a would-be mini to a full spin", () => {
    // Same slot, but the bottom-right corner (2,0) is open: 3 corners, only one front corner.
    const g = makeGame(["GG........", "G.........", "G.GGGGGGGG", "G..GGGGGGG", "G..GGGGGGG"], "T");
    softDropToFloor(g);
    tap(g, "moveLeft");
    tap(g, "moveLeft");
    tap(g, "rotateCW");
    const pos = g.piece!;
    expect(pos).toMatchObject({ rot: 1, x: 0, y: 2 });
    expect(detectTSpin(g.board, pos, false)).toBe("mini");
    expect(g.lastSpin).toBe("full");
    const [res] = tap(g, "hardDrop");
    expect(res).toMatchObject({ lines: 2, spin: "full", tst: false });
  });
});

describe("Iso TST (Hard Drop wiki, T-Spin Triple Setups § Others)", () => {
  // Diagram 1 of the TrIso, without the T. Sequence: soft drop, CW, 180° using
  // the (-1, 0) N→S "left zipper" kick, CW into the TST.
  const ISO_BOARD = ["GGGGG..GGG", "GGG....GGG", "GGGG.GGGGG", "GGG..GGGGG", "GGGG.GGGGG"];

  it("is reachable with SRS+ 180 kicks and scores a full TST", () => {
    const g = makeGame(ISO_BOARD, "T");
    tap(g, "rotateCCW");
    tap(g, "moveRight");
    tap(g, "moveRight");
    softDropToFloor(g);
    expect(g.piece).toMatchObject({ rot: 3, x: 5, y: 5 }); // diagram 1

    tap(g, "rotateCW");
    expect(g.piece).toMatchObject({ rot: 0, x: 4, y: 4 }); // diagram 2

    tap(g, "rotate180");
    expect(g.piece).toMatchObject({ rot: 2, x: 3, y: 4 }); // diagram 3: shifted left by the (-1, 0) kick

    tap(g, "rotateCW");
    expect(g.piece).toMatchObject({ rot: 3, x: 3, y: 2 }); // diagram 4
    const [res] = tap(g, "hardDrop");
    expect(res).toMatchObject({ lines: 3, spin: "full", tst: true });
  });

  it("the 180 step uses kick #5, (-1, 0)", () => {
    const board = Board.fromRows(ISO_BOARD);
    const r = tryRotate(board, { type: "T", rot: 0, x: 4, y: 4 }, 2);
    expect(r).toMatchObject({ kickIndex: 4, kick: [-1, 0] });
  });
});

describe("3-corner rule and mini classification", () => {
  it("3 corners with only one front corner is a mini", () => {
    // T pointing up on the floor: both bottom corners are floor, top-left filled, top-right open.
    const b = Board.fromRows(["G.........", ".........."]);
    expect(detectTSpin(b, { type: "T", rot: 0, x: 0, y: 1 }, false)).toBe("mini");
  });

  it("3 corners with both front corners is full", () => {
    const b = Board.fromRows(["G.G.......", ".........."]);
    expect(detectTSpin(b, { type: "T", rot: 0, x: 0, y: 1 }, false)).toBe("full");
  });

  it("only 2 corners is not a spin", () => {
    // T pointing down with its stem in a 1-wide hole: only the two bottom corners are filled.
    const b = Board.fromRows(["..........", "GGGG.GGGGG"]);
    expect(detectTSpin(b, { type: "T", rot: 2, x: 3, y: 2 }, false)).toBe("none");
  });

  it("a piece that can still move down is not a spin", () => {
    const b = Board.fromRows(["G.G.......", "..........", ".........."]);
    expect(detectTSpin(b, { type: "T", rot: 0, x: 0, y: 2 }, false)).toBe("none");
  });

  it("non-T pieces never spin under the T-spins rule", () => {
    const b = Board.fromRows(["G.G.......", ".........."]);
    expect(detectTSpin(b, { type: "L", rot: 0, x: 0, y: 1 }, false)).toBe("none");
  });

  it("moving after the rotation cancels the spin", () => {
    const g = makeGame(["GG........", "G.........", "G.GGGGGGGG", "G..GGGGGGG", "G.GGGGGGGG"], "T");
    softDropToFloor(g);
    tap(g, "moveLeft");
    tap(g, "moveLeft");
    tap(g, "rotateCW");
    expect(g.lastSpin).toBe("full");
    tap(g, "moveRight"); // blocked: stays a spin
    expect(g.lastSpin).toBe("full");
    // Open the cells the T needs one column to the right: (2,2), (3,1), (2,0).
    g.board.set(2, 2, 0);
    g.board.set(3, 1, 0);
    g.board.set(2, 0, 0);
    tap(g, "moveRight"); // now succeeds
    expect(g.piece).toMatchObject({ x: 1 });
    expect(g.lastSpin).toBeNull();
  });
});
