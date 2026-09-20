# moosebench — the workload suite

`npm run moosebench` runs moose-stash and the reference **mustache.js 4.2** across a
spread of the most **common** and the **hardest** Mustache jobs, plus the **drop-in
compatibility API** (Writer, Context, Scanner, the config argument, function partials,
cache control). For each job it first checks output **parity** (so it times equivalent
work, and surfaces where mustache.js diverges or can't run the job at all), then
measures throughput. Both engines cache parsed templates, so `render()` is the
like-for-like call.

Numbers below are representative (Node 22); absolute µs is machine-specific and varies
run to run — the **ratios and the parity column** are the signal.

## Results

```
  job                         parity      moose µs   mustache µs   speed
  ── COMMON ──────────────────────────────────────────────────────────────────
  greeting                   ✓ match       0.44        0.48        1.09×
  user-card (HTML)           ✓ match       1.46        1.78        1.22×
  table-100 (HTML)           ✓ match      65.36       67.26        1.03×
  layout (partials)          ✓ match       1.67        1.84        1.10×
  email (mixed)              ✓ match       1.54        2.10        1.36×
  ── HARD ─────────────────────────────────────────────────────────────────────
  deep-context (6 levels)    ✓ match       2.99        4.96        1.66×
  big-list-2000              ✓ match    1204.58     1215.30        1.01×
  recursive-tree (partial)   ✓ match     106.51      142.78        1.34×
  delimiter-switching        ✓ match       0.38        0.57        1.50×
  interpolation lambda       ✓ match       0.30        0.41        1.37×
  section lambda (render-cb)  ✗ n/a        0.67           —   moose-only
  inheritance (layout)       ✗ n/a        0.77           —   moose-only
  ── COMPAT SURFACES ──────────────────────────────────────────────────────────
  Writer (own cache)         ✓ match       0.95        1.28        1.35×
  Context (prebuilt chain)   ✓ match       0.74        0.87        1.18×
  Scanner (tokenize)         ✓ match       6.94        8.31        1.20×
  config: custom tags        ✓ match       0.95        1.32        1.39×
  config: custom escape      ✓ match       0.70        0.86        1.23×
  partials as function       ✓ match       1.44        1.80        1.25×
  cache churn + clearCache   ✓ match       1.39        2.29        1.65×
```

`speed = mustache-µs ÷ moose-µs` (>1 means moose is faster). **moose-stash is faster on
every one of the 17 comparable jobs** (≈1.01–1.66×, median ~1.28×), and does 2 more that
mustache.js 4.2 cannot render at all.

## The jobs

**Common** (the 90%): a greeting with a conditional; an HTML user-card (escaping + small
list); a 100-row HTML table; a header/nav/content/footer partial layout; a transactional
email (conditionals + itemized list + footer).

**Hard**: 6-level nested sections where every leaf walks the whole context stack; a
2000-row list with per-row conditionals and escaping-heavy fields; a self-recursive
partial rendering a 364-node tree; a template that switches delimiters three times; a
portable interpolation lambda; a section lambda using the spec's render callback; and a
parametric-partial **inheritance** layout with block overrides.

**Compat surfaces** (the drop-in API a real mustache.js consumer touches): a reused
`Writer` with its own cache; a prebuilt `Context` view-chain; a `Scanner` tokenizing a
template; per-call custom delimiters and custom escape via the 4th `config` argument;
partials resolved by a **function** rather than a map; and 512 cycling unique templates
with periodic `clearCache` (the unbounded-cache guard). Each is byte-identical to
mustache.js and faster.

## Reading

- **Correctness / capability.** 17 of 19 comparable jobs are **byte-identical** to
  mustache.js. The other two are **moose-only**: mustache.js 4.2 does not implement
  template inheritance, and does not pass a render callback to section lambdas (the spec
  convention moose follows).
- **Speed.** moose-stash is **faster than mustache.js on every comparable job** —
  ≈1.0–1.36× on the common/list jobs, up to **1.66×** on deep nested-context walking, and
  1.18–1.65× across the compatibility surfaces (Writer and cache-churn among the widest
  gains) — with render semantics untouched (190/194 + 4 declined held throughout).
- **How the gap closed.** Two Pin-Art arcs located the cost seams exactly:
  `L.mustache.exceed-parity` (Doc 705) amortized the render walk (push/pop context stack,
  single-segment lookup, no-op-escape fast path, dropped hot-path boxing), and
  `L.mustache.lookup-amortization` memoized the dotted-name split. The drop-in surfaces
  lower onto one shared render/parse core, so they carry no extra cost.

## Honesty notes

- **Escaping is identical.** Both engines escape `/` to `&#x2F;` (moose-stash's default
  entity map matches mustache.js's), so escaped content compares byte-for-byte with no
  spurious "differ". (An earlier version of these docs claimed moose did not escape `/`;
  that was never true — the drop-in fixture suite passes 62/62 byte-identical, which
  requires matching escaping.)
- `render()` is timed with each engine's parse cache warm (both cache), which is how
  templates are used in practice.

## Size (packaged script, non-blank lines)

| engine | non-blank lines | comments | files | runtime deps |
|---|---:|---:|---:|---|
| moose-stash (`moose-stash.js`) | **646** | 0 | 1 | 0 |
| mustache.js 4.2 (`mustache.js`) | 665 | ~200 | 1 | 0 |

Comparable size, counted the same way — moose-stash ships slightly fewer non-blank lines
and **zero comments**, while passing 190/194 (+4 security-declined; vs mustache.js
142/194), adding template inheritance / dynamic partial names / render-callback lambdas,
and winning every throughput job.
