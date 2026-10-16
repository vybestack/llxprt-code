# Compression annotation reads raw rows; getRawHistory remains RED

This stage removes the raw-array read from production compression annotation.
It does not remove `HistoryService.getRawHistory(): readonly IContent[]` or
complete its public caller migration. The six structural findings remain:
`materializeHistory`, `captureChronology`, `getRawHistory`, `getAll`, `getCurated`
and `getCuratedForProvider`. No accessor was renamed, exempted or replaced by an
eager cursor adapter.

Evidence is under
`tmp/verify854/p05d/raw-facade-stream-20260930-sol/`. The source and test baseline
was captured before implementation. Earlier dirty work and evidence were
preserved. The complete source AST inventory covers raw calls in packages,
plugins and scripts, with test calls identified separately. Direct production
and script calls decrease from nine to eight; there were no direct plugin calls.

## Invoked production stage

`CompressionHandler.createApplyCallback` still invokes
`applyCompressionWithAnchor` for normal compression and its shared apply path.
That helper now awaits `annotateCompressionSpanStream` over
`historyService.streamRawHistory(signal)`. It no longer materializes old raw
history or accepts the old synchronous annotation callback.

`compression-span-stream.ts` consumes previous rows directly. The journal pins
membership at first iteration. A private `CompressionSpanIndex` keeps retained
and previously encountered sequence membership on disk, replacing the old
previous/new/destroyed Sets for this route. Resident state is a destroyed-item
count, minimum and maximum sequence, a frontier-captured flag and the first
semantic-media frontier. No previous-row array, Map or Set is collected.
Duplicate sequence markers count once, unmarked rows remain raw, and encounter
order determines the first frontier.

The candidate is borrowed and must remain immutable until annotation settles.
The returned annotated candidate, cache-marker copy and atomic replacement
remain array-valued at their existing boundary. The prior-history traversal uses
bounded memory. Compression strategies and replacement transactions retain
their array contracts. No end-to-end bounded compression acceptance is claimed.

Cache-anchor validation still occurs before publication. Existing summary spans
are preserved, new spans are attached only to eligible summaries, and an
existing candidate frontier takes precedence over transfer from old history.
Responses stored-chain invalidation and the single preserved-head cache marker
remain in their old order. Replacement is awaited before the anchor is changed.
The real active-compression-lock regression still checks queued tool and user
rows on both sides of publication.

The optional signal is checked before traversal, at row boundaries and after
event-loop scheduling points. Abort and source failure unwind the source and
close scratch before any replacement. Normal exhaustion also releases both.
Cancellation does not interrupt an already started `replaceAll` transaction.
The original pinned-journal implementation, clone behavior, folding and trim
logic are unchanged.

## Remaining callers and public contracts

| Remaining direct caller | Array ownership and required next step |
| --- | --- |
| `CompressionHandler.ensureDensityOptimized` | Supplies full raw history to the synchronous strategy optimizer. Strategy decisions, index-based density results and their application must migrate together. |
| `toolResultTruncator.ts` | Legacy and unified ranking retain tool blocks, positions and candidate arrays. Two additional raw calls implement the length guard. Bounded ranking must preserve model-aware size order, recency ties, pending offsets and concurrency rejection, together with addressed replacement. Merely streaming into the current candidate arrays would preserve ownership proportional to history length. |
| `ProviderContentEnforcer.captureFallbackState` | Copies full raw history for rollback, then copies it again for restoration. It needs a reusable owned disk snapshot and release on success, failure and disposal, not a one-shot generator. |
| `MediaLifecycleMetrics.snapshot` | Its exported `HistoryMetricSource` still requires the synchronous raw facade. Measurement also retains a reference-byte Map; replacing only the input accessor would leave that index unbounded. |
| `scripts/issue-3199-media-memory-target.ts` | Passes the raw array to the media resolver. The probe currently replaces history with one admitted row, but its input contract remains array-valued. |

The raw facade itself remains unchanged. Other public histories still expose
arrays through `ConversationManager`, `ChatSession`, `AgentChatContract`,
`AgentClientContract` and the agent API. CLI chat clear/restore/export and copy
consume those arrays; copy still finds the last AI result by filtering the
history. ACP live-agent replay copies `Agent.getHistory()`. Checkpoint receipts
still serialize `clientHistory` arrays. These public caller chains remain
unmigrated.

Recording's existing turn-boundary journal persistence path is unchanged.
Legacy mutation, density, rollback, previous-history and semantic-media purge
contracts still require the migrations documented in
[getall-materialize-stream-migration.md](getall-materialize-stream-migration.md)
and
[provider-curated-stream-migration.md](provider-curated-stream-migration.md).
Provider enforcement results and request envelopes also remain array-valued.

The internal compression helper's fifth argument is now an optional
`AbortSignal`, replacing the synchronous annotation callback. All repository
callers were migrated. `annotateCompressionSpanStream` is exported through the
existing history-chronology module. The old pure array annotation function
remains available for its separate input-array contract and independent test
oracles; it is not a raw-history compatibility adapter. No whole-history public
API break is claimed.

## Behavioral evidence and limits

The fail-first production tests use real 512/8192-row journals and reject the
old raw-facade read. Separate fail-first tests check abort and producer-fault
propagation before publication. Those initial failures establish the forbidden
access and missing lifecycle behavior; they are not baseline heap measurements.

The normal ownership cases register reader-owned rows, borrowed rows and
distinct shallow copies. Their peaks are one decoded journal row, one borrowed
row and two distinct consumer rows, with deterministic release to zero. The
440-row and 8 MiB controlled-fixture limits are unchanged. Deliberate consumers
retain every borrowed row and a separate copy: each reaches 512 or 8192 rows,
and both 8192-row owners exceed 8 MiB. The controls must fail those bounds and
then release to zero. Registered ownership counters do not discover arbitrary
JavaScript references.

Independent old-path oracles compare annotation JSON and serialized replacement
input, including metadata key order, rather than deriving expectations from
streamed output. A valid source row larger than 8 MiB is accepted and read;
that fixture does not apply the controlled-fixture byte limit to arbitrary rows.
A pinned traversal survives clearing live history while suspended. Scratch and
source cleanup are checked on exhaustion, pre-abort, in-stream abort and source
fault.

An additional fail-first parity case exposed null frontier metadata in accepted
serialized raw rows: nullish assignment replaced the first null frontier with a
later one. The scalar frontier-captured flag preserves the old first-match
behavior without changing content validation.

The new BODY BYTES matrix runs both history sizes, all three providers and
caching enabled/disabled after the invoked compression stage and real enforcer
recomposition. Its expected contents use independently generated fixtures and
the unchanged old array annotation/normalization path. Responses forces a
transport retry with identical bodies. Only the network boundary is replaced.
The matrix does not prove remote cache writes or bounded downstream request
ownership.

The 1,048,576-byte retained-growth allowance, estimator and enforcement are
unchanged. Statistical heap probes are deferred because unrelated CPU-bound
Bun and CLI processes are active. There is no retained-heap acceptance claim.

## Verification record

Final isolated results and exact command arguments are recorded in
`final/manifest.json`. The driver includes the original 31 atomicity/density
cases, the new compressed transport matrix, existing provider BODY BYTES
matrices, adjacent agent/CLI/ACP/checkpoint/recording suites, official root
TypeScript and lint commands, full-dirty normal and forced 800/80 zero-warning
lint, dirty-file Prettier, test-audit comparison and the unchanged structural
scanner and mutation controls.

The final ordinary regression run has 1,412 passes and no failures across 143
isolated invocations, including the 29 new behavioral and compressed-transport
cases. The original 31 cases pass. All 40 saved final provider actual/expected
body pairs match byte-for-byte, including the twelve new compressed cases.
Official root typecheck and lint pass. All 565 dirty code files pass normal and
forced 800/80 ESLint with zero warnings, and their Prettier checks pass.

The unchanged structural suite has 18 passes and two failing production
assertions. Its exact six findings match the starting inventory, with zero added
or removed findings. Both existing 512/8192 semantic-purge no-array assertions
remain RED. Including these suites, the final test
record has 1,430 passes and four failures across 145 invocations. The audit
multiset has 2,126 findings before and after, with zero NEW and zero removed.
All twenty protected-path hashes match, and `git diff --check` passes.
`HistoryService.ts`, `HistoryServiceCore.ts`, the structural scanner and
enforcement were not changed by this stage. These results do not remove the
unfinished caller chains above.

Adverse logs are retained. The first broad Bun invocation also discovered old
snapshot tests under `tmp/`; final suite arguments use absolute paths to run
only current source. Root TypeScript found an agent test using `Array.fromAsync`
without that library in its compiler target. The test now explicitly iterates
its three output rows; compiler settings were not changed. The initial test
audit found two same-reader failure-state expectations. Independent
fixture-generated digests replaced those expectations, preserving the
unchanged-state checks. Initial lint failures were corrected by splitting test
registration groups and making comparisons explicit, without relaxing limits.

No GitHub, commit, push, OCR, PR or merge action was performed. Full repository
acceptance is outside this result.
