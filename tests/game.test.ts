import { describe, expect, it } from "vitest";
import { Board } from "../src/engine/board";
import { Game } from "../src/engine/game";
import { DEFAULT_HANDLING, SDF_INFINITE } from "../src/engine/handling";
import { pieceCells } from "../src/engine/pieces";
import { BagQueue, FixedQueue } from "../src/engine/queue";
import type { PieceType } from "../src/engine/types";
import { makeGame, press, release, softDropToFloor, tap, wait } from "./helpers";

const empty = () => makeGame([], "TTTTTTTT");

describe("spawn", () => {
  it.each([
    ["T", [[4, 22], [3, 21], [4, 21], [5, 21]]],
    ["I", [[3, 21], [4, 21], [5, 21], [6, 21]]],
    ["O", [[4, 22], [5, 22], [4, 21], [5, 21]]],
    ["L", [[5, 22], [3, 21], [4, 21], [5, 21]]],
  ])("%s spawns centered, two rows above the visible field", (type, cells) => {
    const g = makeGame([], type);
    expect(pieceCells(g.piece!)).toEqual(cells);
  });
});

describe("handling defaults", () => {
  it("match the spec", () => {
    expect(DEFAULT_HANDLING).toEqual({
      arr: 0,
      das: 5.5,
      dcd: 2,
      sdf: 40,
      preventAccidentalHardDrops: true,
      cancelDasOnDirectionChange: false,
      preferSoftDrop: true,
    });
  });
});

describe("DAS / ARR timing at defaults (DAS 5.5F, ARR 0F)", () => {
  it("a tap moves exactly one cell", () => {
    const g = empty();
    tap(g, "moveLeft");
    wait(g, 20);
    expect(g.piece!.x).toBe(2);
  });

  it("holding charges for 5.5 frames, then goes instantly to the wall", () => {
    const g = empty();
    press(g, "moveLeft"); // frame 1: initial shift
    expect(g.piece!.x).toBe(2);
    wait(g, 4); // frames 2-5: DAS = 5.0, not charged
    expect(g.piece!.x).toBe(2);
    wait(g, 1); // frame 6: charge completes mid-frame, ARR 0 → wall
    expect(g.piece!.x).toBe(0);
  });

  it("supports fractional DAS with subframe-accurate presses", () => {
    const g = empty();
    press(g, "moveRight", 0.5); // DAS starts halfway through frame 1
    expect(g.piece!.x).toBe(4);
    wait(g, 4); // DAS = 4.5
    expect(g.piece!.x).toBe(4);
    wait(g, 1); // DAS reaches exactly 5.5 at the end of frame 6
    expect(g.piece!.x).toBe(7);
  });

  it("ARR 2F repeats one cell every two frames after DAS", () => {
    const g = new Game({ queue: new FixedQueue(["T"]), handling: { das: 10, arr: 2 } });
    press(g, "moveLeft");
    expect(g.piece!.x).toBe(2);
    wait(g, 8); // frame 9
    expect(g.piece!.x).toBe(2);
    wait(g, 1); // frame 10: DAS charged, first repeat
    expect(g.piece!.x).toBe(1);
    wait(g, 1);
    expect(g.piece!.x).toBe(1);
    wait(g, 1); // frame 12
    expect(g.piece!.x).toBe(0);
  });

  it("DCD delays auto-shift for DCD frames after a rotate against the wall", () => {
    for (const [dcd, movedAfter] of [
      [0, 0],
      [2, 1],
    ]) {
      const g = new Game({ queue: new FixedQueue(["T"]), handling: { dcd } });
      press(g, "moveLeft");
      wait(g, 6);
      expect(g.piece!.x).toBe(0);
      press(g, "rotateCW"); // rot R is narrower on the left, so it can slide one more
      if (movedAfter === 0) {
        expect(g.piece!.x).toBe(-1);
      } else {
        expect(g.piece!.x).toBe(0);
        wait(g, movedAfter);
        expect(g.piece!.x).toBe(-1);
      }
    }
  });
});

describe("cancel DAS when changing directions", () => {
  function run(cancel: boolean) {
    const g = new Game({ queue: new FixedQueue(["T"]), handling: { cancelDasOnDirectionChange: cancel } });
    press(g, "moveLeft");
    wait(g, 7); // left fully charged, at the wall
    press(g, "moveRight"); // tap right while still holding left
    wait(g, 1);
    expect(g.piece!.x).toBe(1);
    release(g, "moveRight");
    return g.piece!.x;
  }

  it("off: the held direction keeps its charge and resumes instantly", () => {
    expect(run(false)).toBe(0);
  });

  it("on: the held direction must recharge", () => {
    expect(run(true)).toBe(1);
  });
});

describe("gravity, soft drop, lock delay", () => {
  it("base gravity is 0.02 G: first row after 2 frames, then one row per 50 frames", () => {
    const g = empty();
    wait(g, 1);
    expect(g.piece!.y).toBe(22);
    wait(g, 1);
    expect(g.piece!.y).toBe(21);
    wait(g, 49); // frame 51
    expect(g.piece!.y).toBe(21);
    wait(g, 1); // frame 52
    expect(g.piece!.y).toBe(20);
  });

  it("SDF 40 drops two rows per frame", () => {
    const g = empty();
    press(g, "softDrop");
    expect(g.piece!.y).toBe(20);
    wait(g, 1);
    expect(g.piece!.y).toBe(18);
  });

  it("SDF ∞ drops to the floor instantly", () => {
    const g = new Game({ queue: new FixedQueue(["T"]), handling: { sdf: SDF_INFINITE } });
    press(g, "softDrop");
    expect(g.piece!.y).toBe(1);
  });

  it("a grounded piece locks after 30 frames", () => {
    const g = empty();
    softDropToFloor(g); // grounded for 1 frame
    expect(wait(g, 29)).toHaveLength(0);
    expect(wait(g, 1)).toHaveLength(1);
  });

  it("moves reset the lock timer, but the 15th move on the ground force-locks", () => {
    const g = empty();
    softDropToFloor(g);
    for (let i = 1; i <= 14; i++) {
      expect(tap(g, i % 2 ? "moveLeft" : "moveRight")).toHaveLength(0);
    }
    expect(tap(g, "moveLeft")).toHaveLength(1);
  });

  it("hard drop locks immediately with a ghost-consistent position", () => {
    const g = empty();
    const ghost = g.ghost!;
    const [res] = tap(g, "hardDrop");
    expect(res.pos).toEqual(ghost);
    expect(res.hardDrop).toBe(true);
  });
});

describe("prevent accidental hard drops", () => {
  function hardDropRightAfterNaturalLock(enabled: boolean) {
    const g = new Game({ queue: new FixedQueue(["T", "T"]), handling: { preventAccidentalHardDrops: enabled } });
    softDropToFloor(g);
    wait(g, 30); // locks by itself
    expect(g.stats.pieces).toBe(1);
    tap(g, "hardDrop");
    return g.stats.pieces;
  }

  it("on: a hard drop right after a natural lock is ignored", () => {
    expect(hardDropRightAfterNaturalLock(true)).toBe(1);
  });

  it("off: the same hard drop goes through", () => {
    expect(hardDropRightAfterNaturalLock(false)).toBe(2);
  });

  it("on: hard drop works again after 7 frames", () => {
    const g = new Game({ queue: new FixedQueue(["T", "T"]) });
    softDropToFloor(g);
    wait(g, 30);
    wait(g, 7);
    tap(g, "hardDrop");
    expect(g.stats.pieces).toBe(2);
  });
});

describe("prefer soft drop over movement (SDF ∞)", () => {
  // O on the surface at row 2 slides left over a 2-wide well at columns 2-3.
  function slide(prefer: boolean) {
    const g = new Game({
      board: Board.fromRows(["GG..GGGGGG", "GG..GGGGGG"]),
      queue: new FixedQueue(["O"]),
      handling: { sdf: SDF_INFINITE, preferSoftDrop: prefer },
    });
    press(g, "softDrop");
    expect(g.piece!.y).toBe(3);
    press(g, "moveLeft");
    wait(g, 10);
    return g.piece!;
  }

  it("on: the piece stays on the floor while moving, so it falls into the well", () => {
    expect(slide(true)).toMatchObject({ x: 2, y: 1 });
  });

  it("off: the piece slides over the well to the wall first", () => {
    expect(slide(false)).toMatchObject({ x: 0, y: 3 });
  });
});

describe("hold", () => {
  it("swaps once per piece", () => {
    const g = makeGame([], "TIO");
    tap(g, "hold");
    expect(g.hold).toBe("T");
    expect(g.piece!.type).toBe("I");
    tap(g, "hold");
    expect(g.piece!.type).toBe("I");
    tap(g, "hardDrop");
    expect(g.piece!.type).toBe("O");
    tap(g, "hold");
    expect(g.piece!.type).toBe("T");
    expect(g.hold).toBe("O");
  });

  it("can be disabled", () => {
    const g = makeGame([], "TI", { allowHold: false });
    tap(g, "hold");
    expect(g.hold).toBeNull();
    expect(g.piece!.type).toBe("T");
  });
});

describe("queue and game over", () => {
  it("a fixed queue ends with queue-empty, playing out the hold piece last", () => {
    const g = makeGame([], "TI");
    tap(g, "hold");
    tap(g, "hardDrop");
    expect(g.piece!.type).toBe("T");
    tap(g, "hardDrop");
    expect(g.over).toBe("queue-empty");
  });

  it("tops out when the spawn area is blocked", () => {
    const rows = Array.from({ length: 23 }, () => "GGGG.GGGGG");
    const g = makeGame(rows, "T");
    expect(g.over).toBe("topout");
  });

  it("7-bag: every bag holds all seven pieces, seeded and deterministic", () => {
    const a = new BagQueue(12345);
    const b = new BagQueue(12345);
    const seq = Array.from({ length: 70 }, () => a.shift());
    expect(Array.from({ length: 70 }, () => b.shift())).toEqual(seq);
    for (let i = 0; i < 70; i += 7) {
      expect(new Set(seq.slice(i, i + 7)).size).toBe(7);
    }
    expect(new BagQueue(1).peek(7)).not.toEqual(new BagQueue(2).peek(7));
  });

  it("peek shows the next 5 without consuming", () => {
    const q = new BagQueue(7);
    const five = q.peek(5);
    expect(q.shift()).toBe(five[0]);
  });
});

describe("line clears", () => {
  it("counts quads and back-to-back", () => {
    const rows = Array.from({ length: 4 }, () => "GGGGGGGGG.");
    const g = makeGame(rows, "IIII");
    tap(g, "rotateCW");
    press(g, "moveRight");
    wait(g, 6);
    release(g, "moveRight");
    const [res] = tap(g, "hardDrop");
    expect(res).toMatchObject({ lines: 4, spin: "none", perfectClear: true, b2b: 0 });
    expect(g.stats.quads).toBe(1);
  });

  it("board round-trips through fromRows/toRows", () => {
    const rows = ["T.........", "GIJLOSZ..G"];
    expect(Board.fromRows(rows).toRows()).toEqual(rows);
  });

  it("all piece types are valid board cells", () => {
    for (const t of "IJLOSTZ" as unknown as PieceType[]) expect(() => Board.fromRows([`${t}.........`])).not.toThrow();
  });
});
