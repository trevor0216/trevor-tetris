import { describe, expect, it } from "vitest";
import { Board } from "../src/engine/board";
import { SRS_PLUS_I_KICKS, SRS_PLUS_KICKS, isTstKick, kicksFor } from "../src/engine/kicks";
import { tryRotate } from "../src/engine/movement";
import { pieceCells, rotateBy } from "../src/engine/pieces";
import type { PiecePos, PieceType, Rotation } from "../src/engine/types";
import {
  HARDDROP_GUIDELINE_I,
  HARDDROP_JLSTZ,
  HARDDROP_SRS_PLUS_I,
  TRIANGLE_SRS_PLUS_I_YDOWN,
  TRIANGLE_SRS_PLUS_JLSTZ_YDOWN,
} from "./fixtures/kick-sources";

const NINETY = ["01", "10", "12", "21", "23", "32", "30", "03"];
const ONE_EIGHTY = ["02", "20", "13", "31"];
const toPlain = (t: Record<string, ReadonlyArray<readonly [number, number]>>, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, t[k].map(([x, y]) => [x, y])]));
const flipY = (t: Record<string, number[][]>) =>
  Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.map(([x, y]) => [x, 0 - y || 0])]));

describe("kick tables match their sources", () => {
  it("J/L/S/T/Z 90° kicks equal the Hard Drop SRS table", () => {
    expect(toPlain(SRS_PLUS_KICKS, NINETY)).toEqual(HARDDROP_JLSTZ);
  });

  it("I 90° kicks equal the Hard Drop SRS+ table (not Guideline SRS)", () => {
    expect(toPlain(SRS_PLUS_I_KICKS, NINETY)).toEqual(HARDDROP_SRS_PLUS_I);
    expect(toPlain(SRS_PLUS_I_KICKS, NINETY)).not.toEqual(HARDDROP_GUIDELINE_I);
  });

  it("every table, including 180°, equals Triangle.js SRS+ data (y flipped)", () => {
    expect(toPlain(SRS_PLUS_KICKS, [...NINETY, ...ONE_EIGHTY])).toEqual(flipY(TRIANGLE_SRS_PLUS_JLSTZ_YDOWN));
    expect(toPlain(SRS_PLUS_I_KICKS, [...NINETY, ...ONE_EIGHTY])).toEqual(flipY(TRIANGLE_SRS_PLUS_I_YDOWN));
  });

  it("J/L/S/T/Z 180° kicks equal osk's official TETR.IO 180 kick diagram", () => {
    // Transcribed from File:TETR.IO_180kicks.png (tetris.wiki), kicks 1-5 (kick 0 is (0,0)).
    expect(toPlain(SRS_PLUS_KICKS, ONE_EIGHTY)).toEqual({
      "02": [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0]], // North → South
      "20": [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0]], // South → North
      "13": [[1, 0], [1, 2], [1, 1], [0, 2], [0, 1]], // East → West
      "31": [[-1, 0], [-1, 2], [-1, 1], [0, 2], [0, 1]], // West → East
    });
  });

  it("includes the (±1, 0) N→S kicks needed for the Iso TST", () => {
    expect(SRS_PLUS_KICKS["02"]).toContainEqual([1, 0]);
    expect(SRS_PLUS_KICKS["02"]).toContainEqual([-1, 0]);
  });
});

/**
 * For each table entry, build a board where the unkicked rotation and every
 * earlier kick are blocked but this kick fits, and check the engine picks
 * exactly this kick.
 */
describe("every kick entry is applied in order", () => {
  const cases: [PieceType, string, number][] = [];
  for (const type of ["I", "J", "L", "S", "T", "Z"] as PieceType[]) {
    for (const key of [...NINETY, ...ONE_EIGHTY]) {
      const from = Number(key[0]) as Rotation;
      const to = Number(key[1]) as Rotation;
      kicksFor(type, from, to).forEach((_, i) => cases.push([type, key, i]));
    }
  }

  it.each(cases)("%s %s kick #%i", (type, key, k) => {
    const from = Number(key[0]) as Rotation;
    const to = Number(key[1]) as Rotation;
    const amount = (((to - from + 4) % 4) === 3 ? -1 : (to - from + 4) % 4) as 1 | -1 | 2;
    expect(rotateBy(from, amount)).toBe(to);

    const kicks = kicksFor(type, from, to);
    const start: PiecePos = { type, rot: from, x: 3, y: 10 };
    const at = ([dx, dy]: readonly [number, number]): PiecePos => ({ type, rot: to, x: 3 + dx, y: 10 + dy });
    const target = at(kicks[k]);
    // Only the target must stay open; rotation never re-checks the starting cells.
    const protectedCells = new Set(pieceCells(target).map(([x, y]) => `${x},${y}`));

    const board = new Board();
    for (const earlier of [at([0, 0]), ...kicks.slice(0, k).map(at)]) {
      if (!board.fits(earlier)) continue;
      const free = pieceCells(earlier).find(([x, y]) => !protectedCells.has(`${x},${y}`));
      expect(free, "earlier test can't be blocked without blocking the target").toBeDefined();
      board.set(free![0], free![1], 8);
    }

    const r = tryRotate(board, start, amount);
    expect(r).not.toBeNull();
    expect(r!.kickIndex).toBe(k);
    expect(r!.pos).toEqual(target);
  });

  it("O never kicks and rotates in place", () => {
    const board = new Board();
    const r = tryRotate(board, { type: "O", rot: 0, x: 4, y: 5 }, 1);
    expect(r!.kickIndex).toBe(-1);
    expect(r!.pos).toEqual({ type: "O", rot: 1, x: 4, y: 5 });
  });
});

describe("TST / fin kick", () => {
  it("is exactly the 4th 90° kick, (-1,-2) for 0→R and 2→R, (+1,-2) for 0→L and 2→L", () => {
    expect(SRS_PLUS_KICKS["01"][3]).toEqual([-1, -2]);
    expect(SRS_PLUS_KICKS["21"][3]).toEqual([-1, -2]);
    expect(SRS_PLUS_KICKS["03"][3]).toEqual([1, -2]);
    expect(SRS_PLUS_KICKS["23"][3]).toEqual([1, -2]);
    expect(isTstKick(0, 1, [-1, -2])).toBe(true);
    expect(isTstKick(2, 1, [-1, -2])).toBe(true);
    expect(isTstKick(0, 3, [1, -2])).toBe(true);
    expect(isTstKick(2, 3, [1, -2])).toBe(true);
    expect(isTstKick(1, 0, [1, 2])).toBe(false);
    expect(isTstKick(0, 1, [0, -2])).toBe(false);
  });
});
