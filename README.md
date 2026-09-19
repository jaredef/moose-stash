# moose-stash

A tiny, fast, logic-less [Mustache](https://mustache.github.io/) template engine.
Zero dependencies. Safe against lambda template injection.

- One small file, no runtime dependencies.
- Full Mustache: interpolation, sections, inverted sections, partials, comments,
  set delimiters, dotted names, lambdas, dynamic names (`{{>*name}}`), and
  inheritance (`{{<parent}}` / `{{$block}}`).
- Fast — beats `mustache` on every workload we measured.

## Install

```sh
npm install moose-stash
```

## Usage

```js
import { render } from "moose-stash";

render("Hello, {{name}}!", { name: "world" });
// → "Hello, world!"

render("{{#items}}- {{label}}\n{{/items}}", { items: [{ label: "a" }, { label: "b" }] });
// → "- a\n- b\n"

// partials: a name → source map
render("{{> hd}}\n{{body}}", { body: "hi" }, { hd: "== {{title}} ==" });
```

### API

```ts
render(template: string, data: unknown, partials?: Record<string, string>): string
```

`{{name}}` HTML-escapes; `{{{name}}}` and `{{&name}}` are raw. A value may be a
function: `{{fn}}` renders `fn()`, `{{#fn}}…{{/fn}}` renders `fn(rawText, render)`.

## Security

A lambda's return value is always **literal text** — moose-stash never re-parses it
as a template. So user data returned from a lambda cannot become tags like
`{{secret}}` or `{{> admin}}` (no lambda template injection).

```js
render("{{leak}}", { secret: "hunter2", leak: () => "{{secret}}" });
// → "{{secret}}"   (literal — the secret is not read)
```

A section lambda may still render *template-author* text via its `render` callback;
the engine never re-parses an untrusted return.

General rules still apply: escape output (`{{ }}` does, `{{{ }}}` does not), don't let
users supply templates or register lambdas/partials, and keep secrets off the view.

## Conformance

Verified against the official [Mustache spec](https://github.com/mustache/spec): **190
of 194**. The 4 not implemented are the lambda *re-render* cases — re-parsing a
lambda's return is the injection surface above, so moose-stash skips them by design.
(The reference `mustache` engine passes 0 of those 4 as well.)

```sh
npm test        # conformance
npm run security # the injection guarantee
```

## License

MIT. Bundles the Mustache spec test data (MIT) under `spec/` for testing.
