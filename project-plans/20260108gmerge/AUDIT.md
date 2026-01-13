# Audit: v0.11.3 → v0.12.0 Cherry-Pick

Tracking issue: https://github.com/vybestack/llxprt-code/issues/709

## Summary

| Category | Count |
|----------|-------|
| PICKED | 0 |
| SKIPPED | 67 |
| REIMPLEMENTED | 0 |
| DEFERRED | 13 |
| **Total** | 135 |

---

## PICK Audit (55 commits → 11 batches)

| Batch | Upstream SHA | Decision | LLxprt Commit | Notes |
|-------|-------------|----------|---------------|-------|
| 01 | ce655436 | PICK | - | fix(test): unskip and fix useToolScheduler tests |
| 01 | 0bf2a035 | PICK | - | Add extension alias for extensions command |
| 01 | 6d75005a | PICK | - | Add setting to disable YOLO mode |
| 01 | b40f67b7 | PICK | - | extract console error to util func |
| 01 | 2ede47d5 | PICK | - | fix(ui): Fix and unskip InputPrompt tests |
| 02 | a90b9fe9 | PICK | - | fix(a2a-server): Fix and unskip GCS persistence test |
| 02 | 8f8a6897 | PICK | - | feat(preflight): Use venv for yamllint installation |
| 02 | d9f0b9c6 | PICK | - | fix(cli): fix race condition and unskip tests in useGitBranchName |
| 02 | 92d412e5 | PICK | - | refactor: simplify FilterReport and remove unused code |
| 02 | 047bc440 | PICK | - | refactor(core): Clean up exclude description |
| 03 | 1202dced | PICK | - | Refactor KeypressContext |
| 03 | 8e9f71b7 | PICK | - | fix(ui): resolve race condition in double-escape handler |
| 03 | 5ebe40e9 | PICK | - | refactor(cli): Parameterize tests in InputPrompt |
| 03 | 445ef4fb | PICK | - | Docs: Fix broken link in docs/cli/configuration.md |
| 03 | 3f38f95b | PICK | - | Adds executeCommand endpoint with support for /extensions list |
| 04 | 5ae9fe69 | PICK | - | Fix broken links in documentation |
| 04 | bde5d618 | PICK | - | Re-enable test |
| 04 | 750c0e36 | PICK | - | Add extension settings to be requested on install |
| 04 | 9e91aafe | PICK | - | Fix bug where tool scheduler was repeatedly created |
| 04 | 3a501196 | PICK | - | feat(ux): Surface internal errors via unified event system |
| 05 | 5e70a7dd | PICK | - | fix: align shell allowlist handling |
| 05 | aa6ae954 | PICK | - | Use raw writes to stdin where possible in tests |
| 05 | 9814f86a | PICK | - | Added parameterization to base-storage-token.test and prompts.test.ts |
| 05 | b7738175 | PICK | - | feat(core) Bump get-ripgrep version |
| 05 | 0fe82a2f | PICK | - | Use raw writes to stdin in test |
| 06 | 884d838a | PICK | - | fix(cli): re-throw errors in non-interactive mode |
| 06 | a889c15e | PICK | - | Adding Parameterised tests |
| 06 | c079084c | PICK | - | chore(core): add token caching in google auth provider |
| 06 | 978fbcf9 | PICK | - | run bom test on windows |
| 06 | a123a813 | PICK | - | Fix(cli): Use the correct extensionPath |
| 07 | 25996ae0 | PICK | - | fix(security) - Use emitFeedback |
| 07 | c2104a14 | PICK | - | fix(security) - Use emitFeedback instead of console error |
| 07 | 31b7c010 | PICK | - | Add regression tests for shell command parsing |
| 07 | ca94dabd | PICK | - | Fix(cli): Use cross-platform path separators in extension tests |
| 07 | 63a90836 | PICK | - | fix linked extension test on windows |
| 08 | 40057b55 | PICK | - | fix(cli): Use correct defaults for file filtering |
| 08 | c20b88ce | PICK | - | use coreEvents.emitFeedback in extension enablement |
| 08 | d91484eb | PICK | - | Fix tests |
| 08 | cdff69b7 | PICK | - | Support redirects in fetchJson |
| 08 | f934f018 | PICK | - | fix(tools): ReadFile no longer shows confirmation when message bus is off |
| 09 | 145e099c | PICK | - | Support paste markers split across writes |
| 09 | b1059f89 | PICK | - | refactor: Switch over to unified shouldIgnoreFile |
| 09 | bcd9735a | PICK | - | Fix typo in handleAutoUpdate |
| 09 | ce26b58f | PICK | - | docs(contributing): update project structure section |
| 09 | ef70e632 | PICK | - | Make PASTE_WORKAROUND the default |
| 10 | 51578397 | PICK | - | refactor(cli): replace custom wait with vi.waitFor in InputPrompt tests |
| 10 | 73570f1c | PICK | - | Fix the shortenPath function to correctly insert ellipsis |
| 10 | a2d7f82b | PICK | - | fix(core): Prepend user message to loop detection history |
| 10 | 8352980f | PICK | - | Remove non-existent parallel flag |
| 10 | ee66732a | PICK | - | First batch of fixing tests to use best practices |
| 11 | 2fa13420 | PICK | - | add absolute file path description for windows |
| 11 | c7817aee | PICK | - | fix(cli): Add delimiter before printing tool response in non-interactive mode |
| 11 | 23c906b0 | PICK | - | fix: user configured oauth scopes should take precedence |
| 11 | 5ded674a | PICK | - | Refactor vim.test.ts: Use Parameterized Tests |
| 11 | 4ef3c093 | PICK | - | fix(core): update loop detection LLM schema fields |

---

## SKIP Audit (67 commits)

| Upstream SHA | Decision | Rationale |
|-------------|----------|-----------|
| 59985138 | SKIP | Version bump - release management |
| 5bb9cd1a | SKIP | GitHub workflow - gemini-cli infra |
| a7faa208 | SKIP | GitHub workflow - gemini-cli infra |
| 4f220e94 | SKIP | ClearcutLogger telemetry - removed from LLxprt |
| 30dd2f1d | SKIP | LLxprt has completely different todo implementation |
| eee34529 | SKIP | Gemini-cli changelog - not applicable |
| d3e4ff2c | SKIP | GitHub workflow - lychee link checker |
| 8ad72ec1 | SKIP | GitHub workflow - gemini-cli infra |
| 7787a31f | SKIP | GitHub workflow - gemini-cli infra |
| 48ff9e15 | SKIP | GitHub workflow - gemini-cli infra |
| b16fe7b6 | SKIP | FakeContentGenerator - needs separate evaluation |
| d915525c | SKIP | Telemetry documentation - LLxprt has different telemetry |
| 8bdef875 | SKIP | ClearcutLogger - removed from LLxprt |
| 4960c472 | SKIP | GitHub workflow - gemini-cli infra |
| ee92db75 | SKIP | LLxprt has different retry architecture, FlashFallback removed |
| 7e2642b9 | SKIP | debugLogger.warn - LLxprt has DebugLogger |
| 810d940e | SKIP | Replace update-notifier - different update system |
| 81006605 | SKIP | debugLogger migration - LLxprt has DebugLogger |
| e750da98 | SKIP | debugLogger migration - LLxprt has DebugLogger |
| 9e8f7c07 | SKIP | BYOID auth client - Google-specific |
| abd22a75 | SKIP | ID token support - then reverted |
| 6db64aab | SKIP | StartSessionEvent - ClearcutLogger |
| cb0947c5 | SKIP | TSC build config - build specific |
| e9f8ccd5 | SKIP | GEMINI_MODEL env var test - Gemini specific |
| cb208f53 | SKIP | Genkit telemetry - Google-specific |
| ecf0a248 | SKIP | Parameterize glob tests - minor |
| cca5a128 | SKIP | README installation - branding |
| 034ca939 | SKIP | Revert ID token support |
| d465a26e | SKIP | Console errors in sa-impersonation - minor |
| 25f27509 | SKIP | Revert nightly schedule - gemini-cli infra |
| 4e6eef58 | SKIP | debugLogger migration - LLxprt has DebugLogger |
| 13aa0148 | SKIP | Migrate tests to avoid jsdom - test infrastructure |
| 7a238bd9 | SKIP | GitHub workflow - e2e specific |
| 39eb6ed9 | SKIP | debugLogger migration - LLxprt has DebugLogger |
| ab1f1955 | SKIP | Debug drawer keybinding - may conflict |
| 70996bfd | SKIP | OTEL semantic log - Google telemetry |
| f6423ea4 | SKIP | Remove obsolete snapshots - minor |
| 601a639f | SKIP | Disable model routing - Google-specific |
| cca41edc | SKIP | Symlink CONTRIBUTING.md - docs site |
| fe98c855 | SKIP | Release version bump |
| b4a63bf7 | SKIP | Merge commit for preview release |
| 7124551a | SKIP | Release version bump |
| 3876379b | SKIP | Cherry-pick patch for preview |
| cd4bebba | SKIP | Release version bump |
| 66b61a13 | SKIP | Cherry-pick patch - chatCompressionService |
| 30dc89c8 | SKIP | Release version bump |
| 174462f4 | SKIP | Cherry-pick patch - config changes |
| 2072d90a | SKIP | Release version bump |
| fe44afe8 | SKIP | Cherry-pick patch - settings/compression |
| a0198269 | SKIP | Release version bump |
| 9fbea50e | SKIP | Cherry-pick patch - telemetry loggers |
| 3d44880e | SKIP | Release version bump |
| cc076e95 | SKIP | Cherry-pick patch - loop detection |
| 5d7772ff | SKIP | Release version bump |
| d756ef64 | SKIP | Remove context percentage in footer |
| 09a65920 | SKIP | compressionThreshold restart - settings |
| a893c8c7 | SKIP | Simplify daily quota error messages |
| 1c445865 | SKIP | Release version bump |
| a2cb1169 | SKIP | Cherry-pick patch with conflicts |
| 51a415f2 | SKIP | Cherry-pick commits for release - bundled |
| d6f977cb | SKIP | Cherry-pick screen reader nudge |
| 9e7c80f2 | SKIP | Release version bump |
| 5839bb53 | SKIP | Final release version bump |
| 0e4dce23 | SKIP | debugLogger migration - LLxprt has DebugLogger |
| 85f3a8c2 | SKIP | Migrate to coreEvents/debugLogger - LLxprt has DebugLogger |
| e115083f | SKIP | Revamp pull request template - gemini-cli specific |
| 44c62c8e | SKIP | Contributing guide - gemini-cli specific |

---

## REIMPLEMENT Audit (13 commits - DEFERRED)

| Upstream SHA | Decision | Status | LLxprt Commit | Notes |
|-------------|----------|--------|---------------|-------|
| c4c0c0d1 | REIMPLEMENT | DEFERRED | - | Create ExtensionManager class |
| b188a51c | REIMPLEMENT | DEFERRED | - | Introduce message bus for tool execution confirmation |
| 541eeb7a | REIMPLEMENT | DEFERRED | - | Implement sequential approval |
| 29efebe3 | REIMPLEMENT | DEFERRED | - | Recitations events in A2A responses |
| 2a87d663 | REIMPLEMENT | DEFERRED | - | Extract ChatCompressionService |
| 2dfb813c | REIMPLEMENT | DEFERRED | - | AppContainer polling and footer currentModel |
| a9cb8f49 | REIMPLEMENT | DEFERRED | - | OTEL trace instrumentation |
| 1b302dee | REIMPLEMENT | DEFERRED | - | ExtensionLoader interface on Config |
| 064edc52 | REIMPLEMENT | DEFERRED | - | Config-based policy engine with TOML |
| 5d61adf8 | REIMPLEMENT | DEFERRED | - | Message bus setting guard for tool confirmation |
| c2d60d61 | REIMPLEMENT | DEFERRED | - | Extension explore subcommand |
| 7e987113 | REIMPLEMENT | DEFERRED | - | Sensitive keychain-stored per-extension settings |
| 44bdd3ad | REIMPLEMENT | DEFERRED | - | Record model responses for testing |
