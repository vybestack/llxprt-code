# The raw facade is removed; Issue 854 memory acceptance remains RED

The last direct production `HistoryService.getRawHistory` call, in continuous
density optimization, now runs against pinned disk rows. The exact public
`HistoryService.getRawHistory(): readonly IContent[]` method is removed. The
unchanged structural scanner drops from five findings to four. Its two
production assertions still fail because other eager surfaces remain.

Evidence is under
`tmp/verify854/p05d/density-raw-facade-20261001T0401-sol/`. The starting dirty tree,
protected hashes, structural findings and test-audit baseline were captured
before implementation. Earlier stage evidence and unrelated edits were preserved.

## Invoked density route

`CompressionHandler.ensureDensityOptimized` retains strategy eligibility,
threshold selection, configuration and the dirty flag's existing finally
behavior. It dispatches `optimizeRows`, not the synchronous array optimizer.
`HistoryServiceCore.optimizeDensityRows` executes in the mutation FIFO and opens
a pinned `HistoryMutationSnapshot`. Decisions and publication use that same
membership. A concurrent append is queued behind the mutation and survives
publication. There is no production full-array collector, array-to-cursor adapter,
eager fallback, input cap or row-size cap in this route.

`DiskDensityOptimization` uses indexed disk reads and a disk replacement spool.
`DensityDiskIndex` stores row decisions, latest write positions, stale call IDs,
latest inclusion locations and per-tool recency counts in disk hash chains.
The 4,096 bucket pointers are stored on disk. SHA-256 chooses the bucket;
lookup checks the complete key in each linked record. Cardinality grows on disk,
not in a standing JavaScript Map. Index metrics count actual reads/writes and
disk bytes. The reported 24-byte pointer/header workspace excludes transient
encoded keys/records and content rows; it is not a total heap measurement.

The three phases retain the old ordering: read/write pruning, inclusion
deduplication, then recency pruning over prior decisions. Duplicate call IDs
retain the old global stale-response behavior. Path aliases, mixed concrete and
glob `read_many_files` inputs, empty inputs, multi-block inclusion ties, blank
AI text and existing pruned pointers are covered against the independently
invoked old strategy. Per-row block collections remain proportional to one
row's blocks. No claim is made that an arbitrarily large row has fixed size.

Candidate construction holds the original source row while resolving its
addressed decision, inherits replacement chronology, and invalidates stored
Responses chains row by row. Durable candidate values are serialized; pending
caller identities retain their existing strong ownership. Removal/replacement
spans are spooled to `DensitySpanRows`, sorted on disk with insertion order as
the equal-start tie breaker, and projected into the existing 1,024-span window.
Two passes preserve the old removal-before-replacement ordering. The existing
window bound was not changed. Nonmonotonic chronology is tested against the old
span merger at both fixture sizes.

Token estimation retries transient failures over the same candidate, with three
attempts and the existing retry predicate. Publication itself is not retried.
No-change optimization performs no mutation or Responses invalidation. Partial
journal admission uses the existing compensating transaction. Pending chronology
is restored on rejection even when no journal operation was admitted. Candidate,
index, span and snapshot resources close on the tested fault paths. Index tests
include allocation failure and zero-progress I/O.

The explicit legacy array `HighDensityStrategy.optimize` and
`HistoryServiceCore.applyDensityResult` APIs remain. They are used by independent
test oracles and existing explicit array clients. This stage does not present
those contracts as bounded streaming APIs.

## Public API and repository consumers

The breaking change and cursor lifetime contract are documented in
`docs/migration/history-raw-stream.md`. Callers must consume
`streamRawHistory(signal?)`; membership is captured on first `next()`. Borrowed
rows must not be mutated, and retaining a row or distinct copy belongs to the
consumer. Manual iteration must call `return()` when abandoned.

Repository tests now consume streams directly or use the explicitly eager,
test-owned `collectRawHistory` helper under the test-utils export. Production
code does not import that helper. Guard subclasses no longer override the
removed method. The absence test checks the real public prototype surface.
Textual references in synthetic scanner fixtures remain intentionally.

Forced 800/80 lint required splitting several existing test callbacks, lifting
fixtures and separating density property registrations. The AST inventory in
`assertion-inventory.json` verifies identical test-title multisets, assertion
counts and matcher counts for all ten refactored suites against their migrated
pre-extraction backups. Properties retain their original options and are awaited.
The test-only collector does not hide an eager production owner.

## Behavioral and byte evidence

Real 512/8192-row mixed journals exercise phase decisions and selected
transformations through the invoked handler. All eight phase combinations are
also compared directly with the legacy optimizer. Tests cover partial admission
and retry, strong pending caller/marker identity after GC and rejection,
transient token-estimate retry, concurrent queued append, hard-limit admission,
and a surviving valid nine-MiB row.

Named reader, optimizer and transaction ownership counters use the unchanged
440-row/eight-MiB controlled-fixture limits and return to zero. A source-lifetime
test checks that the decoded original remains charged throughout addressed
decision resolution. These counters measure registered owners, not every
JavaScript reference.

The twelve-case density BODY BYTES matrix passes for Responses, Anthropic and
Gemini at both sizes, caching off/on. Actual requests use the production density
route and provider conversion. Only network boundaries are replaced. Retries
run through `RetryOrchestrator`, and retry SDK bodies must be identical. Expected
bodies use independent fixtures and the old optimizer/normalization. Saved
actual/expected bodies are compared byte-for-byte, without JSON normalization.
Other compression, tool-truncation, fallback and curated-provider matrices are
included in the verification manifests.

Borrowed and distinct-copy retaining controls detect full-history retention at
both sizes, exceed the 440-row bound, and exceed eight MiB at 8192 rows. The
separate `DENSITY_RETAINING_TRAP=1` run has four required failures against those
unchanged positive bounds. Its cleanup still releases all registered objects.
These failures are adverse controls, not ordinary regressions.

## Static gates, audit and adverse results

The final-tree `gates-release/manifest.json` records successful official root
`npm run typecheck` and `npm run lint`, all-dirty normal and forced 800/80 ESLint
with zero warnings, dirty-file Prettier, test-audit execution and `git diff --check`.
The behavioral audit compares duplicate-preserving identities, ignoring only
line positions: 2,126 baseline findings versus 2,117 final findings, zero new.
Seven disappear from scanner attribution after fixture/callback extraction;
two collected-length expectations were replaced with independent fixture sizes.
This is not a claim that extracting a callback repairs those seven test-quality
observations. All original assertions remain executable.

`release-regressions/manifest.json`, `release-extra/manifest.json` and
`release-consumers/manifest.json` preserve suite paths, arguments, logs, process
exits and signals, including the original 31 atomicity/density cases. The final
ordinary union has 1,104 passes, zero failures and zero skips across 127 isolated
invocations after deduplicating repeated absolute suite paths. This excludes
three actual public-transform owner failures, two actual structural failures,
and four deliberate retaining-trap failures. The seven provider byte matrices
have 96 passes; all 96 final-run saved actual/expected pairs match exactly.
Accumulated accepted/confirmation/final artifacts have 204 matching pairs, not
204 distinct scenarios. All 690 dirty code files pass the static file gates.
`final-summary.json` records the consolidated result. The unchanged structural
suite has 18 passes and two failures, with exactly four remaining production
findings. Mutation controls pass. Twenty protected hashes match the starting state.

Adverse logs retain raw-array RED, pending chronology identity RED, transient
estimation RED, the index descriptor leak, initial body-oracle mismatches, and
initial lint/type/audit failures. Automated async/test extraction produced
unawaited helpers, incorrect generator annotations and renamed shorthand-binding
errors; those failures and the corrected runs remain in the evidence directory.
Assertions, ownership thresholds, retry failure visibility and enforcement were
not weakened to make the gates pass.

## Actual remaining owners and acceptance limits

The four structural findings are `HistoryServiceCore.materializeHistory`,
`HistoryServiceCore.captureChronology`, `HistoryService.getAll` and
`HistoryService.getCurated`. Their tests remain RED. They were not renamed,
exempted or hidden behind a full-array iterable.

The unchanged public `transformAll` owner suite also remains RED: its paused
transactions retain 1,024/16,384 registered rows for the two sizes, and the larger
case exceeds eight MiB. Those explicit array/chronology owners require a separate
caller and transaction migration. They are not failures of the new density
cursor, and this report does not waive them.

Middle-out, one-shot and high-density compression still construct array-valued
strategy contexts/results. Provider fallback installation, pending enforcement,
client deferred history, clear/restore and checkpoint/replay paths retain their
previous array contracts. Provider request conversion, hooks, media resolution,
envelopes and retry request arrays remain request owners. Pending writer and
caller-owned identities can grow with unsettled work and are not classified as
bounded durable-history state.

No statistical retained-heap acceptance is claimed. Host snapshots show unrelated
CPU-bound worker processes, an active sibling model server and multiple CLI
sessions. The 1,048,576-byte allowance and statistical estimator remain unchanged;
a quiet-host density sweep is still required. Full repository test/build/smoke,
whole-provider memory, no-leak and whole-session acceptance are not asserted by
these selected regressions and static gates.

No protected source, `.llxprt` contents, immutable evidence, scanner controls or
enforcement policy was changed. No GitHub, commit, push, OCR, PR or merge action
was performed.
