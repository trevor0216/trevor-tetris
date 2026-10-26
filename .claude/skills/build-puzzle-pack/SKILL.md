---
name: build-puzzle-pack
description: Build a verified TST Trainer puzzle pack from a web page of Tetris setups (Hard Drop wiki or any other site). Use when the user says "make a pack from <url>", "build a puzzle pack", "turn this page into puzzles", or names a setup page they want to drill.
---

# Build a puzzle pack from a URL

Turns a page of board diagrams into `packs/<slug>.json`. Every puzzle is solved by
`src/solver` and replayed through the real engine before it's written, and the
validator re-checks it, mirrored too. Don't hand-write puzzle solutions: the
generator finds and verifies them.

Pieces involved (read them if anything below doesn't match):
- `scripts/build-pack.ts`: config → pack + `packs/<slug>.report.md`. Its header documents the config format.
- `scripts/lib/harddrop-wiki.ts`: wikitext → diagrams → boards (cell code legend in the header).
- `scripts/lib/puzzle-gen.ts`: diagram → ready / build-variant / completion puzzles.
- `src/modes/goals.ts`: the goal table. A pack's `goal` must be a key here.
- `scripts/validate-packs.ts`: schema + engine replay of every pack.

## 1. Fetch the page

**Hard Drop wiki** (`harddrop.com/wiki/...`): diagrams live in the raw wikitext
(`?action=raw`), not in the HTML (which only has images). Run:

```
npm run pack-sections -- <url>
```

It caches the page in `.cache/wiki/` and lists every section with its diagram
count, how many diagrams can't be read, image-only diagrams, and setup titles.
Check the page for links to sub-pages that hold more diagrams (e.g. "X Base
Setups", "X Overhang Setups") and run `pack-sections` on those too.

**Any other site**: fetch the HTML (WebFetch, or `curl -s`). Look for boards
written as text: tables, ASCII grids, or JSON. There's no fumen
(`v115@...`) decoder yet. If the page's boards are only fumen links or images,
tell the user and stop unless they want them transcribed by hand. Never guess
a board you can't read clearly.

## 2. Decide the goal

Pick it from the page's topic: TST setups → `tst`, TSD → `tsd`, TSS → `tss`,
PC openers → `pc`, quad/tetris setups → `quad`, generic spin setups → `tspin`,
"clear N lines" drills → `clear2` / `clear3`. Current goals are the keys of
`GOALS` in `src/modes/goals.ts`.

**If it isn't obvious** (a page mixing TSDs and TSTs, a page of downstack
drills), ask the user with AskUserQuestion. Offer the 2–3 likeliest goals.

**If the goal is new**, add it to `GOALS`:
- `label`: shown in the UI ("T-Spin Double").
- `requiresPiece: "T"` when the finishing piece must be a T (any T-spin goal).
  This lets puzzles fail early when no T is left, and makes the generator end
  every queue on a T. Leave it out when any piece can finish (pc, clear-N).
- `isMet(r)`: true for the lock that completes the goal. `r` has `piece`,
  `lines`, `spin` ("none" | "mini" | "full"), `tst`, `perfectClear`.

Then add a test for it in `tests/solver.test.ts` (`describe("goals")`): a tiny
board where one piece meets the goal, and one where it doesn't.

## 3. Write the config

Create `scripts/pack-configs/<slug>.json`. The slug is short and kebab-case, and
becomes the pack id and file name.

```json
{
  "id": "tsd-setups",
  "title": "T-Spin Double Setups",
  "source": "https://harddrop.com/wiki/T-Spin_Double_Setups",
  "goal": "tsd",
  "variants": 2,
  "pages": [
    { "url": "https://harddrop.com/wiki/T-Spin_Double_Base_Setups", "section": "Base" },
    { "url": "https://harddrop.com/wiki/T-Spin_Double_Setups",
      "include": ["General Setups", "STSD setup"], "diagrams": "sequences" }
  ]
}
```

- `include`: section paths ("Heading/Subheading", prefix match) from
  `pack-sections`. Leave out sections that are about a different goal
  (e.g. "T-Spin Double Replacements" on the TSD page is TSTs) or are tips
  rather than setups. List what you left out in the summary.
- `diagrams: "sequences"` for pages where each table is a step-by-step build of
  one setup (left to right). Leave it out (one setup per diagram) for
  catalogue pages like "Base Setups".
- `variants`: how many setup pieces may be moved into the queue (0–2).
  2 is the default.
- `section`: a prefix for the puzzle list's section names, when combining pages.

**Non-wiki pages**: transcribe each board into a `boards` page instead of a
`url` page:

```json
{ "section": "PC Openers", "boards": [
  { "name": "PCO (I-first)", "caption": "Optional note from the page.",
    "rows": ["..........", "GG......GG", "GGG....GGG", "GGGG..GGGG"] } ] }
```

Rows are top first and 10 cells wide: `.` empty, `G` garbage, `IJLOSTZ` blocks.
Use piece letters for the setup pieces the page shows being placed. The
generator uses them to make build variants and to find the depicted finishing
piece. Double-check each transcription against the page: count the cells in
every row.

## 4. Build

```
npm run build-pack -- scripts/pack-configs/<slug>.json
```

It prints counts and writes `packs/<slug>.json` and `packs/<slug>.report.md`.
For each diagram, the generator:
- **ready**: the board as drawn, with the depicted finishing piece removed, is
  solvable with just the finisher. A diagram with a full row (a "drop + line
  clear" setup) has that row cleared first.
- **build variants**: up to `variants` setup pieces nearest the goal are moved
  from the board into the queue. A variant is kept only if the finisher alone no
  longer works.
- **completion**: a partial diagram is completed by the shortest 1–2 extra pieces
  (1 when the goal has no fixed finisher).

Mirroring isn't a separate step. Every puzzle has a mirror toggle in the app,
and the validator checks the mirrored versions.

Read the report's **Dropped** list:
- `unknown cell code "XY"`: the page uses a cell code the parser doesn't know.
  Look at the raw wikitext to see what it means, add it to `diagramToBoard` in
  `scripts/lib/harddrop-wiki.ts` with a test in `tests/harddrop.test.ts`, and
  rebuild.
- `shows a line clear in progress`: rows of `-` show the clear animation. These
  are expected and fine to drop.
- `no <goal> even with extra pieces`: either the diagram isn't a setup for this
  goal (fine to drop) or the goal or include list is wrong. Look at a couple of
  them before deciding.
- `unsupported row template`: a row template other than `pfrow` (e.g. a different
  board-diagram template). Extend `parseWikitext` if there are many.

Then check a few puzzles by eye (`node -e` over the JSON: name, queue, board):
names should be meaningful, queues should be short, and nothing should look
like a broken transcription.

## 5. Verify

```
npm test
npm run validate-packs
npx tsc --noEmit
```

Everything must pass. Mirror failures in the validator are warnings: SRS+ 180°
kicks aren't left/right symmetric, so a few mirrored Iso-style spins don't exist.

## 6. Summarize

Tell the user:
- the pack file, title, and goal;
- the puzzle count, split into ready / build variants / completions, per section;
- what was dropped or skipped and why (point to `packs/<slug>.report.md`), and
  which sections you left out of `include`;
- any code you changed (new goal, new cell code) and the test you added for it;
- that it's in the app under Puzzles. If the dev server is running it hot-reloads;
  otherwise `npm run dev`.

Don't commit unless the user asks.
