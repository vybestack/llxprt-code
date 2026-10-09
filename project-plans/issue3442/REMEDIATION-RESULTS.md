## Publication evidence update (2026-10-02)

The initial independent review and findings-only follow-up are complete with PASS; both TypeScript include findings are resolved. Follow-up evidence in `tmp/verify3442/followup/` verifies the unchanged candidate fingerprint, 39 immutable snapshots, completed command exits and unchanged compiler flags. The review cap is reached and OCR remains disabled.

The remediation focused log contains 238 cases in 10 passing suites, corrected below. The earlier correction log contains 247 because it selected the 16-case test-session suite rather than the 7-case subprocess suite; that historical count remains accurate. Review classifications and publication authorization are recorded at the top of `PLAN.md`. No extra production change or approval blocker was introduced. The report below retains the local-remediation stage; CI and PR status will be recorded on GitHub.

# Issue #3442: TypeScript integration fixed; local code gates pass

Date: 2026-10-02
Branch: `issue3442`
Base and unchanged HEAD: `f3839b8810496490f4eaf8513c27e12bd7952809`
Evidence root: `tmp/verify3442/remediation/`

The required TypeScript include entries are added. After restoring the declared optional Gemini plugin installation, format, lint, typecheck, the complete workspace test command, build, the test-file coverage guard and the audit comparison all exit 0. The prescribed named `luna` smoke remains an external profile prerequisite failure. A supplemental smoke using the existing `gpt-6-luna` user profile exits 0 and produces a haiku. It does not replace the failed named-profile gate.

## Initial finding disposition and preservation

**Blocker-Fix resolved:** `packages/core/tsconfig.runner.json` includes `../../scripts/lib/bun-test-retry.ts`, `../../scripts/lib/bun-test-reaper.ts` and `../../scripts/lib/junit-report-writer.ts`.

**In-scope-Fix resolved:** `tsconfig.scripts.json` includes `scripts/tests/bun-test-retry.bun.test.ts` and `scripts/tests/bun-test-retry-timing.bun.test.ts` beside the existing policy suite.

The include omissions were migration integration errors. No separate approval is required. `PLAN.md` and `CORRECTION-RESULTS.md` no longer describe an approval requirement for them or for ordinary dependency restoration. `config-preservation.log/.exit` proves that removing exactly these five new entries produces the original parsed configurations. Every compiler flag and all other configuration fields are unchanged. No quality rule, assertion, deadline, file-size guard, workflow or branch protection was weakened.

No runner implementation or test assertion changed during this remediation. Shared retry-env resolution remains once per file, before the first attempt, from runner `process.env`. The focused scripts run passes all 238 cases in 10 isolated files, including the three adapter timing characterizations and the helper budget snapshot. It retains the earlier red/green evidence in [CORRECTION-RESULTS.md](./CORRECTION-RESULTS.md).

## Immutable candidate evidence

Before every verification command, the harness records HEAD, git status, the binary tracked diff, SHA-256 hashes of tracked and nonignored untracked files, a separate code/config hash list and a UTC start timestamp. Each `<gate>.candidate/` directory is made read-only, and the harness refuses to reuse an existing snapshot name. Commands, logs, numeric exits and completion timestamps are adjacent as `<gate>.command`, `.log`, `.exit` and `.finished`.

All verification snapshots have the same SHA-256 for `code-config.sha256`:

```text
7f89ef388d47871e4dc7566d3fede7caf0a83fa0d9234bbd128a3baabea1222c
```

This list includes the untracked retry suites and both corrected configs. The complete file-list hashes also include issue-plan prose; final documentation changes are recorded separately and do not change the code/config candidate. Logs are repo-local and retained. No bare `/tmp` verification logs were used.

Managed job `shell_2e98824fa7f7` completed the first cycle naturally. Managed job `shell_4943f343d6e7` completed the restored-environment cycle and all supplemental checks naturally. A harness exit 0 means orchestration finished; the tables below report each command's own exit instead.

## Completed command results

Commands run from the repository root unless a workspace is specified. Evidence prefixes are relative to the evidence root.

| Command | Completed result | Evidence prefix |
| --- | --- | --- |
| `npm run format` | Exit 0, before and after plugin restoration | `format`, `format-restored` |
| `npm run lint` | Exit 0, before and after plugin restoration | `lint`, `lint-restored` |
| `npm run typecheck` | Exit 0, including declaration build, every workspace and scripts/evals configs | `typecheck`, `typecheck-restored` |
| `npm run test`, before restoration | Exit 1; all workspaces finished; only the two known Gemini prerequisite files failed | `test` |
| `npm run test`, after restoration | Exit 0; all 17 workspace commands finished | `test-restored` |
| `npm run build` | Exit 0, before and after the final full test rerun | `build`, `build-restored` |
| `bun scripts/check-test-file-coverage.ts` | Exit 0; zero uncovered and zero doubly-executed files | `coverage-guard`, `coverage-guard-restored` |
| `bun scripts/test-audit/scan.ts tmp/verify3442/remediation/scan-restored` | Exit 0; 3017 files, zero errors, 2106 findings | `audit-restored`, `scan-restored/` |
| `diff -u tmp/verify3442/scan-base/findings.tsv tmp/verify3442/remediation/scan-restored/findings.tsv` | Exit 0; byte-identical findings, including line numbers | `audit-compare-restored` |
| `./node_modules/.bin/tsc -p packages/core/tsconfig.runner.json` | Exit 0; prior TS6307 errors resolved | `core-runner-typecheck` |
| `./node_modules/.bin/tsc -p tsconfig.scripts.json` | Exit 0, including both added retry suites | `scripts-typecheck` |
| Focused scripts command below | Exit 0; 238 pass across 10 isolated files | `focused-scripts` |
| In `packages/core`: `bun test ./test/run-bun-tests.test.ts` | Exit 0; 34 pass, one existing Windows-only skip | `core-meta` |
| In `packages/cli`: `bun test ./test/run-bun-tests.test.ts` | Exit 0; 80 pass | `cli-meta` |
| In `packages/agents`: `bun test ./test-bun/run-bun-tests.issue3253.bun.ts` | Exit 0; 7 pass | `agents-meta` |
| In `packages/auth`: `bun test ./src/__tests__/run-bun-tests.behavior.test.ts` | Exit 0; 12 pass | `auth-meta` |
| `LLXPRT_CONFIG_HOME=/Users/acoliver/Library/Preferences/llxprt-code bun scripts/start.ts --profile-load luna "write me a haiku and nothing else"` | Exit 1; `Profile 'luna' not found` | `smoke-luna`, `smoke-luna-restored` |
| Same actual user config root, `bun scripts/start.ts --profile-load gpt-6-luna "write me a haiku and nothing else"` | Exit 0 twice; model stamp `gpt-6-luna:gpt-6-luna`, haiku output | `smoke-existing-gpt6luna`, `smoke-existing-gpt6luna-restored` |
| Config structure preservation check | Exit 0; only three runner includes and two scripts includes differ | `config-preservation` |
| Unchanged known-failure sources and `git diff --check` | Exit 0 | `known-failure-sources-unchanged` |
| Tracked root/plugin manifests and locks diff | Exit 0; no changes | `manifests-unchanged`, `manifests-unchanged-restored` |
| User profile/settings SHA-256 comparison before/after smoke | Exit 0; all compared files unchanged | `user-config-unchanged` |

Exact focused scripts command:

```bash
bun scripts/run_bun_tests.ts \
  scripts/tests/bun-test-policy.bun.test.ts \
  scripts/tests/bun-test-retry.bun.test.ts \
  scripts/tests/bun-test-retry-timing.bun.test.ts \
  scripts/tests/bun-test-reaper.bun.test.ts \
  scripts/tests/run_bun_tests.test.ts \
  scripts/tests/run_bun_tests.global-setup.test.ts \
  scripts/tests/run_bun_tests.session-isolation.test.ts \
  scripts/tests/run_bun_tests.subprocess.test.ts \
  scripts/tests/bun-junit-to-json-report.test.ts \
  scripts/tests/bespoke-runner-isolation.test.ts
```

The restored full test command started at `2026-10-02T12:01:22Z` and completed at `2026-10-02T12:24:56Z`, with exit 0. It was not filtered, interrupted, canceled or given relaxed budgets.

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
| core | 460/460 |
| lsp | 13/13 |
| providers | 643/643 |
| agents | 418/418 plus 7/7 native meta files |
| zed-acp | 33/33 |
| cli | 764/764 |
| a2a-server | 22/22 |
| test-utils | 15/15 |
| vscode-ide-companion | 7/7 |

CLI reports 9812 passed cases, zero failed, 5 existing skips and 13 existing todo. Intentional failing/hanging child fixtures in runner meta tests are not workspace failures.

## Environment restoration and historical failure triage

The first `npm run test` completed with core 460/460 and CLI 762/764. CLI's 12 failed cases were confined to `cli-args.integration.test.ts` and `cli-args.profile-flag.integration.test.ts`, with the same missing Gemini provider error previously reproduced on base in [#3784](https://github.com/vybestack/llxprt-code/issues/3784).

From `plugins/google-gemini`, the frozen attempt `bun install --frozen-lockfile --no-save --ignore-scripts --omit peer` exited 1. Bun 1.3.14 could not parse the checked plugin lock's unresolved host peer. The plugin documents Bun >=1.4.2 for this flow, while the available PATH and repository-bundled Bun are 1.3.14. No new tool was installed.

The documented peer-omitting flow with non-writing flags, `bun install --omit=peer --no-save --ignore-scripts`, then exited 0 and installed 13 packages, including the already-declared `@ai-sdk/google@4.0.56`. Tracked manifests and locks stayed unchanged. Bun ignored the lock after its peer-resolution diagnostic, so this is an installation from the checked manifest, not an exact frozen-lock reproduction. Installed transitive/dev versions include `undici@7.30.0`, `@types/node@24.19.1` and `undici-types@7.24.6`, within the existing declared ranges rather than the older lock resolutions. Installed metadata is retained in `plugin-package-files.log`. The failed `bun pm ls --all` inventory probe is retained in `plugin-installed-metadata.log/.exit`; it hit the same lock parse issue and is not a passing verification claim.

After that environment preparation, the entire format/lint/typecheck/test/build sequence was rerun. All 12 Gemini cases now pass in the full unfiltered CLI workspace. No product fix, dependency declaration/version edit, assertion change or plugin source change was made.

The first remediation full run reproduced [#3790](https://github.com/vybestack/llxprt-code/issues/3790)'s SessionDiscovery property timeout at 30272.62 ms, then recovered on the unchanged per-test timeout retry. Its core command passed 460/460 files. The restored full run passed 460/460 without that retry. Both the first-run timeout and subsequent passing outcomes are retained; no deadline or property case count was changed. Original-base reproduction remains in `CORRECTION-RESULTS.md`. The recording flake is not a remaining failure in the completed candidate run.

## Remaining external prerequisite and candidate state

The inherited shell has `HOME=/Users/acoliver`, with `LLXPRT_CONFIG_HOME` and `XDG_CONFIG_HOME` unset. The actual path resolver returns `/Users/acoliver/Library/Preferences/llxprt-code`. The prescribed `profiles/luna.json` is absent there; read-only checks also found no exact `luna.json` in the checked repository profiles or inspected legacy/global locations. Both explicit actual-root attempts exit 1 with the same missing-profile diagnostic.

Available suitable existing names include `gpt-6-luna` (Codex / gpt-6-luna), `lunahigh` and `praxis-luna` (Codex / gpt-5.6-luna), `astra` (Codex / gpt-6-astra), `zai-glm-flash` (Anthropic / glm-5.3-flash) and `dsflash` (OpenAI / deepseek-v4-flash). Only safe names/provider/model metadata was reported; tokens were not exposed. `gpt-6-luna` passed the requested haiku workload twice. No profile, settings, credential configuration or `.llxprt` edit was made.

Both initial findings are resolved. The working tree contains the migration, its tests, the two include-list fixes and issue-plan documentation, without commits. HEAD remains the recorded base. No OCR or other review, commit, push, PR or merge was performed. Windows execution and the previously unavailable full mutation tool remain evidence limits from the original plan, not new local approval gates or claims of certification. This deliverable is completed local remediation and verification, with the exact named-profile gate still failed. It does not claim CI, review or PR completion.
