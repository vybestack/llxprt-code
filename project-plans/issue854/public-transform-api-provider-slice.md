# Provider-file binding streams rows; the complete transformAll migration remains unfinished

This stage implements an independently tested caller slice. Both provider-file
binding callbacks now use the public `transformRows` cursor and disk sink. The
legacy `transformAll` signature remains unchanged for semantic-media purge,
context tests, the original owner helper, and the protected memory child. No
array-to-cursor adapter or production row-size cap was introduced.

Evidence is in
`tmp/verify854/p05d/public-transform-api-20260930T1304Z-branch3-sol/`.
The earlier stage reports and protected tests were not edited. No commit, push,
OCR, PR, merge, full-repository acceptance, or enforcement change was performed.

## Implemented API and caller behavior

`HistoryServiceCore.transformRows` serializes the operation through the mutation
FIFO. It captures a disk-backed previous-membership snapshot and supplies a
repeatable async source whose entries explicitly distinguish detached durable
values from borrowed pending rows. The sink offers `appendDetached`,
`appendBorrowed`, and `appendIdentity`. Detached appends sanitize and serialize
one value immediately, without stamping the caller's object. Both reference
operations retain the exact row strongly through completion and protect its
original marker during rollback. Borrowing never exempts an owner from the
census. There are no weak handles for guaranteed originals.

The source and sink are scoped to the callback. Escaped handles reject new work
after callback completion. Early cursor return releases its row, cancellation
prevents further candidate admission, and a second cursor traverses the same
captured membership. Disk decoding restores the immutable provider-file
reference and collection contract.

Provider-file bind validates that matching reference media exists before
candidate serialization. It then makes a second cursor traversal and writes
row-local updates. Unbind writes row-local updates directly. Both operate under
the history mutation FIFO, including queued appends. Their tests also use a
history subclass whose whole-history materializer throws, so accessor escape
cannot make the migrated caller pass.

Streaming publication admits operations with durability backpressure rather
than retaining an entire rewrite queue. It tracks the suspended planner rows,
publication operation, and distinct row graph in the last serialized journal
envelope. Owner enumerators are repeatable because deterministic release
re-enumerates them. A one-shot generator initially leaked census acquisitions;
the failing logs are retained.

An externally seeded journal's captured durable boundary is adopted before
publication, including no-op transforms. Without that step, an unbind operation
with no journal operations could lose all membership. The provider tests caught
and now cover that case. Context-range publication derives its boundary from
candidate rows without a whole-history materialization.

The existing eager mutation path keeps synchronous admission. Its original
identity, pending-writer, failure aggregation, token, and chronology assertions
remain unchanged. The detached streaming path uses the existing bounded durable
compensation. Pending previous membership and explicit identity writes still
have potentially context-sized strong ownership.

## Behavior and memory evidence

The fail-first row-transform suite had six failures because the API did not
exist. The final streaming behavior group passes 20 cases. It includes complete
512/8192 mixed media/tool journals, changing every row's text, full ordered
restoration after GC, strong original-marker restoration after displacement,
aliased borrowed rows, partial journal admission failure, cancellation, repeated
and early-return cursors, scoped-handle closure, token accounting, and circular
tool-payload sanitation. No original assertion was removed. Two assertions at
separate transaction stages were moved into shared helpers to avoid duplicate
scanner findings; both stages still execute them.

The retained-memory lane traverses all source rows and changes the first row.
Its 8192-row source still serializes to 20,157,099 bytes. The logical control
measures actual active transaction owners, not all rows that the cursor has
visited. The strong borrowed-row trap deliberately keeps every row and original
marker. All 23 raw samples are retained for each lane.

| Isolated observation | 512 rows | 8192 rows |
| --- | ---: | ---: |
| Streaming pause active owners | 2 | 2 |
| Streaming pause serialized charge | 4,894 | 4,894 |
| Streaming peak active owners | 3 | 3 |
| Streaming peak serialized charge | 7,333 | 7,333 |
| Strong borrowed-row trap active owners | 1,024 | 16,384 |
| Strong borrowed-row trap serialized charge | 1,280,785 | 20,580,869 |

The unchanged paired estimator accepts the normal streaming lane: heap and
external upper bounds are 125,503 and 122,851 bytes against the unchanged
1,048,576-byte allowance. The trap is rejected: heap and external upper bounds
are 25,075,368 and 17,125,685 bytes. Its heap median also exceeds the allowance.
All five streaming memory tests pass. Host checks before and after both lanes
found no competing suites; sampling waited for the verification driver and
sibling suites to stop. Production source was settled during sampling. The
subsequent changes were assertion-helper and type-only test fixes.

These fixed fixtures do not establish a bound for arbitrary row sizes or every
caller. A single accepted row can exceed 8 MiB. No input cap was added. Provider
BODY BYTES and retry checks are adjacent existing-fixture equivalence tests,
not an 8192-row end-to-end provider memory claim.

## Official and adjacent checks

`final-gates/manifest.json` records 187 commands. Official root typecheck and
root lint pass. Root lint reports one preexisting top-level-describe warning in
`pop-token-accounting-settlement.test.ts:61`. The original atomicity and density
files pass all 31 cases; cleanup/snapshot/density coverage passes 11 cases.
The 163 adjacent exact-path commands pass 1,745 test executions. Five provider
body-equivalence/retry assertions and request-scope, lease, backpressure, and
Responses retry coverage pass.

`supplemental-gates/` records a final official root typecheck after test-helper
typing was corrected, 26 identity/candidate/admission/owner cases, and 17 media
cases, all passing. `final-test-gates/` preserves the earlier readonly-array
helper type error and the passing assertion behavior run. Failed intermediate
runs are not presented as final-source type proof.

All 492 dirty code files were checked with forced 800/80 limits and Prettier.
There are no size-rule errors. Six forced ESLint batches pass; one fails its
additional zero-warning threshold solely because of the untouched
`pop-token-accounting-settlement.test.ts:61` warning. That batch is not reported
as green. Both final edited test files pass forced limits with zero warnings.
Dirty-file Prettier and `git diff --check` pass. The final audit has the same
2,102 stable file/test/flag/detail/area identities as before, with no added or
removed findings. Protected before/after hashes match, including the already
dirty `.llxprt/LLXPRT.md`.

## Unrepaired failures and false negatives

The structural suite finishes with 17 passes and three failures. Six actual
findings remain: `HistoryServiceCore.materializeHistory`,
`HistoryServiceCore.captureChronology`, `HistoryService.getRawHistory`,
`HistoryService.getAll`, `HistoryService.getCurated`, and
`HistoryService.getCuratedForProvider`.

The third failure is a mutation-control false negative. Extracting effect
rollback from the core to meet the unchanged file/function limits means the
protected scanner no longer sees its original method location. Injecting
history-sized effects into the commit still ought to be rejected, but this
control now returns false. The scanner was not changed or weakened. This
additional failed control must be repaired with an authorized scanner migration;
its absence cannot be treated as proof that effect ownership is bounded.

The broad structural-analysis tool initially stopped at its 2,000-file budget
and returned no references. An exhaustive TypeScript syntax census was run
instead and preserved in `transformAll-references.json`. It finds the two
remaining production calls, one declaration, six context/facade test calls,
one owner-helper call, and two protected memory-child calls.

All three legacy public-transform owner assertions remain red. The legacy
8192-row paused transform still owns 16,384 row/marker objects with 20,580,869
charged bytes. Its unchanged strict-memory suite has two passes and three
failures. The fixed controls still own 8192 rows and 20,157,099 bytes, exceeding
both logical limits. The legacy estimator incorrectly accepts its deliberately
retained-array trap in this run: heap upper bound -399,619 bytes and median
-403,426 bytes despite actual strong retention. This is a false negative,
not a retained-memory certification. Its normal lane also has large negative
paired estimates. Raw observations and the unchanged estimator results remain
in `isolated-peaks/`; no samples or thresholds were removed or adjusted.

## Exact remaining migration

`semantic-media-purge.ts:513` and `:558` are the remaining production
`transformAll` callbacks. The transaction at that file's public surface owns
whole `baseHistory` and `candidateHistory` arrays. Candidate construction,
value comparison, persistence, and compensation all operate on arrays.
`packages/agents/src/core/semanticMediaPurgeSession.ts:107-128` retains candidate
and provider `requestHistory` arrays, including the separately cloned cache
prefix path. `chatSessionMediaLifecycle.ts:18-26` passes a full candidate to
recording. Those contracts must migrate together to scoped repeatable disk
sources, including explicit disposal and row-wise request/persistence handling.
Changing only the callback type would preserve the full-context owners.

Next, migrate those semantic-purge transaction, comparison, persistence,
recording, cache-evidence, and provider-request seams together. Preserve frozen
candidate behavior, frontier identity/rebasing, concurrent-history validation,
cache evidence, compensation ordering, and provider bytes. Then migrate the six
context/facade callbacks and owner helper without deleting assertions, replace
the protected child contract only with authorization, and remove the legacy
array callback/public copy in one type-consistent change. The present source
keeps both APIs coherent and claims only the completed provider caller slice.

Separate remaining strong owners include pending fold/snapshot pins, caller
arrays passed to `addBatch`/`replaceBatch`/`replaceAll`, batch events, media
adoption/reconciliation arrays, and identity row/marker pins. The new identity
trap demonstrates why explicit borrowed rows cannot be renamed as detached or
excluded from ownership accounting to make the full fixture pass.
