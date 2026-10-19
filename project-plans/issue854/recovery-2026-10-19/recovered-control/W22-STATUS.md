# W22 agents sweep status, 2026-10-19

**Two fixture clusters are committed and green. The package sweep is still running; W22 is not done.** At the recorded checkpoint `2026-10-19T19:27:31.440Z`, 66 of 806 files have completed with 621 passing cases, zero current failures and zero skips. Another 740 files have no completed result. The active file is included in that uncompleted count.

## Commits and root causes

- `f0b24926af3eb9286ac7cf4af020427f48b580a1`: carry durability/transaction faults previously targeted JSONL's acknowledgement method even when journal was selected. Baseline was 143 pass/four fail across twenty files. The backend-aware fixture now rejects the actual native candidate trailer write and preserves the original old acknowledgement seam. Both scales and all original conservation/owner/retry assertions remain, plus full-source-consumption witnesses. Final changed tests: four journal passes and four separate old passes. Unchanged journal retaining traps: zero pass/four expected failures.
- `f518c3a7c016b8e99237dc963531413ed7e4742b`: the next batch exposed a prohibited cross-package `core/src` import in session export. The unchanged boundary guard was four pass/one fail. Export now uses the existing agents `withHistoryBackend` helper. Guard: five passes; actual export: one old case and one native equivalent pass. All fifteen assertion ASTs are identical before/after. No guard exemption or production change.

Verified starting HEAD: `b1714cdea75dd297a122b443b853bbe36b1cead5`, branch `issue854`. W21's named closure is retained at its documented boundaries, not counted as W22 execution.

## Inventory and coverage

Actual package scripts run `packages/agents/run-bun-tests.ts` over source and `scripts/run_bun_tests.ts --workspace agents` over test-bun. Their discovery functions produced 799 source files and seven test-bun files, **806 total, no exclusions**. Inventory/status were written before tests.

At the checkpoint, classified cases are 27 native history, 236 journal-selected shared/public and one explicit old export case with its native counterpart RUN. Another 357 passing cases have pending native/shared/old classification. Do not count those 357 as native proof. Four supplemental old carry executions and four expected retaining-trap failures are separate from package totals. Zero current failing package cases does not establish native parity for unclassified or unexecuted files.

Completed results combine per-file source boundaries; this is not a single final-source whole-package run. The first 37-file map has 264 passes. The later twenty-file batch and current automatic batch add actual execution only; their case classification remains pending. `W22-PROOF-MAP.md` maps the first cluster and second-cluster increment.

Raw evidence root: `tmp/854-notes/p4/w22/run-20261019-a/`:

- `inventory.json`, `inventory.txt`, initial `STATUS.md`: full pretest inventory, original hashes and runner settings.
- `current-progress.json`, `current-files-table.md`, `current-not-run.txt`: exact completed case/process census and every pending path at the recorded checkpoint. Refresh with `bun tmp/854-notes/p4/w22/progress.ts`; it reads existing results without rerunning tests.
- `accounting-after-boundary.json`: exact JUnit case titles/classification for the first 37 green files; `export-assertion-proof.json` proves all fifteen original assertion ASTs unchanged.
- Each batch: `selected.json`, `driver.pid`, `current.json`, `pids.jsonl`, `results.json`, per-file logs/JUnit.
- `gates-a/`, `gates-b/`: exact serial gate commands, PIDs and exit codes. `commit-proof.json` matches all four committed code files to tested hashes. `after-boundary-source-comparison.json` confirms all 3317 captured agents/core/test-utils TypeScript paths unchanged.

## Live process handoff

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
