# W22 agents sweep status, 2026-10-19

## Census repaired and checkpoint preserved; W22 remains partial

The frozen census at **2026-10-19T21:36:35.279Z** selects **308 of 806 inventory files: 293 green, 14 red, one unverified and 498 unrun**. Measured results are **2333 passes, 37 failures and zero skips**. Passing-case classification is **88 native history, 258 journal-selected shared/public, 28 explicit old and 1959 classification-pending**. The separate unclassified bucket is zero. Classification includes measured passes in selected red files; journal selection alone does not establish native-history coverage.

There are **433 distinct historical attempts**, **22 historical missing-XML attempts** and **one latest missing file**. The 806-path partition reconciles. Results retain their per-attempt source boundaries and do not establish a final-source whole-package pass. Earlier counts and PIDs in the historical proof map are dated checkpoints, not live state.

`W22-CONTINUATION-PROOF.json` records this checkpoint, every red/unverified file, exact evidence references, source hashes and scoped verification. Frozen raw outputs are under `tmp/854-notes/p4/w22/continuation-run-c/durable-checkpoint-a/`, generation `dacd0f20-8913-4f82-aa77-4ccf0413918e`. All seven copied publication hashes match. The frozen counts file and publication manifest remain separate from advancing live outputs.

## Sweep continues without retries or package source edits

At the census cutoff, supervisor **94663** and driver **25162** were running `package-resume-g-0050`. The 550-path pending-only continuation had completed **52 files: 42 green and ten red/incomplete**, with **498 remaining**. Its first 50-file batch finished 42 green/eight red, 356 passes/26 failures/zero skips. Ordinary red and incomplete attempts do not stop this collection sweep and are not automatically retried. Disk-full, loader and driver-integrity failures remain separate stop conditions.

A process-identity observation at **2026-10-19T21:36:42Z** confirmed the supervisor, driver and child **48284**, with the expected commands and parent chain. The child was running `packages/agents/src/compression/__tests__/middleout-disk-owners.test.ts`, source SHA-256 `08f88ef14da78c782c1366847e7efaf7275102deb5b1fb26eb995edc3716f92f`. Its raw log is `run-20261019-a/package-resume-g-0050/0308-middleout-disk-owners.test.ts.log`, relative to the W22 tmp root. These are timestamped observations; read live identity again before acting.

Live authority remains `tmp/854-notes/p4/w22/run-20261019-a/sweep-supervisor.json` and its `currentFilePath`. Both orchestration entrypoints now use the same evidence-aware runner:

```sh
bun tmp/854-notes/p4/w22/progress.ts
bun tmp/854-notes/p4/w22/instance-run-20261019-a/progress-g.ts
```

Both completed without ENOENT in the earlier delivery check. This checkpoint ran the second entrypoint once, without launching package tests. Do not start another supervisor, restart the inventory or repair package fixtures while this sweep is active. A later product change requires a safe stop and its own verification boundary.

## Current red and unverified files at the frozen checkpoint

Paths below are relative to `packages/agents/src/`. `W22-CONTINUATION-PROOF.json` includes exact failed case names, source hashes, termination details, result references, logs and JUnit paths. Unknown counts remain unknown.

| File                                                               | State      | Pass/fail |   PID | Observed failure and remaining contract work                                                                                                               |
| ------------------------------------------------------------------ | ---------- | --------: | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/__tests__/recording-shared-history-origin.behavior.test.ts`   | Red        |       8/1 | 55296 | Raw marker absence in native bytes cannot establish visible-row rollback. Preserve original old cases and add or reuse native committed-row rollback proof |
| `compression/__tests__/addbatch-pending-window.test.ts`            | Red        |       0/2 | 71576 | Fixture constructs an old recorder for a journal history store; map selected-backend acknowledgement and rollback                                          |
| `compression/__tests__/compression-attempt-estimation.test.ts`     | Red        |       1/1 | 71899 | 8192-row compression publication rejects an empty-block row; preserve both input scales and determine the no-op/publication contract                       |
| `compression/__tests__/compression-attempt-lifecycle.test.ts`      | Red        |       3/2 | 72984 | Large row returns compressed instead of noop; retaining control reaches empty-block rejection                                                              |
| `compression/__tests__/compression-attempt-stream.test.ts`         | Red        |       4/4 | 74633 | Abandoned-cursor success/failure cases at both scales reject empty-block publication                                                                       |
| `compression/__tests__/compression-value-lifetime.test.ts`         | Red        |       0/3 | 94666 | `diskMiddleOut.ts:127` calls missing `previous.close`; preserve cursor/checkpoint lifetime evidence                                                        |
| `compression/__tests__/compression-value-recorder.test.ts`         | Red        |       0/4 | 95480 | Recorder/backend mismatch prevents acknowledgement and compensation proof                                                                                  |
| `compression/__tests__/density-disk-capture-owners.test.ts`        | Red        |       0/1 | 95950 | Decoded-original owner count is zero where the contract requires a positive count                                                                          |
| `compression/__tests__/density-disk-lifecycle.test.ts`             | Red        |       4/1 | 96014 | Transient candidate token-estimate error escapes the expected retry path                                                                                   |
| `compression/__tests__/density-disk-span-order.test.ts`            | Red        |       0/1 | 97194 | Overlapping chronology positions violate removal-before-replacement expectation                                                                            |
| `compression/__tests__/effective-token-count-stream.test.ts`       | Red        |       1/8 | 98322 | Exact token-count differences at 512/8192 rows and policy boundaries                                                                                       |
| `compression/__tests__/highdensity-disk-fallback-rollback.test.ts` | Red        |       0/4 |  5824 | Two recorder/backend mismatches, then failed rather than expected noop at both scales                                                                      |
| `compression/__tests__/highdensity-disk-source.test.ts`            | Red        |       0/4 | 21653 | Fixture requires a JSONL recorder from a journal-selected fixture at line 76                                                                               |
| `compression/__tests__/middleout-disk-lifecycle.test.ts`           | Red        |       7/1 | 45204 | Exact serialized provider-request comparison differs in row property order; preserve expected and actual strings before deciding the contract              |
| `compression/__tests__/middleout-disk-large-request.test.ts`       | Unverified |   Unknown | 25163 | Outer 300000 ms timeout/SIGTERM, raw log contains only the header, no XML or complete summary; driver 0/0 defaults are not measurements                    |

The selected next repair is the shared-history-origin rollback fixture. The next protocol cluster is recorder/backend selection in pending-window, compression-value-recorder and highdensity fallback/source, followed by cursor-close and empty-block publication. Other red token, owner, span-order and request-byte contracts stay open. No assertions, scales, limits, timeouts or skips may be weakened to conceal these failures. The incomplete large-request attempt needs no automatic retry or fatal sweep stop.

## Missing admission evidence is retained separately from later passes

The original progress script unconditionally opened the missing admission XML and ended its accepted batch order before later repairs. The shared runner now preserves all attempts, applies the explicit accepted progress-layer order and keeps the latest accepted attempt even when unverified. It does not fall back silently to an earlier pass.

Original admission PID **98836**, driver **97143**, in `package-auto-0060` has source SHA-256 `be4a05833e5c8b5315e8da6adf12ef1eac783436c862365c134dd573651e2446`. Its raw log records a first-case 180000 ms timeout; the outer 300000 ms termination is SIGTERM with null exit. The XML and complete raw summary are absent, so measured counts remain null. No deletion or overwrite is established.

Selected later admission PID **19211** in `finalizer-run-final-journal-a` has valid XML and three passes, zero failures/skips, at source SHA-256 `c219c66619201501571f01753e15c23c8b1dfa0202b96c2055dfafacddcc0789`. This is a distinct repaired source boundary. `finalizer-run-restored-journal-a` contains only `recording-finalizer-join.behavior.test.ts`, PID **24041**, eleven passes, source SHA-256 `36dcf04977f8c01909781918fa4fc5232b833281e060b25f136a56d4ae1a726d`; it does not contain admission. No missing-result rerun is required.

## Scoped orchestration verification and earlier product proof

The three new `w22-census*.ts` files pass **seven Bun tests with 52 assertions**, strict scoped no-emit TypeScript with unused-symbol checks, explicit `--no-ignore --max-warnings 0` ESLint and explicit Prettier checks. Exact commands and logs are in `W22-CONTINUATION-PROOF.json`. ESLint uses the unchanged repository configuration: these recovery paths receive base recommended rules, including no-any/no-unused-vars, but no max-lines rule. Package/scripts lint scopes and heavy package gates are not claimed for this run. No code changes were needed after those checks.

The source comparison at **2026-10-19T21:30:29.779Z** checked all **3321** entries in `instance-run-20261019-a/full-final-source-hashes-c.json`, with zero mismatches. Discovery independently reconciled **799 src plus seven shared files = 806**, with no added, missing or duplicate paths. Both receipts are in `continuation-run-c/`; neither scan was repeated during this checkpoint. The readonly before-snapshot SHA-256 remains `61780e2313d471bf6acf26568a53306ddfa1b17d90245d4b6193c93dad1029fc`.

Earlier product proof remains at its recorded boundaries:

| Commit                                     | Scope                                                                                                               | Earlier verification                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `bc46927e653921afcb5d4b6a9fb2d22e55ecba28` | Preserve original adopted-instance JSONL contract; add native public resume/replacement/continued-turn/reopen proof | Four isolated files under both outer backends, 86 passes total, zero failures/skips; eight scoped gates |
| `75fe4c8a4402e37d415c121c6eac14a6593c326b` | Publish seven existing core runtime subpaths needed by Node agents                                                  | Six isolated files under both outer backends, 94 passes total, zero failures/skips; nine scoped gates   |

`W22-INSTANCE-PROOF.json`, `W22-FINALIZER-PROOF.json`, `W22-FACADE-PROOF.json` and the dated historical proof map retain the detailed contracts. Future product/fixture repairs still require both backend matrices, declaration/build types, agents tsc/Bun types, scoped lint/Prettier, affected graph and audit at a safe stop. Those gates did not run anew for this orchestration change.

W22 remains partial. W23-W26 stay open, the old backend default stays, and there is no 802 reset. W26 scratch-candidate removal remains required within the PR. No package source/test edit, duplicate test launch, retry, cleanup, deletion, process kill, `.llxprt/` edit, default flip, check weakening, push or merge occurred. Unrelated recovery files and the pre-existing memory-file change remain untouched. Review skipped per Andrew 2026-10-09.
