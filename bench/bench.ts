// Benchmark + parity: moose-stash vs the reference mustache.js (4.x).
//
// Two questions:
//   1. Parity — do the two engines produce identical output on the spec corpus?
//   2. Throughput — how fast is each, on realistic workloads?
//
// Honest-comparison notes:
//   - mustache.js caches parsed templates by source string; moose-stash re-parses
//     every render() call. We measure BOTH the cached path (as users call
//     `render`) and a parse-every-time path (mustache cache cleared per render),
//     so the difference is visible rather than hidden.
//   - mustache.js does not implement inheritance ({{<}}/{{$}}) or dynamic names
//     ({{>*}}), so parity is reported per module.
//
// Run: npm run bench   (Node 22+, --experimental-strip-types)

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import Mustache from "mustache";
import { render as moose, type Partials } from "../src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = join(HERE, "..", "spec");

type Case = { name: string; data: unknown; template: string; expected: string; partials?: Partials };

function reviveLambdas(v: unknown): unknown {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.__tag__ === "code" && typeof o.js === "string") return new Function(`return (${o.js})`)();
    if (Array.isArray(v)) return v.map(reviveLambdas);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = reviveLambdas(o[k]);
    return out;
  }
  return v;
}

function loadModule(file: string): { module: string; tests: Case[] } {
  return { module: basename(file, ".json").replace(/^~/, ""), tests: JSON.parse(readFileSync(join(SPEC, file), "utf8")).tests };
}

const ALL = readdirSync(SPEC).filter((f) => f.endsWith(".json")).map(loadModule);

// ---- 1. Parity ------------------------------------------------------------

function renderMustache(t: Case): string {
  return Mustache.render(t.template, reviveLambdas(t.data), t.partials ?? {});
}
function renderMoose(t: Case): string {
  return moose(t.template, reviveLambdas(t.data), t.partials ?? {});
}

console.log("PARITY vs mustache.js 4.x (spec corpus)\n");
console.log("  module           moose=spec   mustache=spec   moose≡mustache");
let pMoose = 0, pMust = 0, pAgree = 0, total = 0;
for (const { module, tests } of ALL) {
  let ms = 0, mu = 0, ag = 0;
  for (const t of tests) {
    total++;
    let mooseOut: string | null = null, mustOut: string | null = null;
    try { mooseOut = renderMoose(t); } catch { mooseOut = null; }
    try { mustOut = renderMustache(t); } catch { mustOut = null; }
    if (mooseOut === t.expected) ms++;
    if (mustOut === t.expected) mu++;
    if (mooseOut !== null && mooseOut === mustOut) ag++;
  }
  pMoose += ms; pMust += mu; pAgree += ag;
  console.log(`  ${module.padEnd(16)} ${String(ms + "/" + tests.length).padStart(8)}   ${String(mu + "/" + tests.length).padStart(11)}   ${String(ag + "/" + tests.length).padStart(12)}`);
}
console.log(`  ${"TOTAL".padEnd(16)} ${String(pMoose + "/" + total).padStart(8)}   ${String(pMust + "/" + total).padStart(11)}   ${String(pAgree + "/" + total).padStart(12)}`);

// ---- 2. Throughput --------------------------------------------------------

// Workload A: the spec core corpus (small, varied real templates).
const CORE = ALL.filter((m) => !m.tests[0] || !readdirSync(SPEC).includes(`~${m.module}.json`))
  .filter((m) => ["comments", "delimiters", "interpolation", "inverted", "partials", "sections"].includes(m.module))
  .flatMap((m) => m.tests.map((t) => ({ template: t.template, data: t.data, partials: t.partials ?? {} })));

// Workload B: a section-heavy list render (the common real-world shape).
const LIST_TMPL = "<ul>\n{{#items}}  <li>{{n}}. {{name}} — {{#active}}on{{/active}}{{^active}}off{{/active}}</li>\n{{/items}}</ul>\n";
const LIST_DATA = { items: Array.from({ length: 50 }, (_, i) => ({ n: i + 1, name: `item <${i}>`, active: i % 2 === 0 })) };
const LIST = [{ template: LIST_TMPL, data: LIST_DATA, partials: {} as Partials }];

type Work = { template: string; data: unknown; partials: Partials };

function time(label: string, fn: () => void, iters: number): number {
  // warmup
  for (let i = 0; i < Math.min(iters, 200); i++) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const t1 = process.hrtime.bigint();
  const ns = Number(t1 - t0);
  return ns / iters; // ns per iteration
}

function benchWorkload(name: string, work: Work[], passes: number) {
  const rendersPerPass = work.length;
  let sink = 0;
  const moosePer = time(`moose ${name}`, () => { for (const w of work) sink += moose(w.template, w.data, w.partials).length; }, passes);
  // mustache with its internal parse cache (default)
  const mustCachedPer = time(`must ${name}`, () => { for (const w of work) sink += Mustache.render(w.template, w.data, w.partials).length; }, passes);
  // mustache clearing cache each pass -> parse every render (apples-to-apples with moose)
  const mustUncachedPer = time(`mustNoCache ${name}`, () => { Mustache.clearCache(); for (const w of work) sink += Mustache.render(w.template, w.data, w.partials).length; }, passes);

  const perRender = (nsPerPass: number) => nsPerPass / rendersPerPass;
  const rps = (nsPerRender: number) => (1e9 / nsPerRender);
  if (sink < 0) console.log("");
  console.log(`\n  ${name}  (${rendersPerPass} renders/pass × ${passes} passes)`);
  console.log(`    moose-stash            ${(perRender(moosePer) / 1000).toFixed(2).padStart(8)} µs/render   ${Math.round(rps(perRender(moosePer))).toLocaleString().padStart(12)} renders/s`);
  console.log(`    mustache (cached)      ${(perRender(mustCachedPer) / 1000).toFixed(2).padStart(8)} µs/render   ${Math.round(rps(perRender(mustCachedPer))).toLocaleString().padStart(12)} renders/s`);
  console.log(`    mustache (parse each)  ${(perRender(mustUncachedPer) / 1000).toFixed(2).padStart(8)} µs/render   ${Math.round(rps(perRender(mustUncachedPer))).toLocaleString().padStart(12)} renders/s`);
  console.log(`    → moose vs mustache(cached): ${(perRender(mustCachedPer) / perRender(moosePer)).toFixed(2)}×   vs mustache(parse-each): ${(perRender(mustUncachedPer) / perRender(moosePer)).toFixed(2)}×`);
}

console.log("\n\nTHROUGHPUT  (Node " + process.version + ")");
benchWorkload("spec-core corpus", CORE as Work[], 3000);
benchWorkload("50-item list", LIST as Work[], 20000);
console.log("");
