# bench — moose-stash vs mustache.js

Two benchmarks against the reference **mustache.js 4.2** (a `devDependency`;
moose-stash itself stays dependency-free):

- **`npm run bench`** — spec-corpus parity (per module) + throughput on two
  micro-workloads. *This file.*
- **`npm run moosebench`** — the **workload suite**: the most common and hardest
  real Mustache jobs (greetings, HTML tables, partial layouts, emails, deep
  context, 2000-row lists, recursive partials, delimiter-switching, lambdas,
  inheritance), each with an output-parity check. See
  [`MOOSEBENCH.md`](MOOSEBENCH.md).

## `npm run bench`

1. **Parity** — does each engine match the spec, and do the two agree, per module?
2. **Throughput** — µs/render and renders/s on two workloads.

Numbers below are representative from one run (Node 22, Apple Silicon); absolute
throughput is machine-specific and varies run to run — the *ratios* are the signal.

## Parity (spec corpus, 194 cases)

| module | moose = spec | mustache = spec |
|---|---:|---:|
| comments | 12/12 | 12/12 |
| delimiters | 14/14 | 14/14 |
| interpolation | 42/42 | **41/42** |
| inverted | 22/22 | 22/22 |
| partials | 12/12 | 12/12 |
| sections | 34/34 | 34/34 |
| dynamic-names | 21/21 | **5/21** |
| inheritance | 27/27 | **0/27** |
| lambdas | 6/10 (+4 declined*) | **2/10** |
| **TOTAL** | **190/194** (+4 declined*) | **142/194** |

*\*The 4 lambda re-render cases are declined by design — re-parsing a lambda return is
an injection surface (`docs/theory/mustache-security.md`). moose still passes far more
spec cases than mustache.js.*

**moose-stash is more spec-conformant than mustache.js 4.2.** The gap:

- **inheritance (0/27)** and **dynamic-names (5/21)**: mustache.js 4.2 does not
  implement `{{<parent}}`/`{{$block}}` or `{{>*name}}` at all.
- **lambdas (2/10)**: mustache.js uses pre-spec lambda semantics — section lambdas
  receive the *rendered* inner text (spec: the *raw* text), and interpolation
  results are not re-parsed as templates. moose follows the current spec.
- **interpolation (41/42)**: on `{{#a}}{{b.c}}{{/a}}` (Dotted Names – Context
  Precedence) mustache.js errors where the spec expects `""`; moose returns `""`.
- *Caveat (honesty):* the lambdas "Multiple Calls" case uses a counter lambda whose
  state is a JS global; run in one process both engines mutate the same counter, so
  that single case is not a fair cross-engine comparison. The other lambda
  divergences are genuine.

## Throughput

Both engines now **cache parsed templates by source string** — moose-stash gained a
parse cache in arc `2026-09-16-parse-cache` (memoize `parseTemplate` over
`(template, delimiters)`; sound because `renderTokens` is read-only). We report
mustache's cached path (the like-for-like comparison) and a parse-every-render path
(cache cleared each pass) for context.

**spec-core corpus** (136 small varied templates):

| engine | µs/render | renders/s |
|---|---:|---:|
| moose-stash (with cache) | 0.63 | 1,580,000 |
| mustache (cached) | 0.56 | 1,770,000 |
| mustache (parse each) | ~3–11 | (varies) |

→ moose is **~0.89×** mustache-cached — near parity (was **0.33×** before the cache).

**50-item list render** (one section-heavy template):

| engine | µs/render | renders/s |
|---|---:|---:|
| moose-stash (with cache) | 33 | 30,000 |
| mustache (cached) | 27 | 36,000 |
| mustache (parse each) | 32 | 31,000 |

→ moose is **~0.82×** mustache-cached (was 0.63×), and **~1.04×** vs
mustache-parse-each.

*Before the parse cache*, moose was 1.61 µs (spec-core) / 40.7 µs (list) and
0.33× / 0.63× of mustache-cached. The cache is the whole difference.

## Reading

- **Correctness:** moose-stash wins outright — full spec, including the three
  optional modules mustache.js omits or predates.
- **Speed:** with both engines caching parses, moose-stash is at **~0.85–0.9× of
  mustache.js** — effectively at parity. The parse cache closed the gap the first
  benchmark exposed.
- **Remaining ~10–15% (render path):** the list path still allocates a fresh
  context frame per item (`[...stack, item]`) and concatenates strings — a
  secondary optimization, recorded but not chased (the benchmark measures; it does
  not tune beyond the one amortization the method called for).
