import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { render, type Partials } from "../src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = join(HERE, "..", "spec");

const REQUIRED = ["comments", "delimiters", "interpolation", "inverted", "partials", "sections"];

type Case = {
  name: string;
  desc: string;
  data: unknown;
  template: string;
  expected: string;
  partials?: Partials;
};
type Module = { overview?: string; tests: Case[] };

function specFile(mod: string): string {

  const direct = join(SPEC_DIR, `${mod}.json`);
  const optional = join(SPEC_DIR, `~${mod}.json`);
  try { readFileSync(direct); return direct; } catch { return optional; }
}

function loadModule(mod: string): Module {
  return JSON.parse(readFileSync(specFile(mod), "utf8")) as Module;
}

function reviveLambdas(v: unknown): unknown {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.__tag__ === "code" && typeof o.js === "string") {
      return new Function(`return (${o.js})`)();
    }
    if (Array.isArray(v)) return v.map(reviveLambdas);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = reviveLambdas(o[k]);
    return out;
  }
  return v;
}

function selectModules(): string[] {
  const args = process.argv.slice(2);
  const named = args.filter((a) => !a.startsWith("--"));
  if (named.length) return named;
  if (args.includes("--all")) {
    return readdirSync(SPEC_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => basename(f, ".json").replace(/^~/, ""));
  }
  return REQUIRED;
}

const SECURITY_DECLINES = new Set<string>([
  "lambdas/Interpolation - Expansion",
  "lambdas/Interpolation - Alternate Delimiters",
  "lambdas/Section - Expansion",
  "lambdas/Section - Alternate Delimiters",
]);

let totalPass = 0;
let totalDeclined = 0;
let totalFail = 0;
const rows: string[] = [];

for (const mod of selectModules()) {
  let pass = 0;
  let declined = 0;
  const fails: string[] = [];
  const { tests } = loadModule(mod);
  for (const t of tests) {
    let actual: string | null = null;
    try {
      actual = render(t.template, reviveLambdas(t.data), t.partials ?? {});
    } catch {
      actual = null;
    }
    if (actual === t.expected) pass++;
    else if (SECURITY_DECLINES.has(`${mod}/${t.name}`) && actual != null) declined++;
    else fails.push(t.name);
  }
  totalPass += pass;
  totalDeclined += declined;
  totalFail += fails.length;
  const status = fails.length > 0 ? "····" : declined > 0 ? "SAFE" : "PASS";
  const label = declined > 0 ? `${pass}/${tests.length} (+${declined} declined)` : `${pass}/${tests.length}`;
  rows.push(`  ${status}  ${mod.padEnd(14)} ${label}`);
}

console.log("Mustache conformance — moose-stash\n");
console.log(rows.join("\n"));
const total = totalPass + totalDeclined + totalFail;
console.log(`\n  TOTAL  ${totalPass}/${total} pass` + (totalDeclined ? `  ·  ${totalDeclined} security-declined` : ""));
if (totalDeclined) console.log(`  (4 lambda re-render cases not implemented by design — see README Security)`);
if (totalFail) console.log(`  ${totalFail} UNEXPECTED failure(s)`);

process.exit(totalFail === 0 ? 0 : 1);
