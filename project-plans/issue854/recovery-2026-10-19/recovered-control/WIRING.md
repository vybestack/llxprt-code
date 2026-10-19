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

W11 closure is reported for the original 92-file inventory and 37 native-coverage paths at `b0f58ec58`, not a fresh full-package sweep. See `W11-PROOF-INVENTORY.md` for the missing tables and retained reports. W15, W16, W18 and W19 are reported complete in later task results. W17's wider lifecycle/fault remainder is DONE with new W21-owned proof at `e514188fc7f00638700e28025d3aec9976e8f25a`. W21 parts one through five are committed; W21 remains partial. The old backend remains the default. W22-W26 and phases five through nine remain.

Current W21 scope is detailed in `W21-INVENTORY.md`. Its exact remaining-file list has 289 paths, but that list is only the difference against a bounded regenerated process matrix. It is not a native coverage closure map. Four old integration suites ran without closing their native counterparts.

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
