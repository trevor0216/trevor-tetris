/**
 * Hard Drop wiki playfield parsing.
 *
 * Diagrams are {{pfstart}} ... {{pfrow|c1|...|c10}} / {{pfrowblank}} ... {{pfend}}
 * templates in the raw wikitext (?action=raw); the rendered HTML only has
 * images. Cell codes (Template:Pfstart legend): space = empty, IJLOSTZ =
 * piece colors, G = garbage, P = purple T for T-spin docs, "-" = ghost piece
 * or line clear, C/B/X/digits = annotations. Lowercase letters are lighter
 * shades of the same blocks; "-T" etc. are ghost pieces.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Diagram {
  /** Heading path, e.g. ["Openings"]. */
  sections: string[];
  /** Bold/linked setup title preceding the diagram, if any. */
  title: string | null;
  /** Index of the {| table |} the diagram sits in (diagrams in one table are a step sequence). */
  table: number;
  /** Position within that table. */
  step: number;
  caption: string;
  /** Raw cell codes, top row first, 10 per row. */
  codes: string[][];
  line: number;
}

export interface ImageDiagram {
  sections: string[];
  title: string | null;
  file: string;
  line: number;
}

export interface ParsedPage {
  diagrams: Diagram[];
  images: ImageDiagram[];
  /** Row templates we don't understand (e.g. tnetrow), with line numbers. */
  unsupported: { line: number; text: string }[];
}

/** Turns a Hard Drop wiki URL or page title into its ?action=raw URL. */
export function rawUrl(urlOrTitle: string): string {
  const m = urlOrTitle.match(/harddrop\.com\/wiki\/([^?#]+)/) ?? urlOrTitle.match(/[?&]title=([^&#]+)/);
  const title = m ? decodeURIComponent(m[1]) : urlOrTitle;
  return `https://harddrop.com/wiki?title=${encodeURIComponent(title.replace(/ /g, "_"))}&action=raw`;
}

/** Fetches raw wikitext, caching to `cacheDir` so re-runs don't hit the wiki. */
export async function fetchWikitext(urlOrTitle: string, cacheDir?: string): Promise<{ url: string; text: string }> {
  const url = rawUrl(urlOrTitle);
  const cacheFile = cacheDir && join(cacheDir, `${url.replace(/[^a-z0-9]+/gi, "_")}.txt`);
  if (cacheFile && existsSync(cacheFile)) return { url, text: readFileSync(cacheFile, "utf8") };
  const res = await fetch(url, { headers: { "User-Agent": "tst-trainer pack builder" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error(`${url}: got HTML, not wikitext`);
  if (cacheFile) {
    mkdirSync(cacheDir!, { recursive: true });
    writeFileSync(cacheFile, text);
  }
  return { url, text };
}

/** Strips links, bold/italics, <br> and templates from a wikitext fragment. */
export function plainText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseWikitext(text: string): ParsedPage {
  const lines = text.split("\n");
  const diagrams: Diagram[] = [];
  const images: ImageDiagram[] = [];
  const unsupported: { line: number; text: string }[] = [];
  const sections: string[] = [];
  let title: string | null = null;
  let table = -1;
  let step = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const heading = line.match(/^(=+)\s*(.*?)\s*\1\s*$/);
    if (heading) {
      const level = heading[1].length;
      sections.length = Math.max(0, level - 2);
      sections.push(plainText(heading[2]));
      title = null;
      continue;
    }

    // A setup title: a line starting with bold text, or "{{clear}} [[Link]] is a technique ...".
    const bold = line.match(/^(?:\{\{clear\}\}\s*)?'''(.+?)'''/);
    const linked = line.match(/^\{\{clear\}\}\s*\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/);
    if (bold) title = plainText(bold[1]);
    else if (linked) title = plainText(linked[1]);

    if (/^\{\|/.test(line)) {
      table++;
      step = 0;
    }

    for (const m of line.matchAll(/\[\[(?:File|Image):([^|\]]+)/gi)) {
      images.push({ sections: [...sections], title, file: m[1].trim(), line: i + 1 });
    }

    if (!line.includes("{{pfstart}}")) continue;

    const codes: string[][] = [];
    let j = i;
    for (; j < lines.length && !lines[j].includes("{{pfend}}"); j++) {
      for (const m of lines[j].matchAll(/\{\{(pfrowblank|pfrow\|[^}]*|[a-z]+row[0-9]*\|[^}]*)\}\}/g)) {
        if (m[1] === "pfrowblank") codes.push(Array(10).fill(" "));
        else if (m[1].startsWith("pfrow|")) codes.push(m[1].slice(6).split("|").map((c) => c.trim() || " "));
        else unsupported.push({ line: j + 1, text: m[0] });
      }
    }
    // Caption: text after {{pfend}} up to the next table cell, table end or diagram.
    const after: string[] = [lines[j]?.split("{{pfend}}")[1] ?? ""];
    let k = j + 1;
    for (; k < lines.length; k++) {
      const l = lines[k];
      if (/^\s*(\||\{\||!|=)/.test(l) || l.includes("{{pfstart}}")) break;
      after.push(l);
    }
    diagrams.push({ sections: [...sections], title, table, step: step++, caption: plainText(after.join(" ")), codes, line: i + 1 });
    i = j;
  }
  return { diagrams, images, unsupported };
}

// ---- diagram → board -------------------------------------------------------

export interface DiagramBoard {
  /** Engine board rows (top first): "." empty, "G" garbage, IJLOSTZ colors. */
  rows: string[];
  /** 4-connected groups of T-colored cells (T, t, P, p), as [x, y] with y counted from the bottom. */
  tGroups: [number, number][][];
  /** Uppercase-lettered cells per piece letter, for picking setup pieces. */
  upper: Map<string, [number, number][]>;
}

export type DiagramResult = { ok: true; board: DiagramBoard } | { ok: false; reason: string };

export function diagramToBoard(codes: string[][]): DiagramResult {
  if (codes.some((r) => r.length !== 10)) return { ok: false, reason: "row is not 10 cells wide" };
  if (codes.some((r) => r.filter((c) => c.startsWith("-")).length >= 5)) return { ok: false, reason: "shows a line clear in progress" };

  const height = codes.length;
  const grid: string[][] = codes.map((row) =>
    row.map((c) => {
      if (c === " " || c.startsWith("-") || c === "X" || /^[0-9]$/.test(c)) return ".";
      if (c === "G" || c === "g" || c === "B") return "G";
      if (c === "P" || c === "p") return "T";
      const letter = c.replace(/^'/, "").toUpperCase();
      if (/^[IJLOSTZ]$/.test(letter)) return letter;
      if (letter === "C") return "G";
      return "?";
    }),
  );
  const bad = codes.flat().find((_, i) => grid[Math.floor(i / 10)][i % 10] === "?");
  if (bad) return { ok: false, reason: `unknown cell code "${bad}"` };

  // Drop empty rows above the stack.
  let top = 0;
  while (top < height && grid[top].every((c) => c === ".")) top++;
  const rows = grid.slice(top).map((r) => r.join(""));
  if (rows.length === 0) return { ok: false, reason: "empty diagram" };
  if (rows.length > 20) return { ok: false, reason: `stack is ${rows.length} rows tall` };

  const yOf = (rowIndex: number) => height - 1 - rowIndex;
  const isT = (c: string) => c === "T" || c === "t" || c === "P" || c === "p";
  const seen = new Set<string>();
  const tGroups: [number, number][][] = [];
  for (let r = 0; r < height; r++) {
    for (let x = 0; x < 10; x++) {
      if (!isT(codes[r][x]) || seen.has(`${x},${r}`)) continue;
      const group: [number, number][] = [];
      const stack: [number, number][] = [[x, r]];
      seen.add(`${x},${r}`);
      while (stack.length) {
        const [cx, cr] = stack.pop()!;
        group.push([cx, yOf(cr)]);
        for (const [dx, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cx + dx;
          const nr = cr + dr;
          if (nx < 0 || nx > 9 || nr < 0 || nr >= height || seen.has(`${nx},${nr}`) || !isT(codes[nr][nx])) continue;
          seen.add(`${nx},${nr}`);
          stack.push([nx, nr]);
        }
      }
      tGroups.push(group);
    }
  }

  const upper = new Map<string, [number, number][]>();
  codes.forEach((row, r) =>
    row.forEach((c, x) => {
      if (/^[IJLOSZ]$/.test(c)) upper.set(c, [...(upper.get(c) ?? []), [x, yOf(r)]]);
    }),
  );
  return { ok: true, board: { rows, tGroups, upper } };
}
