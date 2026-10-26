/**
 * Lists a Hard Drop wiki page's sections with their diagram and image counts,
 * to pick `include` paths for a pack config.
 *
 *   npm run pack-sections -- https://harddrop.com/wiki/T-Spin_Double_Setups
 */
import { join, resolve } from "node:path";
import { diagramToBoard, fetchWikitext, parseWikitext } from "./lib/harddrop-wiki";

const target = process.argv[2];
if (!target) {
  console.error("usage: npm run pack-sections -- <harddrop url or page title>");
  process.exit(2);
}
const { url, text } = await fetchWikitext(target, join(resolve(import.meta.dirname, ".."), ".cache", "wiki"));
const page = parseWikitext(text);

const rows = new Map<string, { diagrams: number; unreadable: number; images: number; titles: Set<string> }>();
const row = (sections: string[]) => {
  const k = sections.join("/") || "(top)";
  if (!rows.has(k)) rows.set(k, { diagrams: 0, unreadable: 0, images: 0, titles: new Set() });
  return rows.get(k)!;
};
for (const d of page.diagrams) {
  const r = row(d.sections);
  r.diagrams++;
  if (!diagramToBoard(d.codes).ok) r.unreadable++;
  if (d.title) r.titles.add(d.title);
}
for (const img of page.images) row(img.sections).images++;

console.log(url);
for (const [k, r] of rows) {
  const titles = [...r.titles].slice(0, 6).join(", ");
  console.log(`- ${k}: ${r.diagrams} diagrams${r.unreadable ? ` (${r.unreadable} unreadable)` : ""}, ${r.images} images${titles ? ` · ${titles}${r.titles.size > 6 ? ", ..." : ""}` : ""}`);
}
if (page.unsupported.length) console.log(`Unsupported row templates: ${page.unsupported.length}`);
