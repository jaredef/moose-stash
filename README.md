# moose-stash

A tiny, fast, logic-less [Mustache](https://mustache.github.io/) template engine for
JavaScript and TypeScript — **zero dependencies**, **safe against lambda template
injection**, and a **drop-in** for [mustache.js](https://github.com/janl/mustache.js).

- **Small.** ~400 lines, no runtime dependencies. UMD, ESM, and minified builds.
- **Fast.** Beats `mustache` on every workload measured — up to **1.6×**.
- **Complete.** The whole Mustache spec **plus** template inheritance and dynamic
  partial names, which `mustache` doesn't have.
- **Safe by default.** A lambda's return value is always literal text and is **never**
  re-parsed as a template — closing the server-side template-injection surface.
- **Drop-in.** Reproduces **all 62** of mustache.js's own fixtures, byte for byte.
- **Typed.** Written in TypeScript.

## vs. mustache.js

| | moose-stash | mustache.js 4.2 |
|---|---|---|
| Mustache spec cases | **190 / 194** (+4 declined for safety) | 142 / 194 |
| mustache.js fixtures | **62 / 62** | 62 / 62 |
| Template inheritance (`{{<parent}}` / `{{$block}}`) | ✅ | ❌ |
| Dynamic partial names (`{{>*name}}`) | ✅ | ❌ |
| Render-callback section lambdas | ✅ | ❌ |
| Lambda injection safe by default | ✅ | by omission |
| Throughput | **1.0–1.6×** | 1× |
| Runtime dependencies | 0 | 0 |

The 4 declined spec cases are the lambda **re-render** cases — see [Security](#security).

## Install

```sh
npm install moose-stash
```

## Usage

```js
import MooseStash from "moose-stash";      // default import
import { render } from "moose-stash";      // …or named
const MooseStash = require("moose-stash"); // …or CommonJS

render("Hello, {{name}}!", { name: "world" });
// → "Hello, world!"

// sections, inverted sections, dotted names
render("{{#user}}{{name}} <{{contact.email}}>{{/user}}{{^user}}nobody{{/user}}",
  { user: { name: "Ann", contact: { email: "ann@x.io" } } });
// → "Ann <ann@x.io>"

// lists
render("{{#items}}- {{label}}\n{{/items}}", { items: [{ label: "a" }, { label: "b" }] });
// → "- a\n- b\n"

// partials: a name → source map
render("{{> header}} {{body}}", { title: "Hi", body: "…" }, { header: "[{{title}}]" });
// → "[Hi] …"
```

### API

```ts
render(template: string, data: unknown, partials?: Record<string, string>): string
```

`{{name}}` HTML-escapes its value; `{{{name}}}` and `{{&name}}` emit it raw. A value may
be a function: `{{fn}}` renders `fn()`; `{{#fn}}…{{/fn}}` calls `fn(rawText, render)` and
the `render` callback re-renders template-author text on demand.

## Features

Everything Mustache — interpolation, sections, inverted sections, comments, partials,
set delimiters (`{{=<% %>=}}`), dotted names, and lambdas — plus:

- **Template inheritance** — `{{<parent}}` with named `{{$block}}` overrides, including
  correct block reindentation.
- **Dynamic partial names** — `{{>*name}}`, resolving the partial's name from the data.

## Security

Mustache lets a lambda's **return value** be re-parsed as a new template. That powers
i18n/filters, but it's a server-side template-injection surface: user text returned from
a lambda becomes live tags — `{{secret}}`, `{{> admin}}` — that can read the context or
pull in partials.

**moose-stash never re-parses a lambda's return.** It is always literal text. There is
no mode or flag that re-opens the surface.

```js
render("{{leak}}", { secret: "hunter2", leak: () => "{{secret}}" });
// → "{{secret}}"   (literal — the secret is not read)
```

A section lambda can still render *template-author* text through its explicit `render`
callback — that's the lambda's deliberate act on trusted source, not an automatic
re-parse of an untrusted return. The cost of this guarantee is the spec's 4 lambda
*re-render* cases, declined by design.

Defense in depth still applies: prefer `{{ }}` (escaped) over `{{{ }}}` (raw), don't let
users supply templates or register lambdas/partials, and keep secrets off the view.

## CLI

```sh
moose-stash <view.json> <template.mustache> [output]   # -p <partial> to add partials
moose-stash --version
```

The view may be a JSON file, a `.js`/`.cjs` module (so it can hold functions), or `-`
for JSON on stdin.

## Builds & wrappers

`moose-stash.js` (UMD, global `MooseStash`) · `moose-stash.mjs` (ESM) ·
`moose-stash.min.js` (minified). Adapters for jQuery, MooTools, Dojo, YUI3, and qooxdoo
live under `wrappers/`.

## License

MIT.
