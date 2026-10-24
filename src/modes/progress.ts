/** Solved state per pack and puzzle, persisted to localStorage. */
export interface PuzzleProgress {
  solved?: boolean;
  solvedMirrored?: boolean;
  /** Solved without using Hint or Show solution. */
  clean?: boolean;
}

export type Progress = Record<string, Record<string, PuzzleProgress>>;

export const PROGRESS_KEY = "tst-trainer:progress:v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadProgress(st: StorageLike | undefined = storage()): Progress {
  try {
    const v = JSON.parse(st?.getItem(PROGRESS_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function markSolved(
  progress: Progress,
  packId: string,
  puzzleId: string,
  opts: { mirrored: boolean; clean: boolean },
  st: StorageLike | undefined = storage(),
): Progress {
  const prev = progress[packId]?.[puzzleId] ?? {};
  const entry: PuzzleProgress = {
    ...prev,
    [opts.mirrored ? "solvedMirrored" : "solved"]: true,
    clean: prev.clean || opts.clean,
  };
  const next = { ...progress, [packId]: { ...progress[packId], [puzzleId]: entry } };
  try {
    st?.setItem(PROGRESS_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
  return next;
}
