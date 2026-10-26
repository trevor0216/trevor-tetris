import { describe, expect, it } from "vitest";
import { diagramToBoard, parseWikitext, plainText, rawUrl } from "../scripts/lib/harddrop-wiki";
import { generateFromDiagram } from "../scripts/lib/puzzle-gen";
import { verifyPlacements } from "../src/solver/verify";

// Shaped like the real T-Spin_Triple_Setups wikitext (Iso TST section).
const SAMPLE = `== Others TST ==

{{clear}}  '''Iso T-spin Triple (TrIso)'''

Some text about [[TETR.IO]].
{|
|- valign="top"
|{{pfstart}}
{{pfrowblank}}
{{pfrow| | | | | | |T| | | }}
{{pfrow|G|G|G|G|G|T|T|G|G|G}}
{{pfrow|G|G|G| | | |T|G|G|G}}
{{pfrow|G|G|G|G| |G|G|G|G|G}}
{{pfrow|G|G|G| | |G|G|G|G|G}}
{{pfrow|G|G|G|G| |G|G|G|G|G}}
{{pfend}}
Soft drop
|{{pfstart}}
{{pfrowblank}}
{{pfrow|G|G|G|G|G| | |G|G|G}}
{{pfrow|G|G|G| | | | |G|G|G}}
{{pfrow|G|G|G|G|P|G|G|G|G|G}}
{{pfrow|G|G|G|P|P|G|G|G|G|G}}
{{pfrow|G|G|G|G|P|G|G|G|G|G}}
{{pfend}}
Clockwise<br>again
|}
[[File:Some diagram.png]]

== Openings ==
'''Cuts'''
{|
|{{pfstart}}
{{pfrow|Z|Z| | | | | | | | }}
{{pfrow|-|-|-|-|-|-|-|-|-|-}}
{{pfrow|L| | |g|g|g|g|g|g|g}}
{{pfend}}
Stack and clear
|}
`;

describe("wikitext parsing", () => {
  const page = parseWikitext(SAMPLE);

  it("finds diagrams with sections, titles, tables, steps and captions", () => {
    expect(page.diagrams).toHaveLength(3);
    expect(page.diagrams[0]).toMatchObject({ sections: ["Others TST"], title: "Iso T-spin Triple (TrIso)", table: 0, step: 0, caption: "Soft drop" });
    expect(page.diagrams[1]).toMatchObject({ table: 0, step: 1, caption: "Clockwise again" });
    expect(page.diagrams[2]).toMatchObject({ sections: ["Openings"], title: "Cuts", table: 1, step: 0 });
    expect(page.diagrams[0].codes).toHaveLength(7);
  });

  it("logs image-only diagrams", () => {
    expect(page.images).toEqual([expect.objectContaining({ file: "Some diagram.png", sections: ["Others TST"] })]);
  });

  it("builds raw URLs from page URLs or titles", () => {
    expect(rawUrl("https://harddrop.com/wiki/T-Spin_Triple_Setups")).toBe("https://harddrop.com/wiki?title=T-Spin_Triple_Setups&action=raw");
    expect(rawUrl("T-Spin Triple Setups")).toBe("https://harddrop.com/wiki?title=T-Spin_Triple_Setups&action=raw");
  });

  it("strips wiki markup from text", () => {
    expect(plainText("'''[[C-Spin|Triple Double]]''' and<br>[[DT Cannon]]")).toBe("Triple Double and DT Cannon");
  });
});

describe("diagram → board", () => {
  const page = parseWikitext(SAMPLE);

  it("maps codes: P → T, lowercase → same block, trims empty top rows", () => {
    const r = diagramToBoard(page.diagrams[1].codes);
    expect(r.ok && r.board.rows).toEqual(["GGGGG..GGG", "GGG....GGG", "GGGGTGGGGG", "GGGTTGGGGG", "GGGGTGGGGG"]);
    expect(r.ok && r.board.tGroups).toHaveLength(1);
  });

  it("rejects diagrams that show a line clear in progress", () => {
    expect(diagramToBoard(page.diagrams[2].codes)).toEqual({ ok: false, reason: "shows a line clear in progress" });
  });

  it("reads two-letter block codes (SG, ST) as the same blocks", () => {
    const r = diagramToBoard([[..."SG SG ST ST ST SG SG SG SG SG".split(" ")]]);
    expect(r.ok && r.board.rows).toEqual(["GGTTTGGGGG"]);
    expect(r.ok && r.board.tGroups).toHaveLength(1);
  });

  it("treats ghost cells as empty and rejects unknown codes", () => {
    const r = diagramToBoard([[..."G G G G G G -T -T G G".split(" ")]]);
    expect(r.ok && r.board.rows).toEqual(["GGGGGG..GG"]);
    expect(diagramToBoard([[..."G G G G G G Q G G G".split(" ")]])).toMatchObject({ ok: false });
  });
});

describe("puzzle generation", () => {
  const page = parseWikitext(SAMPLE);
  const opts = { variants: 2, budget: 30_000, completion: true };

  it("removes the depicted T to get the pre-TST board (T hovering)", () => {
    const r = diagramToBoard(page.diagrams[0].codes);
    const [g] = generateFromDiagram(r.ok ? r.board : null!, "tst", opts);
    expect(g).toMatchObject({ kind: "pre", queue: "T", rows: ["GGGGG..GGG", "GGG....GGG", "GGGG.GGGGG", "GGG..GGGGG", "GGGG.GGGGG"] });
  });

  it("removes the depicted T when it sits in the slot (P cells)", () => {
    const r = diagramToBoard(page.diagrams[1].codes);
    const [g] = generateFromDiagram(r.ok ? r.board : null!, "tst", opts);
    expect(g.kind).toBe("pre");
    expect(g.solution[0]).toMatchObject({ piece: "T", rot: "left", x: 3, y: 0 });
  });

  it("makes build variants by moving the overhang piece into the queue", () => {
    const r = diagramToBoard([
      [..."O O . . . . . . . .".split(" ")],
      [..."O O . . . . . . . .".split(" ")],
      [..."g . . . . . . . . .".split(" ")],
      [..."g . g g g g g g g g".split(" ")],
      [..."g . . g g g g g g g".split(" ")],
      [..."g . g g g g g g g g".split(" ")],
    ].map((row) => row.map((c) => (c === "." ? " " : c))));
    const out = generateFromDiagram(r.ok ? r.board : null!, "tst", opts);
    expect(out.map((g) => g.kind)).toEqual(["pre", "variant"]);
    const v = out[1];
    expect(v).toMatchObject({ queue: "OT", removed: ["O"] });
    expect(verifyPlacements({ board: v.rows, queue: v.queue, hold: null, allowHold: true }, v.solution, "tst").ok).toBe(true);
  });

  it("completes partial diagrams with the shortest extra queue", () => {
    // The overhang is missing; one extra piece can build it.
    const r = diagramToBoard([
      [..."g . . . . . . . . .".split(" ")],
      [..."g . g g g g g g g g".split(" ")],
      [..."g . . g g g g g g g".split(" ")],
      [..."g . g g g g g g g g".split(" ")],
    ].map((row) => row.map((c) => (c === "." ? " " : c))));
    const [g] = generateFromDiagram(r.ok ? r.board : null!, "tst", opts);
    expect(g.kind).toBe("completion");
    expect(g.queue).toHaveLength(2);
    expect(g.queue.at(-1)).toBe("T");
  });

  const grid = (rows: string[]) => rows.map((row) => [...row].map((c) => (c === "." ? " " : c)));

  it("drop + line clear: clears the completed row for the ready puzzle, and the variant leaves the clear to the player", () => {
    const r = diagramToBoard(grid(["OO........", "OOGGGGGGGG", "G...GGGGGG", "GG.GGGGGGG"]));
    const out = generateFromDiagram(r.ok ? r.board : null!, "tsd", opts);
    expect(out[0]).toMatchObject({ kind: "pre", queue: "T", rows: ["OO........", "G...GGGGGG", "GG.GGGGGGG"] });
    expect(out[1]).toMatchObject({ kind: "variant", queue: "OT", rows: ["..GGGGGGGG", "G...GGGGGG", "GG.GGGGGGG"] });
    const v = out[1];
    const res = verifyPlacements({ board: v.rows, queue: v.queue, hold: null, allowHold: true }, v.solution, "tsd");
    expect(res.ok).toBe(true);
    expect(res.results.map((x) => x.lines)).toEqual([1, 2]);
  });

  it("goals without a fixed finisher: the last depicted piece becomes the queue (perfect clear)", () => {
    const r = diagramToBoard(grid(["GGGGGGIIII"]));
    const [g] = generateFromDiagram(r.ok ? r.board : null!, "pc", opts);
    expect(g).toMatchObject({ kind: "pre", queue: "I", rows: ["GGGGGG...."] });
    expect(verifyPlacements({ board: g.rows, queue: g.queue, hold: null, allowHold: true }, g.solution, "pc").results.at(-1)!.perfectClear).toBe(true);
  });
});
