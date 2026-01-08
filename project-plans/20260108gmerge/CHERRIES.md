# Cherry-Pick Decisions: v0.11.3 → v0.12.0

Tracking issue: https://github.com/vybestack/llxprt-code/issues/709

## Summary

| Decision | Count |
|----------|-------|
| PICK | 55 |
| SKIP | 67 |
| REIMPLEMENT | 13 |
| **Total** | 135 |

## Decision Notes

### Recurring SKIP Themes
- **Release/version bump commits** (chore(release): bump version, v0.12.0-preview.N, etc.) - 15 commits
- **GitHub workflow/infra commits** (deflake.yml, test_chained_e2e.yml, merge queue, etc.) - 12 commits
- **ClearcutLogger/telemetry commits** - LLxprt has removed all Google telemetry
- **debugLogger migrations** - LLxprt has superior DebugLogger system (skip these)
- **Docs-only for gemini-cli specific features** (changelogs, gemini-specific docs)
- **Preview cherry-pick patches** - These are upstream release management, not applicable
- **Todo tool docs** - LLxprt has completely different todo implementation
- **Retry/fallback changes** - LLxprt has different retry architecture, FlashFallback removed

### Recurring REIMPLEMENT Themes
- **Message bus / policy engine changes** - LLxprt has divergent architecture
- **Extension manager refactors** - LLxprt has different extension handling
- **ChatCompressionService** - LLxprt has different compression architecture

### High-Risk Items
- `b188a51c` - Message bus for tool execution confirmation (core scheduler changes)
- `064edc52` - Config-based policy engine with TOML (LLxprt already has this)
- `541eeb7a` - Sequential approval implementation (scheduler changes)
- `c4c0c0d1` - ExtensionManager class (major refactor)

---

## PICK Table (Chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | `ce655436` | 2025-10-22 | cli/tests | Test improvements for useToolScheduler | fix(test): unskip and fix useToolScheduler tests (#11671) |
| 2 | `0bf2a035` | 2025-10-22 | cli | Adds alias for extensions command | Add extension alias for extensions command (#11622) |
| 3 | `6d75005a` | 2025-10-22 | cli, core, docs | Useful setting to disable YOLO mode | Add setting to disable YOLO mode (#11609) |
| 4 | `b40f67b7` | 2025-10-22 | core, cli, a2a | Extract console error to util - clean refactor | extract console error to util func (#11675) |
| 5 | `2ede47d5` | 2025-10-22 | cli/tests | Test improvements for InputPrompt | fix(ui): Fix and unskip InputPrompt tests (#11700) |
| 6 | `a90b9fe9` | 2025-10-22 | a2a/tests | GCS persistence test fix | fix(a2a-server): Fix and unskip GCS persistence test (#11755) |
| 7 | `8f8a6897` | 2025-10-23 | scripts | Use venv for yamllint - better isolation | feat(preflight): Use venv for yamllint installation (#11694) |
| 8 | `d9f0b9c6` | 2025-10-22 | cli | Fix race condition in useGitBranchName | fix(cli): fix race condition and unskip tests in useGitBranchName (#11759) |
| 9 | `92d412e5` | 2025-10-22 | core | Simplify FilterReport, remove unused code | refactor: simplify FilterReport and remove unused code (#11681) |
| 10 | `047bc440` | 2025-10-22 | core | Clean up exclude description | refactor(core): Clean up exclude description (#11678) |
| 11 | `1202dced` | 2025-10-22 | cli | Refactor KeypressContext - code quality | Refactor KeypressContext (#11677) |
| 12 | `8e9f71b7` | 2025-10-23 | cli | Fix race condition in double-escape handler | fix(ui): resolve race condition in double-escape handler (#8913) |
| 13 | `5ebe40e9` | 2025-10-23 | cli/tests | Parameterize InputPrompt tests | refactor(cli): Parameterize tests in InputPrompt (#11776) |
| 14 | `445ef4fb` | 2025-10-23 | docs | Fix broken link in configuration docs | Docs: Fix broken link in docs/cli/configuration.md (#11655) |
| 15 | `3f38f95b` | 2025-10-23 | a2a, cli, core | executeCommand endpoint with /extensions list | Adds executeCommand endpoint with support for /extensions list (#11515) |
| 16 | `5ae9fe69` | 2025-10-23 | docs | Fix broken links in documentation | Fix broken links in documentation (#11789) |
| 17 | `bde5d618` | 2025-10-23 | integration-tests | Re-enable shell command test | Re-enable test. (#11628) |
| 18 | `750c0e36` | 2025-10-23 | cli, docs | Extension settings on install - useful feature | Add extension settings to be requested on install (#9802) |
| 19 | `9e91aafe` | 2025-10-23 | cli, core | Fix tool scheduler repeated creation bug | Fix bug where tool scheduler was repeatedly created. (#11767) |
| 20 | `3a501196` | 2025-10-23 | cli, core | Surface internal errors via unified event system | feat(ux): Surface internal errors via unified event system (#11803) |
| 21 | `5e70a7dd` | 2025-10-23 | core, integration-tests | Align shell allowlist handling | fix: align shell allowlist handling (#11510) (#11813) |
| 22 | `aa6ae954` | 2025-10-23 | cli/tests | Use raw writes to stdin in tests | Use raw writes to stdin where possible in tests (#11837) |
| 23 | `9814f86a` | 2025-10-24 | core/tests | Parameterize base-storage-token and prompts tests | Added parameterization to base-storage-token.test and prompts.test.ts (#11821) |
| 24 | `b7738175` | 2025-10-23 | core | Bump get-ripgrep version | feat(core) Bump get-ripgrep version. (#11698) |
| 25 | `0fe82a2f` | 2025-10-23 | cli/tests | Use raw writes to stdin in test | Use raw writes to stdin in test (#11871) |
| 26 | `884d838a` | 2025-10-23 | cli | Re-throw errors in non-interactive mode | fix(cli): re-throw errors in non-interactive mode (#11849) |
| 27 | `a889c15e` | 2025-10-24 | core/tests | Adding parameterised tests | Adding Parameterised tests (#11930) |
| 28 | `c079084c` | 2025-10-24 | core | Token caching in google auth provider | chore(core): add token caching in google auth provider (#11946) |
| 29 | `978fbcf9` | 2025-10-24 | integration-tests | Run BOM test on Windows | run bom test on windows (#11828) |
| 30 | `a123a813` | 2025-10-24 | cli | Use correct extensionPath | Fix(cli): Use the correct extensionPath (#11896) |
| 31 | `25996ae0` | 2025-10-24 | core | Use emitFeedback in keychain token storage | fix(security) - Use emitFeedback (#11961) |
| 32 | `c2104a14` | 2025-10-24 | core | Use emitFeedback in oauth token storage | fix(security) - Use emitFeedback instead of console error (#11948) |
| 33 | `31b7c010` | 2025-10-24 | integration-tests, core/tests | Regression tests for shell command parsing | Add regression tests for shell command parsing (#11962) |
| 34 | `ca94dabd` | 2025-10-24 | cli/tests | Extension test fix | Fix(cli): Use cross-platform path separators in extension tests (#11970) |
| 35 | `63a90836` | 2025-10-24 | cli/tests | Fix linked extension test on Windows | fix linked extension test on windows (#11973) |
| 36 | `40057b55` | 2025-10-24 | cli | Use correct defaults for file filtering | fix(cli): Use correct defaults for file filtering (#11426) |
| 37 | `c20b88ce` | 2025-10-24 | cli | Use coreEvents.emitFeedback in extension enablement | use coreEvents.emitFeedback in extension enablement (#11985) |
| 38 | `d91484eb` | 2025-10-24 | cli/tests, core/tests | Fix tests | Fix tests (#11998) |
| 39 | `cdff69b7` | 2025-10-24 | cli | Support redirects in fetchJson | Support redirects in fetchJson, add tests for it (#11993) |
| 40 | `f934f018` | 2025-10-24 | core | ReadFile no confirmation when message bus off | fix(tools): ReadFile no longer shows confirmation when message bus is off (#12003) |
| 41 | `145e099c` | 2025-10-24 | cli | Support paste markers split across writes | Support paste markers split across writes. (#11977) |
| 42 | `b1059f89` | 2025-10-24 | cli, core | Switch to unified shouldIgnoreFile | refactor: Switch over to unified shouldIgnoreFile (#11815) |
| 43 | `bcd9735a` | 2025-10-25 | cli | Fix typo in handleAutoUpdate | Fix typo in: packages/cli/src/utils/handleAutoUpdate.ts (#11809) |
| 44 | `ce26b58f` | 2025-10-25 | docs | Update project structure in CONTRIBUTING | docs(contributing): update project structure section with missing packages (#11599) |
| 45 | `ef70e632` | 2025-10-24 | cli | Make PASTE_WORKAROUND the default | Make PASTE_WORKAROUND the default. (#12008) |
| 46 | `51578397` | 2025-10-24 | cli/tests | Replace custom wait with vi.waitFor in InputPrompt tests | refactor(cli): replace custom wait with vi.waitFor in InputPrompt tests (#12005) |
| 47 | `73570f1c` | 2025-10-24 | core | Fix shortenPath function ellipsis insertion | Fix the shortenPath function to correctly insert ellipsis. (#12004) |
| 48 | `a2d7f82b` | 2025-10-24 | core | Prepend user message to loop detection history | fix(core): Prepend user message to loop detection history if it starts with a function call (#11860) |
| 49 | `8352980f` | 2025-10-25 | package.json | Remove non-existent parallel flag | Remove non-existent parallel flag. (#12018) |
| 50 | `ee66732a` | 2025-10-25 | cli/tests | First batch of fixing tests to use best practices | First batch of fixing tests to use best practices. (#11964) |
| 51 | `2fa13420` | 2025-10-27 | core | Add absolute file path description for Windows | add absolute file path description for windows (#12007) |
| 52 | `c7817aee` | 2025-10-27 | cli | Add delimiter before printing tool response in non-interactive mode | fix(cli): Add delimiter before printing tool response in non-interactive mode (#11351) |
| 53 | `23c906b0` | 2025-10-27 | core | User configured oauth scopes take precedence | fix: user configured oauth scopes should take precedence over discovered scopes (#12088) |
| 54 | `5ded674a` | 2025-10-27 | cli/tests | Refactor vim.test.ts with parameterized tests | Refactor vim.test.ts: Use Parameterized Tests (#11969) |
| 55 | `4ef3c093` | 2025-10-27 | core | Update loop detection LLM schema fields | fix(core): update loop detection LLM schema fields (#12091) |

---

## SKIP Table (Chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | `59985138` | 2025-10-22 | package.json | Version bump - release management | chore(release): bump version to 0.12.0-nightly.20251022.0542de95 (#11672) |
| 2 | `5bb9cd1a` | 2025-10-22 | .github | GitHub workflow - gemini-cli infra specific | feat(infra) - Create a workflow for deflake (#11535) |
| 3 | `a7faa208` | 2025-10-22 | .github | GitHub workflow - gemini-cli infra specific | feat(infra) - Update status for chained e2e (#11651) |
| 4 | `4f220e94` | 2025-10-22 | cli, core | ClearcutLogger telemetry - removed from LLxprt | feat(infra) - Add logging for when user tries to exit multiple times (#11218) |
| 5 | `30dd2f1d` | 2025-10-22 | docs | LLxprt has completely different todo implementation | Document todo tool (#11695) |
| 6 | `eee34529` | 2025-10-22 | docs | Gemini-cli changelog - not applicable | Docs: adds 2025-10-13 changelog. (#11751) |
| 7 | `d3e4ff2c` | 2025-10-23 | .github | GitHub workflow - lychee link checker | feat: Add lychee-action to check for broken links (#11781) |
| 8 | `8ad72ec1` | 2025-10-23 | .github | GitHub workflow - gemini-cli infra specific | fix(infra) - Remove context input for setting status (#11734) |
| 9 | `7787a31f` | 2025-10-23 | .github | GitHub workflow - gemini-cli infra specific | feat(infra) - Make merge group and pushes run chained e2e (#11796) |
| 10 | `48ff9e15` | 2025-10-23 | .github | GitHub workflow - gemini-cli infra specific | fix(infra) - Fix merge queue skipper issues for chain e2e (#11810) |
| 11 | `b16fe7b6` | 2025-10-23 | core, cli, integration-tests | FakeContentGenerator for mocking - needs evaluation | First take at mocking out gemini cli responses in integration tests (#11156) |
| 12 | `d915525c` | 2025-10-24 | docs | Telemetry documentation - LLxprt has different telemetry | docs(cli): update telemetry documentation (#11806) |
| 13 | `8bdef875` | 2025-10-24 | core | ClearcutLogger - removed from LLxprt | Stop logging session ids on extension events (#11941) |
| 14 | `4960c472` | 2025-10-24 | .github | GitHub workflow - gemini-cli infra specific | fix(infra) - Simplify cancel in progress and add permission to set status step (#11835) |
| 15 | `ee92db75` | 2025-10-24 | cli, core | LLxprt has different retry architecture, FlashFallback removed | fix: handle request retries and model fallback correctly (#11624) |
| 16 | `7e2642b9` | 2025-10-24 | core | debugLogger.warn for loop detection - LLxprt has different logger | fix(core): use debugLogger.warn for loop detection errors (#11986) |
| 17 | `810d940e` | 2025-10-24 | cli | Replace update-notifier with latest-version - different update system | fix(update): replace update-notifier with latest-version (#11989) |
| 18 | `81006605` | 2025-10-24 | cli | debugLogger migration - LLxprt has DebugLogger | use debugLogger instead of console.error (#11990) |
| 19 | `e750da98` | 2025-10-28 | cli | debugLogger migration - LLxprt has DebugLogger | chore: migrate console.error in useGeminiStream (#12157) |
| 20 | `9e8f7c07` | 2025-10-27 | core | BYOID auth client - Google-specific auth | Create BYOID auth client when detecting BYOID credentials (#11592) |
| 21 | `abd22a75` | 2025-10-27 | core, docs | ID token support for MCP - then reverted | feat(ID token support): Add ID token support for authenticating to MC… (#12031) |
| 22 | `6db64aab` | 2025-10-27 | cli, core | Prevent duplicate StartSessionEvent - ClearcutLogger | fix(telemetry): Prevent duplicate StartSessionEvent logging (#12090) |
| 23 | `cb0947c5` | 2025-10-27 | core | TSC build idempotent - build config specific | fix(ci): tsc build for package/core is idempodent (#12112) |
| 24 | `e9f8ccd5` | 2025-10-27 | cli/tests | Fix config test for GEMINI_MODEL env var - Gemini specific | Fix config test so it passes even if the user running the test happens to have set GEMINI_MODEL to flash (#12114) |
| 25 | `cb208f53` | 2025-10-27 | scripts, docs | Genkit telemetry setup script - Google-specific | Added a a script to setup and run genkit telemetry and dev ui (#12120) |
| 26 | `ecf0a248` | 2025-10-28 | core/tests | Parameterize glob tests - minor test refactor | refactor(core): Parameterize tests in glob.test.ts (#12061) |
| 27 | `cca5a128` | 2025-10-28 | docs | Update README installation section - branding | docs: update installation section in README (#12035) |
| 28 | `034ca939` | 2025-10-28 | core, docs | Revert ID token support | Revert "feat(ID token support): Add ID token support for authenticating to MC…" (#12162) |
| 29 | `d465a26e` | 2025-10-28 | core | Console errors in sa-impersonation - minor | chore(console): change console errors in sa-impersontation (#12165) |
| 30 | `25f27509` | 2025-10-28 | .github | Revert nightly schedule - gemini-cli infra | revert nightly schedule (#11653) |
| 31 | `4e6eef58` | 2025-10-28 | cli | Migrate console.error to debugLogger.warn - LLxprt has DebugLogger | refactor: Migrate console.error to debugLogger.warn in atCommandProcessor.ts (#12134) |
| 32 | `13aa0148` | 2025-10-28 | cli/tests | Migrate tests to avoid jsdom - test infrastructure | Migrate tests to use avoid jsdom (#12118) |
| 33 | `7a238bd9` | 2025-10-28 | .github | GitHub workflow - e2e specific | fix(infra) - Continue workflow when merge queue skipper fail (#10509) |
| 34 | `39eb6ed9` | 2025-10-28 | core | Migrate console.error in workspaceContext - LLxprt has DebugLogger | chore: migrate console.error in workspaceContext (#12167) |
| 35 | `ab1f1955` | 2025-10-28 | cli, docs | Change debug drawer keybinding to F12 - may conflict | Change debug drawer keybinding to F12 (#12171) |
| 36 | `70996bfd` | 2025-10-28 | core, docs | OTEL semantic standard log - Google telemetry | feat: Add Open Telemetric semantic standard compliant log (#11975) |
| 37 | `f6423ea4` | 2025-10-28 | core/tests | Remove obsolete snapshots - minor cleanup | Remove obsolete snapshots (#12180) |
| 38 | `601a639f` | 2025-10-28 | core | Disable model routing for oauth users - Google-specific | Disable model routing for oauth users (#11889) |
| 39 | `cca41edc` | 2025-10-28 | docs | Symlink CONTRIBUTING.md for docs site | feat(docs): Symlink CONTRIBUTING.md in the docs folder so that the site can pick it up. (#12178) |
| 40 | `fe98c855` | 2025-10-29 | package.json | Release version bump | chore(release): v0.12.0-preview.0 |
| 41 | `b4a63bf7` | 2025-10-30 | core, eslint | Merge commit for preview release | Merge commit 'b382ae6803ce21ead2a91682fc58126f3786f15b' into HEAD |
| 42 | `7124551a` | 2025-10-30 | package.json | Release version bump | chore(release): v0.12.0-preview.2 |
| 43 | `3876379b` | 2025-10-30 | cli, docs | Cherry-pick patch for preview release | fix(patch): cherry-pick 82c1042 to release/v0.12.0-preview.2-pr-12231 to patch version v0.12.0-preview.2 and create version 0.12.0-preview.3 (#12320) |
| 44 | `cd4bebba` | 2025-10-30 | package.json | Release version bump | chore(release): v0.12.0-preview.3 |
| 45 | `66b61a13` | 2025-10-30 | core | Cherry-pick patch - chatCompressionService | fix(patch): cherry-pick 68afb72 to release/v0.12.0-preview.3-pr-12306 to patch version v0.12.0-preview.3 and create version 0.12.0-preview.4 (#12327) |
| 46 | `30dc89c8` | 2025-10-30 | package.json | Release version bump | chore(release): v0.12.0-preview.4 |
| 47 | `174462f4` | 2025-10-30 | core | Cherry-pick patch - config changes | fix(patch): cherry-pick 643f2c0 to release/v0.12.0-preview.4-pr-12300 to patch version v0.12.0-preview.4 and create version 0.12.0-preview.5 (#12329) |
| 48 | `2072d90a` | 2025-10-31 | package.json | Release version bump | chore(release): v0.12.0-preview.5 |
| 49 | `fe44afe8` | 2025-10-30 | cli, core, docs | Cherry-pick patch - settings/compression | fix(patch): cherry-pick 3332703 to release/v0.12.0-preview.5-pr-12317 to patch version v0.12.0-preview.5 and create version 0.12.0-preview.6 (#12334) |
| 50 | `a0198269` | 2025-10-31 | package.json | Release version bump | chore(release): v0.12.0-preview.6 |
| 51 | `9fbea50e` | 2025-10-31 | core, docs | Cherry-pick patch - telemetry loggers | fix(patch): cherry-pick 135d981 to release/v0.12.0-preview.6-pr-12299 to patch version v0.12.0-preview.6 and create version 0.12.0-preview.7 (#12368) |
| 52 | `3d44880e` | 2025-10-31 | package.json | Release version bump | chore(release): v0.12.0-preview.7 |
| 53 | `cc076e95` | 2025-10-31 | core | Cherry-pick patch - loop detection | fix(patch): cherry-pick 11e1e98 to release/v0.12.0-preview.7-pr-12347 to patch version v0.12.0-preview.7 and create version 0.12.0-preview.8 (#12383) |
| 54 | `5d7772ff` | 2025-10-31 | package.json | Release version bump | chore(release): v0.12.0-preview.8 |
| 55 | `d756ef64` | 2025-10-30 | cli | Remove context percentage in footer by default | Remove context percentage in footer by default (#12326) |
| 56 | `09a65920` | 2025-10-31 | cli | Mark compressionThreshold as requiring restart | Mark `model.compressionThreshold` as requiring a restart (#12378) |
| 57 | `a893c8c7` | 2025-10-31 | core | Simplify daily quota error messages - minor | refactor: simplify daily quota error messages |
| 58 | `1c445865` | 2025-10-31 | package.json | Release version bump | chore(release): v0.12.0-preview.9 |
| 59 | `a2cb1169` | 2025-11-03 | core, integration-tests | Cherry-pick patch with conflicts | fix(patch): cherry-pick fd2cbac to release/v0.12.0-preview.9-pr-12399 [CONFLICTS] (#12488) |
| 60 | `51a415f2` | 2025-11-04 | cli, core | Cherry-pick commits for release - bundled | fix: cherry-pick commits for release (#12549) |
| 61 | `d6f977cb` | 2025-11-04 | cli | Cherry-pick screen reader nudge changes | Cherry pick screen reader nudge changes (#12553) |
| 62 | `9e7c80f2` | 2025-11-04 | package.json | Release version bump | chore(release): v0.12.0-preview.11 |
| 63 | `5839bb53` | 2025-11-04 | package.json | Final release version bump | chore(release): v0.12.0 |
| 64 | `0e4dce23` | 2025-10-27 | cli, core | debugLogger migration - LLxprt has DebugLogger | use debugLogger instead of console (#12095) |
| 65 | `85f3a8c2` | 2025-10-27 | core | Migrate to coreEvents/debugLogger - LLxprt has DebugLogger | Migrate to coreEvents/debugLogger (#12107) |
| 66 | `e115083f` | 2025-10-27 | docs | Revamp pull request template - gemini-cli specific | docs(github): revamp pull request template (#11949) |
| 67 | `44c62c8e` | 2025-10-27 | docs | Contributing guide - gemini-cli specific | Docs: Contributing guide (#12012) |

---

## REIMPLEMENT Table (Chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | `c4c0c0d1` | 2025-10-23 | cli | Major ExtensionManager refactor - needs adaptation for LLxprt architecture | Create ExtensionManager class which manages all high level extension tasks (#11667) |
| 2 | `b188a51c` | 2025-10-24 | core | Message bus for tool execution confirmation - LLxprt has different message bus | feat(core): Introduce message bus for tool execution confirmation (#11544) |
| 3 | `541eeb7a` | 2025-10-27 | cli, core, a2a | Sequential approval - major scheduler changes | feat(core, cli): Implement sequential approval. (#11593) |
| 4 | `29efebe3` | 2025-10-27 | a2a | Recitations events in A2A responses - needs A2A adaptation | Implementing support for recitations events in responses from A2A Server (#12067) |
| 5 | `2a87d663` | 2025-10-27 | core | Extract ChatCompressionService - LLxprt has different compression | refactor(core): extract ChatCompressionService from GeminiClient (#12001) |
| 6 | `2dfb813c` | 2025-10-27 | cli, core | AppContainer polling and footer currentModel - UI state changes | (fix): appcontainer should not poll and footer should use currentModel from ui state (#11923) |
| 7 | `a9cb8f49` | 2025-10-27 | cli, core, docs | OTEL trace instrumentation - needs careful adaptation | feat: added basic dev otel trace instrumentation (#11690) |
| 8 | `1b302dee` | 2025-10-28 | cli, a2a | ExtensionLoader interface on Config - major refactor | Add ExtensionLoader interface, use that on Config object (#12116) |
| 9 | `064edc52` | 2025-10-28 | cli, core | Config-based policy engine with TOML - LLxprt already has policy engine | feat(policy): Introduce config-based policy engine with TOML configuration (#11992) |
| 10 | `5d61adf8` | 2025-10-28 | core | Message bus setting guard for tool confirmation | feat: Add message bus setting guard for tool confirmation (#12169) |
| 11 | `c2d60d61` | 2025-10-28 | cli | Extension explore subcommand - needs adaptation | feat: Add explore subcommand for extension (#11846) |
| 12 | `7e987113` | 2025-10-28 | cli, core, docs | Sensitive keychain-stored per-extension settings | Add support for sensitive keychain-stored per-extension settings (#11953) |
| 13 | `44bdd3ad` | 2025-10-28 | cli, core, docs, integration-tests | Record model responses for testing - useful but needs adaptation | Record model responses with --record-responses (for use in testing) (#11894) |

---

## Commit Details Reference

For quick lookup during execution, here are the full SHAs:

```
ce655436ef97535247daa9d27f572c1ca3ed62ac - PICK #1
0bf2a0353d55f4f94119a45519fbde00d806e717 - PICK #2
6d75005afc3517cd00d3bea766f0e8ff146a0859 - PICK #3
b40f67b76ae49049e979592a37dd122e1bcd7d71 - PICK #4
2ede47d5ee30f815edb1ba41862a8b03c52c7fff - PICK #5
a90b9fe977acc8249c98cb6adcb7ded55ad82054 - PICK #6
8f8a6897224e341d20c6148675fe199e721af855 - PICK #7
d9f0b9c66844ab9b94c053401ce105f5874a976e - PICK #8
92d412e542cf04cfa6d50bf15f0cfd95f439582e - PICK #9
047bc44032d5eb33defe4f5a2e9c6da6765602e3 - PICK #10
1202dced7339ef05e0638442853ee614bab0be03 - PICK #11
8e9f71b7a34953fca0fd77745d448198556f35f0 - PICK #12
5ebe40e91982b7210d6c2720d56c32cdce6a8619 - PICK #13
445ef4fbed7701e51a1f0ab3e982b661186ff7cb - PICK #14
3f38f95b1dde572a05e30e80efa0adb0a98024af - PICK #15
5ae9fe69495ea60cd55b25d05b2506862da424fd - PICK #16
bde5d61812a1aae62d77997f087ebda1209e1f6d - PICK #17
750c0e366f2074c35975ca192aebb4f87a7bc731 - PICK #18
9e91aafe40591166002af1254a0f2a541c460512 - PICK #19
3a501196f0f49f693a531a56e43d56f41bd872b9 - PICK #20
5e70a7dd461d817dcc8e26aecf41c82111752d13 - PICK #21
aa6ae954efeab1beb2b1a41ccd5d39c204bd728d - PICK #22
9814f86a2540096eeec0c7121aff380fe92d0c36 - PICK #23
b77381750cdc4321851d6f0123025978fa8abfde - PICK #24
0fe82a2f4e624fd70229be49da4a501f2f401d84 - PICK #25
884d838a1e0e41e67c8614fdb7f6f2eddfe2066c - PICK #26
a889c15e389fc747299ecc2784862ea888562ada - PICK #27
c079084ca454ef3e83261cfeba1b8719d6163931 - PICK #28
978fbcf95ee53c6c2f5e60b5cdfaf0f9043f9224 - PICK #29
a123a813b25ae9f64a39c2d0033f3a9196106b0a - PICK #30
25996ae037c5d05a1cee515ae9f1c187986f6c4d - PICK #31
c2104a14fbd0de383a2ecd2e70889252bef36c33 - PICK #32
31b7c010d028e0548d3b0756a7eeaa100b258368 - PICK #33
ca94dabd4f84bcf2399a7b90799fe6c89491f6d9 - PICK #34
63a90836fe6a9a2539dade85f303ab461bf82cf6 - PICK #35
40057b55f0c725458b4f3291e85985fcf1716bd8 - PICK #36
c20b88cee2ed488ad611878e7c96716fb12ed071 - PICK #37
d91484eb4dc276e9ccfbeec71e85e1a304f1d950 - PICK #38
cdff69b7b255b8ce1df0c4a7fc09a1d5342e2da2 - PICK #39
f934f018818f3f66e0a141fe9bbccdd03254f191 - PICK #40
145e099ca54524fa1198a607bc0b54082f1661c9 - PICK #41
b1059f891f18c478c2afa0c44766f36654fd7001 - PICK #42
bcd9735a739e05d4c7b3eebaf658e3b2f32e8a66 - PICK #43
ce26b58f09c2e30daad408cd2f8bac30a5ae298a - PICK #44
ef70e6323016f4391aa1f449408c70a381f1711c - PICK #45
51578397a5f0e48ac0e73b2dec42b97a2ad4febc - PICK #46
73570f1c86e7f5e4b027a5879fa2a705be4be6a3 - PICK #47
a2d7f82b499f8d9ed44b732056267ec8e181ebeb - PICK #48
8352980f014743625f5058cd73d5c3abdd69a518 - PICK #49
ee66732ad258f097455ca0664b7084a88a4586d1 - PICK #50
2fa13420aeb67adcbba0ca0fa8c4827be34b8f0d - PICK #51
c7817aee305712c74a139ecb08333fec81a633b9 - PICK #52
23c906b0855e4553cc47321c040e4b28e6c60b15 - PICK #53
5ded674ad6071fbfade3a56f75894c613b24b580 - PICK #54
4ef3c09332d8a272db40028e99b646999c1088e6 - PICK #55
```
