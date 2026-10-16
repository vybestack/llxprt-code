# Primary top-down compression uses disk candidates; Criterion 1 remains RED

The primary `top-down-truncation` dispatch now prepares and publishes a
journal-backed candidate without the eager curated, raw or replacement facades.
Other strategy and enforcement routes retain their array contracts. This is an
invoked production stage, not complete compression migration or retained-heap
acceptance. The exact `HistoryService.getCurated(): IContent[]` contract remains.

Evidence is under
`tmp/verify854/p05d/compression-strategy-stream-20260930T2253-sol/`.
The existing dirty workspace and earlier evidence were preserved.

## Production route and ownership

`CompressionHandler.performCompression` still runs the borrowed PreCompress
cursor, post-hook probe, compression lock and comprehensive recording count.
`runCompressionWithRetryAndFallback` now dispatches primary top-down truncation
before constructing the old array context. `runDiskTruncation` calls the shared
metadata builder, opens a pinned disk-backed dump snapshot and writes only
curated rows into `HistoryDensityRows`. The cursor reads actual journal rows;
it does not wrap an eager array. Membership remains fixed across strategy
estimation and candidate annotation. Appends during the lock stay queued and
are flushed after publication.

`TopDownTruncationStrategy.compressDisk` reads the indexed disk rows and chooses
a suffix. Production token estimation sums per-row costs, so subtraction of the
removed rows preserves the old repeated-suffix estimates without collecting
suffix arrays. Explicit targets use `<=`; threshold-derived targets retain the
old strict comparison. The two-row floor and tool-boundary adjustment retain
the old behavior, including forward search and backward recovery. Matching
scans hold one AI row and one prospective response row, rather than a tool-ID
index proportional to history length. These searches can require multiple disk
passes; this stage does not promise constant-time preparation.

Transient estimator failures retry against the same pinned candidate. Exhausted
errors propagate; this migrated primary route has no eager fallback. Source,
annotation and publication errors likewise do not enter the old array path.
Publication errors use the existing transaction's disk-backed compensation.

Retained chronology membership is indexed by `CompressionSpanIndex` on disk.
Destroyed span bounds/count and the first semantic-media frontier are scalar
state. The surviving candidate is emitted through `transformRows` and
`appendDetached`, so candidate acceptance, stamping and rollback use the existing
disk transaction rather than `replaceAll`. Existing summary spans are retained;
unannotated surviving summaries receive the destroyed span. A surviving frontier
wins over transfer from old history. Cache markers are removed and the anchor is
reset only after successful publication, matching truncation's destroyed-prefix
contract. Responses stored-chain metadata is invalidated row by row.

The recording summary selector keeps at most one surviving summary row, with
explicit snapshot reasons preferred over legacy summary detection. That retained
row and the frontier remain owners and are not excluded from the stated scope.
An individual row may exceed eight MiB. The controlled-fixture byte budget is
not a maximum accepted row size.

The curated spool and detached candidate do not use the identity writer. Their
identity/marker Maps therefore remain empty. Existing raw mutation snapshots can
still strongly pin pending caller-owned rows while the journal writer is behind.
Those owners belong to the pending-write/transaction contract and must remain
charged. The bounded fixture evidence here uses settled durable source rows;
it is not proof that arbitrarily many pending external owners are bounded.
Strongly held caller rows and their marker objects are checked separately across
an admission failure. No claim is made that explicit counters discover every
JavaScript reference.

## Behavioral and wire coverage

The first four production tests fail on the old `getCurated` call. Guarded real
histories also reject `getRawHistory` and `replaceAll`. Fixtures contain actual
512/8192 journal rows, not short arrays with inflated length metadata. Normal
cases select a recent 29-row suffix. Explicit-target cases preserve 502 and
8,182 rows while publication remains disk-backed.

Additional cases cover interrupted hooks, pinned queued appends, producer
failure and snapshot closure, partial journal admission with complete rollback,
retry after rollback, strong caller marker identity, surviving summary annotation
and recording, transient estimator retry, and a valid surviving row larger than
eight MiB. Summary and retry failures were captured before their corrections.
Independent fixture rows supply rollback expectations; expected history is not
read back from the component under test.

Deliberately retaining consumers keep each borrowed source row and a distinct
shallow copy. Both 512/8192 controls must fail the unchanged 440-row ownership
bound. Both 8192 controls also exceed the unchanged eight-MiB byte bound and
release to zero afterward. Ordinary registered reader/transaction owners must
pass those same controlled-fixture bounds and release to zero. These controls
are explicit ownership checks, not heap reference census results.

The new twelve-case BODY BYTES matrix invokes the production strategy and real
provider recomposition at both sizes for Responses, Anthropic and Gemini, with
caching enabled and disabled. Its expected candidate is computed by the old
array strategy over independently generated fixtures, with independently
computed suffix token sums and old annotation/normalization. Only network
boundaries are replaced. Responses includes identical retry bodies. Separate
large-journal high-density tests exercise actual tool-result summarization and
recent-tail preservation, but leave its eager ownership visible.

## Remaining executable owners

The primary route uses shared scalar preparation, but the old
`buildCompressionContext` function still calls `getCurated`. Its executable
caller chains are:

- Primary middle-out, one-shot and high-density dispatch through
  `CompressionHandler.runCompressionWithRetryAndFallback`.
- Middle-out structural-no-op routing to one-shot over the same array context.
- Failure fallback to `compressWithFallbackStrategy`, which still invokes the
  array-valued `TopDownTruncationStrategy.compress` contract.
- Provider hard-limit fallback in `createProviderContentEnforcer`, whose callback
  applies `IContent[]` candidates under the enforcer's rollback contract.
- Pending-window hard-limit truncation through `PendingContextWindowEnforcer`'s
  `buildCompressionContext`, `compressWithFallbackStrategy` and array result
  callback contracts.
- Public builder and direct strategy callers/tests that still depend on the
  array-valued `CompressionContext` and `StrategyCompressionResult` types.

`MiddleOutStrategy` retains split/head/middle/tail and injection/request arrays;
`OneShotStrategy` retains compressible/preserved/request arrays; verification
can retain another model request. These explicitly model-facing requests need
separate request ownership/lifetimes when those strategies migrate. Their
current standing context and candidate arrays have not been reclassified as
exempt request owners in this stage. `HighDensityStrategy` retains its input,
summarized head, preserved tail, truncated candidate and optimization indexes.
`ensureDensityOptimized` still reads raw history and returns density
removal/replacement collections.

`ProviderContentEnforcer` still retains complete normalized requests, raw
fallback snapshots and restored arrays. Pending enforcement and tool truncation
also retain candidate/ranking arrays. Turn/media request collection, model-hook
payloads, prompt envelopes, telemetry and Responses/Anthropic/Gemini conversion
and retry arrays remain as documented in `provider-facade-removal.md`. None of
these owners is waived by the primary strategy migration.

The getter is not removed, renamed, hidden behind an eager iterable or exempted
from the scanner. Its full executable caller migration remains unfinished.
The five remaining scanner findings are `materializeHistory`,
`captureChronology`, `getRawHistory`, `getAll` and `getCurated`.

## Verification and limits

Command arguments, exit codes, regression logs, body pairs and protected hashes
are preserved in the run directory. Verification includes the original 31
atomicity/density cases, compression suites, the new strategy body matrix,
existing provider/body matrices, the production semantic-purge session suite,
official root typecheck/lint, all-dirty forced 800/80 zero-warning lint,
formatting, test-audit comparison and unchanged structural mutation controls.
Final counts and gate results are recorded in `final-summary.json`.
The selected regression union has 813 passes and zero failures across 78
isolated suite invocations. This includes the original 31 cases and all 30 new
strategy/behavior/body cases, with overlapping coverage counted by invocation.
All 64 distinct saved actual/expected body pairs match byte-for-byte; repeated
verification retains 104 matching saved pairs across the two run directories.
Official root typecheck and lint pass. All 608 dirty code files pass forced
800/80 ESLint with zero warnings and Prettier checks. The audit retains 2,126
identities with zero additions or removals, ignoring line numbers only.
Protected-path hashes match and `git diff --check` passes.

The unchanged structural suite has 18 passes and two production-surface
failures. Its five findings are unchanged, and mutation/retaining controls pass.
The separate production semantic no-array suite has two passes; the legacy
stream coordinator suite has nine passes in this workspace. Earlier reports'
legacy no-array failures are not reproduced here. One foreground legacy run was
interrupted by the timeout and retained; its background completion passed.
No semantic coordinator or scanner source was changed by this stage.

Early adverse logs retain eager-preparation RED, summary recording RED, transient
retry RED, the first lint failures, two new test-audit self-confirming observations
and a TypeScript library mismatch for a test's `Array.at` use. Assertions were
preserved while expectations were moved to independently generated fixtures.
Named test callbacks return derived results for assertion in their registrations.
The existing summary selector was extracted to keep the handler below the
unchanged line limit. Four fallback-bookkeeping tests initially failed because
their strategy-factory stub no longer intercepted the migrated primary
truncation route. Their fixture now selects one-shot as the primary strategy,
so its injected summary failures still reach the unchanged array fallback
contract under test. All original assertions remain, and all fifteen cases in
that suite pass. No enforcement, scanner, estimator or threshold was relaxed.

Statistical retained-heap measurement is deferred because unrelated CPU-bound
workers and active CLI sessions are present, as recorded in `host.txt`. The
1,048,576-byte retained-growth allowance and its estimator are unchanged. This
stage makes no all-reference, whole-provider, no-leak or retained-heap acceptance
claim. Full repository unit-test/build/smoke acceptance is not asserted by these
selected suites and root static gates.

Protected `.llxprt` files, immutable evidence and enforcement were not changed.
No GitHub, commit, push, OCR, PR or merge action was performed.
