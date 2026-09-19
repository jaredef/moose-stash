// Drop-in parity gate: run mustache.js's own fixture suite (test/mustache-fixtures/,
// vendored from janl/mustache.js 4.2.0) against moose-stash. This is the WITNESS for
// the mustache-drop-in-parity arc — it measures how many of mustache.js's real-world
// fixtures moose-stash reproduces byte-for-byte.
//
// The mustache.js render-test harness registers the single `<test>.partial` file under
// the name `partial` and renders `Mustache.render(template, view, { partial })`. We
// reproduce that exactly (see /tmp render-test.js:236) so numbers are comparable.
//
// Fixtures whose expected output requires mustache's call-function-in-lookup lambda
// convention (IC-5), which CONFLICTS with the spec's section-lambda semantics
// moose-stash targets, are named as CONVENTION_DECLINE — reported, not counted failed.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { render } from "../src/index.ts";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "mustache-fixtures");

// No fixture is declined: IC-5c (return-type-discriminated lambda unwrap in the
// section handler) reproduces mustache's wrapper behaviour WITHOUT the spec-breaking
// no-arg unwrap — see docs/theory/mustache-behavioral-constraints.md IC-5.
const CONVENTION_DECLINES = new Set<string>([]);

function loadView(name: string): unknown {
  let src: string;
  try {
    src = readFileSync(join(DIR, `${name}.js`), "utf8");
  } catch {
    src = readFileSync(join(DIR, `${name}.cjs`), "utf8");
  }
  src = src.replace(/^﻿/, "");
  // views are either `({...});` (expression) or `module.exports = {...}` (CJS)
  try {
    return (0, eval)(src);
  } catch {
    const mod = { exports: {} as unknown };
    new Function("module", "exports", src)(mod, mod.exports);
    return mod.exports;
  }
}

// Enumerate exactly as mustache.js's render-helper does: by VIEW file (.js/.cjs), not
// by .mustache. This drops CLI-only fixtures (e.g. cli_with_partials, JSON view) that
// mustache's own render suite never runs — keeping the comparison apples-to-apples.
const tests = [
  ...new Set(readdirSync(DIR).filter((f) => /\.c?js$/.test(f)).map((f) => f.replace(/\.c?js$/, ""))),
].sort();

let pass = 0;
let declined = 0;
const fails: string[] = [];

for (const name of tests) {
  const template = readFileSync(join(DIR, `${name}.mustache`), "utf8");
  const expected = readFileSync(join(DIR, `${name}.txt`), "utf8");
  let partials: Record<string, string> = {};
  try {
    partials = { partial: readFileSync(join(DIR, `${name}.partial`), "utf8") };
  } catch {
    /* not all tests use a partial */
  }
  let actual: string;
  try {
    actual = render(template, loadView(name), partials);
  } catch (e) {
    actual = `<<threw: ${(e as Error).message}>>`;
  }
  if (actual === expected) {
    pass++;
  } else if (CONVENTION_DECLINES.has(name)) {
    declined++;
  } else {
    fails.push(name);
  }
}

const total = tests.length;
console.log(`\nmoose-stash vs mustache.js fixtures: ${pass}/${total} pass · ${declined} convention-declined`);
if (fails.length) {
  console.log(`\n  unexpected failures (${fails.length}):`);
  for (const f of fails) console.log(`    ${f}`);
}
// The gate fails only on UNEXPECTED failures — a declined convention case is expected.
process.exit(fails.length === 0 ? 0 : 1);
