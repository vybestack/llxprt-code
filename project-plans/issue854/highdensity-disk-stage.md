# Primary high-density uses disk; compression regression acceptance remains RED

The invoked high-density route now prepares, decides and publishes against pinned
disk rows. Its eligible planning failures use disk top-down truncation over the
same membership. Primary compression no longer calls the eager context builder.
The broader compression regression suite still has 30 failures in seven existing
factory-mocked suites. The new combined optimizer/compressor test also times out
at 8192 rows, and the structural scanner still reports four eager contracts.
This stage does not establish Issue 854 memory acceptance.

Evidence is under
`tmp/verify854/p05d/highdensity-disk-20261001T2030-sol/`. Starting sources, the dirty
diff, protected hashes, host snapshot, initial audit and adverse logs were captured
separately from the new changes. Earlier stage evidence was not edited.

## Invoked route and legacy behavior

`CompressionHandler.runCompressionWithRetryAndFallback` now dispatches every
parsed primary strategy through `diskRunners`. The obsolete primary array dispatch,
array retry/fallback branch and private middle-out no-op routing helpers were
removed. Provider and pending-window array fallback contracts remain separate.

`runDiskHighDensity` builds scalar metadata, opens a real pinned dump snapshot and
spools curated membership into `HistoryDensityRows`. Both preparation and candidate
writes are detached disk writes. They do not populate the spool's caller identity
maps. No full-array collector, array-to-iterator adapter, input cap or row-size cap
was added to this route.

`HighDensityStrategy.compressDisk` delegates to `compressHighDensityDisk`. The
planner indexes the first AI call location and latest response location by full
call ID in `DensityDiskIndex`. Positions and block offsets live on disk. Parameter
lookup preserves the first matching call, even when its parameters have no usable
path. Duplicate IDs, path aliases and later responses retain the old lookup rules.
The index's bucket pointers also live on disk; transient keys, encoded records and
one decoded row are not a total-heap bound.

The fractional tail uses the legacy backward tool-boundary rule. Tool results in
the head receive the same compact status/path/rerun text, while human and AI rows
and the protected tail remain unchanged. The target retains the compression
threshold, context limit and density headroom calculation. Initial candidate cost
and incremental head removal use the production estimator's sum of independent
per-row costs. The explicit legacy array strategy remains an independent oracle
and preserves its public callback contract.

High-density compression is deterministic and does not call a model. Successful
and failed tool-result summaries are covered, including error markers and error
text. No model-summary or verification call was introduced. The existing one-shot
and middle-out summary machinery was not changed.

Transient estimation failures retry up to three attempts against the same pinned
source. Each retry closes and replaces the disk candidate before rebuilding it.
Eligible exhausted failures enter the shared disk top-down fallback. Permanent
errors and cancellation propagate. Candidate publication is outside the planning
retry catch, so publication faults compensate without initiating another planning
attempt. No-op preserves history, cache anchor and recency bookkeeping.

Publication retains the existing disk span calculation, semantic-media frontier
transfer, Responses-chain invalidation, detached row transaction and summary
selection. The cache anchor resets only after successful publication. Queued
appends remain outside the pinned source and flush after compression unlocks.

## Behavior and ownership evidence

The initial guarded primary tests fail at `getCurated` before the production
migration. Final route tests compare real 512/8192 mixed journals against
independently generated fixtures and the legacy array strategy. Coverage includes
anchored tool pairs, duplicate call IDs, parameter aliases, error/success summaries,
old snapshots, token estimates, high preservation/headroom ratios, structural
no-op, transient retry and top-down fallback.

Atomicity tests cover source error and cancellation, estimation cancellation,
queued append after a fail-open hook, partial primary and fallback journal
admission, complete membership and chronology restoration, caller-marker identity
after GC, successful subsequent retry and a surviving valid nine-MiB row. The
original 31 chronology atomicity/density cases were not edited and pass.

Named source, decision/candidate and transaction owners are exercised with actual
live decoded rows at paused estimation and publication boundaries. The unchanged
440-row/eight-MiB controlled-fixture checks pass and registered owners return to
zero. These counts cover registered objects and UTF-8 JSON charges, not arbitrary
JavaScript references. An individual valid row can exceed the fixture byte budget;
that budget was not converted into a row-size rejection rule.

Borrowed and distinct-copy controls retain actual history rows at both sizes. The
normal control asserts that the unchanged bounds detect retention, and the adverse
`HIGHDENSITY_RETAINING_TRAP=1` run has four required failures after cleanup checks.
The larger retained histories exceed eight MiB. No threshold or assertion was
relaxed.

An initially overbroad materialization guard also rejected caller admission,
queued-append flush and media-owner registration outside compression preparation.
Those failures remain in the logs. Preparation-only parity retains a throwing
`materializeHistory` guard. Lifecycle fixtures still forbid `getCurated`, `getAll`
and array publication, while allowing those existing external lifecycle operations.
The remaining `materializeHistory` scanner finding was not removed or exempted.

## Summary requests and transport bytes

The high-density BODY matrix exercises Responses, Anthropic and Gemini at both
sizes, with caching off/on. It compares before/after bodies against independent
legacy results and verifies identical actual retry bodies through the real provider
conversion and `RetryOrchestrator`. Only network boundaries are replaced. Saved
actual/expected bodies are compared as bytes without JSON normalization.

Adjacent one-shot and middle-out matrices also compare summary contents, summary
bodies and publication bodies, including real invoked summary providers and
transport retries. Existing complete-request charge and paused-verification tests
pass. Every row of the full model-facing request remains charged through options
construction, provider execution and verification until the attempt exits.
High-density sends no such request.

The summary request remains proportional to its compressed range. Verification's
separate request, provider-converted bodies, hook references, media resolution,
transport retries and returned summary strings still require their own ownership
census. Passing byte comparisons and named request charges do not make those
owners bounded.

## Gates and unresolved integration

The final deduplicated ordinary union has 1,016 passes, 31 failures and zero
skips across 130 isolated invocations. It excludes the four deliberate retaining
failures and two structural-surface failures. The 33 final confirmed primary
cases pass, as do two additional high-ratio cases. The combined optimizer lane
adds one pass and one timeout. Five adjacent provider ownership suites have 20
passes. The eight provider byte matrices have 108 passes; all 108 saved
actual/expected pairs match exactly, including 24 high-density before/after pairs.
This artifact count is not a claim that every matrix wrote all of its bodies.

The final `gates-closing/manifest.json` records agents production and Bun-test
TypeScript checks, scoped BODY TypeScript, forced 800 effective lines per file
and 80 per function with zero ESLint warnings, formatting and diff-check. The
duplicate-preserving audit retains 2,117 findings with no additions or removals
after ignoring line drift. All 17 captured protected hashes and ten adjacent
compression-source hashes match. `final-summary.json`, `body-pairs.json` and
`stage-final.diff` preserve the closing result. Initial type/lint/audit failures
remain recorded separately.

Thirty test cases still fail across these seven existing suites:

| Suite | Failing cases |
| --- | ---: |
| `CompressionHandler.chronology.test.ts` | 4 |
| `compression-provider-fallback-propagation.test.ts` | 4 |
| `compression-recency.test.ts` | 5 |
| `compression-retry-behavior.test.ts` | 8 |
| `compression-retry-cooldown.test.ts` | 2 |
| `compression-retry-hardlimit.test.ts` | 6 |
| `transcriptPathContext.test.ts` | 1 |

They inject array-only strategy behavior through the old factory, which primary
disk dispatch no longer invokes. Their unchanged assertions pass against the
captured starting compression sources in an isolated copy with matching ChatSession
callers. They fail on the candidate tree. These are stage regressions, and the
replacement real-route tests do not waive them. Migrating those fixtures to
infrastructure fault injection while preserving their behavioral assertions
remains required before claiming compression-suite acceptance. No eager production
compatibility route or assertion weakening was used to make them pass.

The added optimizer-to-primary integration case passes at 512 rows but remains
unverified at 8192. Its foreground invocation was terminated with signal 15. A
managed rerun using a larger CLI runtime allowance still hits the suite's explicit
180,000-ms deadline; the log reports 614,129 ms before the timeout was observed.
The separate 8192-row density suites and primary high-density suites pass, but
that does not prove their combined lane. Its assertions, fixture sizes and
explicit test deadline remain unchanged. No performance acceptance is claimed.

The scanner retains 18 passes and two production-surface failures. Its four
findings are `HistoryServiceCore.materializeHistory`,
`HistoryServiceCore.captureChronology`, `HistoryService.getAll` and
`HistoryService.getCurated`. Mutation controls still pass.

## Exact remaining eager chains and unbounded owners

`compressionContextBuilder.ts:42` still calls public `getCurated`. Executable
compression callers are:

- Provider hard-limit fallback enters at `providerContentEnforcement.ts:728`,
  then `CompressionHandler.ts:475/478` builds the array context and invokes
  `performFallbackCompression`. Its array truncation dispatch remains at
  `CompressionHandler.ts:808/843`.
- Pending-window hard-limit truncation receives the builder and array fallback
  at `CompressionHandler.ts:541/544`. It consumes them at
  `pendingContextWindowEnforcement.ts:409/417`.
- The public `CompressionHandler.buildCompressionContext` remains at line 892,
  forwarding to the eager builder at line 896. Public array strategy clients
  retain `CompressionContext` and `StrategyCompressionResult` arrays.

There is no remaining primary high-density chain to that builder. The migrated
primary fallback uses `fallbackDisk`, not `performFallbackCompression`.

Array history materialization, explicit chronology capture, public `transformAll`,
provider/pending hard-limit callbacks, deferred transfer, clear/restore and
checkpoint/control paths remain unresolved. Pending writer and caller identity
pins can grow with unsettled work. Model requests, provider conversion, hooks,
media resolution, envelopes and retry bodies remain additional request owners.

The retained-growth allowance remains 1,048,576 bytes. No quiet-host statistical
sweep, no-leak result or whole-session/provider acceptance is claimed. The host
has competing work, so repository-wide test/build/model-smoke lanes were not run.
No `.llxprt`, protected source, scanner control or enforcement policy was changed.
No GitHub, commit, push, OCR, PR or merge action was performed.
