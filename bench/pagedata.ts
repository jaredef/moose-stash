// pagedata — emit one coherent JSON of every benchmark number the GitHub Pages site
// bakes: the 19 workload jobs (DATA) and the 62 mustache.js exemplar-fixture timings
// (EXTIME), all measured in a single run. Run: node --experimental-strip-types
// bench/pagedata.ts > /tmp/pagedata.json
//
// EXTIME is render-only (parse cached), fastest of N windows — matching the page's
// "fastest of several timed windows" footnote.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Mustache from "mustache";
import { render as moose } from "../src/index.ts";
import { JOBS, SURFACE_JOBS, renderMoose, renderMustache, time } from "./moosebench.ts";

// min-of-N windows: return the fastest window's ns/render.
function minTime(fn: () => void, iters: number, windows = 8): number {
  let best = Infinity;
  for (let i = 0; i < 300; i++) fn(); // warmup
  for (let w = 0; w < windows; w++) best = Math.min(best, time(fn, iters));
  return best;
}
const usNum = (ns: number) => Math.round(ns / 10) / 100; // µs, 2 decimals
const usNum3 = (ns: number) => Math.round(ns) / 1000; // µs, 3 decimals

// ---- workload jobs (DATA: name -> {mo, mu, status}) ----
const jobs: Record<string, { mo: number; mu: number | null; status: string }> = {};
for (const j of JOBS) {
  let mo: string | null = null, mu: string | null = null;
  try { mo = renderMoose(j); } catch { mo = null; }
  try { mu = renderMustache(j); } catch { mu = null; }
  const status = mu === null ? "only" : mo === mu ? "match" : "diverge";
  const moNs = minTime(() => { void renderMoose(j).length; }, j.iters);
  const muNs = mu === null ? null : minTime(() => { void renderMustache(j).length; }, j.iters);
  jobs[j.name] = { mo: usNum(moNs), mu: muNs === null ? null : usNum(muNs), status };
}
for (const j of SURFACE_JOBS) {
  let mo: string | null = null, mu: string | null = null;
  try { mo = j.moose(); } catch { mo = null; }
  try { mu = j.mustache(); } catch { mu = null; }
  const status = mu === null ? "only" : mo === mu ? "match" : "diverge";
  const moNs = minTime(() => { void j.moose().length; }, j.iters);
  const muNs = mu === null ? null : minTime(() => { const r = j.mustache(); void (r ?? "").length; }, j.iters);
  jobs[j.name] = { mo: usNum(moNs), mu: muNs === null ? null : usNum(muNs), status };
}

// ---- exemplar fixtures (EXTIME: name -> [mo, mu]) ----
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "mustache-fixtures");
function loadView(name: string): unknown {
  let src = readFileSync(join(DIR, `${name}.js`), "utf8").replace(/^﻿/, "");
  try { return (0, eval)(src); } catch {
    const mod = { exports: {} as unknown };
    new Function("module", "exports", src)(mod, mod.exports);
    return mod.exports;
  }
}
const fixtures = [...new Set(readdirSync(DIR).filter((f) => /\.c?js$/.test(f)).map((f) => f.replace(/\.c?js$/, "")))].sort();
const extime: Record<string, [number, number]> = {};
for (const name of fixtures) {
  let template: string, view: unknown, partials: Record<string, string> = {};
  try {
    template = readFileSync(join(DIR, `${name}.mustache`), "utf8");
    view = loadView(name);
  } catch { continue; }
  try { partials = { partial: readFileSync(join(DIR, `${name}.partial`), "utf8") }; } catch { /* none */ }
  // parity gate: only time fixtures both engines render identically (the 62)
  let mo: string, mu: string;
  try { mo = moose(template, view, partials); } catch { continue; }
  try { mu = Mustache.render(template, view, partials); } catch { continue; }
  if (mo !== mu) continue;
  const moNs = minTime(() => { void moose(template, view, partials).length; }, 3000);
  const muNs = minTime(() => { void Mustache.render(template, view, partials).length; }, 3000);
  extime[name] = [usNum3(moNs), usNum3(muNs)];
}

// ---- medians ----
const geomean = (rs: number[]) => Math.exp(rs.reduce((s, r) => s + Math.log(r), 0) / rs.length);
const comp = Object.values(jobs).filter((j) => j.mu !== null) as { mo: number; mu: number }[];
const workloadMedian = geomean(comp.map((j) => j.mu / j.mo));
const suiteRatios = Object.values(extime).map(([mo, mu]) => mu / mo);
const suiteMedian = geomean(suiteRatios);

console.log(JSON.stringify({
  node: process.version,
  jobs,
  extime,
  workloadMedian: Number(workloadMedian.toFixed(2)),
  workloadFaster: comp.filter((j) => j.mu / j.mo >= 1).length,
  workloadComparable: comp.length,
  suiteMedian: Number(suiteMedian.toFixed(2)),
  suiteFaster: suiteRatios.filter((r) => r >= 1).length,
  suiteTotal: suiteRatios.length,
}, null, 2));
