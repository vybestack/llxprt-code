# Chronology rollback migration remains incomplete and RED

No rollback contract migration was applied in this stage. Production sources
and the structural scanner are unchanged. New Bun tests establish the failing
transaction seams and the rollback behavior a replacement must preserve.
`HistoryServiceCore.stampHistory` still returns its context-length `entries`
array, and Criterion 1 still has seven findings.

## Transaction boundaries that need to move together

`stampHistory` snapshots all input objects and their original chronology marker
references before stamping. `commitHistoryMutation` calls it before entering
its `try`. A later frozen metadata object therefore leaves earlier input rows
stamped and consumes counters when the operation fails. Span derivation also
occurs before the protected scope.

Journal publication is another boundary. `HistoryJournalStore.apply` enqueues
one record and adds one pending overlay entry at a time. The batch commit marks
`historyPublished` only after every op has been applied. Admission failure after
a rewind or any content append leaves a partial projection. The tests cover
failure before admission and after each of the first three admitted ops, with
a controlled writer barrier for pending history and with settled durable
history. Live projection checks use the original fixture inputs as the oracle;
after durability, a separately opened journal resolver must match those inputs.

Compensation can itself fail. The current catch block attempts inverse journal
ops before restoring chronology or rolling back ownership. An exception from
compensation skips both cleanups and replaces the primary error. The regression
requires cleanup to continue and an `AggregateError` to preserve the primary
error followed by the compensation error. The existing effect rollback ordering
is also covered.

Density needs the same scope. `applyDensityResult` calls `chronology.inherit`
before token estimation and before the batch commit captures rollback state.
Failures in estimation or ownership preparation cannot restore the replacement's
original marker reference from that later capture.

## Bounded rollback design and unresolved seam

A scoped transaction must begin before the first chronology mutation, including
density inheritance. It must capture the stamper's scalar state, previous token
and span state, and pinned pending/durable membership. It must own journal
admission, publication callbacks, finalizers, compensation and cleanup.

A disk-backed row cursor can retain previous projections and stream inverse
journal ops without materializing a replacement history array. Its records need
stable row addresses, the original metadata-presence distinction, and chronology
state. It must handle aliased input references and close scratch storage on both
success and failure. Admission must record exactly which ops succeeded, rather
than assuming the complete next projection was published. Writer failure must
remain visible without discarding pending membership.

This does not resolve the input-object contract by itself. The existing rollback
restores the exact original marker object when a publication callback overwrites
it. The 512/8192-row parity tests preserve that behavior, including duplicated
input references, metadata-free rows, media and tool blocks, and subsequent seq
allocation. Serializing an original marker to disk and decoding it later would
lose its reference identity. A returned closure retaining the old entries array,
a weak-map ledger of all original markers, or row-local hidden rollback records
would also leave context-length state. None was introduced.

The next implementation seam is therefore the combined mutation API:
`commitHistoryMutation`, the array-based batch/transform/density callers,
`HistoryMediaOwner.prepareReplacement`, `planHistoryMutation`, and journal
admission/compensation. It needs a row-scoped ownership protocol that preserves
original input identities across the transaction, plus a pinned rollback cursor
for all previous pending and durable membership. This stage supplies no such
protocol and makes no GREEN claim.

## Memory fixture and evidence limits

The new child-process probe warms the real journal path, uses the pinned Bun
version, and measures a suspended `transformAll` transaction at
`afterPublication`. Rejection then exercises real rollback. Five 512/8192-row
pairs use the unchanged 1,048,576-byte retained-growth allowance and the existing
paired estimator. A deliberately retained full-history array is a negative
control. The 440 borrowed-row and 8 MiB serialized-payload checks apply only to
the fixed 2048-byte media/tool fixture; they are not production caps or limits on
valid inputs. Callback array sizes measure exposed borrowed rows, not an
instrumented census of arbitrary JavaScript references.

Earlier acceptance and memory evidence was read without modification. The first
exploratory probe used `replaceBatch([])` suspended at ownership preparation. It
exercised an empty stamp input and cannot certify rollback-entry boundedness.
Those raw records remain in the log directory and are excluded from the final
transaction measurements. The final probe uses a nonempty history-wide transform
and preserves its publication failure through rollback. Neither the exploratory
nor final scoped probes are full acceptance reruns.

Logs, raw measurements, manifests and before/after checksums are under
`tmp/verify854/p05d/chronology-rollback-cursor-20260930-branch3-sol/`.

## Verification

The final atomicity and density suites have 21 passes and 10 expected failures
against the original source: one stamping failure, six partial-admission
failures, one compensation-cleanup failure, and two density-inheritance
failures. The 512/8192-row media/tool rollback parity cases pass, including the
original marker reference check. The memory suite has two passing negative
controls and three expected failures: retained-growth certification, 440-row
fixture ownership, and 8 MiB fixture payload.

The normal retained-growth upper bounds are 20,490,486 heap bytes and 14,827,270
external bytes against the unchanged 1,048,576-byte allowance. Pair deltas are
variable, including negative deltas, and their medians are negative. These
samples fail certification; they do not establish a stable growth estimate or
a post-settlement leak. The eager trap's heap median is 21,036,925 bytes and it
also fails the allowance. The fixed fixture exposes 8,192 borrowed rows and
20,157,099 serialized bytes, independently of that GC variability.

The 59 isolated adjacent history, recording and child files pass all 564 tests.
Configured root `npm run typecheck` and core package typecheck pass. Forced
800/80 and normal ESLint pass across all 441 dirty code files. Prettier and
`git diff --check` pass. Test audit has zero added or removed stable findings
across the whole corpus, with 2,102 unique file/test/flag/detail/area identities
before and after. The initial root typecheck exposed an `Array.fromAsync`
production-build library mismatch in the new test helper; replacing that
helper's test-only collection with an explicit loop fixed it without changing
compiler configuration.

Structural progress is seven findings before and seven after. The unchanged
scanner has 17 passing tests and three production-file failures. The exact
`stampHistory` finding remains present. Its source checksum and the core,
rollback-contract and scanner-support checksums match the starting values.
Full acceptance, OCR, commit, push and merge were not run. No `.llxprt` content
or previous raw evidence was edited.
