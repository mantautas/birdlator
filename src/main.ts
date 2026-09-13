import "./style.css";
import data from "../public/birds.json";
import { BirdIndex, FIELDS, type Bird, type Field, type Match, type Range } from "./search";

const index = new BirdIndex((data as { birds: Bird[] }).birds);

const input = document.querySelector<HTMLInputElement>("#q")!;
const results = document.querySelector<HTMLElement>("#results")!;
const status = document.querySelector<HTMLElement>("#status")!;
const clearBtn = document.querySelector<HTMLButtonElement>("#clear")!;

const LABEL: Record<Field, string> = { en: "EN", lt: "LT", sci: "LAT" };

const STATUS_LABEL: Record<string, string> = {
  A: "vagrant",
  I: "introduced",
  E: "endemic",
  Ex: "extinct in Europe",
  Ext: "extinct",
};

/** Default eBird map viewport (Vilnius area) + year-round / all-years filters. */
function ebirdMapUrl(speciesCode: string): string {
  const q = new URLSearchParams({
    neg: "true",
    "env.minX": "25.037886585614714",
    "env.minY": "54.60279668057792",
    "env.maxX": "25.436140980145964",
    "env.maxY": "54.72808831662741",
    zh: "true",
    gp: "false",
    ev: "Z",
    excludeExX: "false",
    excludeExAll: "false",
    mr: "1-12",
    bmo: "1",
    emo: "12",
    yr: "all",
    byr: "1900",
    eyr: String(new Date().getFullYear()),
  });
  return `https://ebird.org/map/${encodeURIComponent(speciesCode)}?${q}`;
}

function render(query: string) {
  const q = query.trim();
  clearBtn.hidden = q === "";
  if (!q) {
    results.replaceChildren();
    status.textContent = `${index.size} species catalogued · English, Lithuanian or Latin`;
    return;
  }
  const matches = index.search(q, 50);
  status.textContent = matches.length
    ? `${matches.length === 50 ? "50+" : matches.length} match${matches.length === 1 ? "" : "es"}`
    : "No matches";
  results.replaceChildren(...matches.map(card));
}

function card(m: Match): HTMLElement {
  const li = document.createElement("li");
  li.className = "card";

  // Show the matched language first, then the others in fixed order.
  const order: Field[] = [m.field, ...FIELDS.filter((f) => f !== m.field)];
  for (const field of order) {
    const value = m.bird[field];
    const row = document.createElement("div");
    row.className = `row row-${field}${field === m.field ? " row-hit" : ""}`;

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = LABEL[field];
    row.append(label);

    const name = document.createElement("span");
    name.className = "name";
    if (value) {
      name.append(...highlight(value, m.highlights[field]));
    } else {
      name.textContent = "—";
      name.classList.add("missing");
      name.title = "No Lithuanian name in the IOC list";
    }
    row.append(name);

    if (value) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy";
      copy.title = "Copy";
      copy.setAttribute("aria-label", `Copy ${value}`);
      copy.textContent = "Copy";
      copy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(value);
        copy.textContent = "Copied";
        copy.classList.add("done");
        setTimeout(() => {
          copy.textContent = "Copy";
          copy.classList.remove("done");
        }, 1000);
      });
      row.append(copy);
    }
    li.append(row);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  const tax = document.createElement("span");
  tax.textContent = `${m.bird.order} · ${m.bird.family}`;
  meta.append(tax);

  const tag = statusTag(m.bird.status);
  if (tag) meta.append(tag);

  const links = document.createElement("span");
  links.className = "links";
  links.append(
    link(`https://en.wikipedia.org/wiki/${encodeURIComponent(m.bird.en.replace(/ /g, "_"))}`, "Wiki EN"),
  );
  if (m.bird.lt) {
    const title = m.bird.lt.charAt(0).toUpperCase() + m.bird.lt.slice(1);
    links.append(link(`https://lt.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`, "Wiki LT"));
  }
  if (m.bird.ebird) {
    links.append(link(ebirdMapUrl(m.bird.ebird), "eBird map"));
  }
  meta.append(links);
  li.append(meta);
  return li;
}

function statusTag(statusStr: string): HTMLElement | null {
  if (!statusStr) return null;
  const labels = statusStr
    .split(",")
    .map((s) => s.trim())
    .map((s) => {
      const [code, place] = s.split("-");
      const base = STATUS_LABEL[code] ?? code;
      return place ? `${base} (${place})` : base;
    });
  const span = document.createElement("span");
  span.className = "tag";
  if (/\b(A|Ex|Ext)\b/.test(statusStr)) span.classList.add("vagrant");
  span.textContent = labels.join(", ");
  return span;
}

function link(href: string, text: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = text;
  return a;
}

function highlight(text: string, ranges: Range[]): (string | HTMLElement)[] {
  if (!ranges.length) return [text];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: (string | HTMLElement)[] = [];
  let pos = 0;
  for (const [s, e] of sorted) {
    if (s < pos) continue; // overlapping
    if (s > pos) out.push(text.slice(pos, s));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(s, e);
    out.push(mark);
    pos = e;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

// --- wiring -----------------------------------------------------------------

function setQuery(q: string, pushUrl = true) {
  input.value = q;
  render(q);
  if (pushUrl) {
    const url = new URL(location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    history.replaceState(null, "", url);
  }
}

input.addEventListener("input", () => setQuery(input.value));
input.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setQuery("");
});
clearBtn.addEventListener("click", () => {
  setQuery("");
  input.focus();
});

setQuery(new URLSearchParams(location.search).get("q") ?? "", false);
input.focus();
