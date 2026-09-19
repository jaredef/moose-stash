import Mustache, { Writer, Context, Scanner } from "../src/index.ts";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  FAIL ${name}\n    got  ${g}\n    want ${w}`); }
}
function ok(name: string, cond: boolean) { cond ? pass++ : (fail++, console.log(`  FAIL ${name}`)); }
function throws(name: string, fn: () => void) {
  try { fn(); fail++; console.log(`  FAIL ${name} (did not throw)`); } catch { pass++; }
}

// 1. basic render still works
eq("render basic", Mustache.render("Hi {{name}}", { name: "<b>" }), "Hi &lt;b&gt;");

// 2. 4th config arg: custom tags
eq("config tags", Mustache.render("Hi <%name%>", { name: "x" }, {}, { tags: ["<%", "%>"] }), "Hi x");
// tags as bare array (older mustache signature)
eq("config tags array", Mustache.render("Hi <%name%>", { name: "x" }, {}, ["<%", "%>"]), "Hi x");

// 3. 4th config arg: custom escape
eq("config escape", Mustache.render("{{x}}", { x: "a&b" }, {}, { escape: (s) => String(s).toUpperCase() }), "A&B");

// 4. partials as a function
eq("partials fn", Mustache.render("{{>p}}", { who: "world" }, (name) => name === "p" ? "hi {{who}}" : ""), "hi world");

// 5. mutable global escape
const savedEscape = Mustache.escape;
Mustache.escape = (s) => "[" + String(s) + "]";
eq("global escape", Mustache.render("{{x}}", { x: "z" }), "[z]");
Mustache.escape = savedEscape;
eq("global escape restored", Mustache.render("{{x}}", { x: "<" }), "&lt;");

// 6. mutable global tags
const savedTags = Mustache.tags;
Mustache.tags = ["[[", "]]"];
eq("global tags", Mustache.render("[[x]]", { x: "y" }), "y");
Mustache.tags = savedTags;
eq("global tags restored", Mustache.render("{{x}}", { x: "y" }), "y");

// 7. parse exists and returns tokens; priming the cache doesn't change render
const toks = Mustache.parse("{{a}}");
ok("parse returns array", Array.isArray(toks));

// 8. clearCache
Mustache.render("{{cacheme}}", { cacheme: 1 });
ok("templateCache present", Mustache.templateCache != null);
Mustache.clearCache();
eq("render after clearCache", Mustache.render("{{a}}", { a: "b" }), "b");

// 9. templateCache = undefined disables caching, render still works
Mustache.templateCache = undefined;
ok("templateCache undefined", Mustache.templateCache === undefined);
eq("render with cache disabled", Mustache.render("{{a}}", { a: "c" }), "c");
Mustache.templateCache = templateCacheRestore();
function templateCacheRestore() { return {} as any; } // any truthy re-enables
ok("templateCache re-enabled", Mustache.templateCache != null);

// 10. Writer with isolated cache
const w = new Writer();
eq("writer render", w.render("{{x}}", { x: "<a>" }), "&lt;a&gt;");
ok("writer parse", Array.isArray(w.parse("{{y}}")));
w.clearCache();
eq("writer render after clear", w.render("{{x}}", { x: "z" }), "z");

// 11. Context: build a chain and pass it to render
const ctx = new Context({ a: 1 }).push({ b: 2 });
eq("context lookup a", ctx.lookup("a"), 1);
eq("context lookup b", ctx.lookup("b"), 2);
eq("render with context", Mustache.render("{{a}}{{b}}", ctx), "12");

// 12. Scanner works incrementally
const sc = new Scanner("abc{{def");
eq("scanner scanUntil", sc.scanUntil(/\{\{/), "abc");
eq("scanner scan", sc.scan(/\{\{/), "{{");
eq("scanner tail", sc.tail, "def");
ok("scanner not eos", !sc.eos());

// 13. version / name present
ok("version string", typeof Mustache.version === "string" && Mustache.version.length > 0);
ok("name present", typeof Mustache.name === "string");

// 14. mustache.js throw behavior
throws("unclosed tag throws", () => Mustache.render("{{a", {}));
throws("non-string template throws", () => (Mustache.render as any)(null, {}));

// 15. inheritance + dynamic names still there
eq("dynamic partial name", Mustache.render("{{>*p}}", { p: "greet", who: "W" }, { greet: "hi {{who}}" }), "hi W");

console.log(`\ndrop-in API: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
