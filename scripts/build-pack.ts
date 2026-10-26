/**
 * Builds a puzzle pack from Hard Drop wiki pages.
 *
 *   npm run build-pack -- scripts/pack-configs/tst-setups.json
 *
 * Config (JSON):
 *   { id, title, source, goal, variants?: number (default 2), budget?: number,
 *     pages: [{ url, section?: "prefix for section names",
 *               include?: ["Heading/Subheading", ...] (prefix match, default all),
 *               diagrams?: "setups" | "sequences" }
 *             | { section, boards: [{ name, rows: ["..ZZ......", ...], caption? }] }] }
 *
 * `boards` pages are hand-transcribed diagrams (for sites without wiki
 * templates). Rows are top first, 10 cells: "." empty, G garbage, IJLOSTZ
 * blocks. They go through the same generation and verification.
 *
 * Writes packs/<id>.json and packs/<id>.report.md, and prints a summary.
 * Every puzzle is solved and replayed through the engine before it's written.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GOALS, isGoalId, type GoalId } from "../src/modes/goals";
import { parsePack, type Pack, type Puzzle } from "../src/modes/packs";
import { diagramToBoard, fetchWikitext, parseWikitext, type Diagram, type ParsedPage } from "./lib/harddrop-wiki";
import { generateFromDiagram, type Generated } from "./lib/puzzle-gen";

interface ManualBoard {
  name: string;
  rows: string[];
  caption?: string;
}

interface PageConfig {
  url?: string;
  boards?: ManualBoard[];
  section?: string;
  include?: string[];
  /**
   * "setups" (default): every diagram is its own setup, so each one that can't
   * reach the goal directly gets a completion search. "sequences": diagrams in
   * one table are steps of a single setup, so only the last step of a table
   * with no direct result gets one.
   */
  diagrams?: "setups" | "sequences";
}

interface PackConfig {
  id: string;
  title: string;
  source?: string;
  goal: string;
  variants?: number;
  budget?: number;
  pages: PageConfig[];
}

interface Dropped {
  where: string;
  reason: string;
}

const root = resolve(import.meta.dirname, "..");
const configPath = process.argv[2];
if (!configPath) {
  console.error("usage: npm run build-pack -- <config.json>");
  process.exit(2);
}
const config: PackConfig = JSON.parse(readFileSync(resolve(configPath), "utf8"));
if (!isGoalId(config.goal)) {
  console.error(`unknown goal "${config.goal}": add it to src/modes/goals.ts first`);
  process.exit(2);
}
const goal: GoalId = config.goal;
const goalLabel = GOALS[goal].label;
const variants = config.variants ?? 2;
const budget = config.budget ?? 30_000;
const cacheDir = join(root, ".cache", "wiki");

const puzzles: Puzzle[] = [];
const dropped: Dropped[] = [];
const skippedImages: string[] = [];
const outOfScope = new Map<string, number>();
const seen = new Map<string, string>();
const usedIds = new Set<string>();
const counts = { diagrams: 0, pre: 0, completion: 0, variant: 0, duplicate: 0, buildUp: 0 };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

function uniqueId(base: string): string {
  let id = base || "puzzle";
  for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
  usedIds.add(id);
  return id;
}

const pieceList = (ps: string[]) => (ps.length === 1 ? `the ${ps[0]}` : `${ps.slice(0, -1).join(", ")} and ${ps.at(-1)}`);

function notesFor(g: Generated, d: Diagram, wiki: boolean): string {
  const from = d.caption ? (wiki ? `Hard Drop: "${d.caption}". ` : `${d.caption} `) : "";
  switch (g.kind) {
    case "pre":
      return `${from}The board is ready: place the ${g.queue} for a ${goalLabel}.`;
    case "variant":
      return `${from}Rebuild the setup with ${pieceList(g.removed!)} first, then ${goalLabel}.`;
    case "completion":
      return `${from}Finish the shape with ${pieceList([...g.queue.slice(0, -1)])}, then ${goalLabel}.`;
  }
}

const unnamedCount = new Map<string, number>();

function nameFor(g: Generated, d: Diagram, wiki: boolean): string {
  let label = !wiki && d.title ? d.title : d.caption && d.caption.length <= 32 ? d.caption : "";
  if (!label) {
    const base = d.title ?? d.sections.at(-1) ?? "Setup";
    const n = (unnamedCount.get(base) ?? 0) + 1;
    unnamedCount.set(base, n);
    label = `${base} ${n}`;
  }
  if (g.kind === "variant") return `${label} · build with ${g.removed!.join("")}`;
  if (g.kind === "completion") return `${label} · complete with ${g.queue.slice(0, -1)}`;
  return label;
}

/** Hand-transcribed boards as a parsed page: each board is its own one-step table. */
function manualPage(boards: ManualBoard[]): ParsedPage {
  return {
    images: [],
    unsupported: [],
    diagrams: boards.map((b, i) => ({
      sections: [],
      title: b.name,
      table: i,
      step: 0,
      caption: b.caption ?? "",
      codes: b.rows.map((r) => [...r.padEnd(10, ".")].map((c) => (c === "." ? " " : c))),
      line: i + 1,
    })),
  };
}

for (const page of config.pages) {
  const { url, parsed } = page.boards
    ? { url: page.section ?? "manual boards", parsed: manualPage(page.boards) }
    : await fetchWikitext(page.url!, cacheDir).then((r) => ({ url: r.url, parsed: parseWikitext(r.text) }));
  const inScope = (sections: string[]) =>
    !page.include || page.include.some((inc) => sections.join("/").toLowerCase().startsWith(inc.toLowerCase()));

  for (const img of parsed.images) {
    if (inScope(img.sections)) skippedImages.push(`${img.sections.join(" / ")}${img.title ? ` / ${img.title}` : ""}: ${img.file} (line ${img.line})`);
  }
  for (const u of parsed.unsupported) dropped.push({ where: `${url} line ${u.line}`, reason: `unsupported row template ${u.text}` });

  const inScopeDiagrams = parsed.diagrams.filter((d) => {
    if (inScope(d.sections)) return true;
    const k = `${url} · ${d.sections.join(" / ") || "(top)"}`;
    outOfScope.set(k, (outOfScope.get(k) ?? 0) + 1);
    return false;
  });
  const sequences = page.diagrams === "sequences";
  // For sequences: tables where some step already reaches the goal directly.
  const solvedTables = new Set<number>();
  const lastOfTable = new Map<number, number>();
  for (const d of inScopeDiagrams) lastOfTable.set(d.table, Math.max(lastOfTable.get(d.table) ?? -1, d.step));

  const process = (d: Diagram, pass: "direct" | "completion" | "all") => {
    const section = page.boards ? (page.section ?? config.title) : [page.section, ...d.sections, d.title].filter(Boolean).join(" / ");
    const where = `${section} · ${d.caption || `step ${d.step + 1}`} (line ${d.line})`;
    const isLast = lastOfTable.get(d.table) === d.step;
    const board = diagramToBoard(d.codes);
    if (!board.ok) {
      if (pass !== "completion") dropped.push({ where, reason: board.reason });
      return;
    }
    const generated = generateFromDiagram(board.board, goal, { variants, budget, completion: pass !== "direct" });
    if (generated.length === 0) {
      if (pass === "direct") {
        if (!isLast) counts.buildUp++;
      } else if (pass === "completion" && !isLast) {
        counts.buildUp++;
      } else {
        dropped.push({ where, reason: `no ${goalLabel} even with extra pieces` });
      }
      return;
    }
    if (pass === "direct") solvedTables.add(d.table);
    for (const g of generated) {
      const key = `${g.rows.join("/")}|${g.queue}`;
      if (seen.has(key)) {
        counts.duplicate++;
        continue;
      }
      const name = nameFor(g, d, !page.boards);
      seen.set(key, name);
      counts[g.kind]++;
      puzzles.push({
        id: uniqueId(slug(`${page.section ?? ""} ${d.title ?? ""} ${name}`)),
        name,
        section,
        board: g.rows,
        queue: g.queue,
        hold: null,
        allowHold: true,
        solution: g.solution,
        notes: notesFor(g, d, !page.boards),
      });
    }
  };

  counts.diagrams += inScopeDiagrams.length;
  if (sequences) {
    for (const d of inScopeDiagrams) process(d, "direct");
    // Tables with no direct result: try completing each diagram. Such tables are
    // often alternatives side by side (e.g. "LT / SJ / TJ Variation"), not steps.
    for (const d of inScopeDiagrams) {
      if (!solvedTables.has(d.table)) process(d, "completion");
    }
  } else {
    for (const d of inScopeDiagrams) process(d, "all");
  }
}

const pack: Pack = { id: config.id, title: config.title, source: config.source, goal, puzzles };
const check = parsePack(`${config.id}.json`, pack);
if (!check.ok) {
  console.error(`generated pack fails the schema: ${check.error}`);
  process.exit(1);
}
const packPath = join(root, "packs", `${config.id}.json`);
writeFileSync(packPath, JSON.stringify(pack, null, 2) + "\n");

const report = [
  `# ${config.title}: build report`,
  "",
  `Generated by \`npm run build-pack -- ${configPath}\`. Every puzzle below was solved and replayed through the engine.`,
  "",
  `- Diagrams in scope: ${counts.diagrams}`,
  `- Puzzles: ${puzzles.length} (${counts.pre} ready, ${counts.variant} build variants, ${counts.completion} completions)`,
  `- Duplicates skipped: ${counts.duplicate}`,
  `- Build-up steps skipped (intermediate diagrams of a sequence that can't reach the goal with a few extra pieces): ${counts.buildUp}`,
  `- Dropped: ${dropped.length}`,
  `- Image-only diagrams skipped: ${skippedImages.length}`,
  "",
  "## Dropped",
  "",
  ...(dropped.length ? dropped.map((d) => `- ${d.where}: ${d.reason}`) : ["None."]),
  "",
  "## Image-only diagrams (skipped)",
  "",
  ...(skippedImages.length ? skippedImages.map((s) => `- ${s}`) : ["None."]),
  "",
  "## Out of scope (not included by the config)",
  "",
  ...(outOfScope.size ? [...outOfScope].map(([k, n]) => `- ${k}: ${n} diagram(s)`) : ["None."]),
  "",
].join("\n");
mkdirSync(join(root, "packs"), { recursive: true });
writeFileSync(join(root, "packs", `${config.id}.report.md`), report);

console.log(report.split("\n## Dropped")[0]);
console.log(`Wrote ${packPath} and packs/${config.id}.report.md`);
