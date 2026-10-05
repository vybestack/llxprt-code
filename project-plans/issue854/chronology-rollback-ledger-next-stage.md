# Density pause owners are bounded; public array rollback remains RED

This stage removes the full current/next density projections and the media
participant's candidate-array closure. It does not eliminate the public
array-based chronology ledger or certify the strict 1 MiB retained-growth
requirement. The exact `HistoryServiceCore.captureChronology` structural finding
remains visible because those callers have not all migrated.

Evidence is under
`tmp/verify854/p05d/rollback-ledger-next-20260930T1109Z-branch3-sol/`.
`final-gates/` contains the final exact-path verification. Previous stage reports
and their evidence directories were read without editing them.

## Source and ownership changes

`HistoryServiceCore.applyDensityResult` at line 1087 captures current membership
through the existing scoped disk snapshot. It no longer materializes
`currentHistory`, copies it to `nextHistory`, or retains either full row array
across the commit. The same snapshot supplies validation, density spans,
inheritance, planning and compensation.

`historyDensityRows.ts` stores repeatable candidate row values and a fixed-width
index on scratch files. Stamping writes durable candidate values back to the
candidate file before token estimation and publication. Iteration borrows one
row and releases it on advancement or cancellation. The candidate supplies
indexed access for the journal planner and context-span derivation without an
eager return. Responses-chain invalidation still runs row-wise. Scratch files
close on success and failure.

The density chronology path uses a repeatable entry iterator with disk-backed
metadata-presence flags. Durable retained rows do not need a strong rollback
ledger: their original values remain in the previous snapshot, and stamped
candidate rows are detached values. Original replacement and pending-row
identities remain explicit pins in `HistoryDensityRows.identities`; displaced
original markers remain explicit pins in `originalMarkers`. Candidate row pins
are charged on acquisition. Marker pins are charged through the existing
chronology ownership protocol and released before candidate closure. These
maps can grow with the number of replacements or pending rows. They are not
bounded exemptions.

`HistoryMutationSnapshot` additionally charges borrowed previous rows to the
transaction census, alongside the previous-row census. Its pending fold still
pins original pending owners, including ops that no longer survive the fold.
The existing pin ownership charges remain in place.

The internal media contract now accepts repeatable candidate iterables with a
length. `HistoryMediaOwnership.prepareReplacement` at line 68 consumes candidate
rows into a disk media index during preparation. Its effect captures that index,
the previous iterable, adopted reservations and the optional ownership counter;
it does not capture `input` or `input.next`. Publication decodes and emits media
reservations directly from the index. Rollback transitions from the repeatable
previous source. The target index closes on rollback or finalization. Borrowed
reference objects are charged separately from their row owners, including
across awaited reserve/release operations.

`historyBatchContracts.ts`, `historyChronology.ts`, `contextRange.ts` and
`planHistoryMutation.ts` were migrated to the indexed/iterable density source.
Generic journal operations still stream, and density retains its established
single-payload plan. No candidate array was moved into an iterator closure.

## Paused owners and retained negative controls

The accepted fixture still has 8192 media/tool rows, 2048-byte text payloads,
and 20,157,099 serialized bytes. Every previous row is checked during traversal
and after rollback. The density operation replaces one row and removes another.
The caller keeps the original replacement alive, and its ownership charge is
included in the transaction census.

The initial density owner suite had three passes and three failures. The final
six density cases pass, including the retained eager previous-row trap. The
three new public-transform owner cases remain RED. Raw final observations are
in `final-gates/owners-raw.jsonl`.

| Publication pause | Rows | Live transaction objects | Live charged bytes | Peak transaction objects | Peak charged bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Density, ordinary | 512 | 1 | 2,377 | 2 | 4,832 |
| Density, ordinary | 8192 | 1 | 2,383 | 2 | 4,846 |
| Density, retained eager trap | 8192 | 8193 | 20,159,482 | 8193 | 20,159,482 |
| Public transform, ordinary | 512 | 1024 | 1,280,785 | 1025 | 1,283,240 |
| Public transform, ordinary | 8192 | 16384 | 20,580,869 | 16385 | 20,583,332 |

The density fixture's previous-row peak remains one object, with at most 2,463
charged bytes. The eager trap retains all 8192 previous rows, exceeds both the
unchanged 440-object and 8 MiB bounds, and remains charged to both censuses.
All explicit measured owners return to zero after settlement in these cases.
That release check is not a general heap-leak certificate.

The participant in the owner fixture now borrows repeatable candidates rather
than retaining every decoded row. Existing array inputs are still charged as
strong owners. Its earlier retain/release array behavior is not applied to fresh
objects from repeatable disk reads. Production candidate iterators supply the
borrowed-row charge; the fixture's explicit retained array still supplies the
trap charge.

## The unresolved public array chain

`HistoryServiceCore.transformAll` at line 744 still passes a full materialized
array to the public callback and copies its returned array. The async callback
can retain or mutate those original row objects. The replacement remains live
through token estimation and through `commitHistoryMutation(input)`.
`input.nextHistory`, the local `nextHistory` alias, and
`captureChronology(nextHistory).entries` at line 915 retain the candidate rows.
Each entry also retains its original chronology marker until rollback finishes.
Identity deduplication counts shared row objects once, rather than pretending
that the aliases hold separate payload objects.

`addBatch`, `replaceBatch` and `replaceAll` also remain array-based callers.
Batch publication-event arrays and the media adoption/reconcile surfaces remain
array contracts. The new indexed density source does not turn any of these
surfaces into bounded protocols.

The existing identity counterexample still requires the original displaced
markers to survive when the caller has only a WeakSet witness. The unchanged
strong-caller tests additionally require restoring each original marker after
callback overwrite and GC. Disk descriptors cannot recreate those identities,
and weak handles cannot guarantee that the originals survive. This stage keeps
that contract and its pins. It neither rejects the accepted fixture nor
silently changes rollback to value-only restoration.

A subsequent stage must change the public transform/batch ownership semantics
and journal admission/pending ownership together. Streaming candidate reads do
not bound the writer's pending overlay, density replacement payloads,
compensation admissions, or externally retained callback inputs. Success paths
still contain whole-history synchronous context-range materialization. The
paused density measurements cover the specified publication pause, not every
possible peak or every input with a context-sized replacement map.

## Atomicity, identity and verification

The original 31 atomicity/density tests are unchanged and pass. Cleanup,
snapshot and the two new repeatable-candidate cases pass 11 tests. The unchanged
identity/traversal suites pass nine cases, including both weak-descriptor and
strong-retention controls. Failure order remains primary error, compensation
failures, chronology restoration failures, then ownership rollback failures.
Chronology restoration still precedes media rollback.

The final sequential runner passes 1,769 adjacent test executions with zero
failures across 163 commands: 162 isolated files plus the four-file media group.
The media lifecycle file also appears in the isolated list, so the execution
count includes that repeated run. The manifest retains each command and exit
status. `summary-final.json` records the final totals.

The initial runner used non-exact Bun test filters for identity and structural
coverage. Copied tests under ignored evidence directories were discovered, and
identity child output was empty in that invocation. Exact-path commands pass
the original identity suite. Those failed logs remain. A structural mutation
control also caught moving rollback collection into a helper and splitting the
commit body. The source was corrected to preserve that control; neither the
scanner nor its expectations were edited.

Official root `npm run typecheck` passes, including declaration builds and all
workspace/script checks. Forced 800/80 and normal ESLint pass over all 476 dirty
code files. Root lint, dirty-file Prettier and `git diff --check` pass. Root lint
retains the preexisting `jest/require-top-level-describe` warning, with zero
errors. The audit has the same 2,102 stable file/test/flag/detail/area identities
before and after, with zero added and zero removed findings. Shifting line
numbers are excluded from that identity comparison.

The unchanged structural scanner has 18 passes and two production-file failures,
with the same six findings: `materializeHistory`, `captureChronology`,
`getRawHistory`, `getAll`, `getCurated` and `getCuratedForProvider`. Its negative
controls remain intact. Final command results are recorded in
`final-gates/manifest.json`.

The strict-memory process check found sibling `npm run test`, a Bun workspace
test runner and provider diagnostic lanes still active.
`competing-processes-strict-check.log` records them, and
`strict-memory-status.json` records that no broad heap/GC sampling was launched.
No new 1 MiB certification is claimed from deterministic counters or from the
previous stage's strict failures. The original strict suite and child probe
have unchanged checksums and unchanged thresholds.

`protected-final.log` confirms unchanged original atomics, strict-memory tests
and child probe, structural scanner and the preexisting dirty
`.llxprt/LLXPRT.md`. No `.llxprt` file, enforcement configuration, immutable
previous-stage evidence, commit, push, OCR or merge was changed or performed.
No whole-repository acceptance claim is made.
