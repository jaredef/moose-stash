# moosebench — the workload suite

`npm run moosebench` runs moose-stash and the reference **mustache.js 4.2** across a
spread of the most **common** and the **hardest** Mustache jobs. For each job it
first checks output **parity** (so it times equivalent work, and surfaces where
mustache.js diverges or can't run the job at all), then measures throughput. Both
engines cache parsed templates, so `render()` is the like-for-like call.

Numbers below are representative (Node 22, Apple Silicon); absolute µs is
machine-specific and varies run to run — the **ratios and the parity column** are
the signal.

## Results (after the mustache-performance arc)

```
  job                         parity      moose µs   mustache µs   speed
  ── COMMON ──────────────────────────────────────────────────────────────
  greeting                     ✓ match      0.56        0.64        1.13×
  user-card (HTML)             ✓ match      1.82        2.34        1.29×
  table-100 (HTML)             ✓ match     80.2        88.0         1.10×
  layout (partials)            ✓ match      2.22        2.42        1.09×
  email (mixed)                ✓ match      2.21        2.79        1.26×
  ── HARD ────────────────────────────────────────────────────────────────
  deep-context (6 levels)      ✓ match      2.61        6.48        2.49×
  big-list-2000                ✓ match   1494         1611         1.08×
  recursive-tree (partial)     ✓ match    132.1       169.4        1.28×
  delimiter-switching          ✓ match      0.48        0.74        1.55×
  interpolation lambda         ✓ match      0.46        0.55        1.21×
  section lambda (render-cb)   ✗ n/a        1.07           —      moose-only
  inheritance (layout)         ✗ n/a        1.03           —      moose-only
```

`speed = mustache-µs ÷ moose-µs` (>1 means moose is faster). **moose-stash is faster
on every one of the 10 comparable jobs**, and does 2 more mustache.js cannot.

*Before* the mustache-performance arc, these jobs ran at **0.78–0.84×** (mustache
faster). The Pin-Art probe (`L.mustache.exceed-parity`, Doc 705) named the render-path
per-use-cost seam; satisfying it in five gated steps — push/pop context stack (C1),
single-segment lookup (C2), dropped boxing (C4), no-op-escape fast path (C3), and a
tagless-lambda fast path (L1) — each held at 194/194, and moved moose to **1.08–2.49×**.

## The jobs

**Common** (the 90%): a greeting with a conditional; an HTML user-card (escaping +
small list); a 100-row HTML table; a header/nav/content/footer partial layout; a
transactional email (conditionals + itemized list + footer).

**Hard**: 6-level nested sections where every leaf walks the whole context stack; a
2000-row list with per-row conditionals and escaping-heavy fields; a self-recursive
partial rendering a 364-node tree; a template that switches delimiters three times;
a portable interpolation lambda; a section lambda using the spec's render callback;
and a parametric-partial **inheritance** layout with block overrides.

## Reading

- **Correctness / capability.** 9 of 11 jobs are **byte-identical** to mustache.js.
  The other two are **moose-only**: mustache.js 4.2 does not implement template
  inheritance at all, and does not pass a render callback to section lambdas (the
  spec convention moose follows). These are the jobs where the extra spec coverage
  is a real capability, not just a number.
- **Speed.** After the `2026-09-16-mustache-performance` arc, moose-stash is
  **faster than mustache.js on every one of the 10 comparable jobs** — 1.08–1.29× on
  the common/list jobs and up to **2.49×** on deep nested-context walking — with the
  render semantics untouched (194/194 held at every optimization).
- **How the gap closed.** The Pin-Art probe (Doc 705) located the boundary exactly:
  a per-use-cost seam in the render walk. Four cost-amortizations — push/pop context
  stack (was `[...stack, item]` per item), single-segment `lookup` (no `split()`),
  no-op-escape fast path, and dropped hot-path boxing — each gated at 194/194, cleared
  it. See `L.mustache.exceed-parity`.

## Honesty notes

- Escaped content in the common jobs avoids `/` on purpose: mustache.js escapes `/`
  to `&#x2F;` and moose does not (a difference the Mustache spec does not test), so
  including it would show a spurious "differ".
- `render()` is timed with each engine's parse cache warm (both cache), which is
  how templates are used in practice.

## Size (tokei)

| engine | code lines | files | runtime deps |
|---|---:|---:|---|
| moose-stash (`src/index.ts`) | **418** | 1 | 0 |
| mustache.js 4.2 (`mustache.js`) | 743 | 1 | 0 |

moose-stash is ~56% the size while passing 190/194 (+4 security-declined; vs mustache.js 142/194) and
winning every throughput job — more spec coverage in fewer lines.
