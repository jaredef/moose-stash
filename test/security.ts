import { render } from "../src/index.ts";

let pass = 0;
const fails: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else fails.push(name);
}

{
  const view = { secret: "hunter2", echo: () => "{{secret}}" };
  const out = render("{{echo}}", view);
  check("S1a does not leak the secret", !out.includes("hunter2"));
  check("S1b emits the tag as literal (escaped) text", out === "{{secret}}");
}

{
  const view = { echo: () => "{{> admin}}" };
  const partials = { admin: "TOP-SECRET-PARTIAL" };
  const out = render("{{echo}}", view, partials);
  check("S2a does not include the partial", !out.includes("TOP-SECRET-PARTIAL"));
  check("S2b emits the partial tag as (escaped) literal text", out === "{{&gt; admin}}");
}

{
  const view = { apiKey: "sk-PRIVATE", wrap: (text: string) => text };
  const out = render("{{#wrap}}{{apiKey}}{{/wrap}}", view);
  check("S3a does not leak apiKey", !out.includes("sk-PRIVATE"));
  check("S3b section-lambda return is literal", out === "{{apiKey}}");
}

{
  const view = { secret: "S", xss: () => "<script>{{secret}}</script>" };
  const out = render("{{{xss}}}", view);
  check("S4a does not pull the secret into raw output", !out.includes(">S<"));
  check("S4b raw lambda return is literal (tag not interpreted)", out === "<script>{{secret}}</script>");
}

{
  const view = { inner: () => "PWNED", outer: () => "{{inner}}" };
  const out = render("{{outer}}", view);
  check("S5 does not re-enter a second lambda", !out.includes("PWNED") && out === "{{inner}}");
}

{

  const view = { secret: "hunter2", echo: () => "{{secret}}" };

  const out = (render as any)("{{echo}}", view, {}, { rerenderLambdas: true });
  check("S6 no option re-opens the surface", out === "{{secret}}");
}

{
  const view = {
    name: "world",
    salute: () => "Hello there",
    upper: (text: string, r: (s: string) => string) => r(text).toUpperCase(),
  };
  check("S7a tagless lambda return works", render("{{salute}}, {{name}}!", view) === "Hello there, world!");
  check("S7b section lambda may render author text via subrender", render("{{#upper}}{{name}}{{/upper}}", view) === "WORLD");
}

{
  const data = { name: "Sam <& \"'>", items: [{ n: 1 }, { n: 2 }], on: true };
  const tmpl = "Hi {{name}}! {{#on}}[{{#items}}{{n}}{{/items}}]{{/on}}";
  check("S8 non-lambda templates render normally", render(tmpl, data) === "Hi Sam &lt;&amp; &quot;&#39;&gt;! [12]");
}

console.log("Security fixture — lambda injection closed by construction\n");
console.log(`  ${pass} checks passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL: ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
