## CI fix local acceptance (2026-10-02)

Both **Blocker-Fix** findings are resolved locally. CLI and agents bind runner env at the original evaluation point; child spawn env and every isolation assertion remain unchanged. Real children prove session HOME/TMPDIR delivery, invalid supplied child budgets do not control runner deadlines, runner-env changes are read on each call, and invalid runner configuration rejects before a child writes its marker. CLI also verifies the complete runner environment is preserved.

The core fixture now relocates imports through JSON-escaped native module paths. Real-child quote-path loading failed before the fix and passes afterward. A separate raw Windows-path probe captures startup stderr showing backslashes stripped and escape sequences interpreted in the module name. Both real-child batch/retry/FATAL cases remain active with unchanged deadlines and assertions; startup failures now expose captured stderr before reading attempt markers. Windows runtime acceptance awaits candidate-head CI.

Final local format, lint, typecheck, unfiltered workspace tests, build, existing `gpt-6-luna` smoke, coverage guard and audit all exit 0. Core passes 460/460 files; CLI passes 764/764 with 9813 cases passed. Independent full scripts verification passes 300/300 scripts files plus the test-audit suite. Focused coverage runs pass core 35 (one existing skip), CLI 81 and agents 7; auth passes 12; unchanged isolation suites pass 147; focused scripts pass 10/10 files. Coverage artifacts document platform-specific limits; no combined 100% claim is made. Audit comparison has 2106 baseline and candidate findings, with no added or removed findings after normalizing line-number shifts. The existing CLI determinism finding remains.

Evidence is under `tmp/verify3442/ci-fix/`, particularly `scripts-final.log/.exit`, `restored/`, `final/`, red logs, the Windows-path stderr probe and audit comparisons. The actual verified code/config fingerprint is `062caf3290a4d8bf3a133603ea1d884bf58c30bc70cd9828aadb7192040572d3`; post-gate sorted hashes match. Only this reporting prose follows verification.

Earlier failed attempts remain recorded. Already-declared optional plugin dependencies were restored without manifest or lock edits. Copied read-only evidence-directory cleanup failed (#3805); original directory permissions were restored after all copy-based tests. A subsequent npm cache-lock failure (#3806) and unchanged-source storage lock timeout (#3807) each recover in complete unfiltered reruns with no assertion, deadline, concurrency or product-source changes. These separate findings are not repairs included in this candidate. Literal `luna` remains absent; only the explicitly requested existing replacement smoke is claimed.

No new reviewers or OCR were invoked. No workflow, quality enforcement, public abstraction, profile, dependency declaration or protected memory changes were made. Latest fetched main remains `f3839b8810496490f4eaf8513c27e12bd7952809`, an ancestor, and read-only merge-tree reports no conflicts. Commit and authorized SSH push follow these local gates; final candidate-head checks and threads will be reported after publication. No merge.

## CI fix mission (2026-10-02)

Both publication failures are **Blocker-Fix**. The scripts isolation guard rejects the new literal runner-config env inputs in CLI and agents, although child spawns use the session env. Keep all guard assertions unchanged and bind runner env at the original call time. Behavior tests must distinguish runner budgets from child env and prove session HOME reaches real children.

The Windows core batch fixture interpolates native module paths into quoted TypeScript imports without escaping. First reproduce the escaping failure with a real child loading a module through a quote-containing path and retain its stderr. Use one private test-fixture relocation function with JSON-escaped module specifiers. Keep both real-child batch retry/FATAL cases, assertions and deadlines unchanged.

Sequence: record isolation red; add portable-path and runner/child-env behavior proof; record fixture red; apply only runner integration and test-fixture fixes; run independent focused suites, unchanged isolation suites and the full scripts shard. Complete format, lint, typecheck, workspace tests, build, existing `gpt-6-luna` smoke, coverage and audit. Fingerprint the verified candidate before exact-scope commit and authorized SSH push. Watch final-head CI to completion, triage evidence-backed review threads and verify latest main ancestry and merge conflicts. No new reviews, OCR, profile, workflow, dependency, quality-rule or public API changes. No merge.

## Publication handoff (2026-10-02)

The initial independent review and findings-only follow-up are complete with PASS. Both TypeScript include findings are resolved without weakening enforcement. The two-cycle review cap is reached; no further reviewer or OCR run is authorized. Follow-up proof is in `tmp/verify3442/followup/`.

Review disposition: **Blocker-Fix resolved** for the three core runner include entries; **In-scope-Fix resolved** for the two scripts retry-suite include entries and this reporting correction; **Reject** unrelated product changes for base-reproduced failures; **Defer** Windows execution and unavailable full mutation tooling as evidence limits. Literal `luna` remains absent, while the existing `gpt-6-luna` smoke passes twice. No profile repair or extra approval gate is required for publication.

The remediation focused run has 238 cases in 10 passing suites: 17 + 28 + 23 + 14 + 3 + 76 + 9 + 12 + 7 + 49. The earlier correction run has 247: its tenth suite has 16 cases instead of the remediation subprocess suite's 7. Historical counts below are retained where supported by their own logs.

Commit, issue-branch push and PR creation are explicitly authorized; merging is not. Latest main fetched through `git@github-acoliver:vybestack/llxprt-code.git` remains `f3839b8810496490f4eaf8513c27e12bd7952809`, the candidate base. GitHub identity is verified as `acoliver`. Only issue-plan prose changes after the completed code verification; production/config fingerprint remains `7f89ef388d47871e4dc7566d3fede7caf0a83fa0d9234bbd128a3baabea1222c`. Candidate-head CI and PR review-thread triage will be reported on GitHub after publication; no green-CI or merge-ready claim is made here.

The dated sections below describe their recorded stages, not current publication restrictions.

## Remediation completion (2026-10-02)

Both initial findings are resolved: the core runner config includes the three migrated modules, and the scripts config includes both new retry suites. These are in-scope include additions, with every compiler flag unchanged. No separate approval gate applies.

After installing the already-declared optional Gemini plugin dependencies without manifest or lock edits, `npm run format`, `npm run lint`, `npm run typecheck`, the full `npm run test`, `npm run build`, the coverage guard and the exact audit comparison all exit 0. All 17 workspace commands finish; core passes 460/460 files and CLI passes 764/764 with 9812 cases and no failures. All runner meta suites and 238 focused scripts cases in 10 passing suites pass. The earlier SessionDiscovery timeout recovers on retry in the first remediation run and is absent from the completed restored-environment run.

The exact named `luna` smoke remains failed because that profile is absent in the actual user config root. The existing `gpt-6-luna` profile passes the haiku request twice. No profile/settings/credential configuration or `.llxprt` edits were made. This supplemental smoke does not replace the failed named-profile gate.

[REMEDIATION-RESULTS.md](./REMEDIATION-RESULTS.md) records exact commands, individual exits, environment preparation, unchanged enforcement, immutable candidate fingerprints and remaining evidence limits. Evidence is in `tmp/verify3442/remediation/`; all code/config snapshots share SHA-256 `7f89ef388d47871e4dc7566d3fede7caf0a83fa0d9234bbd128a3baabea1222c`. HEAD remains the recorded base. No review, OCR, commit, push or PR was performed. The sections below retain the earlier execution history; their failed gate results are superseded only where the remediation results explicitly record a later pass.

## Preservation correction (2026-10-01)

The shared runner's timeout-retry budget now matches the base ordering and env source: resolve once per file from runner `process.env` before the first attempt. Invalid values reject before attempt side effects; a first attempt cannot alter the selected budget. The issue's no-behavior-change acceptance governs the mistaken intake timing description. The helper correction, archived-base characterization, candidate red/green proof, focused verification and failure comparisons are documented in [CORRECTION-RESULTS.md](./CORRECTION-RESULTS.md).

Evidence is retained under `tmp/verify3442/correction-20261001/`. The timing/policy run is green with 79 passing cases after three recorded red failures; all three adapter characterization cases pass on base. Scripts suites pass 10/10 isolated files, all four workspace meta/behavior suites pass, scoped lint passes, and the audit findings TSV is identical to the successful clean-base baseline. The full `npm run test` command completed with exit 1 after all 17 workspace commands finished. Core passed 459/460 files and CLI passed 762/764; all three failed files reproduce failures on the archived base. The runner and scripts TypeScript include omissions are corrected by the in-scope configuration integration. Current verification and profile investigation are recorded in the remediation section. The earlier execution section below retains its historical verification attempts; the correction results document records the subsequent completed checks.

## Implementation execution (2026-10-01)

The authorized five-runner migration is implemented. No commit, push, OCR, dependency/configuration change, quality-rule change, or agent-memory change was made. The earlier intake and policy-only observations below are history, not the current completion status. Installed dependencies were restored by the parent assignment with `bun install --no-save`; the successful audit baseline is `tmp/verify3442/scan-base`.

All five execution paths call `scripts/lib/bun-test-retry.ts`. Local retry bodies, CLI kill/output/report bodies, core bounded reap/cleanup/scan/report bodies, agents report extraction/aggregation, auth report construction, and the shared script's retry loop/summary classification have been removed from their adapters. The entry point exposes the existing reaper and reporting modules, which import no workspace runner. Original exported helper signatures remain available through forwarding functions or module re-exports. Discovery, argv, scheduling, stream handling, isolation boundaries, cleanup-result/rejection coordination, and terminal/FATAL decisions remain in their original runners.

Core and auth keep fixed per-test defaults when selecting a file budget. CLI's per-test-only projection uses an empty env so it does not start validating file-timeout configuration. Agents still select the file budget from runner env, not child env. The timeout-budget selector ends with a checked `never` variant and throws rather than supplying a default for an unreachable variant. Moved Windows taskkill handling was split into private operations to meet existing function-length/complexity rules; no rule was relaxed. New TypeScript/Bun tests remain discoverable by the existing root table.

### Test-first and behavioral evidence

Evidence root: `tmp/verify3442/migration/`.

- `pre-policy.log` and `pre-{cli,agents,core,auth}.log` record passing original suites. `characterize.ts` captured full original CLI/core/auth/shared XML documents in `{cli,core,auth,shared}.xml` before extraction. Those documents are literal expected values in the new behavior suite. `agents-document-baseline.log` additionally proves complete agents nested/malformed/missing-report output equals the base implementation, including double edge newlines.
- `red-policy.log`: 44 passed and 11 failed against the prior worker's policy implementation. Failures established the core budget, ordinary-failure classification, and completed-summary word boundaries/singular test. The after-first env timing expectation in that historical run was based on a mistaken intake description and is superseded by the base-source characterization and timing correction below. `red-mechanical-report.log` records the absent shared report/reap API failure after fixture syntax was corrected. The expanded real behavior suite became green in `green-policy.log` (77 cases), and the CLI kill case subsequently moved intact into the existing reaper suite to satisfy the unchanged 800-line limit. No old assertion was removed or weakened.
- The new suite now has 76 cases. Its input matrices cover timer/code combinations, core spawn/report boundaries, signal-summary boundaries, and retry sequence/budget combinations. Fast-check cases cover generated positive overrides, scaling/floor boundaries, fixed attempt sequences, and absolute assertion retry bounds. Invalid parser inputs, callback rejection, first-reap reduction, non-timeout cleanup failure, real child close, scoped cleanup, and complete report documents are also exercised. Matrix and generated boundary cases exceed the plan's 30% requirement.
- `core-final-flags.log` and `coverage-core.log` execute the real core main in a relocated fixture workspace with the existing OS reap seam. Both cases kill and await the real timed-out child before forcing a reap error. First-reap recovery runs the later batch, keeps the recovered file failed, and reports two collected cases. Persistent final reap failure prints FATAL, suppresses the later batch, and reports one collected case. `base-core-characterization-final.log` proves these same main/signal contracts on the base source (3 cases passed). The earlier relocated baseline probe's missing-preload failure was a probe setup error; it was corrected without changing production.
- `signal-{cli,agents,core}.log` exercise real self-SIGTERM children and prove those adapters fail once without a timer retry; auth's existing real-signal case remains passing. `bun-test-policy.bun.test.ts` now checks that all four fixed retry adapters ignore both zero and invalid shared-retry env values while retaining exact logs and payloads.
- The final five meta suites and related scripts policy/reaper/JUnit/setup/session/subprocess cases all pass. Workspace suites were run independently with normal workspace preloads. A CLI real-retry run failed under concurrent full lint; the later runtime-build-isolated suite and coverage run pass unchanged. A subsequent CLI import failure occurred after declaration-only build output lacked runtime JS; full runtime build restored it. These failed attempts are retained rather than labeled baseline regressions.
- `negative/` contains isolated copies, not edits to production. Deliberately breaking timeout priority, core reduction, complete-summary acceptance, and report totals produced respectively 4, 2, 4, and 3 failing cases. All four selected defects were caught. This is targeted negative evidence, not a repository-wide mutation score. No existing Stryker configuration/tool was found, and no mutation dependency/configuration was installed.

### Command statuses

All paths below are relative to the evidence root. Commands ran from the repository root except independent workspace meta suites.

| Gate | Completed result | Evidence |
| --- | --- | --- |
| `npm run format` | Exit 0, including final documentation formatting | `final-format.log`, later `handoff-format.log` |
| `npm run lint` | Exit 0 after runtime build and scoped fixes; the initial attempt failed on scoped and unrelated unresolved-type diagnostics | `handoff-lint.log`; earlier `full-lint.log` |
| Scoped ESLint, all changed TypeScript paths | Exit 0 with original enforcement | `scoped-lint-complete.log` |
| `npm run typecheck` including `build:types` prerequisite | Exit 2; only three new TS6307 dependency-list diagnostics remain | `final-typecheck.log` |
| Supplemental strict scripts config plus new suite | Exit 0, zero diagnostics; does not replace the failed required gate | `scoped-typecheck-handoff.log` |
| Base isolated composite core runner typecheck | Exit 0; relocation-only import/preload/config paths | `base-core-typecheck.log` |
| Current `tsc --project packages/core/tsconfig.runner.json` | Exit 2, same three TS6307 errors | `candidate-core-typecheck.log` |
| CLI meta, with coverage | Exit 0, 80 passed | `coverage-cli.log` |
| Agents meta, with coverage | Exit 0, 7 passed, including runner-env versus child-env budget selection | `coverage-agents-final.log` |
| Core meta, with coverage | Exit 0, 34 passed, 1 existing Windows-only skip | `coverage-core.log` |
| Auth meta, with coverage | Exit 0, 12 passed | `coverage-auth.log` |
| Scripts meta/policy/reaper/retry/report/setup/session/subprocess | Exit 0, 218 passed across 8 files, including core/auth ignored file-env boundaries | `coverage-scripts-final.log` |
| `npm run test` | Interrupted after failures were observed, including core 400/460 files passed, 60 failed; no completed exit code or successful full-suite claim | `full-test.log`, `full-test.interrupted.txt` |
| `npm run build` | Exit 0 | `final-build.log` |
| `bun scripts/start.ts --profile-load luna "write me a haiku and nothing else"` | Exit 1: Profile 'luna' not found | `final-smoke.log` |
| `bun scripts/check-test-file-coverage.ts` | Exit 0: zero uncovered and zero doubly-executed | `test-file-coverage-handoff.log` |
| Audit candidate and exact TSV baseline comparison | Both exit 0; findings TSV identical to successful baseline | `audit-handoff.log`, `audit-handoff.diff`, `scan-handoff/` |
| Four isolated deliberate-negative runs | Each exits 1 with behavioral failures; harness exits 0 | `negative.log`, `negative/*/result.log` |

Coverage artifacts are in `coverage/` and `coverage-{cli,agents,core,auth}/`. The scripts run reports retry policy 100% functions / 99.43% lines. Report and reaper line coverage from that lane alone is lower because CLI helpers/core lifecycle are exercised by independent workspace suites and Windows operations are not executed on macOS. No 100% combined coverage or Windows certification is claimed. The audit findings match the baseline exactly, including line numbers; there are no new flagged touched-test findings.

### Remaining scope and environment blockers

The migration introduces imports of `bun-test-retry.ts`, `bun-test-reaper.ts`, and `junit-report-writer.ts` into core's composite runner project. Its three required include entries and both new scripts retry-suite entries are now added. These are in-scope TypeScript integration requirements, not enforcement changes or baseline errors. No separate approval is required, and no compiler flag or enforcement rule is changed.

Issue acceptance requires behavior preservation. Direct inspection of `git show f3839b8:scripts/run_bun_tests.ts` and the entire base retry helper establishes that the shared runner resolves the budget before its first attempt, once per file, using runner `process.env`. The earlier intake description was mistaken. The timing correction preserves the base behavior; it does not add behavior or require a scope approval. Base characterization and candidate red/green evidence are recorded in `tmp/verify3442/correction-20261001/`.

The prescribed smoke profile is absent in the current environment. No profile/settings/memory repair was attempted. The complete fresh full workspace command now exits 1 after all workspaces finish: core 459/460, with the original-base SessionDiscovery deadline failure, and CLI 762/764, with 12 original-base optional-Gemini prerequisite failures. All other workspace commands pass. Controlled base fixtures reproduce the earlier missing runtime-JS errors and pass after supplying complete artifacts; those failures are absent from the fresh run. Original-base comparison of all 60 historically failed core files completes 58/60, with SessionDiscovery and media handoff timeouts; the media case passes in the fresh candidate run. See [CORRECTION-RESULTS.md](./CORRECTION-RESULTS.md) for exact evidence and issue links. The recording slowdown's underlying cause remains unproved. Windows taskkill/locked-handle execution and a supported full mutation gate also remain unverified. OCR remains disabled.

# Issue #3442: Share runner policy without changing runner behavior

Plan ID: PLAN-20261001-ISSUE3442
Date: 2026-10-01
Issue: https://github.com/vybestack/llxprt-code/issues/3442
Status: initial findings resolved; independent review and findings follow-up PASS; local code gates pass; existing gpt-6-luna smoke passes twice, literal luna absent; publication authorized, CI not yet claimed
Branch: `issue3442`
Base: `f3839b8810496490f4eaf8513c27e12bd7952809`
Evidence directory: `tmp/verify3442/intake-20261001-1jdxet0B/`

## Recommendation and accepted scope

Extend the existing internal `scripts/lib/bun-test-retry.ts` into the policy entry point used by all five runners. It should own retry decisions, timeout classification and budget selection, and core's retry-result reduction. Reuse `bun-test-policy.ts` for existing defaults/concurrency, `bun-test-reaper.ts` for mechanical kill/reap operations, and `junit-report-writer.ts` for report construction. Move the relevant implementations into these existing files rather than adding a runner framework or a second policy implementation.

The adapters keep discovery, scheduling, argv construction, workspace paths, preloads, tsconfig selection, stream handling, session isolation, and final process exit. Those are observed differences, not opportunities to standardize behavior. Policy helpers must be called from the existing execution paths; imports or re-exports alone do not satisfy the issue.

The initial intake task created only this plan. The subsequent implementation assignment authorizes the code/test edit set below; dependency, workflow, quality-tool, `.llxprt/`, and agent-memory changes remain prohibited. No commit or push is made. OCR remains disabled.

## Intake evidence and preflight state

Read `AGENTS.md`, `dev-docs/RULES.md`, `dev-docs/PLAN.md`, the planning template and coordination guide, and `project-plans/issue3439/PLAN.md`. The behavior below is taken from the current source, including changes since #3439, rather than assuming the older plan describes today's runners.

Initial `git status --short --branch` showed clean `main`. GitHub identity was verified as `acoliver`. Main was updated with `git fetch git@github-acoliver:vybestack/llxprt-code.git main` and `git merge --ff-only FETCH_HEAD`, without changing remotes or global authentication. The fetched main was already at the base above.

Before branch creation or plan creation, ran:

```text
bun scripts/test-audit/scan.ts tmp/verify3442/intake-20261001-1jdxet0B/scan-main
```

It exited 1 at `scripts/test-audit/scan.ts:413`, with `TypeError: undefined is not an object (evaluating 'ts.ScriptKind.TS')`. A read-only import probe resolved TypeScript to `/Users/acoliver/.bun/install/cache/typescript@7.0.2@@@1/lib/version.cjs`, with `version: 7.0.2` and `ScriptKind: undefined`. Root `package.json` specifies a TypeScript 5.8.3 override. No audit TSV baseline was produced. Raw log and exit are `audit-main.log` and `audit-main.exit`; `base-sha.txt` records the clean-main SHA.

Then created `issue3442`. With code still identical to the base, attempted the following existing suites. Each command exited 1 during preload/module loading because `env-paths` could not be found from `packages/storage/src/config/path-resolver.ts`. No behavioral cases passed or ran to completion; these are environment failures, not demonstrated runner regressions.

| Command, from root unless noted | Evidence log | Exit |
| --- | --- | --- |
| `bun test scripts/tests/bun-test-policy.bun.test.ts scripts/tests/bun-test-reaper.bun.test.ts` | `policy-reaper.log` | 1 |
| `bun test scripts/tests/run_bun_tests.test.ts scripts/tests/run_bun_tests.global-setup.test.ts scripts/tests/bun-junit-to-json-report.test.ts` | `shared-retry-junit.log` | 1 |
| In `packages/cli`: `bun test ./test/run-bun-tests.test.ts` | `cli-meta.log` | 1 |
| In `packages/core`: `bun test ./test/run-bun-tests.test.ts` | `core-meta.log` | 1 |
| In `packages/agents`: `bun test ./test-bun/run-bun-tests.issue3253.bun.ts` | `agents-meta.log` | 1 |
| In `packages/auth`: `bun test ./src/__tests__/run-bun-tests.behavior.test.ts` | `auth-meta.log` | 1 |
| `bun scripts/check-test-file-coverage.ts` | `test-file-coverage.log` | 0 |

The coverage guard reported zero uncovered and zero doubly-executed files. Statuses are retained in `tests.exit.tsv`. Bun is 1.3.14 on macOS arm64. Installation failures were reported separately in [#3789](https://github.com/vybestack/llxprt-code/issues/3789); no install, guard bypass, or repair was attempted.

The full AGENTS completion cycle was not run for this intake. In particular, repository-wide `npm run format` writes files and must not introduce unrelated changes. A scoped Markdown formatting check was unavailable because `node_modules/.bin/prettier` is missing; no tool was installed. Git whitespace checks found no diagnostics. Full lint/typecheck/test/build/smoke verification is required during a later implementation task. The current smoke profile is `luna`, not the older profiles in the workflow documentation.

## Current behavior matrix

Shared constants in `scripts/lib/bun-test-policy.ts` are 180,000 ms per test and 300,000 ms per file. Existing concurrency and override parsing remain unchanged.

| Boundary | CLI | Agents | Core | Auth | Shared script |
| --- | --- | --- | --- | --- | --- |
| Invocation and discovery | `src`, `test`, `test-bun`, `test-utils`; `.test`, `.spec`, `.bun`; relative normalized paths; partition after full discovery | `src`; `.test`/`.spec`; absolute discovery mapped to relative execution | `src`, `test`; `.test`/`.spec` | `src`; `.test`/`.spec` | `resolveBunTestFiles` root table; filters/exclusions/dry-run unchanged |
| Scheduler | Sliding workers; CLI flag/env concurrency | Sliding workers; shared cap 4 | Fixed batches; default cap Windows 1, otherwise 2 | Sliding workers | Serial files |
| Child cwd and streams | `process.cwd()`; stdout/stderr captured into combined output | Workspace root; inherit stdio | Workspace root; ignore stdin, inherit stdout/stderr | Workspace root; inherit stdio | Entry cwd; inherit stdin; pipe stdout/stderr, production spawn also streams them live |
| Per-test budget | 180,000; `.integration.(test\|spec).tsx?` gets 360,000 | 180,000 | 180,000 | 180,000 | Entry timeout wins over CLI timeout; CLI default 180,000 |
| Whole-file budget | 300,000 or positive `LLXPRT_TEST_FILE_TIMEOUT_MS`; integration stays 900,000 even with override | 300,000 or same env override, read from runner `process.env` | `options.timeoutMs` or 300,000; no file-timeout env override | Fixed 300,000; no file-timeout env override | `max(120,000, 2 * effective per-test timeout)`; no file-timeout env override |
| Timeout detection | Runner timer only | Runner timer only | Timer, or nonzero close plus exact Bun JUnit `<failure type="TimeoutError"` marker; per-test origin has `timeoutMs: null` | Runner timer only | SIGTERM/SIGKILL and not accepted as completed success; manual signals also match |
| Ordinary failure retries | None | None | None | None | Opt-in `entry.retries`; absent means zero |
| Timeout retry budget | Exactly one, not env-configurable | Exactly one, not env-configurable | Exactly one, including per-test timeouts and first-attempt reap failure | Exactly one, not env-configurable | Defaults to one; `LLXPRT_BUN_TEST_TIMEOUT_RETRIES` applies only here |
| Settlement event | `exit`, or spawn `error`; timeout forces `exitCode: null` | `close`, or spawn `error`; retains observed code and signal even on timeout | `close`, or bounded reap failure, followed by attempt cleanup; scan errors reject after cleanup | `exit`, or spawn `error`; timeout forces code and signal to null | Production spawn waits for `close`, or rejects on spawn error |
| Timeout kill/reap | POSIX group SIGKILL, fallback direct child on any group-kill exception; Windows direct child; no bounded close wait | `killRunnerChild`: POSIX group, Windows synchronous taskkill then fallback; no bounded close wait | Bounded tree kill and close; Windows asynchronous taskkill and killer-close handling; POSIX ESRCH tolerated | Same kill helper as agents; no separate reap result | Same kill helper as agents; startup stale-orphan reap also exists |
| Timeout then passing retry | Return second attempt, pass | Return second attempt, pass | Pass if first reap was clean; first reap failure plus clean second attempt stays failed/timedOut but clears final `reapFailed` and keeps first error | Return second attempt, pass | Return last attempt, pass |
| Final reap/cleanup failure | No core-style flag or FATAL | No core-style flag or FATAL | Returned `reapFailed` aborts after the current batch; first-attempt failure alone does not abort if retry clears it | No core-style flag or FATAL | No core-style flag or FATAL |
| JUnit | One file testcase inside `cli` suite; output excerpt on ordinary failure | Merge child suite bodies and root tallies; synthetic failed suite if no usable report | One file testcase inside `core` suite; timeout/reap labels; count only collected results | One file testcase inside `auth` suite; signal-aware reason | `--junit`: one suite/case per file; `--json-report`: child JUnit detail converted/reconciled separately |

### Retry details that must survive extraction

- CLI/agents/auth log exactly `RETRY (2/2): ${file} after per-file timeout`. Core uses `per-test` when the first result's `timeoutMs` is null; otherwise `per-file`.
- Four bespoke runners do not read `LLXPRT_BUN_TEST_TIMEOUT_RETRIES`. Setting it to 0 or to an invalid string must not disable their one retry or fail their configuration.
- The shared runner logs exactly `Native Bun test timed out (attempt N), retrying: FILEDIAGNOSTIC` or `Native Bun test failed (attempt N/M), retrying: FILEDIAGNOSTIC`. Terminal failure remains `Native Bun test failed: FILEDIAGNOSTIC`.
- Shared timeout retries are selected before ordinary failure retries. Its ordinary budget is an absolute attempt bound (`failureAttempts = entry.retries + 1`), not a separately decremented counter. A timeout retry increments the same attempt number. With failure retries 2 and timeout retries 1, timeout then two assertion failures stops at attempt 3, not attempt 4. An assertion failure at attempt 1 followed by timeout at attempt 2 can consume the remaining timeout retry to reach attempt 3.
- Shared success is exit code 0, or SIGTERM/SIGKILL with both `0 fail` and `Ran N tests` in combined stdout/stderr. Partial pass lines, either summary component alone, or another signal are not enough. Other runners must not inherit this success exception.
- Shared timeout retry resolution currently occurs before the first attempt, once per file, against runner `process.env`, not `dependencies.environment`. Preserve that timing/source and existing validation messages. Its parser uses `Number`, unlike the positive-digit/safe-integer file-timeout parser. No stricter parser is part of this refactor.
- Core merge uses the second attempt's other fields, including `exitCode` and `timeoutMs`; it does not restore the first timeout budget. If first `reapFailed` and second does not, overwrite only `passed: false`, `timedOut: true`, `reapFailed: false`, `reapError: first.reapError ?? null`.
- Core cleanup failure can coexist with `passed: true` on an otherwise passing attempt. Main's `reapFailed` check makes the run fail. Do not globally redefine result `passed` or make a non-timeout cleanup failure retryable.
- Retry callbacks that reject are propagated by bespoke wrappers. The shared runner's single-spawn adapter catches spawn exceptions into ordinary failure outcomes, so opt-in failure retries can apply. Keep these error boundaries.

### Reap, cleanup, and report boundaries

Core uses 10,000 ms default reap and taskkill bounds. A nonzero taskkill exit is acceptable if child close is observed; taskkill timeout terminates and awaits the killer itself, preserving errors. POSIX group ESRCH is acceptable; other errors propagate into the reap result. Attempt directory removal retries only EBUSY, EPERM, EACCES, ENOTEMPTY, with defaults of three attempts and 100 ms delay. Cleanup after report-scan failure preserves the original rejection, or ordered scan/cleanup errors in an AggregateError. These operations remain scoped to that attempt directory.

Startup stale-orphan reaping belongs only to the shared script's `main`, including before dry-run. It requires independent `ps comm` identity and argv checks, PPID 1, and not the runner PID. It sends SIGTERM, tolerates ps/kill races, and preserves its existing diagnostic. Do not add startup reap to bespoke runners or broaden candidates. Shared `runBunTests` itself currently does not call the startup reaper.

All runners already use child tracking, cancellation, fake HOME/TMPDIR/XDG session environments, and real-home sentinel checks from #3622. Leave this lifecycle in place. A retry remains inside the existing isolation `runFile` boundary; it must not create a new session or finalize a session between attempts. CLI's timeout notification/terminal `process.exit` flag and core's FATAL/terminal exit flag remain unchanged.

For JUnit, preserve suite/case names, attributes, ordering, numeric totals, indentation, XML declaration spelling, failure message/body, control-character handling, and trailing-newline behavior. CLI strips forbidden controls, removes ANSI from failure output, and applies its existing 4,000-character report excerpt; auth/core do ordinary XML escaping. Agents splice existing child bodies and tally root `tests/failures/skipped`, synthesizing when unreadable or unusable. Agents remove the report before each attempt and keep the final attempt's report. Core creates a fresh per-attempt scan report and deletes it before returning. Shared JSON staging and per-file reconciliation remain distinct from its coarse `--junit` report. Do not replace all of these with the same summary or change JSON aggregation.

## Acceptance criteria and behavioral evidence

| ID | Input/boundary | Required observable result | Existing evidence and additions needed |
| --- | --- | --- | --- |
| REQ-3442-01 | Each existing runner entry point and per-file retry path | Uses policy decision/execution code; old local retry decisions removed; discovery/scheduling/argv/session/exit behavior unchanged | Existing runner invariant tests plus each runner's behavioral suite; source-import guard is supplemental only |
| REQ-3442-02 | Pass, assertion failure, timer timeout, external signal, spawn error, mixed retry sequences | Matrix pass/fail classification, exact attempt count, exact diagnostic lines; no third attempt for bespoke runners | CLI/auth/agents/core retry suites and shared `runBunTests`/`isChildSuccess`/`planNextAttempt`; add mixed-budget and cross-runner signal cases |
| REQ-3442-03 | Integration/unit path, effective timeout, env override absent/valid/invalid, shared retry env 0/invalid | Same effective per-test/file budgets and parser/error/source/timing contracts; explicit child `--timeout` | CLI timeout and env tests, policy tests, shared `processTimeoutFor`/argv tests; add fixed-runner retry-env non-consumption and core/auth file-env non-consumption |
| REQ-3442-04 | Core file/per-test timeout; first/final reap failure; cleanup lock and report-scan error | Retry first timeout even if reap fails; exact merged result on recovery; only final returned reap flag aborts; bounded cleanup/error preservation | Core lifecycle, retry, scan, cleanup, and scan-failure settlement tests; add integrated collected-result/FATAL/continuation proof |
| REQ-3442-05 | Real child holds pipes; timeout kills child tree; startup ps snapshots | Existing settlement event per runner; no early completion for close-waiting runners; existing kill variants; no wider startup-reap ownership | Core pipe/group tests, agents real retry/JUnit tests, CLI real retry/callback tests, auth real SIGTERM test, reaper snapshots; add adapter-to-helper lifecycle composition evidence |
| REQ-3442-06 | Mixed passed/failed/timedOut/signaled/reapFailed results; nested child reports; missing/malformed report | Exact runner-specific XML and final report paths; collected-results core count; detail preserved in agents/JSON | Core/auth report tests, CLI XML helpers, agents final-attempt report tests, JUnit converter/reconciliation tests; add full-document fixtures for all report modes |
| REQ-3442-07 | All discovered repository test files | Coverage guard stays zero uncovered and zero doubly-executed; new policy tests are reachable via existing scripts root | `bun scripts/check-test-file-coverage.ts` passed on intake; no root/shard table edits needed |
| REQ-3442-08 | Newly added/modified tests and finished extraction | Genuine red-to-green evidence for preserved behavior in the extracted policy, unchanged valid old assertions, no new false-green audit findings, full verification passes | Audit blocked by #3789; rerun clean-base baseline before implementation and compare candidate TSVs; OCR disabled |

Existing evidence sources read for this intake:

- `packages/cli/test/run-bun-tests.test.ts`: discovery/partition, timeout/path/budget, output/escaping, retry and real timeout child/callback cases. It imports formatting helpers but does not directly cover the full CLI `generateJUnit` document.
- `packages/agents/test-bun/run-bun-tests.issue3253.bun.ts`: fixed retry decisions, real killed child followed by passing report, repeated timeout leaves no stale report. Agents' aggregate `generateJUnit` is currently private and lacks direct full-document coverage here.
- `packages/core/test/run-bun-tests.test.ts`: close vs exit, real process-group reaping, early-abort XML counts, effective/nonnumeric timeout labels, retry/reap reduction, streaming scan chunk boundaries and large report, real per-test timeout, cleanup failures and ordered rejection errors. Windows taskkill behavior needs Windows execution; macOS does not establish it.
- `packages/auth/src/__tests__/run-bun-tests.behavior.test.ts`: failure-reason precedence, signal XML, fixed retry, real POSIX self-SIGTERM fixture.
- `scripts/tests/run_bun_tests.test.ts`: shared classification/diagnostics, argv/preload/tsconfig, failure and timeout budgets, env disabling, plans and scaled process timeout.
- `scripts/tests/run_bun_tests.global-setup.test.ts`: setup/teardown and missing-report reconciliation. `run_bun_tests.session-isolation.test.ts` and `.subprocess.test.ts` protect session/cancellation and real child behavior and must remain passing during migration.
- `scripts/tests/bun-test-policy.bun.test.ts`, `bun-test-reaper.bun.test.ts`, `bun-junit-to-json-report.test.ts`: policy invariants, orphan identity/safety, nested JSON case counting and empty coarse JUnit report.

## Proposed internal API and ownership

These signatures describe the accepted internal contracts used for the implementation. They stay in `scripts/lib/`; no package index export, public package API, plugin interface, configurable framework, or new subsystem is introduced. Existing runner exports keep their signatures and become forwarding adapters where moved.

### Policy entry point: extend `scripts/lib/bun-test-retry.ts`

Keep `resolveTimeoutRetryBudget`, `wasKilledByTimeoutSignal`, and `planNextAttempt` with their current observable contracts. Add these concrete entry points:

```typescript
type RunnerTimeoutInput =
  | { readonly runner: 'cli'; readonly integration: boolean; readonly env: NodeJS.ProcessEnv }
  | { readonly runner: 'agents'; readonly env: NodeJS.ProcessEnv }
  | { readonly runner: 'core'; readonly timeoutMs?: number }
  | { readonly runner: 'auth' }
  | { readonly runner: 'shared'; readonly testTimeoutMs: number };

interface AttemptTimeouts {
  readonly perTestMs: number;
  readonly perFileMs: number;
}

function resolveRunnerTimeouts(input: RunnerTimeoutInput): AttemptTimeouts;

function runTimeoutRetry<T extends { readonly timedOut: boolean }>(
  file: string,
  runAttempt: () => Promise<T>,
  logRetry: (message: string) => void,
): Promise<T>;

interface CoreRetryOutcome {
  readonly passed: boolean;
  readonly timedOut: boolean;
  readonly timeoutMs: number | null;
  readonly reapFailed: boolean;
  readonly reapError?: string | null;
}

function runCoreTimeoutRetry<T extends CoreRetryOutcome>(
  file: string,
  runAttempt: () => Promise<T>,
  logRetry: (message: string) => void,
): Promise<T>;

interface EntryRetryOutcome {
  readonly passed: boolean;
  readonly timedOut: boolean;
  readonly diagnostic: string;
}

function runEntryRetries<T extends EntryRetryOutcome>(
  file: string,
  failureRetries: number,
  runAttempt: () => Promise<T>,
  logRetry: (message: string) => void,
  env?: NodeJS.ProcessEnv,
): Promise<T>;
```

`runTimeoutRetry` serves CLI/agents/auth and retains their minimal generic timedOut contract. `runCoreTimeoutRetry` uses the same internal attempt-execution machinery but owns core's timeout-origin log and final reduction. `runEntryRetries` replaces the shared script's local state loop, keeping `planNextAttempt` as its decision primitive. It defaults `env` to runner `process.env`, resolving its timeout budget before the first attempt. No policy callbacks allow a runner to recreate its own decision logic. The generic type parameter preserves existing result payloads; there is no generic public runner object.

`resolveRunnerTimeouts` uses existing defaults; CLI integration detection remains in its adapter. CLI `fileTimeoutForFile` still validates a present override even when integration ignores its value. Its exported per-test-only `timeoutForFile` must not newly validate a file-timeout env setting: retain its simple existing behavior or use a per-test-only projection that does not parse that env. Agents resolve the override from runner env; core/auth ignore it. Shared `processTimeoutFor` becomes a forwarding projection of the shared budget variant. Explicit `--timeout` literals remain in runner argv construction, satisfying the unchanged invariant tests.

Move shared complete-summary classification into this module and have `isChildSuccess` forward to it. Add a finite classification input rather than assuming a signal alone means the same thing everywhere:

```typescript
type AttemptClassificationInput =
  | {
      readonly runner: 'cli' | 'agents' | 'auth';
      readonly killedByTimer: boolean;
      readonly exitCode: number | null;
    }
  | {
      readonly runner: 'core';
      readonly spawnFailed: boolean;
      readonly killedByTimer: boolean;
      readonly exitCode: number | null;
      readonly fileTimeoutMs: number;
      readonly perTestTimeout: boolean;
    }
  | {
      readonly runner: 'shared';
      readonly exitCode: number | null;
      readonly signalCode?: string | null;
      readonly stdout?: string;
      readonly stderr?: string;
    };

interface AttemptClassification {
  readonly passed: boolean;
  readonly timedOut: boolean;
  readonly timeoutMs: number | null;
}

function classifyAttempt(input: AttemptClassificationInput): AttemptClassification;
```

For CLI/agents/auth, `timeoutMs` is null in this internal projection and the adapter retains its current result shape and code/signal normalization. The flag is timer-based; per-test reporter parsing is not introduced. Spawn-error handlers retain their explicit non-timeout results rather than inferring success from this classifier. For core, timer classification has priority; report scanning happens only after close with no spawn error and nonzero code, and a scan rejection remains an infrastructure rejection. Shared computes success before assigning timedOut. Its internal timeoutMs is null and is not added to `FileTestResult`.

The policy module also exposes the following existing-operation entry points through imports/re-exports from the mechanical modules below, so runners share policy plus reporting/reaping without dependency inversion into workspace files. Extraction must remove the old local implementations, not merely add a facade over duplicated code.

### Mechanical reap implementation: extend `scripts/lib/bun-test-reaper.ts`

Move core's existing `observeChildClose`, `killChildTreeAndWait`, bounded waits, and attempt-directory cleanup here. Define `CoreReapOptions` locally with the existing optional `reapTimeoutMs` and `taskkillTimeoutMs`; define `AttemptCleanupOptions` locally with existing `cleanupAttempts`, `cleanupRetryDelayMs`, and `removeAttemptDir`. No scripts/lib import may depend on a workspace runner.

```typescript
interface CoreReapOptions {
  readonly reapTimeoutMs?: number;
  readonly taskkillTimeoutMs?: number;
}

interface AttemptCleanupOptions {
  readonly cleanupAttempts?: number;
  readonly cleanupRetryDelayMs?: number;
  readonly removeAttemptDir?: (attemptDir: string) => void;
}

function observeChildClose(child: ChildProcess): Promise<void>;
function killChildTreeAndWait(
  child: ChildProcess,
  childClosed: Promise<void>,
  options?: CoreReapOptions,
): Promise<void>;
function cleanupAttemptDirectory(
  attemptDir: string,
  options: AttemptCleanupOptions,
): Promise<void>;

function killTimedOutChild(input:
  | { readonly runner: 'cli'; readonly child: Pick<ChildProcess, 'pid' | 'kill'> }
  | { readonly runner: 'agents' | 'auth' | 'shared'; readonly child: ChildProcess }
): void;
```

The CLI variant is a mechanical move of CLI's current fallback algorithm. The other variants delegate to unchanged `killRunnerChild` from `bespoke-runner-isolation.ts`. Core keeps its awaited bounded operation. Do not route CLI through agents' Windows taskkill policy or give agents/auth new core-style waits. `reapStaleBunTestProcesses` stays in this module and keeps its current implementation and shared-main-only call site. The existing isolation module is a read-only dependency, not part of the edit set.

### Reporting implementation: extend `scripts/lib/junit-report-writer.ts`

Move core's streaming marker scan here with its exact `JUNIT_SCAN_CHUNK_BYTES` constant and ENOENT-only special case. Keep the existing `writeJUnitReport` coarse shared output unchanged, factoring it through the same shared renderer if useful. Add a finite report request:

```typescript
interface SummaryJUnitCase {
  readonly className: string;
  readonly failureXml: string;
  readonly failedTimeAttribute: boolean;
}

interface AgentsJUnitFile {
  readonly file: string;
  readonly failureReason: string;
  readonly reportPath: string;
}

type JUnitReportInput =
  | {
      readonly kind: 'workspace-summary';
      readonly workspace: 'cli' | 'core' | 'auth';
      readonly cases: readonly SummaryJUnitCase[];
      readonly totalFiles: number;
      readonly failedCount: number;
    }
  | { readonly kind: 'agents-detail'; readonly files: readonly AgentsJUnitFile[] }
  | { readonly kind: 'shared-files'; readonly files: readonly JUnitTestFileOutcome[] };

interface CliJUnitOutcome {
  readonly file: string;
  readonly passed: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly output: string;
}

interface CoreJUnitOutcome {
  readonly file: string;
  readonly passed: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly timeoutMs: number | null;
  readonly reapFailed: boolean;
  readonly reapError?: string | null;
}

interface AuthJUnitOutcome {
  readonly file: string;
  readonly passed: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly signal: NodeJS.Signals | null;
}

function renderJUnitReport(input: JUnitReportInput): string;
function junitReportContainsPerTestTimeout(reportPath: string): boolean;
function buildCliJUnitCases(
  results: readonly CliJUnitOutcome[],
  timeoutForFile: (file: string) => number,
): readonly SummaryJUnitCase[];
function buildCoreJUnitCases(
  results: readonly CoreJUnitOutcome[],
): readonly SummaryJUnitCase[];
function buildAuthJUnitCases(
  results: readonly AuthJUnitOutcome[],
  perFileTimeoutMs: number,
): readonly SummaryJUnitCase[];
function formatAuthFailureReason(
  result: AuthJUnitOutcome,
  perFileTimeoutMs: number,
): string;
function formatAgentsFailureReason(result: {
  readonly timedOut: boolean;
  readonly timeoutMs: number;
  readonly signal: NodeJS.Signals | null;
  readonly exitCode: number | null;
}): string;
```

The reporting module owns these concrete preparations and the policy entry point exposes them through re-exports. Result interfaces are local structural projections, not imports from runner modules. In particular, `CoreJUnitOutcome` uses an equivalent locally defined shape to `CoreRetryOutcome` rather than introducing a reporting-to-policy runtime dependency. `timeoutForFile: (file: string) => number` supplies CLI's existing render-time budget lookup, not a new cached value. No new universal result type is required.

CLI failure excerpt/ANSI/control-character helpers move mechanically with report preparation into the reporting module and are forwarded by the existing CLI exports; the same functions continue serving console output. Auth `formatFailureReason` becomes a forwarding wrapper with the current default budget. Core failure-message preparation and agents' failure description move with their report preparation. `SummaryJUnitCase.className` and `failureXml` are already escaped by these internal preparations, and the renderer must not double escape them. CLI supplies `failedTimeAttribute: false`; core/auth supply it only for failed cases. Auth retains its caller-supplied totals; CLI/core derive them as today. All three summary modes retain no trailing newline. Agents and coarse shared output retain their trailing newline and their own headers/totals.

This intermediate representation shares the summary document construction without inventing one failure vocabulary or erasing output differences. The only formatter callback is CLI's existing path-based timeout lookup. Shared JSON conversion/reconciliation stays on the existing `scripts/bun-junit-to-json-report.ts` path; preserve it through regression tests rather than rewriting it as part of this issue.

## Exact migration/edit boundary

Implementation edit set:

- `scripts/lib/bun-test-retry.ts`: policy entry point, budget/classification helpers and retry execution/reduction.
- `scripts/lib/bun-test-reaper.ts`: core bounded reap/cleanup extraction and finite existing kill variants.
- `scripts/lib/junit-report-writer.ts`: report construction/preparation, core marker scan, moved CLI output helpers; no parser redesign.
- `packages/cli/run-bun-tests.ts`: forwarding retry/budget/report helpers and existing kill adapter; remove moved implementations.
- `packages/agents/run-bun-tests.ts`: forwarding retry/budget/report helpers; retain report unlink timing and worker/isolation flow.
- `packages/core/run-bun-tests.ts`: forwarding retry/reap/scan/report helpers; retain spawn, settlement coordination, cleanup-result/rejection boundaries, batching and FATAL decision.
- `packages/auth/run-bun-tests.ts`: forwarding retry/report helpers and existing kill adapter; retain fixed timeout and exit settlement.
- `scripts/run_bun_tests.ts`: call shared retry executor, classification/report/reap entry points; retain roots/options/global setup/session/JSON orchestration.
- Existing tests listed in the acceptance table may gain behavioral cases, without weakening old assertions or converting source-only checks into proof of runtime behavior.
- One new internal behavioral suite, `scripts/tests/bun-test-retry.bun.test.ts`, can exercise the proposed policy API and its composition with existing reap/report helpers. Existing scripts-root discovery already covers it. New fixture code is TypeScript/Bun; no new JS/Vitest/Node test suites. New copyright headers use 2026.
- `project-plans/issue3442/PLAN.md`: scope, execution and verification evidence.

Required integration edits also include the three migrated-module entries in `packages/core/tsconfig.runner.json` and the two retry-suite entries in `tsconfig.scripts.json`. Include-list additions are ordinary in-scope integration; compiler flags and enforcement remain unchanged.

Read-only surfaces: `scripts/lib/bun-test-policy.ts`, `scripts/lib/bespoke-runner-isolation.ts`, session/sentinel modules, `scripts/bun-test-roots.ts`, `scripts/bun-junit-to-json-report.ts`, `scripts/test.ts`, `scripts/check-test-file-coverage.ts`, package scripts/bunfig/preloads, other tsconfigs, and quality/workflow configuration. Importing existing operations from those modules is allowed.

No dependency updates, lockfiles, shard/topology changes, nightly performance work, Windows gate changes, `.github/workflows/`, quality-tool changes, line-limit suppressions, test-threshold reductions, `.llxprt/`, agent memory, public exports, new runner subsystem, unrelated cleanup, or edits to the #3439 plan.

## Test-first migration sequence

The subsequent implementation assignment authorized these phases within the exact edit boundary. Use sequential phases and retain the red/green evidence in a unique repo-local verification directory. Implementers are subagents; do not run OCR. No stub failure is itself an accepted test expectation.

### P01: Restore preflight evidence in an authorized environment

Prerequisite: a later implementation assignment and an installed environment capable of running the existing commands. Do not repair #3789 under this scope. Verify dependencies/types/call sites, re-run baseline at the recorded clean base, and run each existing suite independently with its normal preloads. Require a successful audit baseline before claiming candidate comparison. Any unavoidable baseline failure remains documented and must not be disguised by skipping a guard.

### P02: Characterize integration boundaries before unit implementation

Define end-to-end/adapter tests first using real Bun children, real report files, and normal isolation. Add full XML fixtures that cover mixed pass/failure/timeout/signal/reap states and detailed child reports. These should pass on the old correct paths and later on adapters. Do not force a preservation test to fail by asserting a changed behavior. Tests for known defects must be separated and reported, not turned into passing regression specifications.

Intended additions:

1. Real timer-timeout then successful retry for each fixed adapter; verify filesystem attempt markers, final outcome/log text, and dead first PID on POSIX. For agents verify only final-attempt JUnit is merged.
2. Real self-SIGTERM with no runner timer firing: auth/agents/CLI fail without timeout retry; shared's signal rule retries unless complete success output exists. Core classifies from report, not signal alone.
3. Core first reap failure plus clean retry yields the precise merged failed result, valid collected-result JUnit, and continuation; final failure yields the existing FATAL path and no subsequent batch. Use existing OS-operation seams for deterministic failure, not policy mocks. Do not claim a clean retry proves the first PID died; that is current policy, not process-liveness evidence.
4. Full-document equality for CLI/core/auth coarse reports, agents nested detail/missing-report fallback, and shared per-file report, including XML escaping, counts, suffix handling, failure attributes, and trailing newlines. Parse actual output where suitable and check real case identities/totals.
5. Existing setup/teardown, session-isolation, cancellation and subprocess suites stay green. No session boundary moves inside the retry loop.

### P03: Add red tests for the internal policy contract

At intake, the proposed APIs did not exist. The implementation sequence requires tests of real outputs and compositions, with recorded failures due to absent behavior/API before implementation. Do not use source text/import presence or mock-call counts as the red evidence. Integration scenarios from P02 come first; then unit cases pin down:

1. Fixed retry: first pass, non-timeout failure, timeout/pass, timeout/assertion failure, repeated timeout. Assert final outcome, exact messages and attempt count using sequence data, with extra payload fields retained.
2. Core: file vs per-test labels; first-reap recovery merge; both reap failures; non-timeout cleanup failure remains terminal; thrown report-scan error with cleanup runs once and error identity/order preserved.
3. Shared mixed budgets: timeout then assertion failures, assertion failure then timeout, exhausted timeout falling through to failure budget, timeout budget greater than one, opt-in failure budget zero/nonzero, early successful stop. Assert the absolute attempt bound and exact N/M log lines.
4. Classification: summary split across stdout/stderr, each incomplete-summary variant, other signal, numeric failure, exit 0; nonshared modes do not inherit shared completed-summary acceptance. Core report scan activates only on its current close/nonzero/no-spawn-error boundary.
5. Budget selection: CLI unit/integration, valid/invalid/absent file-env override, agents runner-env vs supplied child env, core/auth env non-consumption, shared scaling and entry-vs-CLI precedence. Bespoke runners ignore timeout-retry env, even if invalid. Shared env parser/error behavior remains unchanged.
6. Reap/report composition: actual child close/group liveness and attempt-scoped directory cleanup; generated XML for the intended report mode. Ps-table inputs verify selected candidate counts and safety without signaling real unrelated processes.

Use existing `fast-check` only after verifying its installed availability (root declares 4.5.3). At least 30% of newly added policy cases should exercise generated outcome sequences, budget boundaries, or escaped names and totals, following PLAN.md. A generator must verify derived outputs/invariants, not repeat the implementation algorithm. No dependency changes are authorized to satisfy this requirement.

### P04: Extract policy and mechanical operations to make the red tests green

Move implementations into the existing modules, obeying numbered pseudocode below. Keep old runner exports/signatures as forwarding functions where tests consume them. Do not alter previously green expectations. Each moved component is exercised by the P02 integration contracts and P03 red tests. Leave argv/workers/session boundaries in adapters.

### P05: Migrate each execution path and remove local policy copies

Wire in this order: CLI, agents, auth, core, shared script. After each adapter, run its unchanged suite plus the policy/composition cases and compare logs/reports with P02 fixtures. Core must preserve all cleanup/rejection branches, not only its retry helper. Shared must preserve entry.retries and JSON report orchestration. Remove moved bodies only when their existing call path uses the shared implementation; no parallel old/new mode remains.

### P06: Verify the complete scoped migration

Run coverage guard, all existing meta/policy/reap/JUnit/subprocess/session suites, scoped formatting checks, lint/typecheck, full test/build and the `luna` smoke. Run the audit candidate into a separate directory and compare stable findings with clean-base TSVs, inspecting touched tests for new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING and NO_ASSERT findings. An unavailable baseline cannot be called a successful comparison.

Use existing mutation tooling only, preserving the PLAN.md 80% minimum where a supported run is available. Do not install a framework, add mutation configuration, or weaken a guard to obtain a result; missing support requires a recorded blocker/approval decision. Retain deliberate negative perturbation evidence for retry priority, core reduction, summary acceptance and report case/totals where it is possible without configuration changes. No new quality-tool subsystem is part of this plan.

Windows evidence must come from the existing Windows infrastructure gate, with no workflow edit. A macOS-only pass does not certify taskkill/locked-handle behavior. Final reviews follow the standing maximum of two cycles; OCR is disabled unless separately re-enabled. No automatic merge is authorized.

## Numbered behavior pseudocode for P04-P05

10. Adapter validates the existing run-wide settings at the existing point and selects files using the unchanged discovery/partition/root path.
11. Adapter opens the existing isolation scope; select effective attempt budgets using the runner-specific input, preserving env sources and parser timing.
12. Run one child with the existing argv, cwd, streams, tracking and settlement event; timer kills use that runner's current mechanical operation.
13. For core, await bounded tree/close handling on timer; on normal close scan only the existing nonzero/no-spawn-error branch; classify and clean the attempt directory before resolve/reject.
14. Classify through the finite policy variant; retain adapter-specific output/code/signal fields and spawn-error boundaries.
15. For fixed retry, retry only a first timedOut outcome; log the original exact text, using core's origin when applicable; do not read shared retry env.
16. For shared retry, resolve timeout retries before the first attempt, once per file from runner `process.env`; invalid values reject without attempting the file, and attempt mutations cannot change its selected budget. Choose timeout retry before ordinary attempt-bound retry; increment the common attempt count; decrement only the timeout budget when selected.
17. On termination, return the final attempt payload; apply only core's specified first-reap recovery reduction; propagate rejected bespoke attempts.
18. Adapter settles its existing isolation/file scope, aggregates in its existing order, and applies existing core batch FATAL or CLI timeout-exit behavior.
19. Prepare report cases/detail references through existing output conventions; render the matching shared report mode; preserve path/write-error/temp-cleanup behavior and shared JSON reconciliation.
20. Adapter performs existing session/sentinel/handler cleanup and sets the existing final exit classification; no new fallback or hidden error swallowing.

## Scope boundaries and external prerequisites

There is no need for a new approval gate to write this intake plan or file the observed environment issue. Implementation was subsequently authorized within the listed code/test scope. Publication is now explicitly authorized: commit, push the issue branch through the specified SSH endpoint and create a PR. Merging remains prohibited without an explicit instruction.

During intake, the installed-dependency mismatch and missing `env-paths` blocked behavioral/audit baselines. Checked dependencies have since been restored, and the successful replacement baseline is recorded in the execution section. Restoring already-declared dependencies from checked manifests and locks is ordinary environment preparation. No tracked manifest or lock changes, dependency-version changes, or new tools are allowed. #3789 retains the historical evidence; the coverage guard alone is not proof of runner behavior.

Changes to timeout/retry defaults or env parsing, exit/close settlement, core's reap/FATAL ownership, startup-reap ownership, JUnit/JSON shape, or unrelated product behavior remain outside this preservation migration. New dependencies or mutation tools are prohibited. Required TypeScript include additions and restoration of checked optional plugin dependencies are in scope. Changes to quality enforcement still require explicit owner approval; no such change is proposed.

No new bug-fixing behavior has been accepted. Existing parser limitations and potential report/lifecycle inconsistencies are migration risks, not authorization to improve them or to encode an established defect as a passing test. If a demonstrated defect conflicts with preservation, record it separately and stop that affected migration step pending a scope decision.
