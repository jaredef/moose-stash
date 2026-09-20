# moosebench — the workload suite

`npm run moosebench` runs moose-stash and the reference **mustache.js 4.2** across a
spread of the most **common** and the **hardest** Mustache jobs, plus the **drop-in
compatibility API** (Writer, Context, Scanner, the config argument, function partials,
cache control). For each job it first checks output **parity** (so it times equivalent
work, and surfaces where mustache.js diverges or can't run the job at all), then measures
throughput. Both engines cache parsed templates, so `render()` is the like-for-like call.

`speed = mustache-µs ÷ moose-µs` (>1 means moose is faster). **The ratios are the signal**
— absolute microseconds are hardware-specific.

## Environment

| | |
|---|---|
| CPU | Intel Xeon @ 2.10 GHz (generic cloud SKU), 4 vCPUs, AVX-512 |
| Virtualization | Docker under a Firecracker-style hypervisor (kernel 6.18) |
| RAM / OS | 15 GiB · Ubuntu 24.04.4 LTS |
| Node | v22.22.2 (V8 12.4) |
| Load during runs | idle (load average 0.02) |

Absolute µs here run ≈1.5–2× slower than desktop Apple Silicon, and a shared-tenant vCPU
with no visible frequency governor swings ≈10–15% run-to-run. The **direction of every
result held across all runs**, but anything within about **0.1× of parity is a tie** on
this hardware.

## Results (1.0.1, min-of-8 windows — the `pagedata.ts` method)

```
  job                         parity      moose µs   mustache µs   speed
  ── COMMON ──────────────────────────────────────────────────────────────────
  greeting                   ✓ match        0.52        0.59       1.13×
  user-card (HTML)           ✓ match        1.93        2.32       1.20×
  table-100 (HTML)           ✓ match       79.00       89.13       1.13×
  layout (partials)          ✓ match        1.96        2.31       1.18×
  email (mixed)              ✓ match        1.49        2.11       1.42×
  ── HARD ─────────────────────────────────────────────────────────────────────
  deep-context (6 levels)    ✓ match        2.63        5.32       2.02×
  big-list-2000              ✓ match     1679.27     1658.16       0.99×  (tie)
  recursive-tree (partial)   ✓ match      122.73      169.97       1.38×
  delimiter-switching        ✓ match        0.44        0.70       1.59×
  interpolation lambda       ✓ match        0.33        0.50       1.52×
  section lambda (render-cb)  ✗ n/a         0.80          —    moose-only
  inheritance (layout)       ✗ n/a         0.85          —    moose-only
  ── COMPAT SURFACES ──────────────────────────────────────────────────────────
  Writer (own cache)         ✓ match        1.22        1.71       1.40×
  Context (prebuilt chain)   ✓ match        0.92        1.15       1.25×
  Scanner (tokenize)         ✓ match        7.59        9.33       1.23×
  config: custom tags        ✓ match        1.11        1.71       1.54×
  config: custom escape      ✓ match        0.75        1.02       1.36×
  partials as function       ✓ match        1.89        2.29       1.21×
  cache churn + clearCache   ✓ match        1.97        2.86       1.45×
```

**moose-stash is faster on 16 of the 17 comparable jobs** (the 17th, `big-list-2000`, is a
tie), and does 2 more that mustache.js 4.2 cannot render at all.

## Across five runs

Two 1.0.0 runs, two 1.0.1 runs (single 500-iter warmup + timed), and one 1.0.1 min-of-8:

| | 1.0.0 run 1 | 1.0.0 run 2 | 1.0.1 run 1 | 1.0.1 run 2 | 1.0.1 min-of-8 |
|---|---|---|---|---|---|
| geometric mean | **1.33×** | **1.36×** | **1.29×** | **1.27×** | **1.34×** |
| faster | 10 / 10 | 10 / 10 | 16 / 16 | 16 / 16 | 16 / 17 |

The geometric mean sits at **~1.3×** every run. Reading across the rows:

- **Reliable big wins:** `deep-context` (2.0–2.29× — every leaf walks the whole context
  stack) and `delimiter-switching` (1.59–1.85×).
- **Compat surfaces** land consistently at **1.1–1.5×** (Writer, custom tags, and
  cache-churn among the widest).
- **`big-list-2000` is a tie:** it swings 0.99×–1.32× across runs, within the vCPU's
  run-to-run noise — treat it as parity.
- Absolute µs dropped between the 1.0.0 and 1.0.1 sessions because the container was
  quieter, **not** because of the release; that's why only ratios are compared. The
  compat-surface jobs exist only in 1.0.1 (they are the API that release added).

## The jobs

**Common** (the 90%): a greeting with a conditional; an HTML user-card (escaping + small
list); a 100-row HTML table; a header/nav/content/footer partial layout; a transactional
email. **Hard**: 6-level nested sections; a 2000-row list; a self-recursive partial
(364-node tree); triple delimiter-switching; a portable interpolation lambda; a section
lambda using the spec's render callback; a parametric-partial inheritance layout.
**Compat surfaces**: a reused `Writer` with its own cache; a prebuilt `Context` chain; a
`Scanner` tokenizing a template; per-call custom delimiters and escape via the 4th
`config` argument; partials resolved by a **function**; and 512 cycling unique templates
with periodic `clearCache`.

## Honesty notes

- **Escaping is identical.** Both engines escape `/` to `&#x2F;` (moose-stash's default
  entity map matches mustache.js's), so escaped content compares byte-for-byte. (An earlier
  version of these docs claimed moose did not escape `/`; that was never true — the drop-in
  fixture suite is 62/62 byte-identical, which requires matching escaping.)
- `render()` is timed with each engine's parse cache warm, as templates are used in practice.
- The 1.0.1 run 1/run 2 logs list 16 comparable jobs (the `cache churn` row was cut by a
  log line limit); it appears in the min-of-8 column, which is why that column has 17.

## Size (packaged script, non-blank lines)

| engine | non-blank lines | comments | files | runtime deps |
|---|---:|---:|---:|---|
| moose-stash (`moose-stash.js`) | **646** | 0 | 1 | 0 |
| mustache.js 4.2 (`mustache.js`) | 665 | ~200 | 1 | 0 |

Comparable size, counted the same way — moose-stash ships slightly fewer non-blank lines
and **zero comments**, while passing 190/194 (+4 security-declined; vs mustache.js
142/194), adding template inheritance / dynamic partial names / render-callback lambdas,
and winning (or tying) every throughput job.
