# W17 wider agents lifecycle and fault contracts

New W21-owned proof from verified HEAD 6a42630abf2481151312816deed1ff3cbea0018f, 2026-10-19. These logs do not restore deleted historical evidence. The three named public suites retain all 32 original expanded cases: session.spec.ts 14, session-owner-restore-checkpoint.behavior.test.ts 8, recording-owner-lifetime.behavior.test.ts 10. Their fixture construction explicitly selects old. Original JSONL, appendFile and ReplayEngine assertions are not used as native proof.

The same three suites add 26 cases: session 8 native, restore/checkpoint 8 native, lifetime 8 native, plus 2 shared media-reservation-failure cases explicitly selecting old and native. Native fixtures use real public Agents over the existing real FakeProvider, real HistoryService and recorder, real native files, locks and media store. Independent readers open the disk file and traverse its committed row tree, state facts and checkpoint descriptors. Arrays are test assertion fixtures, not new production history storage. No production API has been widened for testing.

## Exact original-to-native mapping

Names below are original case names, excluding plan/requirement suffixes. Native entries name cases in these three files. Existing related suites listed below are RUN rather than duplicated.

| Original public case | Native equivalent and evidence boundary |
| --- | --- |
| session: creates and lists recording-native checkpoints without legacy checkpoint files | creates durable checkpoint facts and forks a self-contained child without changing the parent: checks public checkpoint identity/name/time/sequence against independently reopened descriptor and session fact, and absent legacy checkpoint directory. |
| session: forks from a checkpoint into a self-contained child while preserving resume history | Same native case: distinct child session/path, parent/checkpoint ancestry, exact checkpoint-prefix rows in live and disk history, real child stop/resume, unchanged parent bytes and preserved source-only tail. |
| session: durably clears recorded history without re-recording restored entries | durably clears a suffix, continues a turn and resumes only the kept prefix: exact two-row prefix after clear, continuation, no discarded suffix, real stop/resume with exact persisted membership. The single JSONL rewind row/cutSeq is an old encoding assertion; native proof reads the published row tree instead. |
| session: keeps the cleared prefix when the next turn starts | Same native case executes a real public provider turn, checks its done event and kept/discarded membership through reopen. Explicit public flush joins asynchronous mirror delivery before disk assertions. |
| session: resets an already-empty chat while recording is enabled | keeps repeated empty resets durable without writing another group: empty live/disk rows and exact bytes unchanged after two resets and stop. Flush the preceding setHistory mutation before taking the no-change baseline. |
| session: setRecording enabled true activates a recording with a defined path; false deactivates it | activates a materialized journal and rejects missing resume targets: before/active/stopped state, defined path, journal format, exact two seeded rows and independently read row count. |
| session: resume target with no saved sessions throws a clear, non not-implemented error | Same native activation case rejects with session-specific error before any recording exists. |
| session: setRecording true materializes a real JSONL session file containing the seeded content | Same native activation case reads real native rows and state facts. JSON line parsing remains explicitly old-only, not an assertion about the binary file. |
| session: resume latest restores the live history from a previously recorded session on disk | publishes latest adopted identity before startup and preserves it through a later turn and detached stop: unrelated live rows replaced, exact selected prefix, resumed path/session/start/name preserved, Config facade identity not changed. |
| session: exposes checkpoint rename/delete, session naming/listing, and safe deletion through the public API | renames and deletes checkpoints, names sessions and refuses deletion of the active session: preserved active state after rejection, independent renamed descriptor, session listing, deleted checkpoint absence, stop and safe session deletion. |
| session: resumes a named session by explicit public API reference | publishes named adopted identity before startup and preserves it through a later turn and detached stop: returned session id/name, exact restored prefix, same file and facts. |
| session: publishes latest resume to getHistory before chat startup and carries it into the next turn | Native latest case above executes actual provider turn, requires selected prefix and continuation, excludes discarded current rows, reads durable membership after explicit flush, then stops the adopted primary and proves later history mutations cannot write the closed session. |
| session: publishes named resume to getHistory before chat startup and carries it into the next turn | Same native named case. |
| session: keeps the deferred live history and next turn after a failed journal adoption | rolls back failed adoption publication and carries the deferred live history into the next turn: real tokensUpdated observer rejection, unchanged source bytes, disabled recording and zero locks, exact live rollback plus later provider turn without recorded origin. |
| restore: uses the agent-captured media store for recording and checkpoint replay after Config media access is disabled | uses captured media for durable recording, checkpoint fork and resume without Config media access: real reference media, disabled Config getter, independent native rows, checkpoint/fork and real resume preserving contentId. |
| restore: hands back the remaining history as a stream over the journal, not an array | streams restored rows, durably cuts human turns and continues on the same recording lock: non-array AsyncIterable, exact prefix and removed count, exact continued disk rows, same lock filename, stop releases lock and resume restores rows. |
| restore: restores recorded human turns, persists the rewind and continues recording on the same lock | Same native stream/cut/continue/lock case. JSONL rewind marker is old-only; native durable membership and continuation are read independently. |
| restore: serializes restore before a queued checkpoint and rejects mutations after disposal | serializes restore before checkpoint, forks the restored version and rejects mutation after disposal: concurrent public operations, removed count, descriptor id/sequence, exact cut prefix, fork of checkpoint preserves that prefix, disposed mutation rejects and no lock survives. |
| restore: rejects invalid turns and restores live and durable history if client restoration fails | rejects invalid turns and restores live and durable owners when client restoration fails: original reset executes then throws; full metadata-bearing rows equal pre-failure disk rows in live history and after flush; later restore succeeds. |
| restore: denies collisions without UI confirmation and atomically overwrites on create, rename and session naming | denies collisions and atomically overwrites create, rename and session names: rejected collisions, new checkpoint id, exact remaining checkpoint ids after each overwrite, empty checkpoint list after session-name overwrite, independent name fact, unchanged Config facade identity. |
| restore: preserves the colliding name when a confirmed checkpoint write fails | preserves colliding checkpoint names after a native write failure and actual reopen; companion flush-failure case: actual positional/flush fault, exact checkpoint ids and both names through public listing and independent descriptors, failure surfaced again on teardown, real stop/reopen, both names remain. Native poisoned writers do not repair in place. |
| restore: keeps a borrowed sibling recording and its lock isolated while restoring and renaming a closed checkpoint | isolates two borrowed owners while restoring and renaming a closed checkpoint: both checkpoint ids, closed sibling rename, shared live-history restore empties current sibling-origin turn, explicit flush makes owner disk empty, sibling disk stays intact, one owner lock, unchanged Config identity. These facades intentionally share one live client/history; the test does not invent independent live histories. |
| lifetime: releases startup ownership after queue failure before subscription | releases startup lock after write failure and records a later public turn: queue limit 4096 below seed size, real backpressure then positional refusal, disabled state and zero locks, replacement recorder records real provider turn. Native flush companion covers full-flush refusal. Queue-bound rejection is not a native API. |
| lifetime: releases startup ownership after append failure before subscription | Same native startup write/flush cases, no appendFile injection. |
| lifetime: closes admission synchronously and joins an admitted external append before disposing | closes admission synchronously and joins an admitted positional write before disposal: held actual positional write, shared in-flight disposal promise, late enable/resume/checkpoint reject, unsettled disposal with lock held, release joins startup/shutdown, zero locks and independently reopened admitted row. |
| lifetime: control records and flushes a subsequent public turn on a borrowed Config | keeps an owner recording after a non-recording borrowed facade disposes: exact four-row two-turn public provider output through independently reopened native rows after stop. Also exercised by both startup replacement cases. |
| lifetime: disposing a non-recording borrowed facade preserves the other recorder and its subsequent turn | Same native owner-after-sibling-disposal case checks sibling disabled, owner state/path preserved and both complete public turns recorded. |
| lifetime: stopping and disposing a recording sibling leaves the first owner recording later turns | keeps both borrowed recorder identities isolated after sibling stop and disposal: distinct paths, sibling turn persisted, first owner later turn persisted, closed sibling bytes unchanged. |
| lifetime: releases the lock after a subscription rejected registering the retirement listener | releases failed subscription ownership at retirement listener and records with its replacement: real attachment with failed external event-source registration, acquired native file/lock, original listener counts, released failed lock, replacement turn/reply, final zero locks. |
| lifetime: releases the lock after a subscription rejected after the attachment | Same native after attachment case, real attach completes before throwing. |
| lifetime: rejects recording admission while public disposal joins a pending provider body before session shutdown | rejects recording admission while public disposal joins a provider body and after shutdown: real paused OAuth HTTP body, signal aborted, disposal unsettled, recording admission rejected, no new file/lock, release body and join shutdown. |
| lifetime: rejects recording admission after public disposal without creating a journal or lock | Same native public shutdown case repeats admission after completion and requires no files, disabled state and absent path. |

Additional two-backend media fault proof: keeps live and durable rows atomic when the second media reservation fails. The first reference is actually reserved before refusing the second clear-snapshot reservation; exact live rows and disk bytes remain, both objects read correctly, later restore succeeds, recording stops and history clears, and neither reference has a remaining reservation. It tests the real media store and filesystem with only the OS-facing reservation fault seam.

## Reused committed cases to RUN

Core recording-integration-native-core 19 and native-faults 6 are the existing 25 native core/fault cases. Their exact case names and new per-process results are retained in the matrix logs. Core covers exact single/FIFO/tool blocks, compression/rebuild and subscription switching; faults covers acknowledged mirror delivery, native write/flush rejection/reporting, clear, rollback and admitted-row disposal. Native lifecycle 14 plus ownership 2 cover held records/trailer shutdown, idle/late metadata, detach errors, reader lifetime, real lock and media reservation lifetimes. Native boundary 14 and replay 8 cover primary/mirror clear/replacement, compensation, metadata/FIFO and actual reopen/adoption. journalRecordingService 13 and journalResumeAdoption.detach 2 cover writer metadata/locks and adopted primary clone semantics. W15 fork-late-ownership 1 and fork-offset-audit 1 cover inherited provenance and offset/pin independence. flushRecords 23 includes the real platform full-flush/no-fallback controls; injected failure seams here do not claim a new platform call implementation.

All six W17 part-one suites are rerun: recorded-history-persistence, session-control-backend, session-recording-identity.behavior, session.clearConversation.behavior, sessionControl.concurrency.behavior, sessionControl.recording.behavior. The related session-media-owner-closure suite is also included. Their existing two-backend constructs and layout-specific selections are retained.

## Development failures and proof limits

Initial runs failed before test load because Bun resolved packages/mcp/dist/mcp/index.d.ts as runtime. Only the individually confirmed ignored, untracked, nonsymlink MCP dist directory was moved intact to the unique held-generated/run-20261019-part5-a/mcp-dist path. The first driver reused its initial output names once; those pre-load logs were overwritten, although their tool output is retained in the session. Subsequent outputs use distinct run directories. No claim is made that the overwritten files survive.

The initial loaded-suite failures were fixture/oracle errors, not confirmed production RED: public checkpoint info has sessionId/ISO time while the native descriptor has createdAtMs; a missing optional path property is distinct from a present undefined property to toMatchObject; shared facades share live history; native mirror disk assertions need the public flush boundary, including the baseline before no-op resets; a poisoned recorder reports its unobserved metadata failure again on teardown. Diagnostics compare actual inputs, live/disk rows and public completion boundaries instead of retrying an intermittent failure. Native clear continuation worked without a production change after joining the existing flush boundary.

The optional agents test-bun project lacks bun:ffi ambient declarations on its ordinary command. The supplemental run supplies the installed bun-types declarations without changing compiler checks or repository configuration. The scoped touched project includes session.spec.ts, excluded by the existing agents noemit project. Its stale legacy .parts fallback was invalid against the current IContent public type; the test helper now reads its typed blocks directly, with no casts or fallback.

An exploratory end-of-test session deletion exposed old JSONL media blocker validation without a mediaStore and native live-checkpoint refusal. Session deletion is unnecessary to inspect media leases. It is not part of the media failure oracle and remains outside this bounded proof. Filed as https://github.com/vybestack/llxprt-code/issues/3899 after verifying the active acoliver identity and the missing mediaStore call path. No production change was made for that separate defect.

No transport-next-request durability, every-byte service crash/tail/restore, fanout/large-row or whole discovery inventory closure is claimed. Native public flush/stop is the measured boundary here. W21 remains partial, the old backend remains default, and no full package, affected-shard execution or monorepo run is claimed. Review skipped per Andrew 2026-10-09. No OCR, cleanup/deletion, .llxprt edit, push or merge.

## Final delivery

Test-only commit: e514188fc7f00638700e28025d3aec9976e8f25a. Final-source matrix: after-audit-tests/matrix.json,42processes438pass0fail0skip across21paths and both outer environments.22source hashes match worktree and commit. All recorded test/gate PIDs are absent in commit-proof.json.32original expanded cases and their10describe blocks are preserved;26cases are added. Declaration build/coretsc passed in final-gates; final agents/noemit/Bun/touched types, zero-warning lint/format, graph and audit passed again in after-audit-gates after the conservation assertions were made explicit. Staged graph also passed. Zero touched high-risk audit findings;9 DUP_ASSERT notices concern separate lifetime stages, including2unchanged originals. No scanner policy changed. Exact byte equality uses Buffer.compare; row rollback uses isDeepStrictEqual, preserving explicit undefined properties and metadata; listener conservation uses zero deltas. These retain the before/after invariants without same-call snapshot false positives.

W17's named public remainder is DONE. W21 stays partial. The old backend default is unchanged. The graph gate is not affected-shard execution, and no full package or monorepo proof is claimed. The source boundary is final after-audit-tests, not the earlier matrices. Every earlier surviving run remains distinguishable. Historical deleted logs remain missing.

## Final isolated process inventory

All rows have exit 0, zero failures and zero skips. Old and journal columns name the outer environment; explicit fixture backend selection is unchanged. Paths are package-relative under the shown package.

| Package/path | Old passes / PID | Journal passes / PID |
| --- | ---: | ---: |
| agents/src/api/__tests__/session.spec.ts | 22 / 37225 | 22 / 39370 |
| agents/src/api/__tests__/session-owner-restore-checkpoint.behavior.test.ts | 18 / 37744 | 18 / 39611 |
| agents/src/api/__tests__/recording-owner-lifetime.behavior.test.ts | 18 / 38099 | 18 / 39787 |
| agents/src/api/__tests__/recorded-history-persistence.test.ts | 2 / 38298 | 2 / 39935 |
| agents/src/api/__tests__/session-control-backend.test.ts | 4 / 38316 | 4 / 39948 |
| agents/src/api/__tests__/session-recording-identity.behavior.test.ts | 6 / 38376 | 6 / 40006 |
| agents/src/api/__tests__/session.clearConversation.behavior.test.ts | 21 / 38516 | 21 / 40105 |
| agents/src/api/__tests__/sessionControl.concurrency.behavior.test.ts | 13 / 38817 | 13 / 40306 |
| agents/src/api/__tests__/sessionControl.recording.behavior.test.ts | 5 / 38886 | 5 / 40347 |
| agents/src/api/__tests__/session-media-owner-closure.behavior.test.ts | 7 / 38958 | 7 / 40415 |
| core/src/recording/recording-integration-native-core.test.ts | 19 / 39127 | 19 / 40525 |
| core/src/recording/recording-integration-native-faults.test.ts | 6 / 39144 | 6 / 40542 |
| core/src/recording/recording-integration-native-lifecycle.test.ts | 14 / 39165 | 14 / 40553 |
| core/src/recording/recording-integration-native-ownership.test.ts | 2 / 39182 | 2 / 40570 |
| core/src/recording/recording-integration-native-boundary.test.ts | 14 / 39207 | 14 / 40582 |
| core/src/recording/recording-integration-native-replay.test.ts | 8 / 39231 | 8 / 40607 |
| core/src/recording/journalRecordingService.test.ts | 13 / 39266 | 13 / 40639 |
| core/src/recording/journalResumeAdoption.detach.test.ts | 2 / 39277 | 2 / 40655 |
| core/src/recording/session-fork-late-ownership.test.ts | 1 / 39286 | 1 / 40671 |
| core/src/recording/session-fork-offset-audit.test.ts | 1 / 39354 | 1 / 40689 |
| core/src/journal/flushRecords.test.ts | 23 / 39365 | 23 / 40708 |

## Exact reused native 25 case names

These committed tests were not copied or rewritten. Both outer-environment logs in after-audit-tests contain each passing case. They supplement the public counterparts above, not replace them.

### recording-integration-native-core.test.ts

- native recording integration core contracts > records a single service addition exactly once
- native recording integration core contracts > keeps notifications observable without recording them again
- native recording integration core contracts > does not record notifications preceding attachment
- native recording integration core contracts > records service additions in FIFO order
- native recording integration core contracts > preserves complete tool call blocks on disk
- native recording integration core contracts > preserves complete tool response blocks on disk
- native recording integration core contracts > stops recording after unsubscribe without losing the admitted row
- native recording integration core contracts > re-subscribes to the same history without duplicating later rows
- native recording integration core contracts > ignores rebuild notifications while persisting the compression result
- native recording integration core contracts > persists the summary replacing all seven original rows
- native recording integration core contracts > records post-compression content after the summary
- native recording integration core contracts > records content after a no-summary compression ending with undefined
- native recording integration core contracts > records content after a no-summary compression ending with 5
- native recording integration core contracts > records after sequential no-op compression cycles
- native recording integration core contracts > keeps queued compression-window content between summary and later content
- native recording integration core contracts > persists the last summary of sequential replacement cycles without duplicates
- native recording integration core contracts > recovers a complete tool entry added before the compression rebuild
- native recording integration core contracts > recovers a complete tool entry added after the compression rebuild
- native recording integration core contracts > switches history subscriptions and ignores the old instance

### recording-integration-native-faults.test.ts

- native recording integration writer and owner contracts > does not cross the turn boundary until a held mirror write is durable
- native recording integration writer and owner contracts > joins an admitted native row before disposal and detaches later additions
- native recording integration writer and owner contracts > restores the durable mirror when a batch publication listener rejects
- native recording integration writer and owner contracts > persists clear and a following addition without resurrecting prior rows
- native recording integration writer and owner contracts > reports an actual positional write failure without claiming the rejected row durable
- native recording integration writer and owner contracts > reports an actual positional flush failure without claiming the rejected row durable
