# Compression attempts stream curated rows; the exact getter remains RED

This stage removes eager curated reads from compression-attempt preparation,
PreCompress callbacks and the post-hook empty-history decision. It does not
remove `HistoryService.getCurated(): IContent[]` or complete Criterion 1.
The unchanged structural scanner reports the same six facade findings. No
getter was renamed, collected into a substitute array or exempted from the audit.

Evidence for this run is under
`tmp/verify854/p05d/getcurated-20260930T1618-branch3-sol/`.
Earlier evidence and the existing dirty workspace were preserved.

## Invoked production stage

`CompressionHandler.performCompression` calls `prepareCompressionAttempt`.
Its context builder shares scalar metadata with the strategy context builder,
but supplies `HistoryService.streamCuratedHistory()` for callback history.
The cursor is cold and pins membership at its first `next()`. It does not yield
from `getCurated`, `getAll` or another eager array.

Callbacks remain fail-open. Their borrowed cursor is closed in `finally` after
success or rejection, including when the callback abandons an active iterator.
Explicit return, throw and loop break release the same journal reader. A callback
that saves yielded rows can still retain them; the retaining control tests that
case rather than treating reader counters as an all-references proof.

After the callback, a separate curated cursor probes for one surviving row and
closes immediately. This preserves the post-hook decision: clearing history
skips compression, while adding content to initially empty history allows it.
The hook fires for invalid-only and empty histories before that decision, with
the existing manual/automatic trigger and metadata.

The pre-compression recording count now traverses comprehensive rows into a
scalar, preserving inclusion of invalid and empty rows. Counting runs inside
the existing compression lock and its `try/finally`, so appends during the
asynchronous count are queued until unlock. Count-source failure releases the
reader, restores the density suppression state and releases the lock before
another attempt. Actual strategy execution still builds its array-valued
`CompressionContext` after this stage.

## Callback API change

`CompressionHandler` constructor callbacks now accept `CompressionAttemptContext`
in place of `CompressionContext`. Its `history` is
`AsyncGenerator<IContent, void, unknown>`, and `estimateTokens` accepts synchronous
or asynchronous iterables. All other metadata fields retain their shape.
The production `ChatSession` adapter needs only the trigger and does not consume
the cursor. Existing declaration consumers using the constructor callback must
update their callback type and replace indexing, slicing and synchronous
iteration with `for await`. A cursor is single-use and borrowed for the duration
of the callback; it is closed when that callback settles. Iteration observes
membership at first use rather than at context construction.

The public core `HistoryService` remains exported with its existing synchronous
`getCurated` contract in this stage. Consumers of that getter have not been
silently redirected to an eager collection under a new name. The callback API
change above is separate from the unfinished external getter migration.

## Why the complete getter migration is unfinished

The remaining direct production callers are the strategy context builder,
`ProviderContentEnforcer.recomposeProviderContents` and
`HistoryService.getCuratedForProvider`. Their complete consumer chains need
migration together:

- Compression strategies slice, split, index and preserve array membership;
  density results, candidate application, cache anchors and rollback also expose
  context-sized arrays. An async input followed by collection would retain them.
- Provider preparation performs global tool continuity, completeness, adjacency,
  sanitization and anchor checks. The enforcer returns arrays for projection,
  retries and fallback, while fallback snapshots retain raw history arrays.
- Request preparation, media-purge request materialization, model hooks, prompt
  envelopes, logging and provider conversions retain request arrays. The current
  `getCuratedForProviderStream` also materializes its whole input before yielding.

The request body and media semantics of those paths were inspected and left
unchanged. The bounded attempt helper is actually called by production dispatch;
it is not an unused replacement wrapper. Removing the exact getter still needs
disk-backed strategy/candidate/rollback contracts and provider preparation that
does not collect its input. The required scanner progression from six to five
has not occurred.

## Behavioral evidence and limits

Initial RED tests reject eager preparation through a guarded real history
facade. The 512/8192-row fixtures include empty human/tool messages, invalid AI,
text, signed/unsigned thinking, media, tool calls, responses and errors.
An independent fixture digest checks curated membership under concurrent append.
Tests cover callback cleanup, post-hook history changes, metadata, iterable
estimation, large individual rows, count-source failure and queued writes while
counting. The async estimator contract also has a captured TypeScript RED.

The concurrency test first used journal rows written directly by the fixture
recorder, then appended through a facade whose chronology counter had not been
initialized from those rows. That fixture collapsed live membership to one row.
Its logs are retained and are not evidence of correct append membership.
The corrected count test admits its initial rows through the history API.
The separate pinned-iterator digest tests intentionally use the journal fixture
and verify the pinned input membership independently.

Legacy retry, recency and telemetry fixtures initially mocked only `getCurated`,
leaving the real journal empty. Their regression failures are retained. Fixtures
now admit actual initial rows. The empty-history case removes real membership,
and the cooldown-reset case supplies a next turn after a successful empty
replacement. Existing functional assertions were preserved. Over-limit test
registration bodies were split and shared fixtures extracted without changing
lint enforcement.

The 440-row and 8 MiB controlled-fixture limits remain unchanged, and the
retaining hook control exceeds both. A valid individual row larger than 8 MiB
passes without truncation or rejection. These ownership tests charge explicit
registered owners, not every heap reference. The 1 MiB retained-growth allowance
and its estimator were not changed. No quiet-host heap sweep was run because
unrelated CPU-bound workers and active CLI sessions were present. This stage
makes no statistical memory-acceptance claim.

## Verification status

The isolated behavioral run in `settled/manifest.json` has 1,187 passes and no
failures across 110 suite invocations. It includes the original 31
atomicity/density cases, four independent Responses body comparisons, twelve
512/8192-row Responses/Anthropic/Gemini body comparisons, cache and retry suites,
and prompt suffix/context/summary tests. All sixteen saved actual/expected body
pairs match byte-for-byte. These provider tests exercise existing request
boundaries; they do not certify an end-to-end bounded provider send or a
cache-enabled large-fixture body matrix. The shared-journal production purge
suite also passes at both sizes in this workspace; the earlier production
report's 8192-row failure is not reproduced by this run.

Final static gates are in `accepted-gates/manifest.json`. Official root
typecheck and root lint pass. All 535 dirty code files pass normal and forced
800/80 ESLint with zero warnings, and their Prettier checks pass. The report's
formatting and `git diff --check` also pass. The test audit retains 2,126
baseline findings with zero added or removed identities. Five existing findings
in two split legacy suites have different scanner scope labels; the comparison
uses leaf-test title, file, flag, exact detail and area as a multiset for those
two files only. Their assertion ledger is preserved separately.

The unchanged structural suite has 18 passes and two failed production-surface
assertions. Its exact six-finding set is unchanged: `materializeHistory`,
`captureChronology`, `getRawHistory`, `getAll`, `getCurated` and
`getCuratedForProvider`. Scanner negative controls still pass. The two unchanged
legacy semantic-purge no-array cases remain RED. Protected-path hashes match.

Adverse logs include the first eager-preparation RED, async-estimator type RED,
count-order RED and the invalid chronology fixture, legacy empty-journal fixture
failures, an extraction error, over-limit and duplicate-title lint failures, new
duplicate test-audit observations and a root typecheck error from the extracted
fixture's optional runtime identifier. Corrected runs are retained alongside
them. No failing assertion was relaxed to produce the passing results.

No protected `.llxprt` content, immutable evidence, scanner, memory estimator,
threshold, assertion enforcement or required check was changed. No GitHub,
commit, push, OCR, PR or merge action was performed. Full repository
build/test/smoke acceptance is outside this narrower result.
