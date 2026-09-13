// Builds public/birds.json from:
//   data/ioc-multilingual-15.2.xlsx  (IOC World Bird List, multilingual version)
//   data/europe-species.tsv          (which species to include; from fetch-europe-list.mjs)
//   data/overrides.json              (manual fixes / additions)
//   data/ebird-taxonomy.csv          (eBird species codes; fetched if missing)
// Run: node scripts/build-data.mjs
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import * as XLSX from "xlsx/xlsx.mjs";

const root = new URL("../", import.meta.url);
const p = (rel) => new URL(rel, root);

const IOC_FILE = "data/ioc-multilingual-15.2.xlsx";
const IOC_SCI_COLUMN = "IOC_15.2";
const EBIRD_TAXONOMY = "data/ebird-taxonomy.csv";
const EBIRD_TAXONOMY_URL = "https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=csv&cat=species";

// ---- Load IOC multilingual list ------------------------------------------
const wb = XLSX.read(await readFile(p(IOC_FILE)));
const ioc = XLSX.utils.sheet_to_json(wb.Sheets.List);
const bySci = new Map(ioc.map((r) => [r[IOC_SCI_COLUMN], r]));
// Also index by English name so we can recover from taxonomy differences
// (Wikipedia follows AviList; a few binomials differ from IOC).
const byEn = new Map(ioc.map((r) => [norm(r.English), r]));

// ---- Load eBird species codes --------------------------------------------
const ebirdBySci = await loadEbirdCodes();

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
const noEbird = [];
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
  const sciName = row[IOC_SCI_COLUMN];
  const en = patch.en ?? row.English;
  const ebird = ebirdBySci.get(sciName) ?? ebirdBySci.get(en) ?? "";
  if (!ebird) noEbird.push(en);
  birds.push({
    sci: sciName,
    en,
    lt,
    order: titleCase(row.Order),
    family: row.Family,
    status: e.status,
    ebird,
  });
}
for (const x of extra) birds.push({ status: "", order: "", family: "", ebird: "", ...x });

// Dedupe by scientific name (English-name fallback could collapse two rows)
const seen = new Set();
const out = birds.filter((b) => (seen.has(b.sci) ? false : (seen.add(b.sci), true)));

await mkdir(p("public"), { recursive: true });
await writeFile(
  p("public/birds.json"),
  JSON.stringify({
    source: "IOC World Bird List v15.2; species list: Wikipedia 'List of birds of Europe'; eBird taxonomy",
    count: out.length,
    birds: out,
  }),
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
if (noEbird.length) {
  console.log(`\n${noEbird.length} species without an eBird code:`);
  for (const n of noEbird) console.log(`  ${n}`);
}

async function loadEbirdCodes() {
  try {
    await access(p(EBIRD_TAXONOMY));
  } catch {
    console.log(`Fetching ${EBIRD_TAXONOMY_URL}…`);
    const res = await fetch(EBIRD_TAXONOMY_URL, { headers: { "user-agent": "birdlator-build/1.0" } });
    if (!res.ok) throw new Error(`eBird taxonomy fetch failed: ${res.status}`);
    await writeFile(p(EBIRD_TAXONOMY), await res.text());
  }
  const csv = await readFile(p(EBIRD_TAXONOMY), "utf8");
  const lines = csv.trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const sciIdx = header.indexOf("SCIENTIFIC_NAME");
  const enIdx = header.indexOf("COMMON_NAME");
  const codeIdx = header.indexOf("SPECIES_CODE");
  const map = new Map();
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const code = cols[codeIdx];
    if (!code) continue;
    map.set(cols[sciIdx], code);
    map.set(cols[enIdx], code); // English fallback for IOC/eBird binomial mismatches
  }
  return map;
}

function parseCsvLine(line) {
  const cols = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === "," && !inQ) {
      cols.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  cols.push(cur);
  return cols;
}

function norm(s) {
  return (s ?? "").toLowerCase().replace(/[-\u2019']/g, " ").replace(/\s+/g, " ").trim();
}
function titleCase(s) {
  return s ? s.charAt(0) + s.slice(1).toLowerCase() : "";
}
