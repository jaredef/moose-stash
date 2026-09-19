// moosebench — a workload suite: moose-stash vs mustache.js on the most common
// and the hardest Mustache jobs.
//
// Each job defines a template + data. We (1) check output parity between the two
// engines (so we're timing equivalent work, and so we surface where mustache.js
// diverges or cannot run the job at all), then (2) time throughput for each.
//
// Both engines cache parsed templates, so render() is the like-for-like call.
// Escaped content avoids "/" (mustache.js escapes it, moose does not — a known,
// spec-irrelevant difference) so the common jobs compare byte-for-byte.
//
// Run: npm run moosebench   (Node 22+, --experimental-strip-types)

import Mustache from "mustache";
import { render as moose, type Partials } from "../src/index.ts";

type Job = {
  name: string;
  cat: "common" | "hard";
  template: string;
  data: unknown;
  partials?: Partials;
  iters: number;
  note?: string;
};

// ---- data helpers ---------------------------------------------------------

const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
const word = (i: number) => WORDS[i % WORDS.length];
const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    n: i + 1,
    name: `${word(i)} <${i}>`, // exercises escaping (< > &)
    email: `${word(i)}&${i}@example.com`,
    active: i % 3 !== 0,
    score: (i * 7) % 100,
  }));

function tree(depth: number, branch: number, id = "0"): unknown {
  return {
    id,
    label: `node-${id}`,
    children: depth <= 0 ? [] : Array.from({ length: branch }, (_, i) => tree(depth - 1, branch, `${id}.${i}`)),
  };
}

// ---- jobs -----------------------------------------------------------------

const JOBS: Job[] = [
  // ---------- COMMON ----------
  {
    name: "greeting",
    cat: "common",
    template: "Hello, {{name}}! You have {{count}} new {{#one}}message{{/one}}{{^one}}messages{{/one}}.",
    data: { name: "Ada", count: 3, one: false },
    iters: 200_000,
    note: "the 90% case — a few interpolations + a conditional",
  },
  {
    name: "user-card (HTML)",
    cat: "common",
    template:
      "<div class=\"card\">\n  <h2>{{name}}</h2>\n  <p class=\"bio\">{{bio}}</p>\n  <ul>\n  {{#fields}}<li><b>{{k}}:</b> {{v}}</li>\n  {{/fields}}</ul>\n  {{#admin}}<span class=\"badge\">admin</span>{{/admin}}\n</div>\n",
    data: {
      name: "Grace <Hopper>",
      bio: "Compiler pioneer & \"debugging\" namer",
      admin: true,
      fields: [{ k: "team", v: "core" }, { k: "since", v: 1952 }, { k: "role", v: "captain" }],
    },
    iters: 100_000,
    note: "escaping + a small list + a conditional",
  },
  {
    name: "table-100 (HTML)",
    cat: "common",
    template:
      "<table>\n<thead><tr><th>#</th><th>name</th><th>email</th><th>score</th></tr></thead>\n<tbody>\n{{#rows}}<tr class=\"{{#active}}on{{/active}}{{^active}}off{{/active}}\"><td>{{n}}</td><td>{{name}}</td><td>{{email}}</td><td>{{score}}</td></tr>\n{{/rows}}</tbody>\n</table>\n",
    data: { rows: rows(100) },
    iters: 5_000,
    note: "the bread-and-butter list render, with escaping + per-row class",
  },
  {
    name: "layout (partials)",
    cat: "common",
    template: "{{> header}}\n<main>\n{{> nav}}\n<article>{{{body}}}</article>\n</main>\n{{> footer}}\n",
    partials: {
      header: "<header><h1>{{title}}</h1></header>",
      nav: "<nav><ul>{{#links}}<li><a>{{label}}</a></li>{{/links}}</ul></nav>",
      footer: "<footer>© {{year}} {{title}}</footer>",
    },
    data: { title: "moose & co", year: 2026, body: "<p>welcome</p>", links: [{ label: "home" }, { label: "docs" }, { label: "about" }] },
    iters: 40_000,
    note: "header/nav/content/footer composition — very common in web apps",
  },
  {
    name: "email (mixed)",
    cat: "common",
    template:
      "Hi {{name}},\n\n{{#premium}}Thanks for being a premium member!{{/premium}}{{^premium}}Upgrade any time.{{/premium}}\n\nYour {{items.length}} recent orders:\n{{#items}}  - {{title}} ({{qty}}×) — ${{price}}\n{{/items}}\nTotal: ${{total}}\n\n{{#coupon}}Use code {{coupon}} for 10% off.\n{{/coupon}}Unsubscribe: {{unsub}}\n",
    data: {
      name: "Sam", premium: true, total: 84,
      items: [{ title: "Widget", qty: 2, price: 12 }, { title: "Gadget", qty: 1, price: 60 }],
      coupon: "SAVE10", unsub: "settings",
    },
    iters: 60_000,
    note: "a real transactional email: greeting, conditionals, a list, a footer",
  },

  // ---------- HARD ----------
  {
    name: "deep-context (6 levels)",
    cat: "hard",
    template:
      "{{#a}}{{top}}|{{#b}}{{top}}{{mid}}|{{#c}}{{top}}{{mid}}{{deep}}|{{#d}}{{top}}{{mid}}{{deep}}{{x}}|{{#e}}{{top}}{{mid}}{{deep}}{{x}}{{y}}|{{#f}}{{top}}{{mid}}{{deep}}{{x}}{{y}}{{z}}{{/f}}{{/e}}{{/d}}{{/c}}{{/b}}{{/a}}",
    data: { a: { top: "T" }, b: { mid: "M" }, c: { deep: "D" }, d: { x: "X" }, e: { y: "Y" }, f: { z: "Z" } },
    iters: 100_000,
    note: "6-deep nested sections; every leaf walks the whole context stack",
  },
  {
    name: "big-list-2000",
    cat: "hard",
    template: "{{#rows}}{{n}}:{{name}}:{{email}}:{{#active}}A{{/active}}{{^active}}-{{/active}}\n{{/rows}}",
    data: { rows: rows(2000) },
    iters: 400,
    note: "2000 rows, per-row conditional + escaping-heavy fields",
  },
  {
    name: "recursive-tree (partial)",
    cat: "hard",
    template: "{{> node}}",
    partials: { node: "{{label}}\n{{#children}}{{> node}}{{/children}}" },
    data: tree(5, 3), // 1 + 3 + 9 + 27 + 81 + 243 = 364 nodes
    iters: 2_000,
    note: "a self-recursive partial rendering a 364-node tree",
  },
  {
    name: "delimiter-switching",
    cat: "hard",
    template: "{{=<% %>=}}<% greeting %>, <%={{ }}=%>{{name}}! {{=[[ ]]=}}[[ tail ]]",
    data: { greeting: "Hi", name: "Neo", tail: "done" },
    iters: 100_000,
    note: "config-gen style: delimiters change three times mid-template",
  },

  // ---------- HARD — moose capabilities mustache.js lacks or differs on ----------
  {
    name: "interpolation lambda",
    cat: "hard",
    template: "{{salute}}, {{name}}!",
    data: { name: "world", salute: () => "Hello {{name}}".replace("{{name}}", "there") },
    iters: 100_000,
    note: "a value that is a function returning a string — the portable lambda both engines run",
  },
  {
    name: "section lambda (render-cb)",
    cat: "hard",
    template: "{{#upper}}{{greeting}}{{/upper}} {{name}} {{#wrap}}note{{/wrap}}",
    data: {
      greeting: "hello",
      name: "world",
      upper: (text: string, render: (s: string) => string) => render(text).toUpperCase(),
      wrap: (text: string, render: (s: string) => string) => `[${render(text)}]`,
    },
    iters: 100_000,
    note: "section lambdas using the spec's render callback — mustache.js 4.x passes no callback, so moose-only",
  },
  {
    name: "inheritance (layout)",
    cat: "hard",
    template: "{{<base}}{{$title}}Dashboard{{/title}}{{$body}}<p>{{user}}'s stuff</p>{{/body}}{{/base}}",
    partials: { base: "<html><head><title>{{$title}}Untitled{{/title}}</title></head><body>{{$body}}nothing{{/body}}</body></html>" },
    data: { user: "Ada" },
    iters: 100_000,
    note: "parametric-partial layout with block overrides — mustache.js can't do this",
  },
];

// ---- run ------------------------------------------------------------------

function renderMustache(j: Job): string {
  return Mustache.render(j.template, j.data, j.partials ?? {});
}
function renderMoose(j: Job): string {
  return moose(j.template, j.data, j.partials ?? {});
}

function time(fn: () => void, iters: number): number {
  for (let i = 0; i < Math.min(iters, 500); i++) fn(); // warmup
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / iters; // ns/render
}

const us = (ns: number) => (ns / 1000).toFixed(2);
function status(j: Job): "match" | "diverge" | "unsupported" {
  let mo: string | null = null, mu: string | null = null;
  try { mo = renderMoose(j); } catch { mo = null; }
  try { mu = renderMustache(j); } catch { return "unsupported"; }
  return mo !== null && mo === mu ? "match" : "diverge";
}

console.log(`moosebench — moose-stash vs mustache.js 4.x   (Node ${process.version})\n`);
console.log("  job                         parity      moose µs   mustache µs   speed");
console.log("  " + "-".repeat(76));

let sink = 0;
let curCat = "";
for (const j of JOBS) {
  if (j.cat !== curCat) { curCat = j.cat; console.log(`  ── ${curCat.toUpperCase()} ${"─".repeat(70 - curCat.length)}`); }
  const st = status(j);
  const moosePer = time(() => { sink += renderMoose(j).length; }, j.iters);
  let muCol = "        —", speed = "moose-only";
  if (st !== "unsupported") {
    const mustPer = time(() => { sink += renderMustache(j).length; }, j.iters);
    muCol = us(mustPer).padStart(9);
    speed = (mustPer / moosePer).toFixed(2) + "×";
  }
  const parity = st === "match" ? "  ✓ match" : st === "diverge" ? "  ~ differ" : "  ✗ n/a  ";
  console.log(`  ${j.name.padEnd(26)} ${parity}  ${us(moosePer).padStart(8)}   ${muCol}   ${speed.padStart(10)}`);
}
if (sink < 0) console.log("");

console.log("\n  parity: ✓ identical output · ~ engines differ (see notes) · ✗ mustache.js cannot render");
console.log("  speed:  mustache-µs ÷ moose-µs  (>1 = moose faster).  Both engines cache parses.");
console.log("\n  Notes:");
for (const j of JOBS) if (j.note) console.log(`    ${j.name.padEnd(26)} ${j.note}`);
