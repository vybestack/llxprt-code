# W21 ten-file discovery remainder, 2026-10-19

**The ten-file discovery remainder is DONE. W21's owned named gaps are closed at their documented boundaries.** This is not a full-package, affected-shard or monorepo result, and it does not start W22. W23 send/planning-envelope work, W24 whole-product/write-amplification/topology measurement, W25 default/deletion work and later requirements remain separate.

Starting HEAD was verified as `6ed0dfbe2760e13054169207dc1783158a994e5d` on `issue854`. The case inventory was written before edits. `W21-DISCOVERY-REMAINDER-CASES.md` preserves every original title and its exact executed native counterpart, source location and run PID. Raw new evidence is retained under `tmp/854-notes/p4/w21/discovery-remainder/run-20261019-HGigU4/`; real new fixtures remain in the sibling `fixtures/` directory. These are new runs, not recovered historical logs.

## Changes and actual RED

`786d4cf0d` preserves the seven JSONL fixture files with explicit old-backend selection. Original bodies, assertions, generator domains, iteration counts and timeouts are unchanged. `old-ast-proof.json` proves equality to the starting revision after removing only the backend import and pin. The other three files remain unchanged: the direct native recorder, typed native consumer and mixed-backend transition front door.

The untouched baseline ran all ten files under both outer settings: old had 102 passes; journal had 80 passes and 22 failures. Those failures were old-fixture/backend mismatches, not evidence to weaken the native contract. After explicit fixture selection, twenty isolated processes passed all 204 executions. `integration.advanced.test.ts` has eleven curried `itProp` runtime cases, despite the earlier inventory's zero plain-`it` sites.

Native pathname coverage then exposed [#3903](https://github.com/vybestack/llxprt-code/issues/3903). Recorder creation and checkpoint-fork cleanup treated a chosen pathname as owned before exclusive allocation succeeded. `EEXIST` correctly refused the open, but the failure path removed the existing file. The complete native pathname suite produced **one pass and three failures under each outer setting**, with missing occupied-file bytes after the refusal. Nonempty recorder collision, empty recorder collision and fork-destination collision all rejected the old behavior; same-label independent allocation already passed.

`ba9c1829a` moves ownership to successful exclusive allocation, using the existing journal I/O dependency boundary. Cleanup still releases locks and removes genuinely allocated partial files. It does not delete another owner's occupied pathname. Existing creation-write-failure and fork/offset/late-ownership regressions run alongside the new tests. No row buffers, repeated history scans, operation temporary files, new fallback or backend-default change are introduced.

`05c4bc0467f7f31690f944a45fb389cc119a4aad` supplies the remaining native public contracts and exact byte-conservation audit form. No further production defect was demonstrated by metadata, public deletion, partial-turn or janitor/media cases.

## Coverage accounting

| Original file, relative to core recording    | Runtime cases per outer setting | Classification and native coverage                                                                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integration-advanced-addendum.test.ts`      |                               9 | Explicit old JSONL structure/line corruption; native partial-tool turn discovery/resume/append, public locks, generated replay and filename/filter counterparts RUN                                                                                   |
| `SessionTransitionService.frontDoor.test.ts` |                               3 | Unchanged native clone/boot and deleted-checkpoint refusal, plus explicit old cursor dispatch; native clone/fork counterparts RUN                                                                                                                     |
| `recorderConsumers.port.test.ts`             |                               1 | Unchanged native recorder identity and compile-time consumer acceptance; core and supplemental tsc RUN                                                                                                                                                |
| `firstUserMessageScan.test.ts`               |                              11 | Explicit old JSONL chunk/line/cap behavior; native first-human preview, Unicode/length/empty/malformed cases, child filter and bounded reads RUN                                                                                                      |
| `recordingMetadata.integration.test.ts`      |                              29 | Explicit old event/sequence/folding contracts; native direct metadata, stable checkpoint identity/timestamps, concurrency, name/title separation, empty/inactive guards, external descriptor isolation, namespace/fork/resume counterparts RUN        |
| `journalRecordingService.test.ts`            |                              13 | Unchanged native direct service; original thirteen cases RUN rather than duplicated                                                                                                                                                                   |
| `integration.advanced.test.ts`               |                              11 | Explicit old generated JSONL lifecycle; native generated metadata/flush/resume/compression and public discovery/delete counterparts RUN                                                                                                               |
| `integration.basic.test.ts`                  |                              16 | Explicit old JSONL lifecycle plus three local boolean/string examples; native complete rows, discovery/latest/identity/locks, metadata, rewind/compression and public deletion RUN; local examples are not claimed Config proof                       |
| `recording-instance-path-isolation.test.ts`  |                               3 | Explicit old exclusive pathname layout; native same-label paths, selected original-path continuation and occupied empty/nonempty refusal proved directly                                                                                              |
| `janitor/sessionJanitor.safety.test.ts`      |                               6 | Explicit old JSONL safety fixtures; native global-root preservation, archive/raw symlinks, inode replacement, temp grammar and error counters proved directly, including referenced-media preservation and unreadable-sibling fail-closed reclamation |

Twenty-two new native cases execute twice: pathname 4, direct metadata/public deletion/external descriptor isolation 10, janitor/media safety 7 and partial-tool discovery/resume 1. The settled matrix has **70 serial isolated processes, 656 passes, zero failures and zero skips across 35 files**: 44 new native executions plus 612 reused regression executions. The ten original files contribute 204 of those executions. Counts are file/runtime executions, not assertions or generator samples.

Each test file runs alone from `packages/core`, with both `LLXPRT_HISTORY_BACKEND=old` and `journal` as outer settings. Explicitly old files stay old; native suites select native internally where needed. Existing native proofs are mapped and RUN, not duplicated case for case.

The malformed external checkpoint inputs remain actual persisted null/array/scalar/missing/negative/unsafe-number facts. Tests require exact per-file reason/error/skip accounting, preserve failed-file bytes and retain healthy sibling session/checkpoint targets. Public deletion refuses live locks and live checkpoints, releases its lock, deletes only the selected file after the blockers are removed, and reports unreadable siblings without changing them. Partial-tool resume carries exact call/result rows, invents no unfinished results and appends on the original file.

Native janitor inode replacement uses a valid native replacement with the same session ID and a different inode. Its referenced media survives while an unrelated orphan is actually reclaimed. An unreadable native sibling protects all project media when a complete ownership scan is impossible. Symlink and root assertions include actual scan/mutation counters, not just the survival of an unrelated file. Native-looking portable temporary files remain untouched because the actual transfer grammar is JSONL-specific.

## Gates, source boundary and retained evidence

All eight settled gates pass: declaration build, core no-emit tsc, core runner tsc, supplemental touched native-test tsc, fourteen-path zero-warning ESLint, fourteen-path Prettier, affected-graph validation and AST test audit. Graph validation does not mean affected-shard tests ran. Compiler, lint, audit and assertion policies are unchanged.

The 1,859 captured core TypeScript source hashes match the settled worktree. Committed touched source blobs are checked against those tested bytes in `commit-proof.json`. All 248 recorded test/gate/supervisor process IDs are absent; managed shell tasks completed. Exact commands, PIDs, exits and logs are in `settled-tests/matrix.json`, `settled-gates/results.json` and `summary.json`.

Audit has zero new touched `MOCK_MIRROR`, `ALWAYS_TRUE`, `SELF_CONFIRMING` or `NO_ASSERT` findings. One `DUP_ASSERT` notice compares the lock after checkpoint-blocked deletion and after successful deletion, separate lifecycle events. Before/after bytes are compared with `Buffer.compare(...) === 0`, preserving full exact byte equality without suppressing scanner output. Initial audit and lint failures remain recorded separately; no policy was changed. The initial audit conservations were scanner classification failures, not production RED. The ownership callback's local-boolean lint failure was resolved by tracking the existing allocation fact in a small object. These failures are distinct from the observed destructive-collision RED.

No generated obstruction had to be moved in this increment. Declaration outputs remain intact. No cleanup/deletion shell command, `git clean`, `.llxprt/` edit, broad recovery staging, pattern kill, weakened check, default flip, OCR, push or merge was performed. Existing unrelated `.llxprt/LLXPRT.md` and untracked recovery artifacts remain untouched. Review skipped per Andrew 2026-10-09.

## W21 completion boundary

There are no remaining inventory-only whole-file gaps in the named ten-file set. Together with the separately documented service defects 1–5, W17-owned public lifecycle/ownership proofs, generated and unstamped replay, referenced-media reservation/rollback, service large-row persistence, crash/reopen and next-request transport variants, the owned named W21 queue is DONE. Earlier service/crash/transport proofs retain their stated scope and rejecting controls; they were not all rerun here.

No broader full-package claim follows. W22 agents-wide parity remains separate. W23 send/planning-envelope refusal and 40 MiB send remain separate from W21's service-size proof. W24 still requires whole-product/write-amplification measurements and an evidence-based primary/mirror topology decision. W25's default flip is not authorized. W26 and later phase requirements remain. Historical deleted raw evidence is still missing.

## Settled execution tables

| File                                                         | old pass / PID | journal pass / PID |
| ------------------------------------------------------------ | -------------: | -----------------: |
| src/recording/integration-advanced-addendum.test.ts          |      9 / 84324 |          9 / 85706 |
| src/recording/SessionTransitionService.frontDoor.test.ts     |      3 / 84383 |          3 / 85717 |
| src/recording/recorderConsumers.port.test.ts                 |      1 / 84437 |          1 / 85727 |
| src/recording/firstUserMessageScan.test.ts                   |     11 / 84459 |         11 / 85736 |
| src/recording/recordingMetadata.integration.test.ts          |     29 / 84492 |         29 / 85749 |
| src/recording/journalRecordingService.test.ts                |     13 / 84537 |         13 / 85762 |
| src/recording/integration.advanced.test.ts                   |     11 / 84549 |         11 / 85773 |
| src/recording/integration.basic.test.ts                      |     16 / 84715 |         16 / 85824 |
| src/recording/recording-instance-path-isolation.test.ts      |      3 / 84765 |          3 / 85854 |
| src/recording/janitor/sessionJanitor.safety.test.ts          |      6 / 84802 |          6 / 85863 |
| src/recording/journal-recording-path-isolation.test.ts       |      4 / 84820 |          4 / 85869 |
| src/recording/journal-recording-metadata-contracts.test.ts   |     10 / 84842 |         10 / 85877 |
| src/recording/janitor/journal-janitor-safety.test.ts         |      7 / 84859 |          7 / 85889 |
| src/recording/discovery-partial-turn-resume.test.ts          |      1 / 84882 |          1 / 85899 |
| src/recording/session-discovery-native-inputs.test.ts        |     19 / 84898 |         19 / 85911 |
| src/recording/session-discovery-native-contracts.test.ts     |      5 / 84931 |          5 / 85919 |
| src/recording/session-discovery-native-faults.test.ts        |     13 / 85021 |         13 / 85931 |
| src/recording/session-discovery-native-bounds.test.ts        |      2 / 85050 |          2 / 85955 |
| src/recording/session-discovery-native-extensions.test.ts    |      7 / 85159 |          7 / 85970 |
| src/recording/journalResume.test.ts                          |     12 / 85180 |         12 / 85989 |
| src/recording/journalFork.test.ts                            |      4 / 85197 |          4 / 86005 |
| src/recording/journalCheckpointService.test.ts               |     17 / 85207 |         17 / 86011 |
| src/recording/checkpointServiceFactory.test.ts               |     14 / 85232 |         14 / 86020 |
| src/recording/janitor/journalJanitor.test.ts                 |     10 / 85272 |         10 / 86041 |
| src/recording/recording-integration-native-core.test.ts      |     19 / 85289 |         19 / 86051 |
| src/recording/recording-integration-native-lifecycle.test.ts |     14 / 85312 |         14 / 86075 |
| src/recording/recording-integration-native-replay.test.ts    |      8 / 85335 |          8 / 86094 |
| src/recording/recording-integration-native-ownership.test.ts |      2 / 85381 |          2 / 86121 |
| src/recording/recording-exact-generated-replay.test.ts       |     30 / 85459 |         30 / 86141 |
| src/recording/recording-exact-media-replay.test.ts           |      5 / 85599 |          5 / 86220 |
| src/recording/sessionCleanupUtils.journal.test.ts            |      3 / 85632 |          3 / 86248 |
| src/recording/recording-integration-native-boundary.test.ts  |     14 / 85639 |         14 / 86257 |
| src/recording/sessionMetaKeys.preview.test.ts                |      4 / 85672 |          4 / 86289 |
| src/recording/session-fork-offset-audit.test.ts              |      1 / 85677 |          1 / 86296 |
| src/recording/session-fork-late-ownership.test.ts            |      1 / 85691 |          1 / 86313 |

| Gate            |   PID | Exit |
| --------------- | ----: | ---: |
| build-types     | 86826 |    0 |
| core-tsc        | 88764 |    0 |
| core-runner-tsc | 88973 |    0 |
| touched-tsc     | 88993 |    0 |
| eslint          | 89080 |    0 |
| prettier        | 89272 |    0 |
| affected-graph  | 89279 |    0 |
| audit           | 89386 |    0 |
