## Publication evidence update (2026-10-02)

Independent initial review and findings-only follow-up PASS are recorded in `PLAN.md` and `tmp/verify3442/followup/`. Both required TypeScript include findings are resolved without enforcement changes, and publication is authorized without another approval gate. The focused count of 247 below is verified against this historical run's own log; the later remediation run selected a different tenth suite and has 238 cases. No historical count was replaced indiscriminately.

## Completed remediation (2026-10-02)

The TypeScript integration findings are resolved without compiler flag or enforcement changes. The complete restored-environment format/lint/typecheck/test/build cycle, coverage guard and byte-identical audit comparison all pass. All 17 workspaces finish, including core 460/460 and CLI 764/764. The prescribed named `luna` smoke still fails because the profile is absent; the existing `gpt-6-luna` actual-user-config smoke passes twice without profile/settings edits.

See [REMEDIATION-RESULTS.md](./REMEDIATION-RESULTS.md) for exact commands, fingerprinted evidence in `tmp/verify3442/remediation/`, completed statuses and external prerequisites. The dated correction results below retain the historical failures and base comparisons; they are not the final remediation gate status.

# Issue #3442: Preservation correction and verification

Date: 2026-10-01
Base: `f3839b8810496490f4eaf8513c27e12bd7952809`
Evidence: `tmp/verify3442/correction-20261001/`

## Timing correction

The shared timeout-retry budget is selected before the first attempt, once per file, from runner `process.env`. The issue's behavior-preservation acceptance governs the mistaken intake description. No additional behavior or approval gate is involved in correcting the timing.

Direct inspection covered `git show f3839b8:scripts/run_bun_tests.ts` and the complete base `scripts/lib/bun-test-retry.ts`. Full original sources are retained in `tmp/verify3442/migration/base-{shared,retry}-source.txt`. In the original `runSingleTestFile`, `resolveTimeoutRetryBudget()` precedes `await runAttempt()`. The resolver defaults to `process.env`.

`runEntryRetries` now performs that resolution before its first attempt. The shared adapter continues to omit the optional env argument, preserving the runner-env source rather than selecting `dependencies.environment` or the isolated child env. The parser, error text, retry priority, shared attempt counter and timeout-only decrement are unchanged.

The three adapter characterization cases use the real `runBunTests` with a filesystem artifact at its injected spawn boundary:

1. Invalid runner env rejects before a first attempt can write an artifact or repair the env, even when dependency env is valid.
2. Zero runner budget permits one attempt only, despite child env requesting a retry and the attempt changing runner env to one.
3. Valid runner budget permits its retry even when dependency env is invalid.

All three pass against the archived base. Candidate red evidence has three failures: invalid-env-before-side-effects, the zero-budget snapshot and the helper's once-only snapshot. Green evidence has 79 passing cases and no failures across the timing and policy suites. The helper case changes its env to invalid during the first attempt and still exhausts the originally selected one-retry budget. The mistaken intake-only after-first expectation was corrected; valid preexisting assertions were not weakened.

Evidence: `base-timing.log/.exit` (3 pass, exit 0), `red-timing.log/.exit` (76 pass, 3 fail, exit 1), and `green-timing.log/.exit` (79 pass, exit 0).

## Focused verification

| Check | Completed result | Evidence |
| --- | --- | --- |
| Scoped formatting | Exit 0 | `format.log/.exit` |
| Scripts policy, timing, report, reaper, lifecycle and session suites | 247 pass across 10 isolated files; exit 0 | `focused-scripts-isolated.log/.exit` |
| Core runner meta suite | 34 pass, 1 existing Windows-only skip; exit 0 | `focused-core.log/.exit` |
| CLI runner meta suite | 80 pass; exit 0 | `focused-cli-correct-preload.log/.exit` |
| Agents runner meta suite | 7 pass; exit 0 | `focused-agents-correct-preload.log/.exit` |
| Auth runner behavior suite | 12 pass; exit 0 | `focused-auth-real-path.log/.exit` |
| Scoped lint using unchanged rules | 16 targets, including the automatic integration-tests target; exit 0 | `scoped-lint.log/.exit` |
| Test-file discovery guard | Zero uncovered and zero doubly executed; exit 0 | `discovery.log/.exit` |
| Candidate test audit | 3017 files, zero errors, 2106 findings; exit 0 | `audit.log/.exit`, `scan-candidate/` |
| Exact audit findings comparison | Byte-identical to successful clean-base TSV; exit 0 | `audit.diff`, `audit-diff.exit` |
| Supplemental strict timing-test typecheck | Exit 0, no diagnostics; not a replacement for the required composite gate | `timing-typecheck-complete.log/.exit` |
| Original base composite runner typecheck | Exit 0 | `base-runner-typecheck.log/.exit` |
| Candidate composite runner typecheck | Exit 2, exactly three TS6307 include omissions | `core-typecheck.log/.exit` |
| Prescribed luna smoke | Exit 1, profile absent | `luna-smoke.log/.exit` |

Earlier guessed preload/test paths did not execute the intended cases. Those logs remain as command errors, superseded by the correct independent workspace invocations and the isolated scripts run listed above. An initial supplemental typecheck omitted `allowImportingTsExtensions`, required by an existing scripts import. Its diagnostic is retained in `timing-typecheck.log`; the completed strict invocation supplies the matching language option without editing any config. An artifact probe's relative-directory error is retained in `path-error-runtime-*` and superseded by its absolute-path runs.

The successful clean-base audit predates the migration and is in `tmp/verify3442/scan-base/`, with exit 0 in `audit-base.exit`. Candidate findings are identical, including their recorded line numbers. No scanner, dependency manifest, lockfile or enforcement change was made.

## Full workspace command

**The full `npm run test` command completed with exit 1.** The managed job `shell_dd78b1778f40` was launched with shell timeout 7200 and nohup. It completed at `2026-10-01T14:04:06.600Z` after every workspace finished, without early cancellation. Both the managed status and `full-test.exit` record exit 1; `full-test.log` ends with the completed VS Code workspace report. The earlier interrupted run remains historical evidence only.

Core completed 459/460 files, failing only `src/recording/SessionDiscovery.test.ts`. CLI completed 762/764 files, with 9800 passing cases, 12 failing cases, 5 skipped and 13 todo. Its two failed files are `cli-args.integration.test.ts` (9 cases) and `cli-args.profile-flag.integration.test.ts` (3 cases). They reproduce the original-base Gemini plugin prerequisite failure. All other 15 workspace commands completed successfully.

Completed workspace file totals:

| Workspace | Passed / executed files |
| --- | --- |
| tools | 139/139 |
| storage | 38/38 |
| auth | 45/45 |
| settings | 23/23 |
| telemetry | 45/45 |
| ide-integration | 10/10 |
| policy | 12/12 |
| mcp | 42/42 |
| core | 459/460 |
| lsp | 13/13 |
| providers | 643/643 |
| agents | 418/418 |
| zed-acp | 33/33 |
| cli | 762/764 |
| a2a-server | 22/22 |
| test-utils | 15/15 |
| vscode-ide-companion | 7/7 |

Nested intentional `hangs` and `fails` fixtures belong to passing runner meta tests, not additional failed workspace files. The fresh run has no missing runtime-artifact failures, no provider context-window failure and no media ownership failure. Source/log evidence and completed base comparisons account for all three actual failed files. The recording slowdown's underlying operation/OS cause remains unproved; the explicit deadline and base reproduction are established.

## Original-base failure comparisons

The archived base was extracted without copying `.llxprt` and uses the restored checked root dependency installation. Candidate source was never reverted. Original core retry and isolation helpers exercised every one of the 60 files failed in the historical run, in batches of two. The comparison completed with exit 1: 58 pass and two timeout failures. `base-core-results.jsonl` records each actual file result.

### Recording deadline: #3790

`SessionDiscovery.test.ts:727-759` gives the generated multi-session discovery property an explicit 30000 ms deadline. It creates and flushes one through five recording sessions for each generated case. The original runner reproduced the property timeout at 30035.79 ms and 30278.16 ms. The fresh candidate reproduced it at 30064.24 ms and 30111.59 ms. Original and candidate file attempts also reached the unchanged 300000 ms file timer in this environment. Neither is manual cancellation or a shell-watchdog inference. The final candidate core diagnostic is a per-test timeout, based on its final report.

The recording test and production source are unchanged from base. The operation or OS cause of the slowdown has not been established. These measurements prove the deadline failure on base; they do not justify reducing property cases, relaxing assertions or changing concurrency. Evidence and completed core status were added to [#3790](https://github.com/vybestack/llxprt-code/issues/3790).

### Media ready-path stall: #3792

Both original-base attempts fail the unchanged ownership case at its 180000 ms test deadline. A diagnostic base copy with boundary logging only runs all original assertions under original session isolation. It prints `before ready` but never `ready wait settled`; lease-wait and reclamation boundaries are not reached. Read-only samples during the unmodified base run find a live child, complete ready JSON and a renewing instance lease. The watcher wait remains unresolved. The precise reason a notification was absent has not been established.

The standalone diagnostic case passes, and the fresh candidate full run passes the ownership case in 240.99 ms. This establishes an intermittent failure, not a claim that every isolated run hangs. [#3792](https://github.com/vybestack/llxprt-code/issues/3792) records the original-base timeouts, blocked boundary and passing candidate evidence. This differs from #3621's JSON parse EOF signature. No media fix is included here.

Evidence: `base-core-comparison.log/.exit`, `base-media-isolated-probe.log/.exit`, `base-media-barrier-probe.log/.exit`, `media-barrier-snapshots.jsonl` and the candidate full log.

### Missing runtime artifacts: #3791

Controlled isolated base fixtures reproduce the earlier missing `./src/index.js` imports from MCP and test-utils declaration barrels. With declaration-only entry artifacts, auth factories has 8 pass / 2 fail, shell job config fails during loading and prompt loader fails during loading. With complete runtime artifacts copied into the same isolated fixture and no source/config/test changes, they pass with 10, 14 and 45 cases respectively; prompt loader retains one existing skip.

`packages/core/tsconfig.json` maps the runtime imports to `.d.ts` entry files whose relative `.js` exports need runtime artifacts. A declaration-only build preserves existing JavaScript but cannot supply JavaScript absent before that build. The successful full runtime build resolved these failures in the candidate environment. It is not a claim that `build:types` deletes complete runtime output. [#3791](https://github.com/vybestack/llxprt-code/issues/3791) contains the repro and evidence. No build/config correction is included here.

### Optional Gemini plugin prerequisite: #3784

The unchanged base CLI profile-load suite reproduces 9 failing assertions and the profile-flag suite reproduces 3. The completed fresh candidate CLI workspace reproduces the same two files and all 12 failures. Both expect the attempted Gemini API error but get the explicit provider-registration error from `providerManagerInstance.ts:517`. Both archives lack `plugins/google-gemini/node_modules`; `discoverRuntimePlugins.ts:266` excludes that uninstalled checkout plugin. Root installation/build does not install this optional plugin's dependencies. The existing [#3784](https://github.com/vybestack/llxprt-code/issues/3784) was updated with these completed base comparisons. No plugin dependency installation or assertion change was made.

The old interrupted run's provider context-window timeout diagnostic followed runner termination. Its archived-base focused comparison passes all three cases with exit 0. No product defect is inferred from interruption-only output.

## Migration configuration and external prerequisites

The minimal required include entries in `packages/core/tsconfig.runner.json` are:

```json
"../../scripts/lib/bun-test-retry.ts",
"../../scripts/lib/bun-test-reaper.ts",
"../../scripts/lib/junit-report-writer.ts"
```

The migration imports these three modules into a composite project that explicitly lists its files. The earlier candidate failed TS6307 while the base project passed. All three include entries are now added as required migration integration. Both new retry suites are also included in `tsconfig.scripts.json`. Every compiler flag and enforcement rule is unchanged. These additions require no separate approval.

The prescribed luna profile is absent. The smoke exits 1 at `packages/settings/src/profiles/ProfileManager.ts:252`. No profile, settings or credential repair was attempted.

[#3789](https://github.com/vybestack/llxprt-code/issues/3789) was corrected: absent `node_modules` caused the original cache TypeScript resolution and missing `env-paths`. Restoring checked dependencies yielded successful base and candidate audits. Current TypeScript is 5.8.3 with `ScriptKind.TS = 3`. No scanner defect was established.

Windows taskkill/locked-handle evidence and the previously unavailable mutation-tool gate remain separate evidence limits. No tooling, config, dependencies, workflows, quality enforcement or `.llxprt` files were changed. No review, commit or push was run.
