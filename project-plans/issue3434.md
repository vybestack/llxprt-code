# Issue #3434 implementation plan

## Latest status (2026-10-02)

The development-mode DevTools queue identified as #3797 is now fixed in this branch. It is no longer deferred. The maintained Ink and React DevTools patches preserve connected inspection, late connection, reconnect, explicit profiling and Static output. Final-candidate development lanes show flat retained Array counts after cache warmup, with no dormant operation journal and released mounted tree roots. The 2026-10-02 section below records the implementation and verification evidence. Earlier sections preserve historical failures and the completed two-cycle review of the preceding emission candidate; they do not establish broad verification success for the additional lifecycle fix.

## Accepted contract

- In standard-buffer mode, post-cap additions emit every newly retained item exactly once and in order, without replaying retained history or the header. Whole-history `staticKey` remains stable. Cover item and UTF-8 byte caps, a small cap, consecutive append and multi-head eviction.
- Report cumulative genuine head evictions as `[N earlier messages truncated]`, outside the history budget; clear/load replaces that count. Scrollback already written belongs to the terminal. Do not add scrollback loading or purge.
- Resize, including storms and short heights, must not rerender/reprint committed history; pending controls adapt and later output uses current width.
- Preserve explicit refresh, clear, replacement, resume, same-length and overlapping IDs, alternate-buffer, and screen-reader behavior. Add only bounded tests for no-op/duplicate/retraction/empty budget cases needed to protect the emission change.
- Post-cap render/output work scales with newly emitted items and notices rather than retained content. Measure committed-item renders and output writes/bytes. Keep existing bounded ledger array-copy allocations distinct; do not redesign the ledger.

## Minimal design constraint

Use existing ledger/store state plus a replacement epoch and a private standard-buffer emission owner. Identify a newly retained suffix from bounded prior state, not numeric item ordering. Keep a single Ink `Static` owner; rotate only a delta-sized chunk. Keep chunk content and dimensions frozen after consumption. Header appears only on initial/explicit replay. Alternate-buffer rendering remains unchanged. Do not add a public abstraction, undocumented Ink integration, lifetime-growing ID/journal state, or dependency changes.

## Stop boundary

First test real Ink resize behavior, including short-height overflow. Ink 6.4.8's installed implementation calls `onRender` on resize and replays `fullStaticOutput` when `lastOutputHeight >= stdout.rows`. If the supported layout reaches that branch and satisfying the contract requires a dependency/patch change, stop and report evidence for approval.

## Evidence and verification

Use real Ink and the production layout/store/HistoryItemDisplay/markdown in behavioral tests. Record TDD red/green output, resize and tmux evidence, render/write/byte measurements, and profiler findings under `tmp/verify3434/`. Do not claim #3430 workload coverage if unavailable. Run targeted tests, interactive suite and test-audit for changed tests, then `npm run format`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, and `bun scripts/start.ts --profile-load luna 'write me a haiku and nothing else'`. No OCR, commit or push.

## Executed resize boundary evidence (2026-10-01)

**RED: the production standard-buffer UI re-emits committed history on short resize and live overflow.** This conclusion comes from executed output tests, not just the dependency source branch.

Added `packages/cli/src/ui/layouts/default-app-layout.resize.test.tsx`. It uses real Ink public exports, DefaultAppLayout and its UI leaves, HistoryItemDisplay/MarkdownDisplay, and turn/terminal stores. Only unrelated runtime services and the non-CI environment are stubbed. Infrastructure captures `process.stdout.write`, changes `process.stdout.columns/rows`, emits the stdout `resize` event, then updates the terminal store through its commands. This is an in-process stream harness, not an OS PTY/CLI run. Both root and CLI-preloaded runs reach the interactive renderer. No tmux fallback was needed.

Fixtures use standard-buffer settings, `constrainHeight: true`, pending markdown prose, real waiting-for-confirmation/loading and Ctrl+C controls, and inactive composer input. The static header is suppressed to isolate committed history. This run does not claim header, active composer, alternate-buffer, screen-reader, history-cap, or #3430 workload coverage.

The committed input is `**OLD3434_COMMITTED**`; real markdown renders `  OLD3434_COMMITTED\n` once initially. The following counts exclude initial emission. `staticKey` stays 0 throughout.

| Case | Live height before/after | Old sentinel count: event / store update | Emitted bytes: event / store update | Result |
| --- | --- | --- | --- | --- |
| 100x40 to 40x40, one pending paragraph | 5 / 7 | 0 / 0 | 184 / 0 | PASS |
| 100x40 to 40x4, six paragraphs | 15 / 27 | 1 / 1 | 562 / 562 | RED |
| 100x40 to 30x40, twelve paragraphs | 27 / 63 | 0 / 1 | 1255 / 1062 | RED |
| Pending grows from empty to thirty paragraphs, then 80x24 resize | 4 to 63, then 93 | 1 / 1 on resize | 2418 / 2418 | RED |

The fitting-width case also appends a new committed item at 40 columns. Its 282-byte delta contains the new text wrapped across three lines, with no old sentinel. The storm 80x30, 40x4, 60x12, 100x40 yields replay counts `[0, 0, 1, 1, 1, 1, 0, 0]` across event/store deltas. Public controls yield `[0, 1, 1, 1]` for `clear()`, resize event, store update, and `recalculateLayout()`.

Every replay write starts with the exact sequence `\u001b[2J\u001b[3J\u001b[H  OLD3434_COMMITTED\n`. The sentinel is 17 UTF-8 bytes and its rendered static line is 20 bytes. Short shrink adds 40 old-history bytes across two 562-byte writes, plus clear-screen and clear-scrollback sequences. Assertions expect zero replay; the erroneous behavior remains RED.

### Mechanism and scope decision

- `DefaultAppLayout.tsx:110-131` has no standard-buffer root height/clipping; `:248-269` combines Static and a dynamic pending region.
- `DefaultAppLayoutHelpers.tsx:117-182` builds committed HistoryItemDisplay elements; `:184-239` passes available height into pending items. Pending prose exceeds terminal height despite the constrained fixture. `MarkdownDisplay.tsx:723-740` specifically limits pending code-block lines, not the whole dynamic region.
- Installed `node_modules/ink/build/ink.js:163-166` handles resize with calculateLayout/onRender. At `:294-311`, previous dynamic height >= new rows triggers clearTerminal plus cached fullStaticOutput plus current output. Width-only overflow first writes a larger dynamic frame; the subsequent store render triggers replay.
- Public `clear()` at `ink.js:435-439` clears log-update output, without resetting retained static bytes or lastOutputHeight. Public `recalculateLayout()` at `:332-336` invokes the same rendering path. Both were executed against the production layout. `node_modules/ink/build/render.js:31-45` and `render.d.ts:117-154` expose no static-cache reset or replay opt-out.

**The STOP boundary is now supported by behavior.** Under the accepted single-Ink-Static, standard-buffer, no-scrollback-purge contract, a dependency-level fix needs approval before implementation. Rotating app Static chunks or freezing their dimensions cannot remove Ink's cached history. Clipping pending output alone cannot guarantee safety when sudden shrink compares the previous live height with the new row count. Changing to screen-reader/alternate-buffer mode or replacing Static with direct stream writes changes protected behavior or the accepted design. No dependency/patch changes were made.

### Commands and validation

- Root: `bun test packages/cli/src/ui/layouts/default-app-layout.resize.test.tsx` -> exit 1, 1 PASS / 5 RED, 25 assertions. Log: `tmp/verify3434/resize-red.log`.
- From `packages/cli`: `bun test ./src/ui/layouts/default-app-layout.resize.test.tsx` -> exit 1, same result with workspace preloads. Log: `tmp/verify3434/resize-cli-preloads.log`.
- `bunx prettier --write packages/cli/src/ui/layouts/default-app-layout.resize.test.tsx` -> exit 0.
- `bunx eslint packages/cli/src/ui/layouts/default-app-layout.resize.test.tsx` -> exit 0. Log: `tmp/verify3434/test-lint.log`.
- `bun scripts/test-audit/scan.ts tmp/verify3434/test-audit` -> exit 0; no findings for the added test, whose file-stats row is present.
- `bunx tsc --noEmit -p packages/cli/tsconfig.noemit.json` -> exit 2. Checkout core declarations have a scheduler mismatch: Config.disposeScheduler(sessionId: string) versus UiRuntimeBareSource.disposeScheduler(owner, purpose, handle). Existing layout/other tests report the same Config/runtime-builder errors; the new test reports those two builder-call errors too. Logs: `test-typecheck.log` and `test-typecheck-final.log`. No unrelated type/build changes were made.
- Attempted `bun --cwd packages/cli test ./src/ui/layouts/default-app-layout.resize.test.tsx` resolved to the package test script, which ignored the file argument and launched the workspace suite. The shell timeout terminated it. No whole-suite success is claimed. Log: `resize-cli-config.log`. The direct cwd invocation above subsequently ran only the intended file.
- `bun tmp/verify3434/summarize.ts` writes `tmp/verify3434/summary.tsv`. Each case has JSON with delimited raw stage bytes and a concatenated `.stdout` artifact.

This is test-only evidence work with intentionally failing regressions. No full-repository verification success is claimed. No live-model smoke, OCR, commit, push, production/dependency/patch/workflow/quality-rule/memory changes were performed.


## 2026-10-01 continuation status

The user rejected the dependency stop boundary. Updated the existing maintained `patches/ink+6.4.8.patch` and its installed Ink working copy so the standard-buffer overflow/resize branch emits newly produced Static bytes, clears only Ink's live log-update region, and redraws current dynamic output. It no longer sends `clearTerminal` plus the entire retained static transcript. This retains the standard-buffer path and its terminal scrollback. The existing six real-Ink resize tests are now GREEN (6 pass, 0 fail, 25 assertions); run output is `tmp/verify3434/resize-green.log`. The patch was regenerated with `bunx patch-package ink`; no package version or dependency declaration changed.

This continuation is **incomplete**. It does not yet implement the bounded application-side delta/chunk emission owner, truncation count, default/small cap behavior, replace/resume bookkeeping, or committed-history churn/retention measurement. No cap or tmux tests were added, and no tmux/interactive workload was run. The overflow patch makes the resize regressions pass but does not solve the Static positional cursor at the ledger cap. Do not treat issue #3434 as finished.

Validation so far: `npm run format` exit 0; resize regression exit 0; test-audit command exit 0 with 2,106 corpus findings, which still needs changed-test-specific comparison/inspection (`tmp/verify3434/test-audit/`); smoke command's wrapper exit is 0 but its CLI output reports `Profile 'luna' not found`, so smoke did not succeed. `npm run lint` remains in progress at the time of this update. Full lint/typecheck/test/build and interactive suite have not completed. No profiling or terminal scrollback evidence exists yet.

Findings classification: **In-scope-Fix**: Ink resize/overflow automatic full static replay removed and regression tests green. **Blocker-Fix / unfinished**: app-side incremental static emission and cap/truncation semantics remain unimplemented; complete before acceptance. **Defer**: exact #3430 workload unavailable; construct the requested deterministic equivalent using actual committed items before final. **Reject**: no version bump, dependency install, OCR, enforcement changes, or unrelated edits.

## 2026-10-01 bounded Static implementation completed

The bounded application-side feature is implemented and its targeted behavior tests pass. This section supersedes the earlier stop boundary and incomplete continuation status. It does not claim full-repository acceptance.

### Production design and changed files

- `packages/cli/src/ui/layouts/DefaultAppLayout.tsx`: the standard-buffer branch now owns one private `StandardStatic` component. It compares the current history IDs with the previous committed, bounded snapshot by equality, without timestamp ordering. Only new retained items become React elements. Each nonempty delta remounts the single Static owner; a layout effect consumes the snapshot after commit and releases the emitted body elements. There is no accumulated chunk list, lifetime ID set, service, or emission journal. The virtualized list is built only in the alternate-buffer branch. Geometry is sampled for each new emission, not used to recreate committed history on resize.
- `packages/cli/src/ui/stores/turn/historyLedger.ts`: `truncatedItems` accumulates actual budget head evictions, including multi-head byte evictions and limit/update trims. Retractions, duplicate suppression, rejected admission and fitting an oversized body do not increment it. Clear/load replace the count. A zero-item budget does not admit candidates.
- `packages/cli/src/ui/stores/turn/turnStore.ts`: publishes `historyTruncatedItems` with the bounded history and `historyEpoch` on clear/load. The epoch makes replacement histories with overlapping IDs visible. `staticKey` remains the explicit refresh channel; ordinary capped appends leave it unchanged.
- `patches/ink+6.4.8.patch`: retains the authorized standard-buffer resize/overflow change and all pre-existing cache bounds. A terminal-emulator regression exposed an erase-order defect: writing the delta before clearing live output erased the new item. The overflow path now clears live output first, emits the delta, then redraws live content. No version or dependency declaration changed.
- New tests: `packages/cli/src/ui/layouts/default-app-layout.cap.test.tsx` and `packages/cli/src/ui/stores/turn/history-evictions.test.ts`. The default-state expectation in `turnStore.test.ts` includes the two new fields. The existing `default-app-layout.resize.test.tsx` keeps all six behavioral cases and 25 assertions. Both real-stream suites use Node timer/file I/O infrastructure to avoid importing Bun's broad global fetch types; their runner remains `bun:test`.

### Executed red and green evidence

Before production edits, the cap-2, replacement, lower-timestamp/removal and default-cap cases failed because new output disappeared; byte-cap and churn cases also failed on the first post-cap item. Store tests failed on absent eviction metadata. Logs: `cap-red.log`, `cap-bytes-churn-red.log`, `evictions-red.log` under `tmp/verify3434/`.

The overflow emulator regression then failed with the new marker present in raw stdout but absent from terminal contents. Its red/green evidence is `overflow-visible-red.log` and `overflow-visible-green.log`.

Final real-stream execution from `packages/cli`, including workspace preloads:

- Cap suite: **14 pass, 0 fail, 7,261 assertions**, `cap-green.log`. Covers cap 2 and 399/400/401, sequential and batched/disjoint additions, retraction then append, lower timestamps, resume additions, clear/load with overlapping IDs, genuine notices outside the cap, header-once and explicit replay, rendered markdown refresh, current-width output, screen-reader fallback, no-op/duplicate/rejected admission, oversized-body fitting, exact 4 MiB serialized UTF-8 input and multi-head overflow with ASCII/multibyte bodies.
- Existing resize suite: **6 pass, 0 fail, 25 assertions**, `resize-delta-green.log`.
- Store suites: **40 pass, 0 fail, 102 assertions**, `evictions-green.log`.
- Existing layout isolation: **4 pass, 0 fail**, `isolation-green.log`; rendering/buffer selection: **6 pass, 0 fail**, `layout-rendering-green.log`; helper tests: **5 pass, 0 fail**, `helpers-green.log`.
- Changed-file Prettier check and ESLint: exit 0, `scoped-format.log` and `scoped-lint.log`.
- CLI no-emit source typecheck and Bun-test typecheck: exit 0, `delta-typecheck.log` and `delta-test-typecheck.log`. Earlier direct imports from `bun` widened global fetch declarations and caused unrelated preconnect diagnostics; the scoped test-infrastructure import fix eliminated them without changing production fetch code or configuration.
- Test audit: no new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING or NO_ASSERT findings in the new suites. The remaining new-suite findings are DUP_ASSERT checks of unchanged counts across distinct operations. Existing `turnStore.test.ts` findings predate this change. Audit artifacts: `delta-test-audit/`.

### Measured post-cap work

`cap-metrics.json` records four lanes, each with 220 separately committed production-store additions. Every addition prints its marker exactly once, renders one new HistoryItemDisplay and zero previous items, leaves zero committed HistoryItemDisplay bodies mounted after consumption, and retains exactly one Static owner. The observer is the real reconciler's performed-work flags; initial fixtures assert positive observed renders so the zero result cannot come from an inactive observer.

| Retained item cap | Retained serialized bytes during lane | Output bytes per addition | Previous-item renders |
| --- | --- | --- | --- |
| 25 | 1,420 to 1,750 | 63 to 65 | 0 |
| 100 | 5,695 to 7,000 | 63 to 65 | 0 |
| 400 | 23,395 to 26,020 | 63 to 65 | 0 |
| 400, near byte cap | 4,190,223 to 4,192,848 | 63 to 65 | 0 |

Mean emitted bytes are 64.509 in every lane, including the cumulative notice. Retention stays below 4,194,304 bytes. These are deterministic output/render and bounded-state measurements, not heap-profiler or OS PTY results. The ledger's bounded reference-array copy/projection costs were intentionally not redesigned.

### Remaining verification

No duplicate broad verification jobs were launched. The inherited jobs report full lint exit 1 (`sandbox-container-name.bun.test.ts:76`, unrelated unnecessary conditional), full typecheck exit 1 from dist-test-artifact guards, full test exit 1, and build exit 0. Those jobs started before the completed candidate and do not establish final-candidate acceptance. The full test log includes SessionDiscovery and CLI profile integration failures, plus the intermediate screen-reader fixture whose timestamp collided with seeded IDs; that fixture was corrected and passes in the final targeted run. The inherited interactive job completed with 17 pass and 2 fail: slash autocomplete expected `llxprt-code` on screen, and always-allow expected two matching calls but observed one. Those broad failures still require final-candidate triage. Live smoke remains unproven because the installed profiles do not include luna. Final-candidate broad verification, a supported installed-profile smoke, issue-specific OS PTY/tmux evidence and heap/allocation profiling remain follow-up work. Exact #3430 workload coverage is not claimed.

No OCR, final review, commit, push, quality-rule/workflow edits, global settings changes or agent-memory edits were performed.


## 2026-10-01 final-candidate verification and terminal/heap evidence

**The cap/resize feature has passing behavioral and real-terminal evidence. Repository acceptance remains blocked by failing full-test and interactive gates.** This section supersedes the preceding remaining-verification status. It is verification work, not the independent production review.

All artifacts below are under `tmp/verify3434/final/`. No production edits, maintained-test assertion changes, dependency installs, configuration/memory/workflow/enforcement changes, OCR, commit or push were made in this evidence mission. The isolated main worktree is at `baseline/`, commit `f3839b881`, with its own workspace links and main's installed Ink patch. Its tracked source remains clean.

### Required commands and focused checks

| Command | Exit | Evidence |
| --- | ---: | --- |
| `npm run format` | 0 | `format.log`, `format.status` |
| `npm run lint` | 0 | `lint.log`, `lint.status` |
| `npm run typecheck` | 0 | `typecheck.log`, `typecheck.status` |
| `npm run test` | 1 | `test.log`, `test.status` |
| `npm run build` | 0 | `build.log`, `build.status` |
| `bun scripts/start.ts --profile-load gpt-6-luna 'write me a haiku and nothing else'` | 0 | `smoke.log`, `smoke.status`; real haiku returned |
| `npm run test:interactive-ui` with isolated artifact directory | 1 | `interactive.log`, `interactive.status`; 17 pass, 2 fail |
| Focused cap suite | 0 | `cap.log`; 14 pass, 7,261 assertions |
| Focused resize suite | 0 | `resize.log`; 6 pass, 25 assertions |
| Eviction and turn-store suites | 0 | `stores.log`; 40 pass, 102 assertions |
| Candidate test audit | 0 | `test-audit/`, `audit-comparison.json` |

`luna` is absent, so the installed `gpt-6-luna` profile was used without changing stored configuration or credentials. The smoke log contains three haiku lines, not a profile-not-found message. Earlier lint/dist/scheduler failures did not recur in these final candidate checks. No out-of-scope source fix was made to obtain these results.

### Failed gates and executed main comparisons

- Full core tests: **458/460 files pass**. `SessionDiscovery.test.ts` fails its explicit 30,000 ms property-test budget on both attempts. A clean-main focused command using the actual 180,000 ms runner default preserves that explicit override and fails at 30,603.74 ms. Evidence: `baseline-session-discovery-exact.log`. Reported on [#3790](https://github.com/vybestack/llxprt-code/issues/3790). The earlier whole-file diagnostic used a 30,000 ms command-line default; its additional property failures are not default-runner evidence.
- `resumeSession.test.ts` exceeds the unchanged 300-second file budget on both candidate attempts. Clean main, run through its actual `runTestFile` and fake-home isolation, **passes 20 tests at 298.40 seconds**, close to that budget. This does not reproduce the timeout on main and does not prove a cause. Evidence: `baseline-resume-session.log`, `baseline-resume-session.json`. Filed [#3795](https://github.com/vybestack/llxprt-code/issues/3795); preserve it as an unresolved gate failure rather than claiming it unrelated.
- Full CLI tests: **765/767 files pass**, 9,822 passing cases and 12 failing cases. Both profile integration suites receive `Provider 'gemini' not found` before making the expected request. Clean main reproduces the same 12 failures, 19 pass across those two suites. Evidence: `baseline-cli-profile.log`. Added proof to [#3784](https://github.com/vybestack/llxprt-code/issues/3784). All remaining workspace runners finish; the full command exits 1.
- Candidate slash autocomplete fails the existing screen assertion for literal `llxprt-code`; the working-directory footer wraps it between `llxprt-c` and `ode`. Clean main's full interactive suite passes **19/19 in its own directory**, but its CLI launched from the candidate working directory reproduces the exact slash assertion failure. Evidence: `baseline-same-cwd-slash.log` and captures. Filed [#3793](https://github.com/vybestack/llxprt-code/issues/3793). No assertion was softened. Always-allow passes in the final candidate suite, so its inherited failure does not recur.
- The candidate interactive memory test initially reports post-clear RSS growth **120,471,552 bytes**, exceeding its existing **100,663,296-byte** limit. It passes on repetition and on clean main. A separate exact-file candidate run after all broad checks finish also passes: RSS baseline **466,878,464**, post-clear **557,301,760**, growth **90,423,296**. Evidence: `interactive-memory-serial.log` and its own `memprofile/samples.jsonl`. The initial failure remains intermittent and unattributed; a passing repetition does not establish that it is unrelated to #3434. Filed [#3794](https://github.com/vybestack/llxprt-code/issues/3794).

No failures were corrected by changing assertions, thresholds, timeout budgets or enforcement. Fixes to recording/provider issues are outside this mission. The minimal next scope is diagnosis of the recorded gate failures without weakening their checks; production remedies or assertion changes require separately authorized work.

### Executed OS PTY/tmux cap and resize evidence

The temporary driver uses the existing tmux harness and fake-provider fixtures, an actual attached OS PTY client, and only temporary settings. With cap **25**, it commits **36 user items and 36 model items plus one initial item**. The exact `[48 earlier messages truncated]` notice matches 73 minus 25. Each of the 36 committed model markers occurs once in terminal scrollback before and after resize. The generated scenario also resizes after turn 17, then verifies all later committed outputs.

Five postcommit resize raw deltas at **40x4, 80x12, 100x40, 32x4 and 100x40** contain **1,614 / 1,218 / 722 / 1,422 / 1,478 bytes**, respectively, with **zero old model markers, zero old user markers and zero clear-scrollback sequences**. An active copy-mode viewport at history-top contains the evicted first model response; another contains the newest response and truncation notices. Position/height metadata accompanies the actual mode viewport captures, avoiding the unpositioned `capture-pane -M` backing-grid ambiguity.

Driver status is 0. Evidence: `pty-final.log`, `pty-final/metrics.json`, raw deltas, before/after scrollback, `copy-mode-old.txt`, `copy-mode-tail.txt` and viewport metadata. Details and attempt limitations: `terminal-notes.md`. Pending/live model frames may repeat markers in raw output during a turn; once-only assertions use committed scrollback and postcommit deltas, not those live frames. The evidence driver initially needed its own native client helper terminated after assertions and session teardown to exit; temporary cleanup now explicitly kills that client.

### Executed retained-heap and array-copy measurements

`heap.test.tsx` extracts the real production cap harness into an ephemeral Bun test. It omits emulator scrollback from the heap run, checks every output and render, and forces JSC GC before each append and at checkpoints. Four layout lanes at **25/100/400 and 400 near 4 MiB** each have 20 committed warm-up additions and **four equal 50-append measured intervals**. Four separate store-only lanes execute equal intervals. The final run passes **8/8**, with evidence in `heap-no-matcher-retention.json` and `.log`.

All four layout lanes emit **13,681 raw bytes over 200 measured appends**, with **zero old renders**, one Static owner and zero committed bodies left mounted. The near-byte lane's interval-end serialized retention is **4,191,198 to 4,193,478 bytes**, below 4,194,304. Final-interval force-GC process-wide retained-heap change per append is **7,769.16 / 2,311.78 / 1,409.92 / 1,153.08 bytes**, respectively. Earlier equal intervals include large negative collection effects. These are retained-heap changes, not cumulative allocation bytes or application-only attribution.

Retained Array counts increase by **150/151 per 50 appends** at caps 100/400, and **2,640 to 2,690** at cap 25. Removing Bun matcher assertions from the temporary measured loop does not eliminate this growth. The measurement does **not** prove a long-run plateau or no heap leak, nor attribute the arrays to application, Ink, React, Markdown caches or harness/runtime state. Do not convert committed-body release into a general heap claim.

A separate production-store footprint driver executes **600 checked appends each on candidate and main**, measuring fresh ledger/public arrays and JSC backing-vector capacities. Known backing storage per append is **400.32 to 432.00 bytes at cap 25**, **1,607.20 at cap 100**, and **6,787.84 to 7,385.76 at cap 400**. Main is essentially identical: **400.64 to 432.00 / 1,607.20 / 6,787.84 to 7,385.76**. Each interval observes 50 fresh ledger arrays and 50 fresh published-history arrays. This cap-dependent bounded-store allocation is unchanged and distinct from Static/body rerender churn. The bytes exclude headers, intermediate arrays, entry objects and native memory.

Bun's immediate `heapSize()` counter is stale between safepoints, validated by an explicit 10,000-object allocation probe. JSON positive live-heap-growth fields therefore are only limited observations, **not exact allocated bytes**. Evidence and limits: `memory-notes.md`, `store-footprint.json`, `baseline-store-footprint.json`. No allocation-sampling stack attribution, full baseline layout performance claim or #3430 exact-scenario claim is made. Real committed equivalent workloads were executed; profiling was not deferred.

### Test audit and final boundary

Comparing candidate and main findings while ignoring line-number shifts yields **nine new DUP_ASSERT findings and zero new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING or NO_ASSERT findings** across changed maintained tests. The duplicate checks verify unchanged counts across distinct mutations/no-ops; existing turnStore identity findings predate the change. Evidence: `audit-comparison.json` and both audit output directories. No behavior assertion was removed.

All managed evidence/check jobs have exited or were explicitly cancelled and collected. No broad job remains running. The candidate production diff remains the implementation supplied to this mission; the evidence worker only added temporary artifacts and this final status section. Acceptance is not marked complete because the full-test/interactive gates and the intermittent RSS attribution remain unresolved.

## 2026-10-01 accepted-finding remediation and attributed MEMORY evidence

**F1 and F2 are fixed. The production renderer reaches a retained-heap plateau; the earlier growing Array traces have identified owners.** Final interactive verification passes 19/19, and both final RSS repeats pass. The full workspace test command remains red on the reproduced SessionDiscovery and Gemini profile failures detailed below. This mission performs implementation and verification only, with no review round, OCR, commit or push.

### Required triage

| Finding | Classification | Disposition |
| --- | --- | --- |
| F1: missing artifact parent and write-before-cleanup | Blocker-Fix, high | Fixed. Both maintained suites create a workspace-rooted parent and a fresh `mkdtemp` child before rendering. Resize unmounts real Ink and restores captured stdout, dimensions and environment before artifact writes. Fresh absent-parent red/green runs and an injected EISDIR write failure verify this behavior. |
| F2: retained-sized snapshot ID Set | In-scope-Fix, medium | Fixed. StaticSnapshot holds the existing bounded prior history reference, without an ID array or Set. An ordered two-pointer scan skips retained IDs and slices only the newly appended suffix. Replacement epochs still replay; timestamp ordering is irrelevant. |
| F3: full interactive slash/RSS failures | Blocker-Fix | Final unchanged complete-context interactive gate passes 19/19; both final serial RSS repeats pass. Lifetime-retention investigation has attributed roots and production plateau evidence. Original native/RSS variance remains recorded in #3794, without claiming it unrelated. |
| F4: terminal copy-mode and resize evidence | In-scope-Fix | Resolved. Preserve `final/pty-final/`: actual copy-mode old-first and current-tail captures, notices, and five resize deltas without old markers or ESC[3J. |
| D1: inherited maxBytes=0 reduction retaining a 48-byte item | Defer | Not changed. This ledger behavior is outside the accepted emission change. |
| R1: require zero tiny Static mounts or claim terminal purge | Reject | Neither is the contract. Delta-sized chunk replacement is permitted, and emitted terminal scrollback is not purged. |

### Red/green and bounded implementation

Artifacts for this mission are under `tmp/verify3434/remediation/`. Existing shared artifacts were not deleted. `fresh-artifacts.json` records four isolated source fixtures: cap and resize each fail with ENOENT when their fresh parent is absent and initialization is omitted, then pass with maintained initialization. `artifact-failure.log` records deliberately failing artifact output with successful restoration of stdout.write, columns, rows, suppression environment and resize listener count. The injected failure is a diagnostic fixture, not a weakened maintained assertion.

The retained-sized allocation invariant failed before F2: actual source-extracted snapshot construction allocated ID Sets with 25, 100 and 400 entries. `static-red.log` records the failing invariant. After F2, `static-green.json` records zero snapshot ID containers at all three caps, and the real JSC description of each one-item delta has public length 1 and vector length 3, independent of retained count. The prior filter produced vector length 5. These are attributed reference-vector/container measurements, not heap-growth estimates. The unchanged ledger vectors remain separately documented in `final/store-footprint.json` and its clean-main counterpart: approximately 400/1,607/6,788 bytes per append at caps 25/100/400.

A new maintained behavioral test verifies removed-tail then append in one commit, followed by a head removal and a lower-timestamp append, without replaying survivors. This behavior already passed the Set implementation and protects the optimization. Existing tests cover overlapping-ID replacement epochs, fully disjoint batches, lower timestamps, same-ID updates followed by refresh, and duplicate/no-op commands. The allocation invariant supplies the failing pre-optimization regression; the behavioral tests preserve the emission contract.

### Non-test long-lived renderer and retained roots

`render-driver.tsx` mounts the production DefaultAppLayout, HistoryItemDisplay/markdown and turn/terminal stores using real Ink and production context providers. Only unrelated runtime service access is supplied by a temporary Bun loader. It imports no Bun test framework, test render helper or act; installs no fiber observer; and uses a Writable sink that counts markers and bytes but discards each frame. Every append checks exactly one new sentinel, zero previous sentinels and the unchanged item cap. Metrics are appended to a file rather than accumulated in a lifetime-growing array. Each equal 100-append checkpoint settles multiple turns and performs three GC sweeps with turns between them.

Executed lanes: cap 25 has 100 warm-up plus 3,000 measured appends; caps 100 and 400 each have 100 warm-up plus 2,000 measured appends. All exit 0. The late production intervals contain 47,034 to 47,044 Arrays, with all checkpoints from append 1,600 onward at exactly 47,044. Late settled heap ranges are 93,134,517 to 93,670,723 bytes at cap 25, 93,262,848 to 93,688,411 at cap 100, and 93,265,743 to 93,761,510 at cap 400. There is no per-append retained Array slope after warm-up. Snapshot-enabled cap 25 has 125 FiberNodes both before and after 3,000 appends. Snapshot creation itself raises RSS substantially; that lane is retained-root evidence, not an RSS-gate substitute.

The near-byte-cap non-test lane completes 100 warm-up plus 200 measured appends with cap 400. Its final serialized history is 4,194,108 bytes, below 4,194,304. It emits 14,800 measured bytes, with every sentinel checked and no replay. It does not run long enough to claim cache saturation. The small-message lanes emit 150,201 bytes for 2,000 appends and 226,201 for 3,000, independent of retained item count.

Three observed Array owners are now distinguished:

1. **Ink styled-character cache warming.** Strong snapshot edges go from DataLimitedLruMap entries through `value` character arrays to each character's `styles` Array. At production cap 25, the cache grows from 225 value arrays and 4,747 style arrays to 1,311 and 32,767. Its data size settles at 65,534 under the existing 65,536 limit. Width-cache retention remains 34 one-character keys. This is bounded existing renderer retention, not old transcript fibers.
2. **The original profiler's stdout spy call histories.** The saturated-cache differential probe checks the same output while retaining or clearing spy argument histories. Without clearing, calls grow from 3,003 to 3,603 and retained Arrays from 51,786 to 52,361 over 200 appends. With only spy histories cleared, each take sees three calls, and Arrays change from 48,779 to 48,753. That identifies the original roughly three-Arrays-per-append observation. The production driver has no spy.
3. **Disconnected development-mode React DevTools.** A separate DEV=true production-layout lane retains 202 then 6,202 operation Arrays in `pendingOperationsQueue` over 3,000 appends, with FiberNodes unchanged at 125. After cache saturation, the residual slope is exactly two Arrays per append. Clean-main Ink with ordinary keyed Text children and no Static reproduces 1 then 501 queued operation arrays over 500 visible updates; a same-key Text control stays at 1. This pre-existing non-Static root is filed as [#3797](https://github.com/vybestack/llxprt-code/issues/3797). No DevTools, dependency, runtime configuration or enforcement source was changed in this candidate. DEV=false is an ephemeral attribution control, not a modification to the interactive RSS fixture, which still uses development mode.

Source ownership is explicit: Ink `measure-text.js` uses the bounded DataLimitedLruMap; `react-devtools-core/dist/backend.js` appends structural operation arrays to pendingOperationsQueue until frontend connection. Root counters are in `long100/retained-roots.json`, `production25/retained-roots.json`, and both clean-main Text controls. No main capped-silence result is used as a performance comparison.

### Initial RSS failure investigation

`memory-summary.json` also compares all three historical forced-GC checkpoints. The original failing RSS run grows by 120,471,552 bytes, but live heap grows only 2,848,577 bytes, heap capacity by 13,932,241, object count by 99,096, and extra memory falls by 802,271. The successful serial candidate run grows RSS by 90,423,296, live heap by 6,754,848, capacity by 12,601,488 and objects by 103,749. Clean main grows RSS by 78,692,352, live heap by 5,467,229 and objects by 103,000.

Thus the initial RSS excess does not coincide with a larger live-object or live-heap increase. The production lifetime root investigation finds a plateau and attributes the development/test-only slopes above. These observations do not identify the original native/RSS variance, whose failed process was not heap-snapshotted. Keep [#3794](https://github.com/vybestack/llxprt-code/issues/3794) and its unchanged 96 MiB gate; do not claim the original failure irrelevant.

### Final candidate verification results

All maintained source edits preceded this verification sequence. Runner defaults, installed profiles, fixture gates and assertions were unchanged. `dev-docs/bun.md` confirms that `npm run test` is the uncredentialed workspace suite; credentialed integration/eval roots are separate. Existing CLI/core isolated-file runners provide preload and fake-home setup. No unrelated provider or recording change was made.

| Final command/check | Exit | Result/evidence |
| --- | ---: | --- |
| `npm run format` | 0 | Full repository format; `remediation/format.log` |
| `npm run lint` | 0 | All 18 lint roots, including existing complexity/source-size rules; `remediation/lint.log` |
| `npm run typecheck` | 0 | Full typecheck; `remediation/typecheck.log` |
| `npm run test` | 1 | Core 459/460 files; CLI 765/767 files; every remaining workspace runner passes. See failure attribution below. |
| `npm run build` | 0 | Full build; `remediation/build.log` |
| Live `gpt-6-luna` haiku smoke | 0 | Real three-line haiku; `remediation/smoke.log`. This installed profile replaces absent luna for this run. |
| Cap maintained suite | 0 | 15 passing cases, 7,268 assertions; `remediation/cap-green.log` |
| Resize maintained suite | 0 | 6 passing cases, 25 assertions; `remediation/resize-green.log` |
| Candidate eviction/turn-store target group | 0 | 40 passing cases across two candidate files, 102 assertions; `remediation/stores.log`. Its combined 77-case summary also includes 37 clean-main comparison cases and is not the candidate count. |
| Existing Ink retention/cache target group | 0 | 22 passing cases across four files, 2,120 assertions; `remediation/ink-cache.log` |
| Test audit | 0 | Nine new DUP_ASSERT findings and zero new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING or NO_ASSERT findings after ignoring baseline line shifts; `remediation/audit-comparison.json` |
| Full unchanged interactive suite, complete workspace context and stable path | 0 | 19 pass, 0 fail; `remediation/interactive-complete-context.log` |

The final full test failure is confined to `SessionDiscovery.test.ts` and the two Gemini CLI profile integration files. SessionDiscovery repeats the explicit 30-second property timeout on both attempts; clean main has already reproduced that same budget failure in `final/baseline-session-discovery-exact.log` ([#3790](https://github.com/vybestack/llxprt-code/issues/3790)). CLI records 9,823 pass and 12 fail, with `Provider 'gemini' not found` before the expected API request; clean main reproduces those same 12 failures in `final/baseline-cli-profile.log` ([#3784](https://github.com/vybestack/llxprt-code/issues/3784)). `resumeSession.test.ts` now passes all 20 cases in the unchanged full runner at 131.05 seconds. Its earlier two candidate timeouts and the 298.40-second main pass remain historical variability, not a proven cause; [#3795](https://github.com/vybestack/llxprt-code/issues/3795) was updated with the passing result.

The stable isolated launch copies scripts byte-for-byte, links candidate packages/dependencies and exposes the existing project context through a link outside the workspace. `interactive-launch.json` records hashes for the test and memory fixture/assertions. An initial incomplete launch omitted project skills, so its six skill-approval failures are setup failures and are not candidate acceptance evidence. Those raw artifacts are preserved as `interactive-stable/`. Adding access to the existing unchanged project context corrects the setup; no skill/settings/memory content or assertion is edited. The complete-context full run passes slash autocomplete, all approval flows, resize/browser/composer cases and the existing post-clear memory gate. This also resolves the directory-literal wrap from [#3793](https://github.com/vybestack/llxprt-code/issues/3793) without changing maintained assertions or workflows.

Two exact serial RSS repeats after broad jobs finished also pass in the initial stable source launch: baseline/post-clear 478,576,640/569,327,616 (growth 90,750,976 bytes), then 482,951,168/553,713,664 (growth 70,762,496). These preserve the same 100,663,296-byte limit, live-heap/object thresholds, three forced-GC manual checkpoints, DEV setting and fake-provider workload. The complete-context full suite grows RSS by 78,757,888 bytes. Its two final serial repeats grow by 79,757,312 and 87,654,400; all three pass. Final live-heap growth is 6,571,543 / 6,946,989 / 6,329,660 bytes, and object growth is 103,508 / 103,913 / 103,759, below their unchanged gates. Exact checkpoints and limits are in `remediation/final-rss-summary.json`. All project .llxprt files are byte-for-byte unchanged before/after the isolated runs (`interactive-context-unchanged.json`). The initial failed RSS run and identified development-tool queue are retained with their stated attribution limits. F3's final interactive gate is resolved; the historical native/RSS variance is still not identified.

At the end of this remediation mission, no accepted candidate emission behavior remained failing, but full repository acceptance was still blocked by #3790 and #3784 in `npm run test`. D1 stayed deferred, R1 stayed rejected, and #3797 was recorded as an existing non-Static development-tool defect. The mission had not performed review, OCR, commit or push. The later full-suite and reviewer results below supersede that blocked status without discarding its evidence.

## 2026-10-01 final acceptance and local review

**Full `npm run test` passes in the source-identical isolated environment; the two-cycle local review is complete with PASS.** No production changes were made after that verification. This preparation mission updates only this plan before committing the nine issue files. OCR remains disabled by standing instruction and was not run.

### Latest full-suite evidence

`tmp/verify3434/final-environment/full-isolated.status` records exit **0**. The unchanged workspace runners passed **2,739/2,739 test-file executions** across 18 runner summaries. CLI passed **767/767 files**, with **9,835 passing cases, zero failures, five existing skips and thirteen existing todos**. Core passed **460/460 files**. There were no added filters or skips. The media-store locking file timed out once and passed on the runner's existing retry; first-attempt cleanliness is not claimed.

This lane used supported core, CLI, agents and auth concurrency environment overrides set to **1** and temporary optional-plugin dependency-directory links matching CI's separate plugin installation layout. It reused existing dependencies without installing or changing versions. The original checkout lacks the Google plugin's own dependency-directory layout, which explains its missing Gemini registration. Assertions, property iterations, explicit time budgets, retries, workflows and enforcement remained unchanged. Source-checkout default-concurrency reliability is not established by this serial lane.

Post-run SHA-256 verification checked **12,315 copied tracked/current feature files**, with **zero source/copy/manifest differences**. Evidence: `final-environment/final-audit.json`, `isolated-copy-manifest.json`, `full-isolated.log`, and `findings.md`, all under `tmp/verify3434/`. Only this plan is subsequently updated for the commit record; verified production and test sources remain unchanged.

The unchanged SessionDiscovery property passed in both serial lanes, including **9,313.19 ms** in the passing isolated full run. The original serial lane still exited 1 with **2,736/2,739 files** because of missing Gemini registration and a media-store timeout. Its historical failure, earlier SessionDiscovery and resumeSession timeouts, and main comparisons remain preserved above and in the artifacts. This passing lane does not establish that shared-machine scheduling or macOS watcher sensitivity has been eliminated. Follow-up details were posted to [#3784](https://github.com/vybestack/llxprt-code/issues/3784#issuecomment-5938101977) and [#3790](https://github.com/vybestack/llxprt-code/issues/3790#issuecomment-5938101683).

### Other final gates and scope

Full format, lint, typecheck and build passed, as did the installed `gpt-6-luna` live haiku smoke. The complete-context unchanged interactive gate passed **19/19**. Maintained candidate suites passed **15 cap cases**, **6 resize cases**, and **40 eviction/turn-store cases**; the earlier 77-case aggregate included clean-main comparison cases. Real tmux copy-mode evidence and the five no-replay resize deltas remain recorded above.

The non-test production renderer completed **3,000 measured appends at cap 25** and **2,000 at caps 100/400**. Late Array counts plateaued at **47,044**; settled late heap ranged approximately **93.13 to 93.76 MB** across those lanes. These measurements concern retained production-renderer state. Bounded ledger copying remains unchanged; there is no claim of constant whole-path allocation, exact #3430 workload coverage, or universal development-mode memory behavior. The executed real committed workloads are deterministic equivalents. Historical intermittent RSS [#3794](https://github.com/vybestack/llxprt-code/issues/3794) remains unattributed. The main-reproduced development-tool queue [#3797](https://github.com/vybestack/llxprt-code/issues/3797) was recorded as a follow-up at this stage; the 2026-10-02 implementation below fixes it here.

The local review used two cycles: one full review and one findings-only follow-up. The supplied final reviewer verdict is **PASS**, with **F1-F4 resolved** and no remaining code blockers. Follow-up execution artifacts are retained in `tmp/verify3434/review-followup/`. No additional review or OCR was run during commit preparation.

Scope remains #3434's bounded Static emission, genuine truncation count/replacement epoch, and the maintained Ink overflow/resize no-replay patch. Issues #3428, #854 and #3431 are excluded. No dependency versions, workflows, enforcement, project settings or agent memories changed. The earlier blocked status is superseded by this explicitly limited passing lane and completed review; it is retained as historical evidence.

## 2026-10-02 development leak implementation and final-candidate evidence

**The original development operation queue no longer grows during ordinary committed output.** The user expanded the accepted scope to fix the leak here, including the maintained Ink lifecycle and development-only React DevTools patches. #3797 is implemented in this branch, not deferred to a new issue. Existing issue bodies were not changed. No commit, push, OCR or additional code-review cycle was performed.

### Accepted lifecycle contract and source fix

Dormant and disconnected Ink renderers retain their bounded current tree, not a historical operations journal. A newly connected frontend receives a current snapshot with valid parent/child IDs and inspectable current props. Connected commits continue delivering operations. Reconnect rebuilds that snapshot after disconnect cleanup. Explicit profiling still records requested commits and can return profiling data after recording stops; ordinary output never implicitly starts profiling. Disconnect stops timeline recording and releases tree, inspection and profile metadata ownership. Unmount removes the frontend tree and releases mounted fibers. Other renderer packages keep upstream queue behavior.

The source cause was `react-devtools-core/dist/backend.js` appending structural operation Arrays to `pendingOperationsQueue` before a frontend connects. The historical real production-layout development lane grew from 202 to 6,202 queued Arrays over 3,000 appends. The fix makes Ink's dormant queue conditional on explicit profiling. `flushInitialOperations()` reconstructs Ink's live tree when there is no requested historical journal. Cleanup recursively unmounts only this renderer's roots, clears pending/string/inspection/tracking state, and discards disconnected operation/profile metadata. Calling `stopProfiling()` also switches off the timeline recorder; setting only the renderer's `isProfiling` boolean was insufficient.

Ink's installed React reconciler version reads renderer identity from host configuration. The old `injectIntoDevTools({...})` arguments did not publish that identity. The Ink patch now sets `rendererPackageName: 'ink'` and `rendererVersion` from the actual React version in `build/reconciler.js`, and calls `injectIntoDevTools()` without obsolete arguments. It preserves the existing bounded cache/static-output and no-replay overflow patches.

Necessary changes relative to HEAD `714f8fb80`:

- `patches/ink+6.4.8.patch`: correct reconciler host identity and DevTools injection.
- `patches/react-devtools-core+6.1.5.dev.patch`: Ink-specific dormant queue, current-tree backfill and disconnect/profile cleanup. The `.dev.patch` suffix matches the existing development dependency.
- `scripts/tests/fixtures/ink-devtools-lifecycle.ts`: real Ink/React/backend behavior with an external WebSocket transport substitute and a frontend operation decoder.
- `scripts/tests/ink-devtools-lifecycle.test.ts`: Bun regression runner for the lifecycle fixture.
- `project-plans/issue3434.md`: current scope, implementation and evidence record.

No package version, dependency declaration, package manifest, workflow, enforcement, global setting or project `.llxprt` content changed. The worker's 100 added `bun.lock` lines described redundant workspace `file:` dependency records, not patch metadata or new dependency versions. Only that incidental drift was restored to HEAD. The running isolated checkout's lockfile was then updated to those restored bytes; no production source, test or patch blob changed. `lock-restoration-audit.json` records old SHA-256 `a6d0c8cf658d814362138133e41b46b54e714dc6c6b6ac8400987e168ab1e2fd` and restored SHA-256 `98f3e6317e82b6d498fcf0ee57b5f53db96be4c7fbd1feeb051591880cec5dcc`. The subsequent 12,318-file audit had zero mismatches. The plan is updated after that audit and will be recorded separately from verified code/test blobs.

### Executed behavioral red/green evidence

Evidence parent: `tmp/verify3434/leak-fix/`.

1. `red.log`, exit 1: 600 real Static append/consume cycles retained 1,202 dormant operation batches, from two initially. Expected count was zero.
2. `host-red.log`, exit 1: the real hook lacked renderer package/version identity. The host configuration fix supplies it.
3. `green.log`, exit 0: dormant/connected/disconnected/reconnect/inspection/profile/unmount behavior passes with no old Static body replay.
4. `timeline-red.log`, exit 1: after disconnect, recorded component measures grew from 14 to 8,400. This exposed timeline recording continuing despite renderer-level profiling shutdown.
5. `timeline-green.log`, exit 0: invoking the actual profiler stop path prevents that disconnected growth. The final fixture keeps this assertion.

The final fixture executes 1,220 append/consume cycles. It verifies every newly committed body reaches stdout once and no previous body is replayed. At 600 dormant appends, late connection emits at most two snapshot batches and current props inspect as `current 600`. Explicit connected profiling covers 20 appends and returns 80 commit records, including Static layout/body commits. The frontend's five-node live tree remains valid. Timeline profiling records connected work; after socket close and 599 further appends, its measure count does not increase and the disconnected operation queue remains zero. Reconnect emits at most two snapshot batches and inspects `current 1220`. Unmount leaves zero frontend nodes. Initial, dormant and disconnected queue counts are all zero.

The fixture uses real patched renderer/backend logic, not a replacement implementation. The transport substitute is the external network boundary. It parses backend messages, checks unique IDs, existing parents and valid removals, and inspects real component props. Heap edges additionally check the retained dormant queue. The new runner appears in `test-audit/file-stats.tsv`, with no findings in `findings.tsv`.

The final targeted group passed 62 cases across five files with 7,396 Bun `expect` calls, including the lifecycle fixture, 15 cap cases, six resize cases and 40 eviction/turn-store cases. The fixture's internal Node assertions are additional checks, not included in that Bun count. Clear/load/overlapping IDs, explicit refresh, genuine truncation notices, default/small/UTF-8 caps and no-replay resize behavior retain the preceding candidate's tests. The saved real-PTY lane passed 72 committed additions at cap 25, 36 model markers once, five resize deltas without old output, and copy-mode retention of old/tail/notice text (`pty.log`, exit 0).

### Matched final-candidate development and production memory

Evidence: `tmp/verify3434/leak-fix/final-candidate/memory-summary.json`, individual `metrics.jsonl` files, and `retained-roots.json` for snapshot lanes. Every lane ran 2,000 warmup additions followed by 3,000 measured additions, with forced-GC samples every 100 additions. The late ranges below cover measured additions 2,000 through 3,000. All values are bytes. These use real production layout/store/history rendering with a discard stream, not a test spy history or an output accumulator.

| Mode | Item cap / retained serialized history | Arrays: measured start to end | Live heap: start to end | Late live-heap range | Late RSS range |
| --- | --- | ---: | ---: | ---: | ---: |
| Development, no frontend | 25 / 1,950 | 48,070 to 48,070 | 95,661,056 to 95,778,741 | 95,751,322 to 95,778,741 | 435,404,800 to 435,781,632 |
| Development, no frontend | 100 / 7,800 | 48,070 to 48,070 | 95,642,294 to 95,753,132 | 95,721,476 to 95,753,132 | 421,101,568 to 421,347,328 |
| Development, no frontend | 400 / 31,200 | 48,070 to 48,070 | 95,718,988 to 95,870,124 | 95,813,301 to 95,870,124 | 448,921,600 to 449,495,040 |
| Development, connected | 25 / 1,950 | 48,118 to 48,118 | 95,847,892 to 95,960,651 | 95,950,846 to 95,969,207 | 423,706,624 to 424,001,536 |
| Development, connected | 100 / 7,800 | 48,118 to 48,118 | 95,863,611 to 95,979,159 | 95,943,247 to 95,979,159 | 427,835,392 to 428,195,840 |
| Development, connected | 400 / 31,200 | 48,118 to 48,118 | 95,898,399 to 96,030,570 | 95,981,917 to 96,030,570 | 452,984,832 to 453,083,136 |
| Development, disconnected | 100 / 7,800 | 48,070 to 48,070 | 95,682,985 to 95,782,495 | 95,766,219 to 95,790,979 | 420,904,960 to 421,199,872 |
| Production | 25 / 1,950 | 47,002 to 47,002 | 92,826,461 to 92,938,637 | 92,909,363 to 92,938,637 | 387,760,128 to 394,870,784 |
| Production | 100 / 7,800 | 47,002 to 47,002 | 92,818,196 to 92,936,793 | 92,894,482 to 92,937,882 | 393,805,824 to 401,735,680 |
| Production | 400 / 31,200 | 47,002 to 47,002 | 92,912,451 to 93,025,512 | 92,986,930 to 93,025,512 | 420,315,136 to 420,413,440 |
| Development, no frontend | 400 / 4,192,400 | 47,641 to 47,641 | 103,862,928 to 104,011,635 | 103,992,141 to 104,011,635 | 2,468,315,136 to 2,468,446,208 |
| Development, connected | 400 / 4,192,400 | 47,689 to 47,689 | 104,048,741 to 104,173,366 | 104,062,782 to 104,185,695 | 2,309,029,888 to 2,309,259,264 |
| Production | 400 / 4,192,400 | 46,573 to 46,573 | 101,039,310 to 101,139,702 | 101,053,782 to 101,155,152 | 2,084,945,920 to 2,101,968,896 |

All 20 memory lanes, including seven attribution/snapshot lanes, exited zero. The driver lane named `development-disconnected` supplies a socket that never opens; the lifecycle fixture separately proves the real connect-close-reconnect sequence. History stayed at each item cap; the near-byte-cap bodies remained intact and retained history stayed at 4,192,400 bytes, below 4,194,304. Each connected measured lane delivered 6,000 additional operation batches, from 4,001 after warmup to 10,001 at the end. The dormant/disconnected lanes retained zero queued operation Arrays. This directly demonstrates cessation of the original development queue slope; production plateau alone is not the acceptance argument.

Snapshot attribution finds 125 mounted FiberNodes at both measured start and end in development none/connected/disconnected cap-100 lanes. After unmount there are four. The near-4-MiB no-frontend lane also has 125 to 125 to four. Production cap 100 has 125 to 125 to three. Development dormant queue roots have zero operation Arrays at start, end and unmount; connected roots have no queue. The styled cache remains at 65,534 size units / 32,767 character cells in small-body lanes and 65,504 / 32,752 in near-byte-cap lanes, with bounded width keys. These are current bounded cache values, not retained old transcript fibers.

RSS is reported separately from live heap. Generating/serializing heap snapshots adds large native/temporary allocation overhead: cap-100 snapshot lanes end around 1.13 to 1.20 GB RSS while nonsnapshot equivalents end around 0.40 to 0.43 GB. Near-byte-cap nonsnapshot RSS is also high, about 2.10 to 2.47 GB, while late live heap and retained Arrays remain nearly flat. This evidence fixes and attributes the JavaScript queue root; it does not identify all native/RSS allocation or prove absence of every RSS problem. The historical #3794 variance remains unattributed.

The unchanged full interactive suite passed 19/19, including its existing post-clear memory gate. Its forced-GC baseline/post-clear RSS was 498,122,752 / 580,190,208, growth 82,067,456 below the unchanged 100,663,296-byte gate. Live heap was 190,786,120 / 197,573,526, growth 6,787,406; objects were 879,865 / 983,283, growth 103,418. The workload remained development-mode. `context-audit.json` verifies all project `.llxprt` files unchanged.

### Patch installation, verification and limits

Final-candidate format, lint, typecheck and build each exited zero. Targeted tests, test audit, patch reverse/reapply integrity and the 19-case full interactive suite exited zero. The actual live smoke used installed `gpt-6-luna`, exited zero and returned a three-line haiku; no missing `luna` run is counted as success. `verification.status` is the orchestrator's exit, not proof that every child check passed.

A separate fresh published-tarball check downloaded `@jrichman/ink@6.4.8` and `react-devtools-core@6.1.5` into the ignored evidence directory, applied both patches with `patch-package --error-on-fail`, and reran the lifecycle fixture successfully. All eight patched installed files have identical SHA-256 bytes to the candidate, and both package versions are unchanged. Evidence: `fresh-published-integrity.json`, `fresh-published.log`, `fresh-published.status`. The earlier reverse/reapply probe is retained as `patch-integrity.json`. No root dependency install or lockfile regeneration was needed. The known hot Bun transpiler-cache mismatch is a setup hazard when an installed patched file changes; these probes use a disabled or dedicated cache. No workflow/cache policy was changed, and no shared cache was purged.

The first final-candidate `npm run test` exited 1: core passed 459/460 files after a 2,000 ms media-store lock-contention failure; CLI passed 767/767 and all other workspace runners passed. Its separate `npm run test:scripts` exited 1 with 295/299 files: three files required Git index/plugin dependency metadata absent from the temporary launch, and the release-install file exceeded the unchanged runner timeout. Temporary Git metadata and a Google auth plugin dependency link were subsequently supplied in isolation, matching the existing source index and installed CI-style dependencies. No assertions, thresholds, retries, property iterations, filters, runner defaults or dependency versions changed.

The inherited quiet full repeat completed with `npm run test` exit **1**, **2,737/2,739 file executions** across 18 runner summaries. Core passed **460/460** and CLI passed **767/767**. Tools passed 138/139 because the AST memory fixture's `git add -A` timed out before its tool/memory workload. Agents' native group passed 6/7 because both attempts of its four-second child-runner fixture timed out before creating the expected JUnit report. No leak/cap/resize assertion failed. The shell job and repeat orchestrator exited zero because they recorded the child status; that is not a passing full-test result. Evidence: `test-quiet-repeat.log`, `test-quiet-repeat.status` and `repeat-orchestrator.status`.

After the complete repeat finished, bounded unchanged rechecks passed both failed files: AST memory/wiring **2/2**, 16 assertions, and agents retry behavior **5/5**, nine assertions. The three script files affected by missing temporary Git/plugin setup also passed **34/34**, 85 assertions, after that setup was supplied. These rechecks do not erase the failed full-run exits. The separate full scripts lane's release-install timeout remains unverified by a completed passing rerun, so an all-gates-green result is not claimed. No test timeout, assertion, threshold, retry or enforcement source was weakened; no duplicate full suite was started. Evidence: `ast-fixture-recheck.log`, `agents-fixture-recheck.log`, `scripts-metadata-recheck.log` and their status files.

The repeat used the same verified source/test/patch blobs, supported serial concurrency overrides and isolated CI-plugin layout. The pre-leak candidate's earlier passing full suite does not establish broad acceptance for this added lifecycle fix. The leak implementation and its development lifecycle/memory evidence are complete; broad green acceptance still requires a clean full-run result and resolution of the release-install verification timeout. Default-concurrency reliability, unattributed native/RSS allocation and exact #3430 workload coverage are not claimed.

## 2026-10-02 completed final verification of the development leak fix

**Both remaining full gates pass on the unchanged final candidate.** This result supersedes the failed full-run and release-install verification status above. The historical failures and their logs remain preserved. No production, test, patch, dependency, workflow, enforcement or `.llxprt` edit was made during this verification mission. Only this plan and ignored verification evidence were written; no review, OCR, new issue, commit or push was performed.

Evidence directory: `tmp/verify3434/leak-fix/final-candidate/final-gates/`.

| Complete command | Exact child exit | Completed file executions | Evidence |
| --- | ---: | --- | --- |
| `npm run test` | 0 | 2,739/2,739 across all 18 workspace runner summaries | `test.log`, `test.status`, `test-result.json` |
| `npm run test:scripts` | 0 | 299/299 scripts files, including the new lifecycle regression, plus 1/1 ESLint-rule test file | `test-scripts.log`, `test-scripts.status`, `test-scripts-result.json` |
| Sequential verification driver and post-run integrity audit | 0 | Both child exits preserved; 12,317 implementation files checked with zero mismatches | `driver.status`, `result.json`, `before-audit.json`, `after-audit.json` |

The workspace suite includes tools **139/139**, core **460/460**, providers **643/643**, agents **418/418** plus its native group **7/7**, and CLI **767/767**. The AST Git fixture and agents' four-second child-runner fixture both pass inside this complete run. The scripts gate's release-install fixture passes **5/5 cases**, with **16 assertions**. Its real global/local/ephemeral install case completes in **113,302.74 ms**, checking the existing release-manifest and version requirements. The new lifecycle fixture also passes inside the complete scripts run. No targeted pass is substituted for either full command.

The two commands ran once each, sequentially, in the existing source-identical isolated checkout with its previously supplied temporary Git metadata and optional Google-plugin dependency-directory links. Existing dependencies and versions were reused. Core, CLI, agents and auth use their supported concurrency environment settings of **1**. A fresh dedicated Bun transpiler-cache path prevents reuse of the documented stale installed-patch cache. No timeout override, filter, partition, skip or retry loop was added. Existing runner retry policies and case-level platform skips remain unchanged; neither completed gate log contains a top-level timeout retry or failed-file line. Tests that exercise retry/failure handling retain their own expected diagnostics.

The exact launch environment and commands are saved in `test-launch.json` and `test-scripts-launch.json`. Reproduction from this checkout is:

```sh
cd /Volumes/XS1000/acoliver/projects/llxprt/branch-9/llxprt-code/tmp/verify3434/leak-fix/final-candidate/isolated-checkout
export BUN_RUNTIME_TRANSPILER_CACHE_PATH=/Volumes/XS1000/acoliver/projects/llxprt/branch-9/llxprt-code/tmp/verify3434/leak-fix/final-candidate/final-gates/bun-cache
export LLXPRT_CORE_TEST_CONCURRENCY=1 LLXPRT_CLI_TEST_CONCURRENCY=1
export LLXPRT_AGENTS_TEST_CONCURRENCY=1 LLXPRT_AUTH_TEST_CONCURRENCY=1
npm run test
npm run test:scripts
```

Before/after audits match all **12,317** implementation files in source, isolated copy and saved manifest, including both patches and both lifecycle files. All eight installed patched files match the saved fresh-published-tarball hashes. Ink remains **6.4.8**, React DevTools remains **6.1.5**, `bun.lock` matches HEAD, and every project `.llxprt` file remains unchanged. This plan's documentation-only update is recorded separately from the verified implementation. Runtime versions were Bun **1.3.14**, Node **25.2.1** and npm **11.6.2**.

The requested 21,600-second foreground polling timeout did not prevent an external watchdog from terminating a polling shell. The managed verification job continued uninterrupted, completed both commands and its post-run audit, and exited zero. No completed work was lost and no sibling/user process was stopped. The completed managed job is `shell_f4cf1f2a8022`.

Existing final-candidate format, lint, typecheck, build, live smoke, test audit, patch installation, **62-case** targeted group and **19/19** interactive results remain passing on these same implementation hashes. They were not rerun. The saved **20/20** memory lanes retain the development queue count of zero, flat retained Arrays after warmup and mounted/unmounted FiberNode evidence of **125 to 4**. No new profiling job was launched. The development operation-queue leak is fixed in this candidate and is not deferred. Historical native/RSS attribution limits remain as documented; there is no outstanding local verification gate error. Commit and push are left to the coordinating agent's next step.
