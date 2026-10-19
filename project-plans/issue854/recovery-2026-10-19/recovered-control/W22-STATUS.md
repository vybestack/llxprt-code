# W22 agents sweep status, 2026-10-19

## Adopted-instance contract and Node export fix committed; W22 remains partial

At `2026-10-19T21:18:25.628Z`, the running checkpoint has **281 of 806 files executed: 270 green, eleven red, 2138 passing cases, 28 failures, zero skips and 525 unexecuted files**. Passing-case classification is **88 native history, 258 shared/public, 28 explicit old and 1764 pending**. These are cumulative per-file results at recorded source boundaries. They are not a whole-package final-source run.

| Commit | Scope | Actual verification |
| --- | --- | --- |
| `bc46927e653921afcb5d4b6a9fb2d22e55ecba28` | Preserve original adopted-instance JSONL contract explicitly old; add native public resume, stopped replacement, continued turns and independent reopen | Four files, each alone in Bun under both outer backends: 43 passes per environment, 86 total, zero failures/skips; eight scoped gates pass |
| `75fe4c8a4402e37d415c121c6eac14a6593c326b` | Add seven explicit core runtime subpath exports required by published Node agents | Six files under both outer backends: 47 passes per environment, 94 total, zero failures/skips; nine scoped gates pass, including core no-emit types |

The original adopted-instance `it` call is AST-identical, including its 30000 ms limit and all JSONL event assertions. Its former native failure was JSONL replay of binary data; path equality had already passed. The separate native case uses three real public agents, exact independently opened committed rows and indexed session facts. It verifies original path, history, source identity, creation time across three distinct clock timestamps, one session listing and durable turns after independent reopen. It does not read the whole binary file or parse journal bytes as JSONL.

The broad sweep exposed a product publication defect: Node agents imported seven existing core runtime files whose subpaths were absent from `exports`. The unchanged shell-owner file was zero pass/three fail at `ERR_PACKAGE_PATH_NOT_EXPORTED` (62814). After the manifest-only fix, all three cases pass (84152 and 86077 in the final matrix). Related publication, adopted-instance, owner-lifetime and checkpoint files were rerun after this production boundary changed. The earlier red Node result is superseded; retained unrelated results keep their original boundaries.

## Serial sweep and continuation

The pending-only supervisor selected exactly the original 650 unexecuted paths, excluding all 156 previously executed files. Two 50-file batches completed serially, one file per Bun process: **100 files, 94 green/six red, 713 passes/13 failures/zero skips**. It continued beyond each ordinary failure without retry. A recorded control then stopped it at the batch boundary to fix the Node export cluster. Supervisor 54964, both drivers and the last child exited before source edits. The export repair supersedes that chunk's Node failure. Its repaired boundary was 256 executed/251 green/five red, 1970 passes/ten failures, with 550 unexecuted.

The active supervisor uses only the **550** paths frozen in `instance-run-20261019-a/pending-after100.txt`. It must not restart the full inventory or any prior green file. It continues in 50-file batches despite ordinary test failures, logs each red case and failure type immediately, and stops for a disk-full, loader or incomplete-driver failure. Existing per-file settings and the 300000 ms outer limit remain unchanged. There is no automatic retry. State/result publication is atomic; current PID, file and counts appear before the first file completes and terminal state is written on exit.

The final driver controls ran pass/red/pass in three distinct serial processes (91926, 91928, 91930), proving continuation. A separate loader control (91932) stopped before its second selected file. These controls are not package-test coverage. No heavy gate runs with the sweep.

At the frozen handoff, continuation supervisor **94663**, driver **94665** and child **4265** were live in `package-resume-g-0000`. This continuation had completed 25 files, 19 green/six red. The current file was `packages/agents/src/compression/__tests__/fallback-values.test.ts`; the latest completed file was `fallback-values.journal.test.ts`. The sweep remains active and continues beyond this point-in-time snapshot.

Live authority is `tmp/854-notes/p4/w22/run-20261019-a/sweep-supervisor.json` and the `currentFilePath` it names. Refresh completed-file census without rerunning tests:

```sh
bun tmp/854-notes/p4/w22/instance-run-20261019-a/progress-g.ts
```

Read live process identity before acting; historical PIDs are not permission to stop a reused PID. The optional stop control is `instance-run-20261019-a/stop-after-batch-g.json`. It requests a batch-boundary stop without killing a test. Final handoff metadata is in `instance-run-20261019-a/handoff-checkpoint.json`.

## Remaining red files at the running checkpoint

Paths below are relative to `packages/agents/src/`. Exact failed case names, source hashes, JUnit paths and PIDs are in `W22-INSTANCE-PROOF.json` and `instance-run-20261019-a/failure-table.json`.

| File | Pass/fail | PID | Observed failure and next contract work |
| --- | ---: | ---: | --- |
| `api/__tests__/recording-shared-history-origin.behavior.test.ts` | 8/1 | 55296 | Rollback test at line 286 requires marker absence from the whole native file. Committed-row rollback still needs native proof; raw byte presence does not establish visible-row publication |
| `compression/__tests__/addbatch-pending-window.test.ts` | 0/2 | 71576 | Both scales construct an old recorder for the selected native history store in `pending-window-disk-helpers.ts`; construction rejects the backend mismatch |
| `compression/__tests__/compression-attempt-estimation.test.ts` | 1/1 | 71899 | 8192-row case reaches native compression publication and rejects an empty-block row; 512-row case passes. Preserve both inputs and determine the intended no-op/publication contract |
| `compression/__tests__/compression-attempt-lifecycle.test.ts` | 3/2 | 72984 | Large-row case returns `compressed` where fixture expects `noop`; retaining-control case reaches the same empty-block publication rejection. Cursor-exit cases pass |
| `compression/__tests__/compression-attempt-stream.test.ts` | 4/4 | 74633 | Abandoned-cursor success/failure cases at both scales reject empty-block rows through `diskTruncation` and `journalDetachedCandidate`; four other cases pass |
| `compression/__tests__/compression-value-lifetime.test.ts` | 0/3 | 94666 | All cases fail because `diskMiddleOut.ts:127` calls a missing `previous.close`; preserve source and fixture checkpoint-lifetime evidence before choosing the fix |
| `compression/__tests__/compression-value-recorder.test.ts` | 0/4 | 95480 | Recorder/backend mismatch before the native store can exercise recorder acknowledgement or compensation |
| `compression/__tests__/density-disk-capture-owners.test.ts` | 0/1 | 95950 | Decoded-original owner count is zero where the ownership contract requires a positive count |
| `compression/__tests__/density-disk-lifecycle.test.ts` | 4/1 | 96014 | Transient candidate token estimate error escapes the expected retry path; four other lifecycle cases pass |
| `compression/__tests__/density-disk-span-order.test.ts` | 0/1 | 97194 | Exact span result violates the removal-before-replacement expectation at overlapping chronology positions |
| `compression/__tests__/effective-token-count-stream.test.ts` | 1/8 | 98322 | Token-count differences at 512/8192 rows and policy boundaries; exact expected/actual values remain in the log |

These failures remain red. Their passing cases are not promoted to native-history classification merely because the outer backend is journal. Do not relax bounds, change timeouts or force no-op behavior to conceal the compression failures.

## Evidence and limits

`W22-INSTANCE-PROOF.json` records exact matrix cases, commands, gate PIDs, source hashes, driver controls, failure cases and the handoff. The final source boundary contains 3320 TypeScript paths plus `packages/core/package.json`; all captured bytes match. Adopted-instance SHA-256 is `e51a3e8e507d302969bb5c04b7bbed7b273b79ee690462f3ad43e511457ab71a`; core manifest SHA-256 is `1b1fb5b893d4ca07f7f0ac2d2cdc5fde0fd0c388afe6e52b93d7da688ce00cf7`. Earlier detailed increments remain in `W22-PROOF-MAP.md`, `W22-FINALIZER-PROOF.json`, `W22-FACADE-PROOF.json` and git history.

Final gates cover API surface, declaration build, agents no-emit and Bun types, scoped zero-warning ESLint, Prettier, affected graph and AST test audit. The export fix also passes core no-emit types. The changed test is included in agents no-emit compilation. There are no new high-risk audit findings or suppressions. One duplicate-assert notice compares session facts at two different continuation/reopen boundaries. Graph validation is not affected-shard test execution.

Raw logs stay workspace-local under `tmp/854-notes/p4/w22/`; new test isolation roots are under `/private/tmp/llxprt-w22-branch3-instance-*`. No cleanup, deletion, generated-directory move, `.llxprt/` edit, broad recovery staging, skip, assertion/timeout weakening, default flip, push or merge occurred. Earlier preservation receipts and system-temp fixtures remain untouched. Review skipped per Andrew 2026-10-09.

W22 requires all 806 files, remaining red repairs and case classification before closure. W23-W26 remain separate and open.
