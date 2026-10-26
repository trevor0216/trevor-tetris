import type { LockResult } from "../engine/game";

/** The parts of a lock a goal may look at (the solver builds these without a Game). */
export type GoalLock = Pick<LockResult, "piece" | "lines" | "spin" | "tst" | "perfectClear">;

/**
 * Puzzle goals. A pack's `goal` must be a key here; the pack schema rejects
 * anything else. New goals are added by extending this table.
 */
export interface Goal {
  label: string;
  /** The piece kind the goal needs; when none is left anywhere, the puzzle fails early. */
  requiresPiece?: "T";
  isMet(r: GoalLock): boolean;
}

export const GOALS = {
  tst: {
    label: "T-Spin Triple",
    requiresPiece: "T",
    isMet: (r) => r.tst,
  },
  tsd: {
    label: "T-Spin Double",
    requiresPiece: "T",
    isMet: (r) => r.piece === "T" && r.spin === "full" && r.lines === 2,
  },
  tss: {
    label: "T-Spin Single",
    requiresPiece: "T",
    isMet: (r) => r.piece === "T" && r.spin === "full" && r.lines === 1,
  },
  tspin: {
    label: "Any line-clearing T-spin",
    requiresPiece: "T",
    isMet: (r) => r.piece === "T" && r.spin !== "none" && r.lines > 0,
  },
  pc: {
    label: "Perfect Clear",
    isMet: (r) => r.perfectClear,
  },
  clear2: {
    label: "Clear 2+ lines at once",
    isMet: (r) => r.lines >= 2,
  },
  clear3: {
    label: "Clear 3+ lines at once",
    isMet: (r) => r.lines >= 3,
  },
  quad: {
    label: "Quad (4 lines)",
    isMet: (r) => r.lines === 4,
  },
} satisfies Record<string, Goal>;

export type GoalId = keyof typeof GOALS;

export function isGoalId(id: string): id is GoalId {
  return Object.hasOwn(GOALS, id);
}
