import type { PieceType, Rotation } from "./types";

/**
 * TETR.IO "SRS+" kick tables.
 *
 * Convention: [dx, dy] with +x right and +y UP (the Hard Drop wiki
 * convention). Keys are `${from}${to}` with 0 = spawn, 1 = R, 2 = 180,
 * 3 = L. The unkicked test (0, 0) is not listed; it is always tried first.
 *
 * Sources (full details and cross-checks in NOTES.md):
 *  - J/L/S/T/Z 90° kicks: standard Guideline SRS. Hard Drop wiki "SRS" page,
 *    "J, L, S, T, Z tetromino wall kick data" table
 *    (https://harddrop.com/wiki/SRS, fetched 2026-10-24).
 *  - I 90° kicks: SRS+ (y-axis symmetric I kicks). Hard Drop wiki "SRS" page,
 *    section "SRS+", table "SRS+ I tetromino wall kick data".
 *  - 180° kicks (all pieces) and a second source for every table above:
 *    Triangle.js, a TETR.IO engine reimplementation,
 *    https://github.com/halp1/triangle/blob/14418545c7e8249efbb452ea953ddd4961b7a696/src/engine/utils/kicks/data.ts
 *    ("SRS+" entry, stored y-down there and negated here).
 *  - 180° J/L/S/T/Z kicks cross-checked against osk's official
 *    "TETR.IO 180 KICK TABLE" diagram (tetris.wiki, File:TETR.IO_180kicks.png).
 *
 * O never kicks: all four O states are identical, so the (0, 0) test always
 * passes.
 */
export type KickTable = Record<string, ReadonlyArray<readonly [number, number]>>;

export const SRS_PLUS_KICKS: KickTable = {
  // 90° (Guideline SRS)
  "01": [[-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "10": [[1, 0], [1, -1], [0, 2], [1, 2]],
  "12": [[1, 0], [1, -1], [0, 2], [1, 2]],
  "21": [[-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "23": [[1, 0], [1, 1], [0, -2], [1, -2]],
  "32": [[-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "30": [[-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "03": [[1, 0], [1, 1], [0, -2], [1, -2]],
  // 180° (TETR.IO custom). The N→S (±1, 0) "zipper" kicks are what make the
  // Iso TST possible.
  "02": [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0]],
  "20": [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0]],
  "13": [[1, 0], [1, 2], [1, 1], [0, 2], [0, 1]],
  "31": [[-1, 0], [-1, 2], [-1, 1], [0, 2], [0, 1]],
};

export const SRS_PLUS_I_KICKS: KickTable = {
  // 90° (SRS+ symmetric I kicks)
  "01": [[1, 0], [-2, 0], [-2, -1], [1, 2]],
  "10": [[-1, 0], [2, 0], [-1, -2], [2, 1]],
  "12": [[-1, 0], [2, 0], [-1, 2], [2, -1]],
  "21": [[-2, 0], [1, 0], [-2, 1], [1, -2]],
  "23": [[2, 0], [-1, 0], [2, 1], [-1, -2]],
  "32": [[1, 0], [-2, 0], [1, 2], [-2, -1]],
  "30": [[1, 0], [-2, 0], [1, -2], [-2, 1]],
  "03": [[-1, 0], [2, 0], [2, -1], [-1, 2]],
  // 180° (Triangle.js only; no second source found, see NOTES.md)
  "02": [[0, 1]],
  "20": [[0, -1]],
  "13": [[1, 0]],
  "31": [[-1, 0]],
};

export function kicksFor(type: PieceType, from: Rotation, to: Rotation): ReadonlyArray<readonly [number, number]> {
  if (type === "O") return [];
  const table = type === "I" ? SRS_PLUS_I_KICKS : SRS_PLUS_KICKS;
  return table[`${from}${to}`] ?? [];
}

/**
 * The TST / fin kick: the 4th 90° test that drops a T two rows, (∓1, -2).
 * TETR.IO always scores a T-spin that used it as full, never mini
 * (Triangle.js engine/index.ts #isTSpinKick).
 */
export function isTstKick(from: Rotation, to: Rotation, kick: readonly [number, number]): boolean {
  const id = `${from}${to}`;
  if ((id === "01" || id === "21") && kick[0] === -1 && kick[1] === -2) return true;
  if ((id === "03" || id === "23") && kick[0] === 1 && kick[1] === -2) return true;
  return false;
}
