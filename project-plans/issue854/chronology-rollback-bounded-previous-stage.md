# Rollback memory remains RED; durable previous rows now stream from disk

This stage does not fix the three strict chronology rollback memory failures.
It replaces the transaction's eager durable previous-history projection with a
scoped disk-backed snapshot and streams generic journal plans and compensation.
The candidate projection, chronology ledger, pending pins and media effect still
permit context-sized strong ownership. They remain failures, with executable
owner measurements and unchanged original memory tests.

Evidence is under
`tmp/verify854/p05d/rollback-bounded-next-20260930T1016Z-branch3-sol/`.
The earlier migration, identity, atomicity and main-impact evidence was read
without modification. No integration with main was attempted.

## What moved, and what still owns memory

`HistoryJournalStore.withMutationSnapshot` scopes capture, use and closure.
`historyMutationSnapshot.ts` writes durable row values and a fixed-width row
index to scratch files. Iteration decodes one durable row at a time and charges
its explicit borrowed owner until the iterator advances or returns. Compensation
iterates this same snapshot; it no longer materializes a previous-history array
or an inverse-plan array. `planHistoryMutation` produces generic journal ops
incrementally. Density still builds its single mutation payload.

The media participant's `previous` input is now a repeatable iterable with a
length, rather than a required array. `HistoryMediaOwnership` consumes that
iterable for publication rollback and unpublished-adoption cleanup. It still
captures `input.next`, which is an array, in the returned effect. This is an
internal contract migration across both production participants and their test
helper; it is not a fully streamed media transaction.

Pending rows cannot silently become decoded replacements. A new test caught
loss of the original pending row object during compensation. The snapshot now
keeps the original `PendingRowFold` pin and stores numeric pending-row addresses
instead of serializing those rows. That preserves pending row identity through
writer acknowledgement, disposal and rollback. Another test caught an added
previous-row serialization failure before media preparation; pending rows now
avoid that extra serialization, preserving the primary failure order.

The retained pin is a remaining strong owner, not a bounded exemption.
`PendingRowFold` retains `PendingFoldSnapshot.pending`, including pending ops
that may no longer survive the fold. Explicit instrumentation charges those
pinned row owners in the previous and transaction censuses when supplied. They
are released when the scoped snapshot closes. An indefinitely blocked writer
can still make this pin context-sized.

The other remaining paths are:

- `HistoryServiceCore.applyDensityResult`: `currentHistory` remains an eager
  projection across the awaited commit. `nextHistory` shares most of those rows
  and retains the replacement.
- `HistoryServiceCore.captureChronology`: the returned entries retain every
  candidate row and its original chronology object. This preserves original
  marker identities, including callers that overwrite markers before rollback.
- `HistoryServiceCore.transformAll`: the callback still receives a complete
  row array, and the returned replacement is copied into another array. Batch,
  replacement and publication-event arrays also remain whole-array surfaces.
- `HistoryMediaOwnership.prepareReplacement`: the effect retains candidate
  rows until publication, finalization or rollback completes.
- Journal admission and compensation still enqueue pending ops containing
  content references. Streaming the plan does not bound a blocked writer's
  pending overlay or prove a bounded admission peak.

No iterator wrapper was used to relabel these candidate or ledger arrays as
bounded. Their ownership remains visible. The six structural findings are also
unchanged: `materializeHistory`, `captureChronology`, `getRawHistory`, `getAll`,
`getCurated` and `getCuratedForProvider`.

## Test-first owner measurements

The new density fixture uses the real service and journal, 512 and 8192 rows,
2048-byte text payloads, tool calls, tool responses and media blocks. It replaces
one row and removes another, pauses inside media publication, then rejects and
checks every restored row and the original primary error. The complete
8192-row previous fixture contains 20,157,099 serialized bytes. No row or
payload was dropped to meet a bound.

`mutationOwnership` instrumentation charges the density caller's original
projection, chronology ledger row/marker owners and pending pins. The participant
charges its captured candidate rows; the fixture charges its explicitly
caller-owned replacement. Identity deduplication follows the existing
`RowOwnership` protocol. Serialized bytes are its UTF-8 JSON charge at owner
acquisition, not a JavaScript heap estimate. Array-container and other runtime
memory remains covered by the separate unchanged child-process measurements.

`owners-red.log` has one pass and three failures before the durable previous
migration. The final six-test run, `owners-complete.log`, has three passes and
three failures. Raw paused observations are in `owners-complete-raw.jsonl`:

| Observation | 512 rows | 8192 rows |
| --- | ---: | ---: |
| Durable previous-row peak owners | 1 | 1 |
| Durable previous-row peak charged bytes | 2,455 | 2,463 |
| Full transaction live row/marker objects | 1,023 | 16,383 |
| Full transaction live charged bytes | 1,283,062 | 20,583,148 |

The full transaction fails the unchanged 440-object bound at both scales and
the unchanged 8 MiB charge bound at full scale. The eager control retains every
previous row explicitly, fails both previous-owner bounds, and is also charged
to the transaction census. All measured explicit owners return to zero after
settlement. This release observation does not certify a general heap leak bound
or the writer overlay's lifetime.

## Original strict memory results and host limits

The unchanged `chronology-rollback-memory.test.ts` and unchanged child probe
were run separately with a 600-second shell timeout before the final pending
pin and serialization-order corrections. `strict-memory.log` has one pass and
four failures. `strict-memory-raw.jsonl` preserves every sample;
`strict-memory-summary.json` contains the unchanged estimator's pair deltas,
medians and upper bounds.

Normal retained-growth upper bounds were 22,045,394 heap bytes and 16,067,586
external bytes, above the unchanged 1,048,576-byte allowance. The original
fixed-fixture observations were still 8192 rows and 20,157,099 bytes. The eager
fixed-fixture control passed its rejection assertions.

The retained-array trap also failed its heap-median assertion: the median was
-439,278 bytes, while its upper bound was 22,587,559 bytes. Normal and trap
samples included negative deltas and large positive deltas. None was removed,
replaced or reclassified as a passing result. This run fails certification and
also exposes variability in that trap assertion.

A final statistical rerun was not launched while sibling Bun test processes
were active. `competing-processes-final.log` records the competing processes.
The final deterministic owner tests were run; they do not sample heap/GC
statistics. The earlier strict run is not presented as certification of the
final source.

## Atomicity, identity and verification

The original atomicity and density tests remain unchanged and pass all 31
cases, including the ten formerly failing injections. The four existing cleanup
and caller-marker-identity cases also pass. Five new snapshot cases check
pending original-row identity, captured membership after durability/disposal,
borrowed-iterator release, pending serialization error order, and compensation
following partial serialization failure. `pinned-final.log` has 40 passes,
zero failures across these four files.

Chronology cleanup still precedes media rollback. Primary errors, compensation
failures, row restoration failures and ownership failures keep the established
order. The original identity/traversal child suites pass nine cases. The
context-length strong marker ledger was not replaced with weak handles.

The sequential final runner writes `final-gates/manifest.json` and one raw log
per command. Its results are:

- Original atomicity/density: 31 passes; cleanup/snapshot also passed. The final
  combined run after the serialization correction supplies the 40-case result.
- Adjacent history, recording and child coverage: 564 passes in 59 isolated
  files; adjacent density 23 passes; adjacent media/ownership 16 passes. Total
  603 passes across these adjacent commands.
- Official root `npm run typecheck`: passes, including declaration builds,
  workspace checks, scripts and evals. `root-typecheck-final.log` records a
  further passing run after the pending serialization correction.
- Forced dirty-tree 800/80 ESLint and normal dirty-tree ESLint: pass. Normal root
  `npm run lint`: passes. Supplemental lint covers subsequent touched files.
  The preexisting `jest/require-top-level-describe` warning is not an error.
- Dirty-file Prettier and `git diff --check`: pass. Supplemental Prettier also
  checks the final owner helper.
- Test audit: 2102 stable file/test/flag/detail/area identities before and after,
  zero added and zero removed. Initial duplicate-assertion and formatting
  failures are retained in the earlier logs.
- Structural audit: unchanged scanner, 18 passes and two production-file
  failures before and after, with the same six findings.

Initial lint size errors and the pending identity/serialization RED logs remain
in the evidence directory. The journal store was reduced by moving density
planning to the existing planner and moving option declarations to shared
contracts, without changing the lint limits. No original test assertion,
fixture, memory threshold, scanner rule or enforcement configuration was
weakened.

The existing `.llxprt/LLXPRT.md` dirty diff is unchanged. No `.llxprt` file or
preceding evidence was edited. No commit, push, OCR, merge, full acceptance run
or whole-repository test run was performed.

## Remaining implementation scope

A complete fix still needs a row-scoped candidate and chronology protocol,
explicit bounded media snapshots, and pending/admission ownership that preserves
live caller identity without retaining the full rollback context. Those changes
must migrate the whole-array callers together. This stage preserves their
current identity and error contracts and leaves their failing bounds executable;
it provides no full transaction memory-GREEN claim.
