# W22 agents sweep status, 2026-10-19

**The committed fixture repairs are green; the sweep stopped at its next layout-specific failure. W22 is incomplete.** At `2026-10-19T19:50:07.781Z`, 151 of 806 files have completed: 150 green files, one red file, 1195 passing cases, two failures and zero skips; 655 files remain unexecuted. Passing-case classification is 56 native history, 240 shared/public, one explicit old and 898 pending. Historical timeout/loader/disk/prerequisite failures remain preserved separately.

## Current stop and continuation target

`package-resume-c-0000` stopped after its third file: `recording-facade-chat-channel.behavior.test.ts`, child **42825**, two pass/two fail. Supervisor **42344** and driver **42345** exited; `ps` confirms all three absent. There is no live W22 test process and no file currently running. The driver itself returned zero, but the supervisor correctly inspected child results and stopped on failure. Do not use driver exit alone as proof.

The two failures are at lines 136 and 246-248: tests expect the JSONL `"type":"semantic_media_purge"` marker in native `.llxj` bytes. `control/recordedHistoryPersistence.ts:84-91` emits that explicit event only for the JSONL recorder. Native history mutation uses the real service/integration path, so missing marker bytes do not establish a production defect. The passing negative-marker case also does not prove native facade isolation. No source change has been made for this cluster. Before changing it, map all four original cases to actual native public/persisted equivalents, retaining old layout assertions where justified, all case domains and 30000 ms case limits. No blanket old pin is authorized.

Failure evidence: `run-20261019-a/package-resume-c-0000/0149-recording-facade-chat-channel.behavior.test.ts.log` and `.xml`. `next-run-20261019-b/next-root-cluster.json` preserves source hash, exact root evidence and next action; `final-stopped-checkpoint.json` freezes the latest census. Start with this red file, then continue only the 655 unexecuted paths in `run-20261019-a/current-not-run.txt`, beginning `recording-finalizer-join.behavior.test.ts`, `recording-hook-routing.behavior.test.ts`, `recording-instance-resume.behavior.test.ts`, `recording-nonstream-413-hooks.behavior.test.ts` and `recording-owner-lifetime.behavior.test.ts`. Use a fresh batch namespace and include its results in `next-run-20261019-b/progress.ts`; do not restart 806 paths or reuse output directories.

Latest free space: external **19 GiB**, system **103 GiB**. Only the 3,670,126,223-byte preservation manifest move belongs to this task; later capacity changes are not attributed here. The preserved fixtures remain at `/private/tmp/llxprt-branch3-preserved-20261019-go6wku4f/` with exact source symlinks, but system temp is not a permanent archive.


## Prior running checkpoint at 19:47 and runtime prerequisite repair

The first resumed twenty-file batch passed, including all five native public-history files: 29 cases, fully mapped in W22-PROOF-MAP.md and `next-run-20261019-b/classification-b.json`. These cover real selected history stores, 512/8192 scales, unchanged 440-row/8 MiB ownership bounds, active/stored readers, replacement/clear/fault/abort and a 9 MiB row. Four cases are deliberate retaining-consumer controls. A separate PUBLIC_HISTORY_RETAINING_TRAP=1 launch has not run in this increment and is not claimed.

The following batch stopped at unchanged `recorded-history-persistence-node-export.test.ts`: 0 pass/1 fail because Node's published export `core/dist/index.js` did not exist after declaration-only builds. This was a runtime-build prerequisite, not demonstrated product RED. Direct `node node_modules/typescript/bin/tsc --build --force` using existing workspace build configs passed (PID 40268), followed by the existing MCP asset copier. No `--clean`, full-build cleanup stage, source change or assertion change was used. The identical test then passed (PID 41617), with the same source hash. It is shared/public publication coverage, not native history proof. Runtime commands/results/PIDs are `next-run-20261019-b/runtime-emit-results.json`; compiled outputs remain intact. All 3318 source hashes still match.

After that repair, 148 files/1184 cases were green and 658 paths remained. A new serial supervisor **42344**, managed task `shell_35660a6e8039`, resumed only those paths through `next-run-20261019-b/resume-pending-c.ts`. At the latest checkpoint above, driver **42345** was in `package-resume-c-0000`; child **42389** ran `recording-compression-origin.behavior.test.ts`. These are point-in-time IDs, not permission to stop a later reused PID. `sweep-supervisor.json` and its `currentFilePath` identify the current process; first failure/incomplete batch stops the supervisor with no retry.

Next pending paths after the active file: `recording-facade-chat-channel.behavior.test.ts`, `recording-finalizer-join.behavior.test.ts`, `recording-hook-routing.behavior.test.ts`, `recording-instance-resume.behavior.test.ts`, `recording-nonstream-413-hooks.behavior.test.ts` and `recording-owner-lifetime.behavior.test.ts`. The exact remaining list is `run-20261019-a/current-not-run.txt`; `next-run-20261019-b/final-checkpoint.json` freezes execution/classification/PID/disk details. The 889 unclassified passes are not counted as native proof. Supplemental old comparisons and historical failed attempts stay separate.

Free space at that checkpoint: external **21 GiB**, system **103 GiB**. Only the manifest-recorded 3,670,126,223-byte fixture relocation is attributed to this task; later machine-wide capacity variation is not. Preserved system-temp fixtures still need durable archival storage. No evidence was deleted, and no permanent disk-capacity repair is claimed.

## Disk preservation and profile disposal increment

Starting HEAD was verified as `d2fade3331b6807ab1f252c32ee5cec8c9efcb3c` on `issue854`. New fixture commit: `883720445` (full SHA in `tmp/854-notes/p4/w22/next-run-20261019-b/commit-proof.json`). No production source changed.

External free space was 398 MiB at entry and 388 MiB immediately before relocation. Fourteen individually named, closed W21 large-row fixture directories contained only generated native journals. `lsof` found no open handles. Before/after SHA-256 and byte counts match for all **3,670,126,223 bytes** relocated to `/private/tmp/llxprt-branch3-preserved-20261019-go6wku4f/`. Each original path is now a symlink. The durable `W22-FIXTURE-RELOCATIONS.json` records the explicit paths and both inventories. One additional candidate contained a lock, was rejected during preflight and stayed untouched. No file moved during that failed preflight. Free external space rose to 3.8 GiB. This is system-temp preservation, not permanent archival storage or a permanent capacity fix. Code, notes, logs and source-hash evidence did not move off the workspace volume.

The original supervisor stopped at `profile-session-admission.behavior.test.ts`, child 98836, driver 97143, batch `package-auto-0060`. The log contains one observed 180000 ms case timeout; the existing driver terminated the child at its unchanged 300000 ms outer bound. No JUnit or final Bun summary was written, so the driver's numeric summary says zero failures. That number is not a passing result. `next-run-20261019-b/interrupted-profile-observation.json` preserves the distinction: one red/incomplete file with one observed timed-out case, not three completed cases. Supervisor/driver/child had all exited before replacement tests began; no process was manually stopped.

Cause: the test gated JSONL `SessionRecordingService.dispose`, while journal construction returns `JournalRecordingService`. Its entry barrier could never resolve. The backend-selected disposal target now pauses the actual recorder and forwards its original disposal unchanged after release. The added session-ID witness proves which recording retired. AST proof preserves all six original assertion expressions in order and `it.each(['load', 'applySnapshot', 'apply'])` unchanged, adding only that witness. No old pin, skip, timeout adjustment, production fallback, row array or spool was added.

Final formatted-source proof: journal profile three pass (PID 30512), unchanged boundary guard five pass (30501), separate old profile three pass (30727). The three journal admission cases are classified shared/public concurrency contracts, with actual native recorder retirement reachability. They are not independent native disk-row proofs. Before resuming, classifications were 27 native history, 239 shared/public, one explicitly old export case with native counterpart RUN, and 748 passing cases still pending classification. Supplemental old runs remain outside package totals.

All eight final-source gates pass in `tmp/854-notes/p4/w22/next-run-20261019-b/gates-d/`: API surface 24781, declaration build 25414, agents no-emit tsc 27299, Bun tsc 27639, scoped zero-warning lint 27826, Prettier 28133, affected graph 28138, AST audit 29074. The no-emit project includes both touched files. One pre-existing SELF_CONFIRMING conservation notice remains identical except for its line number; no new notice or suppression. Initial formatting failure remains in `gates-c/` and was fixed before final gates/tests. All 3318 captured source hashes match, and both committed code blobs match tested hashes. Graph validation is not affected-shard execution.

The declaration gates recreated the same ignored MCP loader obstruction. Only `packages/mcp/dist` was verified untracked, ignored, nonsymlink and closed, then renamed intact on the workspace volume to `next-run-20261019-b/held-generated/mcp-dist-after-gates-d`. Its inode and all 237 generated-file hashes match. `mcp-generated-relocation.json` retains the before/after inventory and the earlier loader diagnosis; nothing was deleted.

Serial continuation uses `tmp/854-notes/p4/w22/next-run-20261019-b/resume-pending.ts`, supervisor 31425, managed task `shell_45f362468cbc`. It reads only the recorded 681-path remainder, preserves the stopped supervisor state, uses fresh `package-resume-b-NNNN` directories and stops on the first failed/incomplete batch without retry. No completed package file is re-swept. Final changed-file checks and the affected boundary guard are recorded separately above. Test HOME/TMPDIR roots remain `/private/tmp/llxprt-w22-branch3-20261019-99211/`; logs/JUnit/PIDs remain workspace-local. Refresh accounting with `bun tmp/854-notes/p4/w22/next-run-20261019-b/progress.ts`, not the historical progress driver, which predates this continuation.

W22 remains partial until all 806 files and case classification are accounted for. W23-W26, primary topology, default/deletion and scratch-candidate removal remain separate. Review skipped per Andrew 2026-10-09. No OCR, push, merge, cleanup/deletion command, `.llxprt/` edit, recursive raw recovery staging, weakened check or backend-default flip.
## Commits and root causes

- `f0b24926af3eb9286ac7cf4af020427f48b580a1`: carry durability/transaction faults previously targeted JSONL's acknowledgement method even when journal was selected. Baseline was 143 pass/four fail across twenty files. The backend-aware fixture now rejects the actual native candidate trailer write and preserves the original old acknowledgement seam. Both scales and all original conservation/owner/retry assertions remain, plus full-source-consumption witnesses. Final changed tests: four journal passes and four separate old passes. Unchanged journal retaining traps: zero pass/four expected failures.
- `f518c3a7c016b8e99237dc963531413ed7e4742b`: the next batch exposed a prohibited cross-package `core/src` import in session export. The unchanged boundary guard was four pass/one fail. Export now uses the existing agents `withHistoryBackend` helper. Guard: five passes; actual export: one old case and one native equivalent pass. All fifteen assertion ASTs are identical before/after. No guard exemption or production change.

Verified starting HEAD: `b1714cdea75dd297a122b443b853bbe36b1cead5`, branch `issue854`. W21's named closure is retained at its documented boundaries, not counted as W22 execution.

## Inventory and earlier coverage checkpoint

Actual package scripts run `packages/agents/run-bun-tests.ts` over source and `scripts/run_bun_tests.ts --workspace agents` over test-bun. Their discovery functions produced 799 source files and seven test-bun files, **806 total, no exclusions**. Inventory/status were written before tests.

At the checkpoint, classified cases are 27 native history, 236 journal-selected shared/public and one explicit old export case with its native counterpart RUN. Another 357 passing cases have pending native/shared/old classification. Do not count those 357 as native proof. Four supplemental old carry executions and four expected retaining-trap failures are separate from package totals. Zero current failing package cases does not establish native parity for unclassified or unexecuted files.

Completed results combine per-file source boundaries; this is not a single final-source whole-package run. The first 37-file map has 264 passes. The later twenty-file batch and current automatic batch add actual execution only; their case classification remains pending. `W22-PROOF-MAP.md` maps the first cluster and second-cluster increment.

Raw evidence root: `tmp/854-notes/p4/w22/run-20261019-a/`:

- `inventory.json`, `inventory.txt`, initial `STATUS.md`: full pretest inventory, original hashes and runner settings.
- `current-progress.json`, `current-files-table.md`, `current-not-run.txt`: exact completed case/process census and every pending path at the recorded checkpoint. Refresh with `bun tmp/854-notes/p4/w22/progress.ts`; it reads existing results without rerunning tests.
- `accounting-after-boundary.json`: exact JUnit case titles/classification for the first 37 green files; `export-assertion-proof.json` proves all fifteen original assertion ASTs unchanged.
- Each batch: `selected.json`, `driver.pid`, `current.json`, `pids.jsonl`, `results.json`, per-file logs/JUnit.
- `gates-a/`, `gates-b/`: exact serial gate commands, PIDs and exit codes. `commit-proof.json` matches all four committed code files to tested hashes. `after-boundary-source-comparison.json` confirms all 3317 captured agents/core/test-utils TypeScript paths unchanged.

## Historical process handoff at the 19:27 checkpoint

Managed supervisor task: `shell_2d3c6425dfcf`, supervisor PID **61784**. It waits for the preceding batch, then runs only pending inventory paths in serial twenty-file batches. It stops after any failed child, missing result or incomplete batch. It never retries a failed test automatically.

At the checkpoint, batch `package-auto-0000` had driver PID **61787**; current child PID **62674** was `packages/agents/src/api/__tests__/fromConfig.behavior.test.ts`. These are point-in-time IDs. Before acting, read `sweep-supervisor.json` and its `currentFilePath` to obtain the exact current PID/file; a child can finish between reads. Do not redo completed batches or use a pattern kill. The previous `package-36-55` driver PID 48986 completed all twenty files and is no longer the active driver.

Supervisor log: `sweep-supervisor.log`. Current supervisor state: `sweep-supervisor.json`. Current batch log: `package-auto-0000-driver.log`. After `fromConfig.behavior.test.ts`, selected files are `fromConfigSkills.behavior.test.ts`, `fromConfigTaskTool.behavior.test.ts`, `generated-core-resolution.test.ts`, hook files, host ownership/approval files and `ide-client-independent.test.ts`. The full pending set, including W11/W17 regressions and all seven test-bun files, remains in the inventory. No heavy gate overlaps the active sweep.

## Verification

Both clusters pass all eight scoped gates. Final `gates-b/` process table:

| Gate | PID | Exit |
| --- | ---: | ---: |
| API surface | 45238 | 0 |
| Declaration build | 45533 | 0 |
| Agents no-emit tsc | 47054 | 0 |
| Agents Bun tsc with installed Bun ambient types | 47326 | 0 |
| Four-path zero-warning ESLint | 47462 | 0 |
| Four-path Prettier | 47691 | 0 |
| Affected graph | 47697 | 0 |
| AST audit | 47831 | 0 |

Core production source is unchanged; no additional core-only tsc was needed. The declaration build compiles workspace declarations. Graph validation is not affected-shard test execution. Carry touched files have zero audit findings. Export retains the same three SELF_CONFIRMING and one DUP_ASSERT notices as the pre-edit audit; line shifts are the only difference. Those assertions test conservation across operations; no new finding or audit-policy suppression was introduced.

## Preserved obstructions and limits

The first twenty attempts failed in the loader, not test bodies, because Bun resolved generated MCP `.d.ts` files as runtime modules. Only that verified ignored directory moved intact to unique `held-generated/` paths, including output recreated by both declaration gates. Ignore/inode/hash records remain; nothing was deleted.

A later final-source run hit ENOSPC while seeding, before the intended fault. The external volume had about 298 MiB free while the system volume had 104 GiB free. No cleanup/truncation was performed. New test HOME/TMPDIR roots are unique under `/private/tmp/llxprt-w22-branch3-20261019-99211/`; raw logs, JUnit and inventories stay workspace-local. All failed loader/disk attempts remain distinct from the green proof. Workspace free space remains variable and must be checked if writes fail.

W22 still requires all 806 completed files, failure-cluster repairs, and native-case accounting, not just a process-green summary. Existing external-model conditions remain untouched; no new skip is allowed. W23 send/planning, W24 whole-product/write-amplification/topology, W25 default/deletion and W26 compression scratch-candidate removal remain separate and required. Review skipped per Andrew 2026-10-09. No OCR, push, merge, cleanup command, `.llxprt/` edit, broad recovery staging, weakened enforcement or backend-default flip.
