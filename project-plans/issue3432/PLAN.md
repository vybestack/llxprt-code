# Plan: Cut per-tick and per-record transient allocation in the shell streaming and recording path

Plan ID: PLAN-20260916-PTYRENDERALLOC
Generated: 2026-09-16
Issue: #3432
Total Phases: 1 (single-phase small change)
Requirements: REQ-3432-01 (exact cheap change check), REQ-3432-02 (allocation-light serializer), REQ-3432-03 (single pending-record representation)

## Scope

In scope (issue #3432 goals only):

1. `maybeEmitRenderedOutput` in `packages/core/src/services/shellPtyHelpers.ts`: replace the
   two per-tick `JSON.stringify` calls with an allocation-free structural change check.
2. `serializeTerminalToObject` in `packages/core/src/utils/terminalSerializer.ts`: add a
   direct colorless output mode (used by `serializeTerminalForRender` so the per-token
   `{ ...token, fg: '', bg: '' }` copy disappears) and reuse scratch `Cell` instances
   instead of allocating one `Cell` per terminal cell.
3. `SessionRecordingService` in `packages/core/src/recording/SessionRecordingService.ts`:
   pending records retain one representation (`json` + `bytes`) and drop the retained
   `line` object reference; `enqueue` returns the locally built line object.

Out of scope (per issue): output buffer bounds / queue watermarks, scrollback, retention
caps, render budgeting (#3428, #854), logging behavior changes, string-concat strategy in
the serializer, `getFullBufferText` (already optimized, #3200).

## Shaped acceptance criteria

### REQ-3432-01: exact, allocation-free render change check

**Behavior**:

- GIVEN the previous emitted output (`outputRef.current`: `null`, a `string`, or an
  `AnsiOutput`) and a new `finalOutput`
  WHEN `maybeEmitRenderedOutput` runs
  THEN it emits (`onOutputEvent({ type: 'data', chunk: finalOutput })` and
  `outputRef.current = finalOutput`) **if and only if**
  `JSON.stringify(finalOutput) !== JSON.stringify(previous)` would have returned true on
  the current code. Exact equivalence is the contract (issue acceptance criterion 1).

- The check performs zero string serialization of either side and allocates no objects on
  the no-change path (staged comparison: reference identity → type/shape → line count →
  per-line token count → per-token text length → text/flags/colors). The cheap staged
  prefixes are the issue's "fingerprint" (line count, per-line text lengths); cursor
  position is covered by the token `inverse` flag (the cursor position is baked into
  serialized output only via `inverse`), so a raw cursor-position check is deliberately
  NOT an emit trigger: the current code does not emit when the cursor moves outside the
  emitted region, and criterion 1 requires preserving that.

- Boundary cases: initial `null` (emit), initial `string` output (emit), identical object
  reference (no emit), same text lengths with different characters (emit — e.g. a
  progress bar "50%" → "75%"), color-only change (emit), cursor-driven `inverse` flip on
  the cursor line (emit), line-count change (emit), cursor moved with identical emitted
  content (no emit), same-reference different-cursor (no emit).

### REQ-3432-02: serializer emits colorless output directly and allocates O(1) Cells

**Behavior**:

- GIVEN any fixed terminal state
  WHEN serialized through the new colorless mode of `serializeTerminalToObject` (whatever
  option shape is chosen, e.g. an options object)
  THEN the output is deep-equal and `JSON.stringify`-identical to the current two-step
  result of `serializeTerminalToObject(terminal)` followed by
  `line.map((token) => ({ ...token, fg: '', bg: '' }))` — text, bold, italic, underline,
  dim, and inverse (including cursor) preserved verbatim, fg/bg always `''`.

- GIVEN `showColor === true` or default options
  WHEN serialized
  THEN output is byte-for-byte identical to today's colored `serializeTerminalToObject`.

- `serializeTerminalForRender(terminal, showColor)` keeps its exact signature and both
  behaviors (undefined `showColor` → colorless, matching today) but no longer performs the
  per-token copy; it delegates to the serializer's mode.

- GIVEN a fixed terminal state
  WHEN serialized repeatedly
  THEN output is identical across calls AND the serializer allocates a constant number of
  `Cell` objects per call (scratch reuse: current-cell + last-cell ping-pong, per-line
  null-seed reset), not `rows × cols`. The `x === 0` unconditional-continue quirk, the
  null-seed `lastCell` state (attributes 0, fg 0, bg 0, DEFAULT modes, isCursor false),
  `equals()` semantics (attributes + colors + cursor flag only), and `getChars()` ''
  → ' ' normalization are preserved exactly.
  `convertColorToHex`'s exported signature is unchanged (external test usage).

### REQ-3432-03: recorder retains one representation per pending record

**Behavior**:

- GIVEN records pending in the pre-content buffer or the drain queue
  THEN each pending record holds only the serialized `json` string plus its `bytes`
  count; the `line` object (and therefore the live payload object graph — content,
  history, media references) is not retained by the queue.

- GIVEN any enqueue/drain sequence
  WHEN compared with the current implementation
  THEN on-disk JSONL bytes, record ordering, seq numbering, byte accounting
  (`getPendingByteCount`, `maxQueueBytes` enforcement at enqueue time), high-water
  reporting, pre-content buffering/materialization, `prepareContentBatch`
  publish/rollback/finalize, flush/dispose semantics, and `enqueue`'s return value (the
  same `SessionRecordLine` object, with correct `seq`/`ts`/`v`/`type`/`payload`) are all
  unchanged.

- Boundary: `enqueue` on the pre-content path must still return the exact line object it
  created (today it reads it back out of `this.preContentBuffer`; after the change it
  returns the local object — same object, same values).

## Tests (test-first, bun:test, co-located)

1. `packages/core/src/utils/terminalSerializer.test.ts` (extend):
   - colorless mode deep-equals the legacy two-step strip on terminals exercising
     palette, RGB, and default colors, bold/dim/inverse, cursor positions, blank lines;
   - concrete literal token expectations for colorless output (fg/bg `''`, flags and text
     preserved) on a fixed terminal;
   - colored output unchanged (existing 13 cases stay green);
   - repeated serialization calls return identical output (scratch reuse safety);
   - edge cases pinning the scratch refactor: line whose first cell differs from the
     null seed, cursor-at-0-0 inverse, wrapped/multi-char cells.
2. `packages/core/src/services/shellPtyHelpers.bun.test.ts` (new, focused — the existing
   `shellPtyExecution.bun.test.ts` targets the bounded queue internals and cannot absorb
   pure render-check cases cleanly):
   - every REQ-3432-01 boundary case as emit / no-emit assertions, asserting both the
     `onOutputEvent` call and the `outputRef.current` update;
   - an exactness matrix: for a set of mutated outputs, emit decision equals
     `JSON.stringify(prev) !== JSON.stringify(next)` (specification computed in the test).
3. `packages/core/src/recording/SessionRecordingService.test.ts` or
   `SessionRecordingService.payloads.test.ts` (extend):
   - WeakRef retention: enqueue a non-materializing event whose payload object is dropped
     by the caller; `Bun.gc(true)`; the payload is collectable while the record is still
     pending; then flush/dispose and verify the on-disk line still contains the payload;
   - on-disk byte identity and ordering across a mixed enqueue sequence (extend existing
     golden-style coverage if not already present).

## Allocation evidence (issue criterion 2, #3426-style measurement)

Not a permanent CI test; a before/after measurement captured on this branch:

- Fresh-process script (kept in `tmp/`, gitignored) that builds a fixed 80×24 headless
  terminal with representative streaming content, runs N render ticks
  (`serializeTerminalForRender` + change check) with unchanged state (no-change path) and
  with appending content (change path), and reports allocated bytes via
  `bun:jsc` sampling profiler (method used in #3426) or heap-growth delta.
- Run once on `main` (baseline) and once on the branch; numbers recorded in this plan's
  Progress section and in the PR body.

## Implementation steps

1. Capture the baseline allocation measurement on `main` (script above).
2. RED: add the tests above (focused helper tests first, serializer equivalence, recorder
   retention). Confirm they fail against current code.
3. Implement REQ-3432-02 serializer changes (scratch cells + colorless mode) — GREEN.
4. Implement REQ-3432-01 change check — GREEN.
5. Implement REQ-3432-03 recorder single representation — GREEN.
6. Full verification cycle (`npm run test`, `lint`, `typecheck`, `format`, `build`, bun
   smoke test with `zai-glm-flash`), test-audit scanner diff vs `main`, after-measurement.
7. deepthinker review (compliance + intent), remediate within 2-round cap.
8. PR (no OCR per standing instruction to not run OCR until re-enabled).

## Known deviations / decisions

- The issue's fingerprint wording names "cursor position" as an emit trigger component.
  Raw cursor equality is deliberately not consulted: the current emit decision is purely
  `JSON.stringify` content equality (cursor affects output only through the token
  `inverse` flag), and acceptance criterion 1 demands the new check emit exactly when the
  serialization would differ. The staged structural comparison includes the cursor effect
  via `inverse` and preserves exact equivalence.
- "Pass default colors into the serializer" is realized as a serializer option that
  produces the colorless output directly (default/`''` fg/bg for every token); a literal
  `defaultFg`/`defaultBg` parameter alone cannot reproduce the strip path because
  palette/RGB colors would still be emitted. The observable contract (byte-identical
  colorless output, no per-token copy) is what matters.

## Progress (2026-09-16)

Implemented all three REQs via strict TDD; evidence below.

### RED → GREEN

- RED (`bun test` on untouched tree): 5 failures in
  `terminalSerializer.test.ts` colorless-mode cases (option did not exist;
  extra argument ignored at runtime → colored output failed the strip spec),
  1 failure in `SessionRecordingService.test.ts` WeakRef retention case
  (payload pinned by `PendingRecord.line`). The 13
  `shellPtyHelpers.bun.test.ts` REQ-3432-01 cases passed before AND after by
  design — exact behavioral equivalence is the contract, so they are the
  pinning spec for the refactor, not a RED suite.
- GREEN: all focused suites pass — `bun test` over terminalSerializer.test.ts,
  shellPtyHelpers.bun.test.ts, SessionRecordingService.test.ts,
  SessionRecordingService.payloads.test.ts, SessionRecordingService.bounds.test.ts:
  84 pass / 0 fail.

### Allocation evidence (harness: tmp/verify3432/alloc-harness.ts)

Method: fresh-process bun script; fixed 80×24 headless terminal (mixed
plain/palette/RGB/256-color/bold/dim text, blank lines, parked cursor);
per process, 50 warmup ticks then 7 rounds of [Bun.gc(true) → 500 no-change
ticks → heapUsed delta + wall time]; baseline captured by stashing only the
three implementation files (tests/harness untouched), 3 processes per side.
Raw outputs: tmp/verify3432/baseline.txt, tmp/verify3432/after.txt.

- ms/tick median per process — baseline: 0.0981 / 0.0954 / 0.0982; after:
  0.0833 / 0.0799 / 0.0822 (~15% faster, consistent across all processes).
- heapUsed delta medians hover near zero on BOTH sides (e.g. baseline
  3834/6534/2176 bytes/500 ticks, after 1434/4773/48) because JSC's generational
  collector reclaims the young garbage within each round either way, so a
  steady-state heap delta cannot discriminate. The honest reading: the removed
  allocation sources are structural (per tick: 24×80 = 1920 `Cell` instances,
  one token-copy object per emitted token, two full `JSON.stringify` strings),
  and the surviving cost is visible as the wall-time drop; the no-change render
  tick now performs zero serialization and zero object allocation beyond the
  serializer's own output construction.

### Deviations

- Harness hardened beyond the plan sketch (7 rounds × 3 processes, median
  reported) because a single 500-tick heapUsed delta was dominated by GC
  timing noise (first single-shot runs: 542 vs 1079 B/tick in the wrong
  direction); the multi-round protocol above is the trustworthy comparison.
- The wide-char pin test expects token text `a😀b` — actual current xterm
  behavior; the plan's "''→' ' normalization" is preserved verbatim in the
  implementation (the trail cell of the emoji simply does not surface a
  separate padded character today).
- The colorless `serializeTerminalForRender` path also dropped the
  structurally-dead `Array.isArray` filter (serializer output is AnsiLine[]
  by construction); colored path unchanged.

### Driver verification record (2026-09-16)

- Focused suites re-checked: 84 pass / 0 fail (same five files as above).
- `npm run lint`: exit 0 on touched packages. One pre-existing, unrelated
  failure on main: `packages/providers/src/openai/OpenAIStreamProcessor.ts`
  max-lines 801/800 (file byte-identical to main; CI lint selects affected
  packages only, so it does not gate this PR).
- `npm run typecheck`, `npm run format`, `npm run build`: exit 0.
- Smoke: `bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku
  and nothing else"` PASSED (tmp/verify3432/smoke.log).
- test-audit scanner: no new findings on touched files
  (tmp/scan-3432-branch/).
- Full `npm run test` (background, tmp/verify3432/test.log): every stage
  green except one isolated file — `packages/zed-acp/src/
  zed-session-lifecycle.test.ts` failed with `ENOENT reading
  packages/mcp/dist/.../jsonByteMeasurer.js`. Root cause: the suite was still
  running while `npm run build` rewrote workspace `dist/` trees (orchestration
  race, not a code failure; the artifact exists after the build finished).
  Re-verified: the file passes 12/12 in isolation
  (tmp/verify3432/zed-rerun.log) and the full zed-acp stage was re-run clean
  (tmp/verify3432/zed-stage-rerun.log). All other stages: 137/137 core
  isolated files, 755/755 CLI files, a2a-server, vscode-ide-companion 7/7.
- Direct-bytes allocation measurement attempted and abandoned on Bun 1.3.14:
  `heapStats().objectCount` cannot see eden allocations (control: 100k
  garbage objects AND 1000 retained young objects both show delta 0);
  `stopSamplingProfiler` is not exported; `samplingProfilerStackTraces()`
  returns empty traces for sub-second synchronous workloads; mimalloc stats
  are page-granular. Criterion-2 evidence therefore stands on the structural
  diff (per tick: 1920 Cells → 2, strip-copy graph → 0, 2 JSON strings → 0)
  plus the ~15% median wall-time drop above
  (tmp/verify3432/alloc-count.ts documents the dead-end method).

### Review (2026-09-16)

- Reviewer: tscoder-zai subagent (independent-review brief; deepthinker and
  the gpt56solhigh reviewer were both quota-exhausted at review time, and OCR
  is disabled until re-enabled).
- Verdict: APPROVE, findings: none.
- Reviewer's independent verification: 84/84 focused tests, typecheck clean,
  lint clean except the proven pre-existing OpenAIStreamProcessor.ts
  max-lines failure, build clean; plus a 400-round randomized equivalence
  fuzz (tmp/verify3432/review-fuzz.ts): 800 serializer checks vs a faithful
  HEAD-algorithm reference AND the legacy two-step colorless strip (0
  mismatches), 1200 emit-decision checks vs the JSON.stringify-inequality
  specification including slice-trim/same-reference cases (0 mismatches),
  cursor-only transitions 113/113 agreement.
- Key exactness argument confirmed: structural token equality is equivalent
  to JSON.stringify equality because every token is serializer-built with a
  fixed key order and primitive fields only, and `state.output` has a single
  writer; the raw cursor is deliberately not an emit trigger because the old
  behavior emitted purely on serialization equality (criterion 1 forbids
  over-emitting).


