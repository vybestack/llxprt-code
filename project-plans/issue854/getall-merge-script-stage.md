# Merge and the media probe no longer read `getAll`; two direct calls remain

This stage removes the `HistoryService.merge` array read and both array reads in
`issue-3199-media-memory-target.ts`. The symbol-resolved inventory moves from five
exact non-test `HistoryService.getAll` calls to two. The unchanged structural
scanner still reports four eager owners, and its two production assertions remain
RED. This is a merge and probe migration, not whole-session memory acceptance.

Evidence is under `tmp/verify854/p05d/getall-merge-script-20261001T0950-sol/`.
Starting dirty changes, source hashes, caller inventory, structural findings and
test-audit output were recorded before implementation. Earlier work and raw
evidence were preserved.

## Invoked merge transaction

`HistoryService.merge(other)` returns `Promise<void>` and runs in the target
mutation FIFO. It waits for a compression lock to release, captures the target
membership, then captures the source in a scoped `HistoryMutationSnapshot`.
`withMergedHistoryRows` writes the retained target prefix and accepted source rows
to `HistoryDensityRows`. Durable rows are serialized. Pending rows use the existing
identity ownership mechanism. There is no full-history input array, eager fallback,
synchronous array-to-cursor adapter, truncation or input-size cap in this route.
The disk snapshot's existing indexed synchronous row operations remain disk reads;
they do not collect the context in memory.

Zero-block source entries are skipped, preserving `addAll` admission. A source
with no accepted rows publishes nothing. Complete blocks, timestamps, attribution
and existing chronology markers survive. Unmarked accepted source rows are stamped
in append order. Chronology marker stamping remains idempotent. Duplicate rows are
still appended: neither the old implementation nor this one deduplicates histories.
Self-merge appends its pinned source once instead of chasing new appends.

Token accounting adds estimates for accepted appended rows to the target's
existing total. It does not silently recalculate the old prefix, whose accounting
may have been synchronized separately. Publication emits appended `contentAdded`
rows in order and the transaction's token and context-range events. The existing
media replacement participant manages ownership. Durable publication waits between
journal admissions. A pending target uses the existing pending transaction route
so its caller identities are preserved.

Serialization, observer and partial admission failures use the existing
compensating transaction. Admitted content is removed and the prior membership
restored before queued target mutations execute. Token accounting, span state,
chronology counters and pending marker identity are restored. Source, candidate
and publication resources close on the tested failures. Compensation failure
visibility remains unchanged; this stage does not promise recovery from an
unrecoverable recorder failure.

The synchronous `addAll(readonly IContent[])` API remains for explicit array
callers. It is no longer invoked by `merge`. There were no other production merge
callers to migrate. The asynchronous API change and source pinning contract are
in `docs/migration/history-raw-stream.md`.

## Streamed probe persistence and measurements

`SessionPersistenceService.saveRows` writes a session header, consumes each input
row and writes the history array directly to a temporary file. It syncs and closes
the file, then renames it only after successful traversal. Each row is detached,
admitted and verified through the existing media lifecycle. Persistence and
admission reservations are released after its write. The existing array save's
reservation and release implementations were extracted into `session-row-media`
and reused; their array contracts were not presented as bounded APIs.

Encoded writes are charged to the existing queue byte budget while outstanding
and released in `finally`. Save generation is allocated at invocation, before
waiting for the transaction, so a later queued array save retains the later
generation. Row producer failure, a rejected row observation and write-budget
failure leave the previous target intact, clear temporary files and release
charges. Queued saves resume after the failed streaming transaction.

`saveMediaProbeHistory` streams exactly the accepted single-row fixture to
persistence. A second row or empty source rejects before rename. This single-row
check describes the probe's existing workload, not a cap on general history or
persistence input. `countMediaProbeHistory` folds the raw cursor into a scalar.
The probe has no `getAll` read.

The first streaming probe run failed the unchanged lifecycle-path assertion:
its active snapshot happened before the persistence row was charged. The
corrected probe takes the same active metrics and consumes the same transport
body while an actual admitted persistence row write is pending. The scoped
observation runs after admission and reservations, inside the actual byte charge,
before file I/O. It does not inject queue bytes or change the metrics evaluator.
Its rejection is covered by a fail-first compensation test. Forced GC, settled
metrics, unique-image workload, quota, request budgets, existing adverse controls
and plateau rules remain unchanged. The six-turn observed probe passes.

## Behavior and ownership evidence

Fail-first tests rejected the old eager merge, missing persistence helper,
zero-block admission divergence, full-prefix token recalculation, incorrect queued
save generation and missing charged-write observation. Their RED logs remain.

Real 512/8192-row mixed media/tool journals exercise merge and streamed
persistence. Complete value digests use independently constructed fixture rows;
an independent array `addAll` oracle checks admission and token parity. Tests
cover self-merge, source clear/replacement after capture, pending source identity,
exact pending marker restoration, fresh stamping and the next chronology marker,
partial admission followed by queued mutation, and live/durable rollback parity.
A serialization failure is proven after an earlier source row reached the journal.
Valid nine-MiB rows survive both merge and persistence without being treated as
violations of the controlled-fixture certification bound.

Positive merge owners satisfy the unchanged 440-row/eight-MiB serialized-payload
limits and release registered ownership to zero. Streamed persistence's source
reader peaks at one registered row and releases it. These counters measure named
owners, not every JavaScript reference or the whole heap. Pending writer and
caller identities can grow with unsettled work and are not certified as bounded
history state.

Actual `contentAdded` consumers that retain borrowed rows or distinct copies
exercise the merge publication route at both sizes. Ordinary control tests prove
retention is detected and release every owner. `MERGE_RETAINING_TRAP=1` must fail
all four cases against the unchanged positive bounds. These are deliberate
adverse failures, not ordinary regressions.

The host has active sibling CLI and worker processes, system indexing and other
CPU-heavy work. No quiet-host statistical retained-heap acceptance is claimed.
The 1,048,576-byte allowance and estimator remain unchanged. Whole-provider,
whole-session and no-leak acceptance remain outside this receipt.

## Verification receipt

`stage-release.log` has 30 passes and no failures across the nine final merge,
persistence and probe suites. The original atomicity/density pair passes all 31
cases in `release-extra/original31-final.log`. The completed passing-suite union
has 560 passes, no failures and no skips across 83 deduplicated isolated suite
invocations. That union excludes the failed adjacent batch suite; its seven
passes and one failure are reported below. It also excludes structural,
transform-owner and retaining-trap adverse runs. Counts from the combined stage
and original31 receipts overlap the isolated union and must not be added to it.

Official root typecheck and lint pass on corrected final production source. The
API-surface declaration guard passes. All 719 code files in the full dirty-tree
inventory pass normal and forced 800/80 ESLint with zero warnings and Prettier.
The subsequently added persistence-scale suite passes the same forced rules,
Prettier and core typecheck as a supplemental file. Final document formatting
and diff-check pass. Test-audit has 2,117 findings before and after, with zero new
or removed duplicate-preserving identities after ignoring line drift. The
baseline-file comparison has no unexpected changes; all twelve explicitly
selected protected hashes match, including project memory and skills.

Four completed provider body suites cover density, curated conversion, fallback
and raw compression. All 60 saved actual/expected pairs match byte-for-byte.
Saved pairs are not an additional scenario count. Optional broader matrix drivers
were cancelled while running duplicate density and semantic-purge expansions;
those interrupted suites are not counted as complete. Their raw logs and
cancellation receipts remain. No full repository test-suite, full build or model
smoke acceptance is claimed. `final-receipt.json` contains the consolidated gates,
known failures, scalar probe result and final-source receipts.

## Remaining RED caller inventory

| Exact remaining `getAll` call | Array contract |
| --- | --- |
| `packages/agents/src/core/ConversationManager.ts:499` | Raw/default `getHistory` materializes all rows; dynamic chat forwarding still exposes it. |
| `packages/agents/src/core/client.ts:470` | Eager inactive `AgentClient.getHistory` reads the stored service. |

The same 24 production `materializeHistory` calls remain. The symbol-resolved
`remaining-chains.json` lists every file, line and enclosing method. In
`HistoryService` they belong to tool-response replacement, `getAll`, clear,
`getCurated`, removal checks, pop reads, last-speaker queries, length, emptiness,
validation, summarization, JSON export and statistics. In `HistoryServiceCore`
they belong to add, addBatch, transformAll, media registration, ownership
settlement, context-range capture and event publication.

The four structural findings remain `HistoryServiceCore.materializeHistory`,
`HistoryServiceCore.captureChronology`, `HistoryService.getAll` and
`HistoryService.getCurated`. The public transform-owner suite's three existing
failures also remain. Neither suite was exempted or weakened.

The adjacent frozen-metadata batch test also remains RED: `HistoryService.batch`
reports seven passes and one failure, with an aggregate rollback error instead of
its expected listener error. The same failure reproduces in a disposable copy
with both changed history files restored to their starting dirty-tree bytes;
SHA-256 matches the captured baseline for both files. The live tree was not
reverted. This pre-existing pending chronology rollback limitation was preserved,
not reclassified as passing. `batch-starting-tree.log` and
`batch-confirmation.log` retain both receipts.

Compression strategy arrays, clear/restore, checkpoint/continuation, client transfer, provider fallback,
request conversion and retry bodies retain their previous owners. Replacing the
last two direct reads requires those callers' transaction and persistence
contracts to change.

No `.llxprt` content, immutable raw evidence, structural controls, ownership
thresholds or enforcement was changed. No GitHub, commit, push, OCR, PR or merge
action was performed.
