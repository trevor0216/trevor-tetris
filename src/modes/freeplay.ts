import { Game, type LockResult } from "../engine/game";
import type { Handling } from "../engine/handling";
import { BagQueue } from "../engine/queue";

export function createFreePlayGame(handling: Handling, seed = randomSeed()): Game {
  return new Game({ queue: new BagQueue(seed), handling });
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2147483646) + 1;
}

const LINE_NAMES = ["", "SINGLE", "DOUBLE", "TRIPLE", "QUAD"];

export interface Toast {
  text: string;
  kind: "spin" | "mini" | "quad" | "b2b" | "combo" | "pc";
}

/** Action text for one lock, most important first. Empty for a plain placement or plain clear. */
export function toastsFor(r: LockResult): Toast[] {
  const out: Toast[] = [];
  if (r.spin !== "none") {
    const name = r.spin === "mini" ? "T-SPIN MINI" : "T-SPIN";
    out.push({ text: [name, LINE_NAMES[r.lines]].filter(Boolean).join(" "), kind: r.spin === "mini" ? "mini" : "spin" });
  } else if (r.lines >= 4) {
    out.push({ text: "QUAD", kind: "quad" });
  }
  if (r.lines > 0 && r.b2b > 0 && (r.spin !== "none" || r.lines >= 4)) out.push({ text: `B2B ×${r.b2b}`, kind: "b2b" });
  if (r.combo > 0) out.push({ text: `${r.combo} COMBO`, kind: "combo" });
  if (r.perfectClear) out.push({ text: "ALL CLEAR", kind: "pc" });
  return out;
}

export interface FreePlayStats {
  pieces: number;
  pps: number;
  seconds: number;
  lines: number;
  tst: number;
  tsd: number;
  tss: number;
  minis: number;
  quads: number;
  b2b: number;
  combo: number;
  maxB2b: number;
  maxCombo: number;
}

export function statsOf(g: Game): FreePlayStats {
  const s = g.stats;
  const seconds = g.frame / 60;
  return {
    pieces: s.pieces,
    pps: seconds > 0 ? s.pieces / seconds : 0,
    seconds,
    lines: s.lines,
    tst: s.tspins.full[3],
    tsd: s.tspins.full[2],
    tss: s.tspins.full[1],
    minis: s.tspins.mini.reduce((a, b) => a + b, 0),
    quads: s.quads,
    b2b: Math.max(0, s.b2b),
    combo: Math.max(0, s.combo),
    maxB2b: s.maxB2b,
    maxCombo: s.maxCombo,
  };
}
