// Builds public/birds.json from:
//   data/ioc-multilingual-15.2.xlsx  (IOC World Bird List, multilingual version)
//   data/europe-species.tsv          (which species to include; from fetch-europe-list.mjs)
//   data/overrides.json              (manual fixes / additions)
// Run: node scripts/build-data.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import * as XLSX from "xlsx/xlsx.mjs";

const root = new URL("../", import.meta.url);
const p = (rel) => new URL(rel, root);

const IOC_FILE = "data/ioc-multilingual-15.2.xlsx";
const IOC_SCI_COLUMN = "IOC_15.2";

// ---- Load IOC multilingual list ------------------------------------------
const wb = XLSX.read(await readFile(p(IOC_FILE)));
const ioc = XLSX.utils.sheet_to_json(wb.Sheets.List);
const bySci = new Map(ioc.map((r) => [r[IOC_SCI_COLUMN], r]));
// Also index by English name so we can recover from taxonomy differences
// (Wikipedia follows AviList; a few binomials differ from IOC).
const byEn = new Map(ioc.map((r) => [norm(r.English), r]));

// ---- Load overrides ------------------------------------------------------
const overrides = JSON.parse(await readFile(p("data/overrides.json"), "utf8"));
const synonyms = overrides.synonyms ?? {}; // { "Wikipedia binomial": "IOC binomial" }
const patches = overrides.patches ?? {}; // { "IOC binomial": { lt?: string, en?: string } }
const extra = overrides.extra ?? []; // [{ sci, en, lt, order?, family? }]

// ---- Load Europe list ----------------------------------------------------
const tsv = await readFile(p("data/europe-species.tsv"), "utf8");
const europe = tsv
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => {
    const [sci, en, status = ""] = l.split("\t");
    return { sci, en, status };
  });

// ---- Join ----------------------------------------------------------------
const birds = [];
const missing = [];
const noLt = [];
for (const e of europe) {
  const sci = synonyms[e.sci] ?? e.sci;
  const row = bySci.get(sci) ?? byEn.get(norm(e.en));
  if (!row) {
    missing.push(e);
    continue;
  }
  const patch = patches[row[IOC_SCI_COLUMN]] ?? {};
  const lt = patch.lt ?? row.Lithuanian ?? "";
  if (!lt) noLt.push(row.English);
  birds.push({
    sci: row[IOC_SCI_COLUMN],
    en: patch.en ?? row.English,
    lt,
    order: titleCase(row.Order),
    family: row.Family,
    status: e.status,
  });
}
for (const x of extra) birds.push({ status: "", order: "", family: "", ...x });

// Dedupe by scientific name (English-name fallback could collapse two rows)
const seen = new Set();
const out = birds.filter((b) => (seen.has(b.sci) ? false : (seen.add(b.sci), true)));

await mkdir(p("public"), { recursive: true });
await writeFile(
  p("public/birds.json"),
  JSON.stringify({ source: "IOC World Bird List v15.2; species list: Wikipedia 'List of birds of Europe'", count: out.length, birds: out }),
);

console.log(`Wrote ${out.length} birds to public/birds.json`);
if (missing.length) {
  console.log(`\n${missing.length} Europe-list species not found in IOC (add to overrides.synonyms):`);
  for (const m of missing) console.log(`  ${m.sci}\t${m.en}`);
}
if (noLt.length) {
  console.log(`\n${noLt.length} species without a Lithuanian name (add to overrides.patches):`);
  for (const n of noLt) console.log(`  ${n}`);
}

function norm(s) {
  return (s ?? "").toLowerCase().replace(/[-\u2019']/g, " ").replace(/\s+/g, " ").trim();
}
function titleCase(s) {
  return s ? s.charAt(0) + s.slice(1).toLowerCase() : "";
}
