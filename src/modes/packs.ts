import { z } from "zod";
import { Board } from "../engine/board";
import { SHAPES, pieceCells } from "../engine/pieces";
import type { PiecePos, PieceType, Rotation } from "../engine/types";
import { isGoalId } from "./goals";

// ---- schema --------------------------------------------------------------

const PIECE = z.enum(["I", "J", "L", "O", "S", "T", "Z"]);
export const ROT_NAMES = ["spawn", "right", "reverse", "left"] as const;

/**
 * One placement in a solution. `x` is the leftmost column and `y` the lowest
 * row (row 0 = bottom) of the piece's final cells, so placements read the
 * same way as the board rows. `spin` marks placements that finish with a
 * rotation (they can't simply be hard dropped).
 */
export const PlacementSchema = z.object({
  piece: PIECE,
  x: z.number().int().min(0).max(9),
  y: z.number().int().min(0).max(39),
  rot: z.enum(ROT_NAMES),
  spin: z.boolean().default(false),
});

export const PuzzleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  section: z.string().optional(),
  board: z
    .array(z.string().regex(/^[.GIJLOSTZ]{10}$/, "board rows must be 10 chars of . G I J L O S T Z"))
    .max(40),
  queue: z.string().regex(/^[IJLOSTZ]+$/, "queue must be piece letters"),
  hold: PIECE.nullable().default(null),
  allowHold: z.boolean().default(true),
  solution: z.array(PlacementSchema).min(1),
  notes: z.string().optional(),
});

export const PackSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, "pack id must be a lowercase slug"),
    title: z.string().min(1),
    source: z.string().url().optional(),
    goal: z.string().refine(isGoalId, "unknown goal (add it to src/modes/goals.ts)"),
    puzzles: z.array(PuzzleSchema).min(1),
  })
  .superRefine((pack, ctx) => {
    const seen = new Set<string>();
    pack.puzzles.forEach((p, i) => {
      if (seen.has(p.id)) ctx.addIssue({ code: "custom", path: ["puzzles", i, "id"], message: `duplicate puzzle id ${p.id}` });
      seen.add(p.id);
    });
  });

export type Placement = z.infer<typeof PlacementSchema>;
export type Puzzle = z.infer<typeof PuzzleSchema>;
export type Pack = z.infer<typeof PackSchema>;

export type LoadedPack = { ok: true; file: string; pack: Pack } | { ok: false; file: string; error: string };

export function parsePack(file: string, data: unknown): LoadedPack {
  const r = PackSchema.safeParse(data);
  if (r.success) return { ok: true, file, pack: r.data };
  const error = r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  return { ok: false, file, error };
}

/** All packs in /packs, discovered at build time. */
export function discoverPacks(): LoadedPack[] {
  const modules = import.meta.glob<{ default: unknown }>("/packs/*.json", { eager: true });
  return Object.entries(modules)
    .map(([file, mod]) => parsePack(file.replace(/^\/packs\//, ""), mod.default))
    .sort((a, b) => a.file.localeCompare(b.file));
}

// ---- placements ----------------------------------------------------------

export function rotIndex(name: Placement["rot"]): Rotation {
  return ROT_NAMES.indexOf(name) as Rotation;
}

/** Converts a placement to the engine's box-anchored position. */
export function placementToPos(p: Pick<Placement, "piece" | "x" | "y" | "rot">): PiecePos {
  const rot = rotIndex(p.rot);
  const cells = SHAPES[p.piece][rot];
  const minCx = Math.min(...cells.map(([cx]) => cx));
  const maxCy = Math.max(...cells.map(([, cy]) => cy));
  return { type: p.piece, rot, x: p.x - minCx, y: p.y + maxCy };
}

export function posToPlacement(pos: PiecePos, spin = false): Placement {
  const cells = pieceCells(pos);
  return {
    piece: pos.type,
    x: Math.min(...cells.map(([x]) => x)),
    y: Math.min(...cells.map(([, y]) => y)),
    rot: ROT_NAMES[pos.rot],
    spin,
  };
}

// ---- mirroring -----------------------------------------------------------

const MIRROR_PIECE: Record<PieceType, PieceType> = { I: "I", O: "O", T: "T", L: "J", J: "L", S: "Z", Z: "S" };
const MIRROR_ROT: Record<Placement["rot"], Placement["rot"]> = { spawn: "spawn", right: "left", reverse: "reverse", left: "right" };

export const mirrorPiece = (p: PieceType): PieceType => MIRROR_PIECE[p];

function mirrorChar(ch: string): string {
  return (MIRROR_PIECE as Record<string, string>)[ch] ?? ch;
}

/** Flips the board left↔right and swaps L↔J, S↔Z everywhere (cells, queue, hold, solution). */
export function mirrorPuzzle(p: Puzzle): Puzzle {
  return {
    ...p,
    board: p.board.map((row) => [...row].reverse().map(mirrorChar).join("")),
    queue: [...p.queue].map(mirrorChar).join(""),
    hold: p.hold && mirrorPiece(p.hold),
    solution: p.solution.map(mirrorPlacement),
  };
}

export function mirrorPlacement(pl: Placement): Placement {
  const width = Math.max(...pieceCells(placementToPos(pl)).map(([x]) => x)) - pl.x + 1;
  return { ...pl, piece: mirrorPiece(pl.piece), rot: MIRROR_ROT[pl.rot], x: 10 - pl.x - width };
}

export function puzzleBoard(p: Puzzle): Board {
  return Board.fromRows(p.board);
}
