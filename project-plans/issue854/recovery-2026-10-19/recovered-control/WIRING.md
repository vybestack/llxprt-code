# Wiring restart map, reconstructed

The original WIRING file is not fully recovered. `reports/WIRING-author-report.txt` preserves its author's report verbatim: current recording seq 260, 2026-10-17T07:52:28.235Z. Quoted portions of later versions remain in `fragments/stdout/seq-418.txt`, `seq-438.txt`, and `seq-450.txt`, with timestamps in `provenance.json`. The recreated post-incident WIRING file is separately preserved under `../recreated-notes-at-recovery/`.

## Work map

| Slice | Scope from the wiring author |
|---|---|
| W1-W2 | Trailer counters, synchronous scalars, last-row and row-view reads |
| W3-W5 | Tail removal/media reconcile, resume adoption, profile replacement, merge and density operations |
| W6-W7 | Async port types and journal construction with lazy primary |
| W8-W9 | Service scalars, durable commit/fan-out boundary and batch-event lifetime |
| W10-W11 | Core history suite clusters and native contract coverage |
| W12-W14 | Recorder port consumers/factory/integration and resume dispatch |
| W15-W16 | Fork/checkpoint front doors and child histories |
| W17-W19 | Agents recording controls, session packages/matchers, persisted snapshot/janitor behavior |
| W20-W21 | Backend-aware test infrastructure and recording/resume/discovery proofs |
| W22-W24 | Agents suites, CLI/zed/a2a/provider parity and whole-product proofs |
| W25 | Default flip and deletion inventory for S14/S15 |
| W26 | Agents compression candidates stream into the async sink without per-operation scratch files |

W26 comes from D-ORCH-7, recovered verbatim from seq 261. That decision also requires W24 to measure primary-plus-mirror write amplification and choose from the measurement whether the attached recorder becomes the primary.

## Latest supported status

W11 closure is reported for the original 92-file inventory and 37 native-coverage paths at `b0f58ec58`, not a fresh full-package sweep. See `W11-PROOF-INVENTORY.md` for the missing tables and retained reports. W15, W16, W18 and W19 are reported complete in later task results. W17's wider lifecycle/fault remainder is DONE with new W21-owned proof at `e514188fc7f00638700e28025d3aec9976e8f25a`. W21 parts one through six are committed, with final service-mutation fixtures at `9b85ba7b0c096d86bc2188eb1805a001fe921e23`; W21 remains partial. The old backend remains the default. W22-W26 and phases five through nine remain.

`W21-INVENTORY.md` records the recovered part-one inventory. Its 289-path difference is against that bounded regenerated process matrix, not cumulative native coverage accounting. Later appended entries record the lifecycle/replay/failure/agents increments. The current service-mutations source, process/control/gate/hash tables and exact remaining W21 obligations are in `W21-SERVICE-MUTATIONS-PROOF.md`; four earlier old integration runs alone did not close their native counterparts.

## Wiring invariants retained from reports and decisions

Durable publication must settle recorder fan-out before the next turn boundary. Offset-based reads hold a pin for their lifetime. Compaction preserves version identity. Resume adoption and recording detachment must preserve the active history and owner boundaries. Native discovery must handle retired sessions as unreadable without aborting an entire directory scan. Caller-free mutation helpers are deleted rather than wired into a new fallback path.

The old report's complete D01-D40 deferred-item table and its full file/line mapping were not recovered. Do not claim that this summary restores that table. The user-supplied snapshot, verbatim task prompts/reports and partial stdout excerpts provide the attributable restart context; the tracked design supplies the requirements.

## W21 lifecycle wiring, new evidence at 6bcc23386

`HistoryService` mutations commit to the native primary and deliver deltas to the recorder mirror. `RecordingIntegration.dispose()` queues detachment behind admitted mutations. `MirrorFanout.detach()` now waits for the mirror queue, removes the link, then reports an unobserved mirror failure. `JournalMirrors.detachRecorder()` removes its recorder registration in finally, so failure reporting cannot leave future rows routed to a failed recorder. Flush retains its existing repeated native failure reporting; the failure's reported bit prevents an already observed error from being repeated only at detachment.

Native lifecycle coverage adds independent state-trie reads for provider/directories, actual debug output for operational events without journal growth, held records/trailer batch disposal, failed-detach replacement refusal, empty-batch publication rollback, repeated same-instance subscription, and a live history iterator across recorder shutdown. The ownership suite uses real file/lock/media operations to prove cleanup aggregation, lock release/reacquisition and media reservation lifetime. The 22 original old-layout lifecycle cases are unchanged except for explicit old backend selection. Native counterparts are mapped case by case in `tmp/854-notes/p4/w21/lifecycle/run-20261019-part2-a/contracts.md`.

New matrix: 24 isolated processes, 222 passes, zero failures/skips across 12 files in both outer environments. This supersedes no earlier matrix and restores no deleted proof. It does not close W21 or W17. The replay, compressionBoundary, replaceInterleave, recording-failure family and three agents owner/lifetime paths remain next, alongside the service-plus-recorder scale/fanout/crash/transport gaps in remaining-contracts.md. No backend default changed.

## W21 replay/boundary wiring, new proof at b0ecaef63

The real HistoryService/JournalRecordingService/RecordingIntegration path now has22additional native replay/adoption/boundary cases. Old replay25, compressionBoundary13 and replaceInterleave7 remain unchanged in behavior/assertions and explicitly construct old histories. Native resume preserves title tri-state, identity/name/start/provider/directories, checkpoint identity/sequence and active lock/file path. Rebuilds preserve exact membership and distinguish genuinely new equal-text rows. Native primary/mirror replacement and clear gates verify actual trailer writes, FIFO appends, metadata ordering and the public completion boundary. Listener rejection restores membership and token accounting, then continues on the same writer; actual records/trailer/flush failure preserves the previous version and continues only after real reopen. Production is unchanged.

Final source proof:34serial isolated processes360passes0fail0skip across17paths in both outer environments. Declaration/coretsc, scoped lint/format, affected graph and audit passed;18source hashes match commit/worktree. Existing native adoption/profile/pin/publication/core/lifecycle/fault/ownership cases are RUN and mapped, not duplicated. Full45-case map and remaining non-equivalences: tmp/854-notes/p4/w21/replay-boundary/run-20261019-part3-a/contracts.md. Small public boundary proofs do not close the every-byte service cut/restore, fanout/large-row/crash/transport or full discovery/reference-media obligations. Generated and unstamped exact scopes remain recorded in remaining-contracts.md. W21 and W17 stay partial; W22-W26 and later phases remain. The old default remains unchanged.

Only the individually verified ignored test-utils/dist obstruction was moved intact. No cleanup, .llxprt edit, broad staging, OCR, push or merge. All recorded run PIDs absent; historical deleted logs are not restored. Review skipped per Andrew2026-10-09.

## W17 public lifecycle and fault wiring DONE, W21-owned proof at e514188fc

The three named agents public suites now preserve 32 explicit-old cases and add 24 native cases plus two old/native media-reservation-failure cases. Their native route is public Agent/SessionControl through the real HistoryService, recorder, integration, media store and session lock. A test-only infrastructure wrapper injects actual positional write/flush failures without replacing recorder logic; successful flushes still call the platform implementation. Independent readers open committed native rows, session facts and checkpoint descriptors. The ten original describe blocks are AST-identical to base `6a42630ab`.

Checkpoint creation/rename/overwrite/fork and restore serialize on the public session queue. Client restore rejection preserves the full durable/live row state. Media snapshot reservation failure unwinds acquired reservations before publication. Resumed session identity/name/start/path survive continuation; stopping its adopted primary preserves the active history on a clone and prevents later mutations or provider turns from writing the closed session. Borrowed facades share live history while maintaining separate recorder ownership, files and locks. Held admitted positional writes join shutdown; late recording/resume/checkpoint admission rejects before creating resources.

Commit `e514188fc7f00638700e28025d3aec9976e8f25a` is test-only. Final new proof: 42 serial isolated processes, 438 passes, zero failures/skips across 21 paths in both outer environments. Existing 25 native core/fault cases, lifecycle/ownership/boundary/replay, writer/adoption/fork and all six W17 part-one suites were RUN and mapped rather than copied. Declaration/core types and final agents/touched types, scoped lint/format, staged affected graph and audit passed; 22 source hashes match worktree/commit and no recorded run PID remains. Exact case map, proof boundaries and development failures: `tmp/854-notes/p4/w21/agents-lifetimes/run-20261019-part5-a/contracts.md`.

W17 is DONE for this named remainder. W21 remains partial. Generated/reference-media/unstamped replay, service-plus-recorder every-byte restore/cut/fanout/large-row/crash, actual transport-next-request durability and wider discovery requirements remain open in `remaining-contracts.md`. Explicit public flush/stop proof does not close those transport entry points. W22-W26 and later phases remain. [#3899](https://github.com/vybestack/llxprt-code/issues/3899) tracks the separately observed old JSONL media-deletion validation failure. No full package/shard/monorepo claim, default flip, cleanup/deletion command, .llxprt edit, OCR, push or merge. Review skipped per Andrew 2026-10-09. Historical deleted logs are still missing; all proof here is new.

## W21 service mutations part six delivered, still partial

Commits e5a71cd6a570277773f73402d0d87742c2ffcc8b, 1fead98e55ebd7c3cadfb58982110932110b6c3e and final fixture commit 9b85ba7b0c096d86bc2188eb1805a001fe921e23 account for defect 2 and defect 3. HistoryService self-merge appends pinned derived rows with their original owners through the existing bounded batch, preserving suffix-only notifications. Real recorder pop proof observes A B A B to A B A, closes/resumes/adopts, then observes A B independently on disk and live. The two-real-recorder 3/64/65/5000 service proof checks full owner-aware membership after density and appendDerived replacement, exactly one primary/recorder group and actual recorder flush per operation, and clear to zero everywhere.

Product owner-loss RED is 0 pass/1 fail. Final first-marker control rejects 0 pass/1 fail; owner-loss-above-64 control yields 2 pass/2 fail; retaining positives pass 4 and traps reject 4 per backend. Both mutations restore bytes. The related matrix exposed fixture seed-token differences, corrected before seeding at 9b85ba7b0 without production changes or weaker assertions. W21-SERVICE-MUTATIONS-PROOF.md retains the full case, process, control, gate, hash and remaining-contract map; raw evidence is tmp/854-notes/p4/w21/service-mutations/run-20261019-part6-a/.

Final confirmed-source-tests matrix: 58 serial isolated Bun processes, 454 passes, zero failures/skips across 29 paths; 34 hashes match worktree and commit. Final core/runner/touched types, ten-path lint/format, graph and audit pass. Declaration build passed before final test-only fixture changes. Audit has zero touched high-risk findings and one before/after token DUP_ASSERT notice. All 120 recorded PIDs are absent. W15 owner/fork/offset and real full-flush contracts are RUN, not duplicated. Graph validation is not shard execution.

W17's named public remainder remains done. W21 remains partial: defect 1 every-byte service cut/reopen/full restore(version); defect 5 17/40/200 MiB service/real-recorder/reopen, separate from W23 send/planning; service child/SIGKILL/tool-round; actual ChatSession/todo/IDE/directory/turn next-request durability; wider unreadable/scans/resume identity/extensions/checkpoint/fork/janitor; exact reference-media/generated metadata-compression-size-flush-segmentation-minimum-large-text/unstamped equal-text replay. W22-W26 and later phases remain. No next proof, full package/shard/monorepo claim, default flip, cleanup/deletion, .llxprt edit, recursive recovery staging, OCR, push or merge. Review skipped per Andrew 2026-10-09. Historical deleted logs remain missing.

## W21 named discovery cluster accounted for, 2026-10-19

`SessionDiscovery` native dispatch reads native facts/counts through `journalSessionListing` and live checkpoint descriptors through the native read-only reader. `0981cc19d` validates external start facts and nonempty identity instead of coercing malformed workspace/lineage values (#3901). `9f176b7ab` moves native target construction into a bounded helper and isolates each later checkpoint read, so its I/O failure cannot abort healthy sibling targets (#3902). Sessions remain before checkpoints. Native resume retains streamed rows, source identity/path and actual lock ownership; metadata never needs a whole-journal row scan.

Actual branch inventory replaces the old 306-candidate queue. Native proofs cover unreadable/retired siblings and exact refusal text, headers/facts/body corruption, no older committed row fallback under intact damaged latest roots, project/workspace/provider/title/name/origin/identity/filter/sort, checkpoint and lock uniqueness, and native raw/archive/fork/cleanup/janitor matchers. The JSONL portable-transfer temporary grammar remains format-specific. Eleven old suites retain AST-identical behavior/assertions with explicit old-backend pins. Existing native checkpoint/fork/preview/ownership regressions are RUN, not merely referenced.

Confirmed-source matrix: 66 serial processes, 710 passes, zero failures/skips across 33 files under both outer settings; 92 new native executions and 618 reused regressions. All eight gates pass, 1854 source hashes and 19 committed blobs match, and four full-file rejecting controls restore exact bytes. Metadata reads remain below 512 KiB per operation for 40/4000 rows with an 8 MiB body; maximum request is 64 KiB. Audit has no touched high-risk findings; one unchanged legacy duplicate assertion remains. All 239 recorded PIDs are absent and managed jobs complete.

`W21-DISCOVERY-PROOF.md` contains the durable branch/process/gate/control/measurement and scope map; raw new evidence is under `tmp/854-notes/p4/w21/discovery/run-20261019-a/`. This accounts for the named bounded discovery remainder, without a cumulative W21 full-package/shard/monorepo claim. W22/W23/W24, default/deletion and later work remain separate. Historical deleted raw proof remains missing. No default flip, cleanup/deletion command, `.llxprt/` edit, broad recovery staging, OCR, push or merge. Review skipped per Andrew 2026-10-09.
