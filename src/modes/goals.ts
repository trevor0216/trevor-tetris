import type { LockResult } from "../engine/game";

/**
 * Puzzle goals. A pack's `goal` must be a key here; the pack schema rejects
 * anything else. New goals (tsd, pc, ...) are added by extending this table.
 */
export interface Goal {
  label: string;
  /** The piece kind the goal needs; when none is left anywhere, the puzzle fails early. */
  requiresPiece?: "T";
  isMet(r: LockResult): boolean;
}

export const GOALS = {
  tst: {
    label: "T-Spin Triple",
    requiresPiece: "T",
    isMet: (r) => r.tst,
  },
} satisfies Record<string, Goal>;

export type GoalId = keyof typeof GOALS;

export function isGoalId(id: string): id is GoalId {
  return Object.hasOwn(GOALS, id);
}
