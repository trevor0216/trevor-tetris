/**
 * Validates puzzle packs: schema (zod), then plays every puzzle's solution
 * through the real engine (normal and mirrored). With --solve, also checks
 * the solver finds an answer from scratch and reports how short it is.
 *
 *   npm run validate-packs                 # all packs/*.json
 *   npm run validate-packs -- packs/x.json # specific files
 *   npm run validate-packs -- --solve --json
 *
 * Exit code 1 if any pack is invalid or any puzzle fails verification.
 * Mirrored failures are warnings: SRS+ 180 kicks aren't left/right symmetric.
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Board } from "../src/engine/board";
import type { PieceType } from "../src/engine/types";
import type { GoalId } from "../src/modes/goals";
import { mirrorPuzzle, parsePack } from "../src/modes/packs";
import { solve } from "../src/solver";
import { verifyPuzzle } from "../src/solver/verify";

interface PuzzleReport {
  id: string;
  ok: boolean;
  error?: string;
  mirrorOk: boolean;
  mirrorError?: string;
  solverPieces?: number | null;
  solverNodes?: number;
}

interface PackReport {
  file: string;
  ok: boolean;
  error?: string;
  puzzles: PuzzleReport[];
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const root = resolve(import.meta.dirname ?? ".", "..");
const files = args.filter((a) => !a.startsWith("--"));
const targets = files.length
  ? files.map((f) => resolve(f))
  : readdirSync(join(root, "packs"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => join(root, "packs", f));

const reports: PackReport[] = targets.map((path) => {
  const file = basename(path);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { file, ok: false, error: `unreadable JSON: ${(e as Error).message}`, puzzles: [] };
  }
  const loaded = parsePack(file, data);
  if (!loaded.ok) return { file, ok: false, error: loaded.error, puzzles: [] };

  const goal = loaded.pack.goal as GoalId;
  const puzzles = loaded.pack.puzzles.map((p): PuzzleReport => {
    const v = verifyPuzzle(p, goal);
    const m = verifyPuzzle(mirrorPuzzle(p), goal);
    const r: PuzzleReport = {
      id: p.id,
      ok: v.ok,
      error: v.ok ? undefined : `step ${(v.step ?? 0) + 1}: ${v.error}`,
      mirrorOk: m.ok,
      mirrorError: m.ok ? undefined : `step ${(m.step ?? 0) + 1}: ${m.error}`,
    };
    if (flags.has("--solve")) {
      const s = solve({
        board: Board.fromRows(p.board),
        queue: [...p.queue] as PieceType[],
        hold: p.hold,
        allowHold: p.allowHold,
        goal,
      });
      r.solverPieces = s.steps ? s.steps.length : null;
      r.solverNodes = s.nodes;
    }
    return r;
  });
  return { file, ok: puzzles.every((p) => p.ok), puzzles };
});

if (flags.has("--json")) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  for (const r of reports) {
    if (r.error) {
      console.log(`✗ ${r.file}: ${r.error}`);
      continue;
    }
    const passed = r.puzzles.filter((p) => p.ok).length;
    console.log(`${r.ok ? "✓" : "✗"} ${r.file}: ${passed}/${r.puzzles.length} puzzles verified`);
    for (const p of r.puzzles) {
      const solver =
        p.solverPieces === undefined ? "" : p.solverPieces === null ? " · solver: no answer" : ` · solver: ${p.solverPieces} piece(s)`;
      if (!p.ok) console.log(`    ✗ ${p.id}: ${p.error}${solver}`);
      else if (!p.mirrorOk) console.log(`    ⚠ ${p.id}: mirror fails (${p.mirrorError})${solver}`);
      else if (solver) console.log(`    ✓ ${p.id}${solver}`);
    }
  }
}

process.exit(reports.every((r) => r.ok) ? 0 : 1);
