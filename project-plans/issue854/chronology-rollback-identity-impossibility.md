# Rollback remains RED: arbitrary marker identity requires retaining the originals

Production was not changed in this stage. The existing atomicity and density
suites still have 21 passes and 10 failures. Nine added tests exercise an
observable identity counterexample and bounded traversal of the accepted
media/tool fixture. They pass, but they do not make the transaction GREEN.

Evidence is under
`tmp/verify854/p05d/chronology-rollback-green-20260930-branch3-sol-identity/`.
The previous migration report and its raw evidence remain unchanged.

## Observable counterexample

`chronology-rollback-identity.test.ts` runs a pinned-Bun child with 512 and
8192 distinct, ordinary four-number chronology markers. An external `WeakSet`
contains the original markers. Diagnostic `WeakRef` witnesses do not own the
markers. The test does not retain an external strong marker array.

In the real `HistoryService.replaceBatch` path, `afterPublication` replaces
every input marker and runs GC across timer turns before throwing. Every
original remains alive, and rollback restores every original identity:
`WeakSet.has(restoredMarker)` is true for each input. This is observable through
the public mutation API, without inspecting a private service method.

The disk-backed negative control writes each original marker to a separate
scratch descriptor, overwrites each marker through the real
`ChronologyStamper.inherit`, and crosses the same GC boundary. It has weak
handles for every original, granting more weak-handle storage than a scalar-only
implementation. Every original is collected. Reading the descriptors restores
all four values, but none of the identities. A second disk-backed control adds a
strong marker array; it restores every identity.

| Workload | Rows | Original identities alive while displaced | Original identities restored | Marker values restored |
| --- | ---: | ---: | ---: | ---: |
| Real history transaction | 512 | 512 | 512 | 512 |
| Disk descriptor + weak handles | 512 | 0 | 0 | 512 |
| Disk descriptor + strong control | 512 | 512 | 512 | 512 |
| Real history transaction | 8192 | 8192 | 8192 | 8192 |
| Disk descriptor + weak handles | 8192 | 0 | 0 | 8192 |
| Disk descriptor + strong control | 8192 | 8192 | 8192 | 8192 |

After settlement, disposal and explicit release of the test-owned input/control
arrays, every marker witness is empty in all six workloads. This is a
marker-lifetime check, not proof that every transaction payload is leak-free.
The initial exploratory measurements retained one or all markers after
settlement. Their raw outputs are preserved. The final helper measures in a
detached report job and releases its own arrays after checking restoration;
it does not clear any service-owned rollback or replacement arrays. The exact
zero-survivor assertions were retained. No existing memory probe was changed.

For N distinct displaced originals, guaranteed restoration of the original
objects requires N strongly reachable original objects until rollback finishes.
A serialized address cannot resurrect a collected JavaScript object. A weak
handle cannot guarantee its lifetime. Putting the strong references in a
closure, a weak-key map whose live values own the originals, native roots, or
row-local hidden fields moves the retention without bounding it. Freezing or
intercepting the caller's metadata changes the accepted-input and callback
contract and can change the primary error. The counterexample uses ordinary
valid markers; exotic fields or oversized rows are unnecessary.

## Smallest contract alternatives

The smallest change that preserves arbitrary identity is an explicit allowance
for a transaction-scoped strong ledger of the distinct displaced original
markers. Row values, previous projections and inverse journal operations can
still be disk-backed. That ledger is O(N), cannot satisfy criterion 1, and must
not be labeled bounded or exempted silently.

If the no-context-length-state requirement remains absolute, the mutation API
must stop promising rollback of arbitrary caller-object identities after those
objects have been displaced. A streamed mutation can work on detached row
values, leave the caller's input markers untouched, and restore journal values
through a pinned disk cursor. Exact identity would apply only to a bounded
active borrowed-row window, not all released inputs. The array-based
batch/transform/density and media-owner contracts, callback access and success
semantics would need to change together. Neither alternative was adopted here,
and no approval request is queued.

## Independent defects still present

The identity lower bound does not excuse the other transaction bugs. The ten
original failures remain executable work items:

- `HistoryServiceCore.ts:911-934`: stamping mutates earlier inputs and counters
  before the protected scope; a later frozen metadata object leaves that work
  applied.
- `HistoryServiceCore.ts:979-1064` and `historyJournalStore.ts:604-625`: journal
  admission publishes one op at a time. The completion flag misses partially
  admitted plans. Six pending/durable partial-admission cases fail.
- `HistoryServiceCore.ts:1061-1071`: a compensation exception prevents chronology
  and ownership cleanup and replaces the primary error. One case fails.
- `HistoryServiceCore.ts:1097-1126`: density inheritance happens before token
  estimation and before rollback capture. Two original-marker cases fail.

The bounded transaction would also have to migrate
`historyBatchContracts.ts`, `planHistoryMutation.ts`,
`history-media-ownership.ts` and all whole-array callers. No iterator wrapper
retaining those arrays was introduced. No valid row was rejected or capped.

## Accepted-input scale and unchanged memory probes

The valid 8192-row media/tool fixture contains 20,157,099 serialized bytes.
The existing whole-array media-owner callback receives all 8192 previous rows,
so its complete accepted input exceeds both 440 borrowed rows and 8 MiB.
Those bounds cannot describe simultaneous ownership of that entire input.
They can describe incremental traversal. This is an API ownership caveat, not
a reason to shrink the fixture, reject rows or loosen the probes.

`chronology-rollback-traversal.test.ts` reads every row through `getRecent(0)`
at both scales, compares each media/tool row with an independent fixture, and
checks the real ownership counters. Peak borrowed and decoded rows are one;
serialized ownership stays below the unchanged 8 MiB bound. Live rows and
serialized ownership return to zero. An eager retained-fixture control fails
both bounds without dropping any row. These tests certify traversal only.

The unchanged suspended rollback memory suite still has two passing negative
controls and three failures. Five normal pairs have heap deltas
-414,277; 20,496,262; 20,490,552; 20,576,163; 20,484,527 bytes. External deltas
are -6,078,437; 14,830,166; 14,826,072; 14,821,107; 14,819,311 bytes.
The unchanged estimator's upper bounds are 20,576,163 heap bytes and
14,830,166 external bytes against 1,048,576 bytes. The eager trap fails too,
with upper bounds of 64,963,070 heap bytes and 47,781,614 external bytes.
Negative deltas and the spread are recorded, not excluded.

The unchanged suffix-memory suite passes all four tests, including both eager
negative controls. Normal recent traversal has upper bounds of 77,204 heap
bytes and 73,297 external bytes; token traversal has 81,910 heap bytes and
79,894 external bytes. These are separate traversal measurements, not rollback
transaction certification or full acceptance results.

## Verification and limits

The final targeted run has 30 passes and 10 failures across four files: the
original 21 passes/10 failures plus six identity and three traversal passes.
The 59 isolated adjacent history, recording and child files pass 564 tests.
An additional density file passes 23 tests, and four media/ownership files
pass 16 tests.

Configured root typecheck, including declaration builds and workspace/script
checks, and normal root lint pass. Forced 800/80 and normal ESLint pass over
444 dirty code files. Prettier and `git diff --check` pass. The AST test audit
has 2102 unique file/test/flag/detail/area identities before and after, with
zero added and zero removed findings. The original structural scanner remains
unchanged: 17 passes, three failures, seven findings. Its exact
`HistoryServiceCore.stampHistory` finding is still present.

Production and scanner checksums match the stage baseline. Protected `.llxprt`
files and the prior evidence directory match their recorded checksums. No
commit, push, OCR, merge, full acceptance or whole-repository test run was
performed. This report makes no source-GREEN claim.
