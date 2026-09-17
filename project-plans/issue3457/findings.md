# Issue #3457 — implementation findings and evidence

Branch: `issue3457` · Files changed:
`packages/cli/src/ui/components/messages/ToolResultDisplay.retention.behavior.test.tsx`,
`packages/cli/src/test-utils/render.tsx` (helper extraction only).
`ToolResultDisplay.tsx` is untouched in the final diff; every sabotage edit to it
was reverted with `git checkout --` and verified via `git status`/`git diff`.

## What was implemented

The two strict process-RSS assertions are replaced by settled-retained-JSC-heap
assertions (`heapSize + extraMemorySize` after two `gcAndSweep()` calls), on
the cycling shape from the plan: provider-wrapped warmup mount, eight
rerenders each carrying the full provider-wrapped tree (`wrapWithProviders`,
now exported from `src/test-utils/render.tsx` and reused by
`renderWithProviders`), a final small-body rerender, unmount, double sweep,
delta. `render.tsx` changes are extraction only; the provider JSX, defaults,
and store construction are byte-identical, `renderWithProviders` delegates to
`render(wrapWithProviders(...))`.

Tests (file order = run order):

- **A** `does not retain cycled result bodies after unmount` — eight distinct
  ~1 MiB multiline bodies through the cycling shape. Threshold 4 MiB.
- **B** `retains nothing when rerenders repeat the same body` — control: the
  same body eight times. Threshold 1 MiB.
- **C1** `retains nothing new when cycled unbroken bodies are seen again` —
  #3478 unbroken-body regression on the cycling channel, structured as a
  revisit control (see discovery below). Threshold 2 MiB.
- **C2a** `bounds a single unbroken line, which has no newlines to trim on` —
  unchanged behavioral assertions from the old RSS test (frame reports hidden
  lines, shows body content).
- **C2b** `bounds what a single unbroken line costs while mounted` — the old
  peak-RSS intent as a settled during-mount heap delta, mounting one
  1,000,000-character unbroken body at terminal width 12 (why below).
  Threshold 6 MiB; explicit 60 s test ceiling so a broken trim fails on the
  heap assertion rather than a timeout.
- Behavioral tests carried over unchanged: tail visibility and hidden-line
  reporting, hidden-rows-counted-by-line, fully-visible small results.

## Discovery: the "2 MiB per distinct unbroken body" was rope flattening, not retention

probe11-style first measurements showed cycling distinct unbroken bodies
"retaining" ~2 MiB per body and I initially attributed it to a width-cache
pinning the flattened buffer. Follow-up probes (tmp/verify3457/probe12.test.tsx)
showed the real mechanism: `chunk.repeat(n) + tail` builds a JSC **rope**, and
the first render flattens it **in place** — the caller's own string object
grows from a small lazy rope to a ~1 MiB contiguous buffer (~2 MiB on the
heapSize+extraMemorySize channel, which counts string storage twice). Evidence:
a first pass over 8 new unbroken bodies grows the caller-held heap by
+17.23/+17.34 MiB, a second set by the same, and a **revisit of already-seen
bodies is flat (+0.41 MiB)**. Nothing the component retains is involved.

Consequences for the test design:

- C1 therefore measures the **revisit**: baseline read after the first pass
  with bodies still test-held (so their now-flattened storage cancels), second
  pass over the same bodies, assert nothing further accrued. A per-render
  amplification bug re-pays ~17 MiB and fails the 2 MiB bound; a trim bypass
  also runs each render into the seconds and fails on the 5 s default timeout.
- Tests A/B create their bodies inside callee scopes that return before the
  settled read, so the delta cannot include test-held strings. This was
  validated the hard way: the first retention-sabotage run pre-restructure
  showed **no signal at all** because the test's own references made
  reference-pinning sabotage invisible.

Remaining honest residual (~1.9 MiB over 8 distinct multiline bodies) matches
probe11's bounded cache/content cost and is asserted below the 4 MiB bound.

## Why C2b mounts at width 12

The settled-during-mount channel can only see **live** tree data. While
mounted, the 1 MiB body is necessarily live and counts ~2.2 MiB on this
channel. A trim bypass additionally lays out one row per width-sized chunk of
body; at the default width 120 that overhead (~3.5 MiB) does not clear twice
the unavoidable body cost, so no threshold can be both ≥2× clean and ≤½×
sabotage. At width 12 the bypass lays out ~83,000 rows: measured 12.45 MiB
vs 2.24 MiB clean, which supports a 6 MiB threshold (2.7× clean, 2.1× below
sabotage). The visible window stays a few dozen rows at any width, so the
clean cost is width-independent. The wrap-invariant behavioral check is that
the visible tail ends with the body's own final characters (`01ab`); mid-body
substrings are not wrap-safe at narrow widths.

A first attempt used an **unsettled** mid-mount read (no gc) to catch pending
layout allocations; it read exactly 0.000 MiB every run because JSC updates
`heapStats()` counters only at collection time — a stale-counter read, not a
measurement. All reads now follow sweeps.

## Thresholds (all bytes, MiB in parentheses)

| Check | Threshold | Clean (5 runs) | Sabotage measured | Sabotage source |
|---|---|---|---|---|
| A distinct multiline cycling | 4 MiB | 1.873–1.95 (early shape 1.897/1.915) | 18.05 (4.5×) / 8.30 (2.08×) | array push / trim bypass |
| B same-body control | 1 MiB | 0.432–0.473 | 2.63 (2.63×) | array push |
| C1 unbroken revisit | 2 MiB | 0.862–0.904 | ~17.2–17.3 (probe12) + 5 s timeout | per-render amplification / trim bypass |
| C2b unbroken during mount (width 12) | 6 MiB | 2.20–2.25 | 12.13 (2.02×) | trim bypass |

Every clean run sits ≥25% below its threshold (worst case: B at 0.473 vs
0.75 floor; A at 1.95 vs 3.0 floor; C1 at 0.904 vs 1.5 floor; C2b at 2.25 vs
4.5 floor).

## Evidence files (tmp/ is gitignored; numbers embedded above)

- `tmp/verify3457/isolated-runs.log` — 5 measurement runs of the final cycling
  shape (with temporary logging) plus 2×5 confirmation runs of the final suite
  (8/8 pass each), including the rerun after the wrap-safe tail assertion fix.
- `tmp/verify3457/sabotage-retention.log` — final-threshold RED: A received
  18,930,972 vs < 4,194,304; B received 2,756,504 vs < 1,048,576. C1/C2 green
  by design (bodies test-held / single mount).
- `tmp/verify3457/sabotage-trim.log` — final-threshold RED: A received
  8,710,500 vs < 4,194,304; C2b received 12,720,114 vs < 6,291,456 (heap
  assertion, inside the 60 s ceiling); C1 fails on the 5 s timeout after
  27.8 s of untrimmed layout.
- `tmp/verify3457/probe12.test.tsx` — flattening-model probe.
- Earlier probes (probe2–probe11) document the harness findings below.

## Separate-issue candidates (not fixed here, per scope)

1. ink-testing-library's module-level `instances` array pins every render's
   ink instance (its exported `cleanup()` is never called; our
   `renderWithProviders` cleanup is a no-op). Mitigated in-test by ending each
   cycle on a small body before unmount.
2. `renderWithProviders().rerender` on a bare element silently drops the
   provider tree (store subscriptions then pin fibers; measured +6.4 to
   +8.7 MiB). Mitigated by `wrapWithProviders`; the footgun itself is
   unresolved.
3. JSC `heapStats()` returns stale counters until a collection runs — any
   future unsettled read is silently wrong. Worth a note wherever bun:jsc
   evidence is used.

## Deviations from the plan text

- Test C is split into a behavioral test (C2a, original assertions kept) and
   the during-mount memory check (C2b) because the narrow width needed for
   sabotage discrimination truncates the "... first N lines hidden ..."
   header (`wrap="truncate"`), so `hidden` cannot be asserted there.
- C1 is a revisit control rather than an absolute bound on distinct-unbroken
   cycling, because first-use rope flattening of the test's own bodies is not
   component behavior and cannot be separated on this channel (see discovery).
- The plan's suggested 4 MiB starting point holds for A; B/C1/C2b thresholds
   come from the measurements above.

## Addendum — independent re-validation (second orchestrator pass, 21:42–21:48)

The finished tree was re-validated from scratch in a fresh session; all prior
evidence was reproduced or replaced with first-hand runs:

- **Isolated runs (fresh):** 5 consecutive green runs (8/8 each), plus 5
  final-shape delta measurement runs (temporary logging, reverted;
  checksum-verified byte-identical) and 5 post-prettier confirmation runs.
  All appended to `tmp/verify3457/isolated-runs.log`.
- **Final-shape deltas (5 runs, direct measurement):** A 1.899–1.919 MiB,
  B 0.440–0.483 MiB, C1 revisit 0.872–0.893 MiB, C2b mounted 2.238–2.242 MiB.
  Confirms the table above; worst margin to threshold is A at 48% of the 4 MiB
  limit, every channel comfortably outside the 25% guard band.
- **Sabotage RED (fresh):** retention pin → A 18,052,108 vs <4,194,304 (4.3×),
  B 16,476,544 vs <1,048,576 (15.7×; higher than the earlier 2.76 MiB run
  because this pin captured post-truncation copies — 1M-char multiline bodies
  exceed the 1,000,000-char cap, so every render pins a fresh ~1 MiB string);
  trim bypass → A 8,737,322 vs <4,194,304 (2.08×), C1 5 s timeout after 27.6 s
  of untrimmed layout, C2b 12,575,044 vs <6,291,456 (2.00×). Both logs appended
  to `tmp/verify3457/sabotage-*.log`; component reverted and
  `git diff --stat` verified empty after each.
- **Prettier:** both files clean. One formatting fix was needed: comments
  placed between the callback and the `60_000` timeout argument made prettier
  oscillate (known trailing-comment idempotency quirk — two `--write` passes
  produced different non-stable forms). Moved the rationale comment above the
  `it(` call; `}, 60_000);` is now the stable canonical form.
- **Typecheck:** `bunx tsc --noEmit -p tsconfig.json` (packages/cli) reports
  586 pre-existing errors on HEAD; with the change applied the error SET is
  identical (verified by stashing the two files, re-running, and diffing;
  only cosmetic message-text differences: the options type is now named
  `RenderWithProvidersOptions`, and two TS2352 messages print union members
  in different order). Zero new or fixed errors. Note for the orchestrator:
  this tsconfig is not error-clean even on HEAD, so it is not the CI gate.
