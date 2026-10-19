# W22 first agents batch proof map, 2026-10-19

## Current continuation checkpoint, 2026-10-19T21:36:35.279Z

The census orchestration is verified; W22 remains partial. The frozen inventory is **806 = 293 green + 14 red + one unverified + 498 unrun**. There are **308 selected files, 2333 measured passes, 37 failures and zero skips**, across cumulative per-file source boundaries. Classification is **88 native history, 258 journal-selected shared/public, 28 explicit old and 1959 classification-pending**. The separate unclassified bucket is zero; journal selection alone does not classify a case as native. Passing cases in selected red files retain their classifications without making those files green.

`W22-CONTINUATION-PROOF.json` contains all fifteen red/unverified rows with exact failed names, source hashes, termination and evidence references, plus the 433-attempt ledger reference. It separates **22 historical missing attempts** from **one latest missing file**. Frozen copies are in `tmp/854-notes/p4/w22/continuation-run-c/durable-checkpoint-a/`, generation `dacd0f20-8913-4f82-aa77-4ccf0413918e`; all seven publication hashes match. `W22-STATUS.md` lists the complete current red/unverified table and next clusters. All older counts, stopped/running statements and PIDs below this subsection are historical to their stated boundaries.

Original admission PID 98836 in `package-auto-0060` remains missing-record-unverified: first-case timeout 180000 ms, outer 300000 ms SIGTERM, absent XML and no complete raw summary. Its driver zero counts are defaults, not measurements; no deletion or overwrite is established. Selected later admission PID 19211 in `finalizer-run-final-journal-a` has three real passes at a distinct source hash. The restored finalizer batch contains only finalizer PID 24041 with eleven passes, not admission. Exact original/later hashes and references are retained in the new proof. No missing-result rerun is required.

Both progress entrypoints now share `w22-census-runner.ts`. Green requires valid nonempty consistent JUnit, measured/result/raw agreement where present, successful exit, no timeout/signal/failure/skip. Missing attempts and supersession stay in the ledger. The original ENOENT came from unconditional missing-XML reads plus an accepted-order list ending before repaired boundaries. Output files publish atomically, with the generation/checksum manifest last; this detects mixed generations without claiming a multi-file filesystem transaction.

Only lightweight census checks ran for this increment: seven Bun tests/52 assertions, strict scoped types with unused-symbol checks, explicit no-ignore zero-warning ESLint and Prettier, all exit zero. Exact commands/logs and the effective lint configuration are recorded in `W22-CONTINUATION-PROOF.json`. Recovery paths receive the unchanged base recommended lint rules, not package/scripts size rules. No enforcement changed and no package matrix/build/gate was run anew. Earlier product green proof at `bc46927e6` and `75fe4c8a4` remains earlier-boundary evidence.

The once-completed source comparison at 21:30:29.779Z matches all 3321 manifest entries; inventory reconciliation is 799 src plus seven shared, no additions/missing/duplicates. Receipts: `continuation-run-c/source-boundary-comparison.json` and `inventory-reconciliation.json`. The readonly snapshot remains SHA-256 `61780e2313d471bf6acf26568a53306ddfa1b17d90245d4b6193c93dad1029fc`. No repeated full-source hashing occurred.

At the cutoff, supervisor 94663/driver 25162 had completed 52 of their frozen 550 paths, 42 green/ten red or incomplete. Process identities at 21:36:42Z confirmed both and child 48284 on middleout-disk-owners, with exact current file/hash/log in the proof. Keep that pending-only sweep running through ordinary red/incomplete attempts without retries or source edits. Live authority is sweep-supervisor.json and its currentFilePath, not these historical PID numbers.

Next repair at a safe stop: preserve original old shared-history-origin cases and establish rollback through native committed visible rows rather than raw binary marker absence. Then address recorder/backend selection in pending-window/compression-value-recorder/highdensity fallback/source and cursor-close/empty-block publication contracts; other current red contracts remain open. Both-backend product matrices and build/types/agents tsc/lint/Prettier/graph/audit gates remain required for future product repairs. W22 partial, W23-W26 open, old default unchanged, no 802 reset. Review skipped per Andrew 2026-10-09. No cleanup, `.llxprt/` edit, raw-log staging, retries, process kills, skips, weaker checks, push or merge.

## Historical proof increments

The remaining sections preserve earlier product work and dated checkpoints. Their local uses of “current” refer to those earlier checkpoints only.

## Adopted-instance native proof and 100-file collect-failures chunk, 2026-10-19

`bc46927e653921afcb5d4b6a9fb2d22e55ecba28` preserves the original complete adopted-instance `it` call, assertions and 30000 ms bound, explicitly old. One native case adds three real public agents: source recording, public adoption, stopped history replacement at a later creation-clock timestamp, same-path restart, provider continuation, independent resume and another durable turn. Exact committed row trees, original session facts/identity, original creation time and a single listing are observed independently. No whole-binary read or JSONL replay supplies native proof. Four related files pass 43 cases under each outer backend; all eight scoped gates pass.

The pending-only driver then completed two 50-file serial batches without stopping on ordinary red files: 94 green/six red, 713 passes/13 failures/zero skips, no retry. A recorded batch-boundary stop allowed one shared product repair. Node agents imported seven existing core runtime files missing from the package export map. `75fe4c8a4402e37d415c121c6eac14a6593c326b` adds only those mappings. The unchanged three-case shell-owner contract changes from zero pass/three fail to three passes; six related files pass 47 cases per outer backend after the manifest change. Nine scoped gates pass, including core types. Related prior publication results are superseded; other cumulative results retain their original source boundaries.

The repaired checkpoint is 256 executed files, 251 green/five red, 1970 passes/ten failures/zero skips, 550 unexecuted. Classification is 88 native history, 258 shared/public, 28 explicit old and 1596 pending. Final driver controls prove pass/red/pass continuation and loader-failure termination, with atomic live-state publication and inherited timeouts. `W22-STATUS.md` is the concise current report; `W22-INSTANCE-PROOF.json` holds exact evidence and handoff paths. The remaining compression/rollback clusters are still red. W22 remains partial.

## Native public finalizer proof, 2026-10-19

Commit `ac0fa98d08591c9482c3f4b1bb02e4bbf8868a55` changes tests/fixtures only. All three original finalizer cases remain explicitly old; AST comparison preserves both complete `it` calls, the two-value failure domain and their 30000 ms limits. Eight native cases run in the same inventory file under both outer environments. Neither the original JSONL append barrier nor the `.json` rename barrier is used as native evidence.

| Original finalizer contract | Native public proof |
| --- | --- |
| Final public-turn append must finish before the session lock releases | Real Agent.stream reaches the response-row positional write; disposal remains pending with its lock while that write is gated; shutdown resolves only after the stream settles and writer handles close; independently reopened rows contain the seed, prompt and response |
| Accepted persistence success/failure joins finalization | Six native cases cross stop/dispose with success, rejected trailer and rejected platform flush. Real history mutation reaches the selected recorder handle; committed rows remain the previous version while the gate is held; accepting public flush settles before stop/dispose completes. Success commits the extra row; failed write/flush preserves the exact prior rows and keeps the original error on the accepting flush, without duplicate teardown failure |
| Recording ownership ends with shutdown | Empty public recording acquires a lock without allocating `.llxj`; disposal releases it and rejects later recording admission without creating a file |

Native file wrappers forward the real positional read/write/writev, close and platform flush. The decoded-row observation forwards the real counter function and release, recording positive acquisitions and zero live rows/serialized bytes after terminal completion. No decoder, history algorithm, recorder or integration is replaced. Native row proof uses independently opened committed row trees. Late history mutations leave stopped files byte-identical; disposal rejects late recording admission. Repeated public dispose calls share the same terminal promise. There is no timeout increase, skip, default change, production guard or production change.

Existing W21 public lifetime proof was reused and actually RUN rather than duplicated. The final-source seven-file matrix ran each file alone in Bun, serially under both outer backends:

| File under `packages/agents/src/api/__tests__/` | Journal PID | Old PID | Cases per environment and scope |
| --- | ---: | ---: | --- |
| `boundary.adequacy.test.ts` | 19195 | 20077 | Five shared/public boundary cases |
| `profile-session-admission.behavior.test.ts` | 19211 | 20087 | Three shared/public retirement/admission cases |
| `recorded-history-persistence.test.ts` | 19348 | 20145 | Two native committed mutation/rollback cases |
| `recording-facade-chat-channel.behavior.test.ts` | 19374 | 20164 | Four native/four old routing and profile-binding cases |
| `recording-finalizer-join.behavior.test.ts` | 19578 | 20359 | Eight native/three original old cases described above |
| `recording-owner-lifetime.behavior.test.ts` | 19710 | 20496 | Eight native/ten old startup, admission, subscription and owner-lifetime cases |
| `session-owner-restore-checkpoint.behavior.test.ts` | 19884 | 20669 | Nine native/nine old checkpoint rollback, borrowed-owner, reopen and media-reservation cases |

Matrix result: **65 passes per environment, 130 total, zero failures/skips**. Each environment contains 31 native, 26 explicit old and eight shared/public cases. Supplemental outer-old executions do not add package coverage. A full-file control that makes SessionControl finalization resolve without joining or teardown produced **three passes/eight failures**, five of them native, PID **23895**. The three stop cases still pass because that control only removes disposal. Production is restored byte-identically; post-control target runs **24041** and **24189** have eleven passes each. These 22 post-control passes are separate from the 130-pass matrix and are not added again to package totals.

All eight scoped gates pass with exact commands/PIDs in `W22-FINALIZER-PROOF.json`; no-emit tsc includes every changed file. The three committed blobs and full 3320-path boundary match tested source. Four pre-existing SELF_CONFIRMING notices and one DUP_ASSERT notice are unchanged except line numbers, with no new notice or suppression. The initial missing-baseline-flush fixture failure and lint-limit failures remain preserved. Affected graph validation is not shard-test execution.

The pending-only supervisor then ran two of the recorded 652 unexecuted files: hook routing passed four shared/public cases (**27106**); adopted-instance resume failed one (**27267**) when its JSONL `replaySession` was given native bytes. Its original-path equality had already passed; later JSON parsing/sequence assertions are also old format. No repair or retry was made. Supervisor **27104** and driver **27105** exited, and all 35 recorded process IDs are absent.

Current W22 census is **156 executed files: 155 green/one red, 1252 passing cases/one failure/zero skips, 650 unexecuted**. Classification is **87 native history, 255 shared/public, 27 explicit old and 883 pending**. Repair `recording-instance-resume.behavior.test.ts` with preserved old layout and native adoption/replacement/timestamp/listing proof before resuming the exact pending list. `W22-STATUS.md` and `finalizer-run-20261019-a/progress.ts` identify continuation evidence. W22 remains incomplete until all 806 files and case classification are accounted for. Review skipped per Andrew 2026-10-09.

## Facade native proof and profile attachment fix, 2026-10-19

Commit `70fdd3e2110fec4466ae47a9ae835b1afb1431c1` adds four native cases alongside four explicit-old cases. `facade-run-20261019-a/old-contract-proof.json` proves all four original complete `it` calls AST-identical, including their 30000 ms bounds. Original JSONL marker checks remain in those old bodies. The native cases use real public Agents, session controls, HistoryService, recorder integration, and independently opened committed row trees through `nativeRows`. Compression's provider summary is injected at the existing strategy seam; persistence and ownership remain real.

| Original contract | Native counterpart and durable observation |
| --- | --- |
| Manual compression routes through each executing facade across stop/resume | Native compression rows appear only in the executing recording; stopped compression sees no transcript path; the closed file is byte-identical after sibling work; explicit original session resume writes its summary into the same path |
| Purge event belongs to the executing facade | The initial media row is unowned and shared, so its media mutation reaches both native mirrors; only the executing facade's turn appears in its own file; B reseeding/purge and stopped-file reopening establish both directions |
| Non-recording facade does not write a sibling purge | The public stream reports `No active recording`; initial live media remains identical, the recording sibling's complete committed rows remain identical, and B's turn is absent |
| Profile candidate uses the executing recorder | Borrowed-client profile replacement creates separate candidate history; A's committed file and live stream contain the purged row and A's new turn, while B's complete committed rows remain identical to its pre-profile state |

The last case was product RED after adding real mirror flush boundaries: candidate live history changed, but independently reopened A still held the pre-purge media. `SessionClientOwner` intentionally does not adopt the borrowed client's shared history into the candidate. RecordingIntegration was left subscribed to that prior history. The three-file fix runs `SessionControl.rebindRecording` after profile publication/retirement and uses the integration's existing detach/attach path. It does not add a history array, operation spool, repeated whole-file read, fallback or default change. Attaching from inside purge was rejected because it waits on the mutation queue holding that purge; its timeout attempts remain separate evidence.

Final source matrix uses `facade-run-final-{journal,old}-b` and `facade-run-profiles-{journal,old}-b`, 20 serial single-file Bun processes, **130 passes/zero failures/zero skips**. Each outer environment has 54 main plus eleven profile cases. Final facade PIDs: journal **63040**, old **63945**, eight passes each. The full-file missing-rebind control (62521) has seven passes/one native-profile failure, exit one; `rebind-control-b-proof.json` proves byte-identical production restoration. Historical format-marker failures, mirror-flush fixture failures, incorrect test-author expectations, deadlocked experimental attachment and an ES2021 indexing type error stay distinct from final product proof.

Reuse, rather than duplicate, the existing contracts that actually ran:

| File | Final journal PID | Cases and classification |
| --- | ---: | --- |
| `boundary.adequacy.test.ts` | 62903 | Five shared/public; export guard unchanged |
| `profile-session-admission.behavior.test.ts` | 62923 | Three shared/public admission/concurrency contracts |
| `recorded-history-persistence.test.ts` | 63003 | Two native committed purge/rollback contracts |
| `recording-facade-chat-channel.behavior.test.ts` | 63040 | Four native above, four explicit old |
| `recording-owner-lifetime.behavior.test.ts` | 63374 | Eight native startup write/flush failure, admitted-write shutdown, borrowed identity, subscription cleanup and late admission; ten explicit old |
| `session-owner-restore-checkpoint.behavior.test.ts` | 63574 | Nine native, including failed client restoration with complete live/durable rollback, borrowed owners, actual reopen, and failed second media reservation with later release; nine explicit old |
| `profile-atomicity-owner.test.ts` | 65125 | Three shared/public profile transaction cases |
| `profile-postcommit-lifetime.test.ts` | 65269 | Five shared/public retirement/continuation cases |
| `profile-postcommit-siblings.test.ts` | 65492 | One shared/public sibling isolation case |
| `profile-preparation-cancellation.test.ts` | 65589 | Two shared/public candidate cancellation cases |

The main matrix contributes 23 classified native contracts, 23 explicit old and eight shared/public; profile regressions contribute eleven shared/public. Supplemental outer-old executions are not added again to package totals. Exact case names, source hashes and second-environment PIDs are in durable `W22-FACADE-PROOF.json` and raw `facade-run-20261019-a/classification.json`. All eight final gates pass; four committed source hashes and the final 3318-path boundary match. Two DUP_ASSERT notices concern independent before/after compression phases; no final high-risk finding or policy suppression. Affected-graph validation is not affected-shard execution.

The continuation then stopped at the first pending file, `recording-finalizer-join.behavior.test.ts`, child70469: zero pass/three original-bound timeouts, complete summary/JUnit, no retry. All three supervisor/driver/child PIDs exited. Current package census: **154 completed, 153 green/one red, 1237 pass/three fail/zero skip, 652 unexecuted**; classifications **79 native, 251 shared/public, 24 explicit old, 883 pending**. The appendFile/.json rename barriers in that red file are old-only seams, not native shutdown proof. Repair and map that next cluster before resuming. W22-STATUS.md identifies exact paths and source boundaries. W22 is incomplete. Review skipped per Andrew 2026-10-09.

## Earlier proof increments

**The first twenty agents package files are green on journal. This document preserves that bounded proof and its later boundary-fixture increment.** Current running-package counts are in W22-STATUS.md; the first-batch 786-path remainder below is historical to that checkpoint. This is new evidence from base `b1714cdea75dd297a122b443b853bbe36b1cead5`, not restored historical proof.

Raw evidence is `tmp/854-notes/p4/w22/run-20261019-a/`, abbreviated `run/` below. Inventory and initial status were created before tests using both package runner discovery functions. No source test was excluded. All files run serially, alone in Bun, from `packages/agents`, with existing package preloads and timeouts.

## Actual failure and scoped fix

The untouched journal batch produced **143 passes and four failures** across twenty files. Both cases in `agent-carry-durability.test.ts` and both in `agent-carry-transaction.test.ts` expected admission to fail, but it succeeded. Their shared fault assumption was wrong: `SessionRecordingService.waitForCommitSequence` is a JSONL-only method. A journal candidate does not call it. These are fixture failures, not demonstrated production defects.

`helpers/carry-acknowledgement-failure.ts` selects the fault boundary by the actual backend. The old branch retains the original one-shot acknowledgement failure and original two-ack assertion. The native branch wraps real handles through `resolveJournalDependencies`, forwards positional reads/writes/vectors and platform flush unchanged, and rejects exactly the armed trailer write. It installs before candidate creation and arms after the first input row pauses. The tests also require all 512 or 8192 source rows to have been visited, a positive rejected trailer position and a different candidate pathname from the retained source.

No production code changes. No row arrays, scratch fallback, retry, skip, timeout change, default change or weakened assertion. The shared suffix fixture still uses its backend-selected real recorder factory, real HistoryService and async row observers. All source digest, token conservation, owner-release, failed-client state, source-byte-size, startup retry and client-identity assertions remain. Native candidate failure replaces old layout-specific acknowledgement mechanics only.

## Evidence boundaries

| Batch | Files/processes | Pass | Fail | Meaning |
| --- | ---: | ---: | ---: | --- |
| `initial-20` | 20 | 0 | 20 | Generated MCP declaration loader failures, before test bodies |
| `unobstructed-20` | 20 | 143 | 4 | Actual untouched journal baseline |
| `fixed-carry-journal` | 2 | 4 | 0 | First corrected fault fixture, before adding consumed-row assertions |
| `final-carry-journal` | 2 | 0 | 3 | ENOSPC during seeding; one file did not finish all cases, not fault proof |
| `final-system-carry-journal` | 2 | 4 | 0 | Final changed tests on journal |
| `final-system-carry-old` | 2 | 4 | 0 | Same final tests, explicitly old comparison; not native proof |
| `retaining-system-trap-journal` | 1 | 0 | 4 | Expected rejection with the unchanged retaining trap enabled |

No skips in completed case runs. The old/trap launches immediately after ENOSPC failed to create their output directories and spawned no test child; they are not counted as executed tests. The first nested-background shell launch also exited before a driver started; it contributes no test execution.

The generated MCP obstruction was individually verified ignored and moved intact to `run/held-generated/mcp-dist`, with ignore, inode and hash records. The ENOSPC cause was external-volume capacity, about 298 MiB free while the system volume had 104 GiB free. No files were deleted or truncated. Subsequent test HOME/TMPDIR roots are unique under `/private/tmp/llxprt-w22-branch3-20261019-99211/`; raw logs, JUnit, commands, PIDs and inventories remain in the workspace. This changes test isolation placement only, not production storage behavior.

## Current package accounting

Take unchanged-file results from `unobstructed-20` and the two changed-file results from `final-system-carry-journal`. This yields **147 passing cases in twenty distinct files, zero current failures/skips**. It is cumulative per-file proof, not one twenty-file final-source rerun. `run/accounting.json` preserves every executed JUnit case name and selected source hash. `run/not-run.txt` contains all 786 pending paths.

Of 147 passes, **26 are native history contracts** in the carry and public-reader suites below. The other **121 are journal-selected shared/public cases**; they are not counted as native history-specific coverage. There are zero explicitly old-only cases in these twenty package files. Four supplemental old executions verify the changed tests under old and remain separate.

All table paths are relative to `packages/agents/src/api/__tests__/`.

| File | Native history | Shared/public | Final journal PID |
| --- | ---: | ---: | ---: |
| `activation-media-owner-lifetime.behavior.test.ts` | 0 | 2 | 2017 |
| `activation-preflight-cleanup-failure.behavior.test.ts` | 0 | 2 | 2115 |
| `activationPreflightState.behavior.test.ts` | 0 | 22 | 2271 |
| `adoption-binding-failure.behavior.test.ts` | 0 | 1 | 2574 |
| `adoption-scheduler-owner.test.ts` | 0 | 2 | 2692 |
| `agent-bootstrap.spec.ts` | 0 | 37 | 2959 |
| `agent-carry-durability.test.ts` | 2 | 0 | 32713 |
| `agent-carry-faults.test.ts` | 6 | 0 | 3965 |
| `agent-carry-media.test.ts` | 1 | 0 | 7232 |
| `agent-carry-owner-controls.test.ts` | 4 | 0 | 7301 |
| `agent-carry-stream.test.ts` | 5 | 0 | 9326 |
| `agent-carry-tokens.test.ts` | 2 | 0 | 10408 |
| `agent-carry-transaction.test.ts` | 2 | 0 | 33156 |
| `agent-history-reader.test.ts` | 4 | 0 | 13830 |
| `agent-safe-boundary-coordinator.behavior.test.ts` | 0 | 7 | 15061 |
| `agent.approvalMode.behavior.test.ts` | 0 | 5 | 15227 |
| `agent.sequenceModel.behavior.test.ts` | 0 | 7 | 16446 |
| `agent.settings.behavior.test.ts` | 0 | 16 | 16648 |
| `agentAdmission.owner.behavior.test.ts` | 0 | 16 | 19769 |
| `agentMessageBus.behavior.test.ts` | 0 | 4 | 20058 |

The 26 native cases cover: failed final acknowledgement and conserved prior tokens/rows at both scales; source/abort/startup faults and retry; referenced-media/signature/cache/provider metadata; reference/copy retaining controls; bounded streaming, paused source/output snapshots and a 9 MiB single row; mixed-block token counts; unchanged durable source and successful retry; scoped public readers at both scales with active/deferred histories. Existing 180000 ms bounds, 512/8192 inputs, owner limits and negative controls are unchanged.

## Gates and next scope

All eight gates passed in `run/gates-a/`: API surface, declaration build, agents no-emit types, agents Bun types with installed Bun ambient types, three-path zero-warning lint/Prettier, affected graph and AST audit. Core source is unchanged, so this increment does not add a separate core tsc requirement. The captured source boundary contains 3317 TypeScript files across agents/core/test-utils. Final comparisons and gate results will be recorded in W22-STATUS.md.

Next package paths start with `agentUnconfigured.behavior.test.ts`, `apiSessionControl.characterization.test.ts`, `app-service-boundary.spec.ts` and `app-service.spec.ts`; then the async-child files. The full pending inventory includes the existing W11/W17 native runtime suites and all seven `test-bun` files. No affected-graph gate substitutes for their execution.

W23-W26 and later phases remain separate. W26 scratch-candidate removal remains required within the PR. Review skipped per Andrew 2026-10-09. No OCR, push, merge, cleanup command, `.llxprt/` edit or broad recovery staging.

## Boundary fixture increment and continued sweep

`package-next-20` completed sixteen of its twenty selected files before stopping at the first failure. Fifteen files passed; `boundary.adequacy.test.ts` was four pass/one fail because `session-package-export.test.ts` imported `core/src/recording/__tests__/support/backendEnv.js`. The guard was unchanged. Commit `f518c3a7c016b8e99237dc963531413ed7e4742b` switches only backend lifetime wiring to the existing agents helper, retaining both old/native export bodies. `export-assertion-proof.json` proves all fifteen assertion ASTs identical. `fixed-boundary-export` has five guard passes, one native export pass and one old export pass.

The resulting first 37-file map is 264 passes: 27 native history, 236 shared/public and one explicit old with its native counterpart RUN. `accounting-after-boundary.json` preserves exact case names, source hashes and PIDs. The old comparison carry reruns stay separate. All eight four-path gates pass in `gates-b/`, and all 3317 source hashes plus four committed code blobs match tested bytes. The export scan retains the same three SELF_CONFIRMING and one DUP_ASSERT notices found in gates-a before this edit; no new finding or suppression.

`package-36-55` subsequently passed all twenty selected files. A serial pending-path supervisor now continues twenty-file batches and stops on the first failure, without retries. Current execution-only additions have pending native/shared/old case classification, reported separately in W22-STATUS.md and `current-progress.json`. They are not silently counted as native history contracts. The full inventory includes W11/W17 native runtime regressions and test-bun meta suites; all still require current W22 execution/accounting before closure.

## Profile disposal fixture and disk preservation

Commit `883720445` changes two test/fixture files only. Native selection uses `JournalRecordingService.dispose`; the original test spied only on JSONL `SessionRecordingService.dispose` and waited for an unreachable barrier. The preserved native log shows one case timeout, followed by the existing outer driver termination without JUnit. This interrupted file is RED, despite the summary parser's zero failure count. No production bug was established.

`helpers/recording-disposal-target.ts:7-14` returns the actual selected prototype. `profile-session-admission.behavior.test.ts:44-69` gates its real disposal, forwards the original call and witnesses the retiring session ID. Lines 70-82 retain every original admission/state/success assertion. All six original assertion ASTs and the three-case parameter domain match; one witness was added. The 180000 ms Bun and 300000 ms driver limits are unchanged.

| Final-source proof | PID | Pass | Fail | Classification |
| --- | ---: | ---: | ---: | --- |
| `final-profile-disposal-journal`, boundary guard | 30501 | 5 | 0 | Shared/public; guard unchanged |
| Same batch, profile admission | 30512 | 3 | 0 | Journal-selected shared/public concurrency |
| `final-profile-disposal-old`, profile comparison | 30727 | 3 | 0 | Supplemental old, outside package totals |

Raw increment: `tmp/854-notes/p4/w22/next-run-20261019-b/`. `assertion-proof.json`, `audit-comparison.json`, `commit-proof.json`, `classification-b.json` and `interrupted-profile-observation.json` retain the bounded evidence. All eight final-source gates passed in `gates-d/`; the earlier formatting failure stays in `gates-c/`. All 3318 captured source hashes match. One baseline SELF_CONFIRMING notice is unchanged, with no policy change or new finding.

Disk proof is the durable `W22-FIXTURE-RELOCATIONS.json`: fourteen explicit closed journal-only fixture directories, 3,670,126,223 bytes, before/after SHA-256 equality and original-path symlinks. Preserved destination: `/private/tmp/llxprt-branch3-preserved-20261019-go6wku4f/`. It is system-temp storage, not a permanent archive. Code, logs, notes and hash evidence stayed workspace-local. Only the separately verified ignored MCP declaration obstruction moved within the workspace after gates, with matching inode and 237 file hashes.

The repaired checkpoint is 125 green package files/1015 passes; 681 paths remained when serial supervisor 31425 resumed. Three profile cases add shared/public classification, not native disk proof: 27 native history, 239 shared/public, one explicit old and 748 pending at that checkpoint. New execution/classification checkpoints belong to W22-STATUS.md and the continuation's progress driver. Full-package W22 remains partial. Review skipped per Andrew 2026-10-09.

## Continued native public-history execution

The first resumed batch completed all twenty files. Five unchanged public-history files contribute 29 additional native-history contracts, with every executed case name, source hash and PID in `next-run-20261019-b/classification-b.json`:

| File under `src/api/__tests__/` | PID | Pass | Native behavior |
| --- | ---: | ---: | --- |
| `public-history-deferred.test.ts` | 33010 | 2 | 512/8192 pinned snapshots survive replacement without original object retention |
| `public-history-faults.test.ts` | 33154 | 4 | Source fault propagation and early-break iterator closure at both scales |
| `public-history-owner-controls.test.ts` | 33651 | 4 | Borrowed/copy consumer retention exceeds unchanged bounds and releases all owners |
| `public-history-pause.test.ts` | 34214 | 4 | Stored/active clear while paused retains only the returned row and reads indexed boundaries |
| `public-history-stream.test.ts` | 34868 | 15 | Exact mixed-row digests, membership pins, backpressure, consumer fault/abort, unused readers, 9 MiB row and deferred replacement |

Reachability is through the real selected recorder and HistoryService in `history-suffix-test-helpers.ts:155-195`. `public-history-fixture.ts` forwards `super.streamRawHistory`, instruments actual row ownership/decodes and injects that service into a real public Agent. Deferred cases use real Agent history directly. No history decoder is replaced. The 512/8192 scales, 440-row/8 MiB bounds, 9 MiB row, active/stored variants and timeouts remain unchanged. The four owner controls are classified as controls, not bounded-production positive proof. A separate `PUBLIC_HISTORY_RETAINING_TRAP=1` launch has not run in this increment and is not claimed here.

This raises classified native history from 27 to 56; shared/public and pending counts remain separate. The next batch stopped on the unchanged Node-export publication test because `core/dist/index.js` was absent after declaration-only builds. Its observed 0 pass/1 fail is preserved in `package-resume-b-0020/`; runtime prerequisite emission is recorded separately, without changing the test or calling the ordinary full-build cleanup path.

Direct runtime compilation through the existing build configs passed without a clean stage (40268), followed by the existing MCP asset copier. The unchanged Node-export test then passed (41617), same SHA-256, and adds one shared/public publication case. Generated runtime outputs remain intact; 3318 source hashes still match. Supervisor 42344 resumed only the new 658-path remainder in `package-resume-c-NNNN` batches. At `2026-10-19T19:47:29.643Z`, execution was 149 green files/1186 passes, zero current red/skips, 657 uncompleted files; classification was 56 native history, 240 shared/public, one explicit old and 889 pending. `next-run-20261019-b/final-checkpoint.json` freezes that bounded state; W22-STATUS.md identifies current-file and pending-path sources. No full-package claim follows.

## Current unresolved facade cluster

At `2026-10-19T19:50:07.781Z`, supervisor 42344 had stopped at `recording-facade-chat-channel.behavior.test.ts` (42825), two pass/two fail. All supervisor/driver/child PIDs are absent. Failures at lines 136 and 246-248 expect a JSONL purge-event marker in native bytes; `recordedHistoryPersistence.ts:84-91` emits that event only for JSONL. No product defect is established by those assertions, and the negative-marker pass is not native isolation proof. No fix or old pin has been made. Map all four original cases to actual native facade/history/disk semantics before repair, preserving their original limits and old assertions where justified.

Latest exact package state is 151 completed files: 150 green, one red; 1195 passes/two failures/zero skips; 655 unexecuted paths. Passing-case classification: 56 native history, 240 shared/public, one explicit old, 898 pending. Frozen evidence/continuation: `next-run-20261019-b/final-stopped-checkpoint.json`, `next-root-cluster.json`, current pending list and W22-STATUS.md. Earlier running counts above are historical checkpoints. W22 is partial; there is no live sweep.
