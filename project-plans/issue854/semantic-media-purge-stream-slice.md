# Semantic purge disk transactions pass behavior and Responses bytes; production arrays remain

## Delivered slice

`SemanticMediaPurgeStreamCoordinator` is an independently tested transaction
surface. It is not wired into `SemanticMediaPurgeSession`, chat turns, or the
recording callback. The existing production coordinator and `transformAll`
signature remain intact. The two production no-array tests remain executable
and RED. No stream-to-array adapter was added.

`semantic-purge-disk-rows.ts` stores detached values and a row directory using the
existing disk candidate ledger. Transaction consumers receive frozen read-only
views with a scalar length and repeatable async cursors. Decoded rows and their
blocks are frozen. Separate traversals decode independent row objects. Closure
state holds disk handles and scalar transaction metadata, not a collected
history. The inherited identity-pin map is unused by this detached writer path.

`semantic-purge-candidate.ts` scans the pinned previous membership, restores and
rebases persisted frontier identities, selects the next eligible image, and
builds the candidate row by row. Removal, summary replacement, empty-row removal,
Responses suffix invalidation, pre-image boundary selection and first-row
frontier persistence match the eager coordinator on the complete fixtures.
Sanitization runs on one row. JSON serialization in the underlying ledger also
runs on one row. Valid individual rows larger than 8 MiB are accepted unchanged.
The fixture byte limit is not an input cap.

Commit and rollback use the public `HistoryServiceCore.transformRows` FIFO.
Each validates the current target against the pinned expected disk source by
value before calling persistence. Persistence receives a repeatable row source
and frontier. Publication appends detached values to the public sink. Errors
before persistence completes preserve the original rejection object. Errors
following completed persistence restore the earlier callback state; if that
compensation also fails, the AggregateError preserves primary/compensation order.
Abort during persistence performs compensation without propagating the aborted
signal into the compensation traversal. Existing journal admission rollback,
token accounting and media replacement effects remain the public API's work.

`requestRows(false)` traverses the candidate. `requestRows(true)` traverses the
previous history and tags only the selected pre-image boundary row. Its tag keeps
the exact transaction boundary identity on every traversal and does not mutate
stored base rows. The source row and tagged shallow copy are both charged while
the cursor owns them. Boundary objects contain scalar coordinates, not histories.
The caller must still require a defined prefix and match provider cache evidence,
as the existing session does. This slice does not replace that session logic.

## Contract changes and limits

- Construction does not read history. The streaming frontier is restored when
  asynchronous `begin` completes, rather than during coordinator construction.
- Base and candidate are detached values, not caller arrays or original pending
  references. Their cursors reject work after transaction closure. The caller
  must close the transaction after commit/finalization or successful rollback;
  rejected outcomes do not close it automatically.
- The candidate is immutable. Explicit-cache request rows are now frozen as well.
  This differs from the existing mutable cloned cache-request array. Production
  BeforeModel mutation and request-preparation contracts need migration before
  this surface can replace the session's array fields.
- Persistence is a repeatable cursor contract, not `readonly IContent[]`. A
  callback that partially writes and rejects remains responsible for its own
  atomicity, as in the old coordinator. The coordinator compensates after a
  successfully resolved callback and subsequent live-publication failure.
- Durable previous rows restore by value. This slice promises no pending caller
  object or original marker identity across disk detachment. Existing public
  `appendBorrowed`/`appendIdentity` semantics and original marker tests are
  unchanged. Those operations keep and charge strong owners when required.
- The journal FIFO's snapshot can still strongly pin pending rows. Detached
  semantic candidates do not make all mutation callers, pending folds or queues
  bounded. A generic forward rewrite can require many journal operations; this
  slice uses existing row-wise durability backpressure rather than changing the
  planner or admission rules.

## Test-first evidence

Evidence directory:

`tmp/verify854/p05d/media-purge-stream-20260930T1525-branch3/`

The first run failed because the streaming transaction API did not exist. Raw
failed attempts and their corrections are retained. A prototype filesystem spy
failed to intercept Bun's named filesystem import; that run does not demonstrate
an operating-system write failure. The accepted fault test injects the exact
Error at the candidate disk writer boundary and verifies unchanged membership
and released owners. It does not mock the coordinator or return an expected
candidate.

The complete 512/8192 fixtures contain 2048-byte text, tool calls/responses and
media. The behavioral group checks every candidate against a separately persisted
eager fixture, traverses the pinned previous membership after commit and GC,
rolls back, and checks every restored row. It also covers read-only views,
independent traversal, cancellation, explicit-cache identity, frontier rebasing,
stale target validation, admission failure, persistence failure, tokenization
failure, compensation ordering and an oversized row. Eager arrays exist only in
test oracles. The no-array service subclass rejects `getAll` and the protected
materializer, so these tests cannot pass through either accessor.

The new provider suite drives the actual OpenAI Responses provider and local
fetch transport. For 512 and 8192 rows, both candidate and explicit-cache streams
produce complete request BODY BYTES equal to an independently assembled eager
wire oracle. The oracle includes the provider's unmatched-tool
cancellation response. Its initial omission caused four failing comparisons;
the correction did not alter production normalization. Actual and expected
bodies are saved under the evidence directory. This is Responses wire evidence
from a manually supplied transaction stream, not an integrated chat-turn memory
claim or an 8192-row Anthropic cache-write acceptance claim.

## Verification status

The initial gate manifest and final settled manifest preserve individual commands,
exit codes and logs. The initial root typecheck exposed a duplicate helper export
and test typing errors; those were corrected. The official root typecheck then
passed, including workspace test types and the scripts/evals projects. The
settled official root typecheck and root lint both pass. All 504 dirty code files
pass forced 800/80 ESLint with a zero-warning threshold and Prettier checks.
`git diff --check` passes. The final test audit has the same 2,102 stable
file/test/flag/detail/area identities as the starting scan, with zero added or
removed findings. Protected before/final hashes match, including the already
dirty `.llxprt/LLXPRT.md`, original rollback/memory tests, scanner, estimator and
ESLint configuration.

The two earlier root-format issues were checked separately. The touched
`semantic-media-purge.ts` now passes Prettier. Untouched `historySpanWindow.ts`
still fails its formatting check; it was not edited for this migration. The
two-file check is recorded as exit 1 in `existing-root-format-pair.log`. Dirty-file
formatting success does not mean that every repository file passes formatting.

The original atomicity/density suites pass all 31 cases without assertion edits.
The row-transform/lifecycle/provider-file stream files pass 15 cases, and the
unchanged provider-file binding suite passes five more. The new semantic behavior
group passes 18 cases, and the new provider byte group passes four. The seventeen
separate adjacent suites pass 128 test executions, including those four byte
cases, the five existing independent body/retry cases, cache-prefix controls,
request-scope/lease/backpressure behavior, saved recording and media ownership.
Three additional unchanged diagnostic/request-media redaction suites pass 34
cases. These counts are executions, not a claim of full repository acceptance.

The baseline and final structural runs report 18 passes and two failures. The
same six findings remain: `materializeHistory`, `captureChronology`,
`getRawHistory`, `getAll`, `getCurated`, and `getCuratedForProvider`.
The rollback-effect mutation control and the other scanner controls pass. No
scanner, whitelist, threshold, required assertion or enforcement file was edited
by this task. The earlier stage's 17/3 report is not this run's starting result.

The behavior tests assert the 440-owner/8-MiB fixture bounds for the instrumented
semantic transaction and release to zero after closure. They do not constitute
quiet-host retained-memory acceptance or an all-references heap census.
A new pinned-Bun child and unchanged-estimator suite are supplied for five paired
512/8192 normal samples, five paired strong-row/marker traps and three logical
owner controls. Neither this lane nor the existing legacy strict-memory lane is
reported as accepted until run on a quiet host. Active sibling workloads and
sustained unrelated CPU-bound processes were observed; none was terminated.

The legacy public-transform owner suite remains RED on all three assertions. It
still measures context-sized ownership, including original chronology markers.
No full-repository test/build/smoke acceptance, commit, push, PR, OCR or merge was
performed. The official root typecheck performs its normal declaration build.

## Exact remaining production chain

| Seam | Remaining contract |
| --- | --- |
| `semantic-media-purge.ts:457,466,477` | Constructor/refresh/begin read `getAll`; the transaction owns base and candidate arrays. |
| `semantic-media-purge.ts:513,558` | Commit and rollback still call `transformAll`, compare arrays and spread replacement arrays. |
| `semanticMediaPurgeSession.ts:67-103,107-128` | Cache preparation clones the complete base array; the attempt owns complete candidate/request arrays. Session lease and cache-proof logic must migrate with these fields. |
| `chatSessionMediaLifecycle.ts:18-29` | Recording callback passes a full candidate to `recordSemanticMediaPurge` and awaits flush. |
| `SessionRecordingService.ts:866-872` and the session recording contract | One `semantic_media_purge` payload contains the entire replacement history. Streaming transaction persistence alone does not change that payload or its queue ownership. |
| `StreamProcessor.ts:602-613`, `streamRequestHelpers.ts:63-85`, `turnMediaRequest.ts:31-44` | Candidate overrides, provider curation and enforcement return complete arrays. Tool pairing, sanitization, compression fallback and retries need compatible disk-backed request contracts. |
| Public eager transform tests, owner helper and protected memory child | Legacy callback contracts must migrate without removing original identity, owner or trap assertions before `transformAll` can be removed. |

The production array seam test fails at the coordinator constructor for both
persisted sizes. The independently tested streaming coordinator is not a claim
that those calls have migrated. Pending fold/snapshot pins, caller batch arrays,
batch events, media adoption/reconciliation arrays and explicit identity pins
remain separate potentially context-sized owners.
