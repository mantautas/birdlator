// Fetches the Wikipedia "List of birds of Europe" wikitext and extracts
// scientific names + status tags into data/europe-species.tsv.
// Run: node scripts/fetch-europe-list.mjs
import { writeFile } from "node:fs/promises";

const SOURCE = "https://en.wikipedia.org/w/index.php?title=List_of_birds_of_Europe&action=raw";
const OUT = new URL("../data/europe-species.tsv", import.meta.url);

const res = await fetch(SOURCE, { headers: { "user-agent": "birdlator-build/1.0" } });
if (!res.ok) throw new Error(`Wikipedia fetch failed: ${res.status}`);
const text = await res.text();

// Lines look like: *[[Mute swan]], ''Cygnus olor'' (I, A-[[Azores]])
const re = /^\*\s*\[\[(?:[^\]|]*\|)?([^\]]+)\]\],?\s*''([A-Z][a-z]+ [a-z-]+)''\s*(?:\(([^)]*)\))?/gm;
const rows = [];
const seen = new Set();
for (const m of text.matchAll(re)) {
  const [, english, scientific, tags = ""] = m;
  if (seen.has(scientific)) continue;
  seen.add(scientific);
  // Strip wiki links from tags, e.g. "A-[[Azores]]" -> "A-Azores"
  const status = tags.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, "$1").trim();
  rows.push([scientific, english.trim(), status]);
}

const header = "# Source: https://en.wikipedia.org/wiki/List_of_birds_of_Europe (fetched " +
  new Date().toISOString().slice(0, 10) + ")\n# scientific\tenglish (Wikipedia)\tstatus tags\n";
await writeFile(OUT, header + rows.map((r) => r.join("\t")).join("\n") + "\n");
console.log(`Wrote ${rows.length} species to ${OUT.pathname}`);
