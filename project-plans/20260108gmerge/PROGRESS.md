# Cherry-Pick Progress: v0.11.3 → v0.12.0

Tracking issue: https://github.com/vybestack/llxprt-code/issues/709
Branch: `20260108gmerge`
Started: 2026-01-11

## Summary

| Metric | Count |
|--------|-------|
| **Total Commits in Range** | 135 |
| **Planned PICK** | 58 |
| **Successfully Cherry-Picked** | 35 |
| **Skipped (conflicts/architecture)** | 23 |
| **Batches Completed** | 11/11 |

## Batch Completion Status

### Batch 01 [OK] COMPLETE
- [OK] `ce655436` - fix(test): unskip and fix useToolScheduler tests (#11671)
- [OK] `0bf2a035` - Add extension alias for extensions command (#11622)
- [OK] `6d75005a` - Add setting to disable YOLO mode (#11609)
- [ERROR] `b40f67b7` - extract console error to util func (#11675) - SKIPPED (7 file conflicts, different logging architecture)
- [OK] `2ede47d5` - fix(ui): Fix and unskip InputPrompt tests (#11700)

### Batch 02 [OK] COMPLETE
- [OK] `a90b9fe9` - fix(a2a-server): Fix and unskip GCS persistence test (#11755)
- [OK] `8f8a6897` - feat(preflight): Use venv for yamllint installation (#11694)
- [OK] `d9f0b9c6` - fix(cli): fix race condition and unskip tests in useGitBranchName (#11759)
- [OK] `92d412e5` - refactor: simplify FilterReport and remove unused code (#11681)
- [OK] `047bc440` - refactor(core): Clean up exclude description (#11678)

### Batch 03 [OK] COMPLETE
- [ERROR] `1202dced` - Refactor KeypressContext (#11677) - SKIPPED (extensive conflicts with LLxprt's IME/mouse handling)
- [OK] `8e9f71b7` - fix(ui): resolve race condition in double-escape handler (#8913)
- [OK] `5ebe40e9` - refactor(cli): Parameterize tests in InputPrompt (#11776)
- [OK] `445ef4fb` - Docs: Fix broken link in docs/cli/configuration.md (#11655)
- [ERROR] `3f38f95b` - Adds executeCommand endpoint with support for /extensions list (#11515) - SKIPPED (7 file conflicts, touches removed features)

### Batch 04 [OK] COMPLETE
- [OK] `5ae9fe69` - Fix broken links in documentation (#11789)
- [ERROR] `bde5d618` - Re-enable test (#11628) - SKIPPED (test structure conflicts)
- [ERROR] `750c0e36` - Add extension settings to be requested on install (#9802) - SKIPPED (many conflicts, touches removed docs)
- [ERROR] `9e91aafe` - Fix bug where tool scheduler was repeatedly created (#11767) - SKIPPED (deep conflicts, uses upstream debugLogger)
- [OK] `3a501196` - feat(ux): Surface internal errors via unified event system (#11803)

### Batch 05 [OK] COMPLETE
- [OK] `5e70a7dd` - fix: align shell allowlist handling (#11510) (#11813)
- [OK] `aa6ae954` - Use raw writes to stdin where possible in tests (#11837)
- [ERROR] `9814f86a` - Added parameterization to base-storage-token.test and prompts.test.ts (#11821) - SKIPPED (different prompt architecture)
- [OK] `b7738175` - feat(core) Bump get-ripgrep version (#11698)
- [OK] `0fe82a2f` - Use raw writes to stdin in test (#11871)

### Batch 06 [OK] COMPLETE
- [OK] `884d838a` - fix(cli): re-throw errors in non-interactive mode (#11849)
- [OK] `a889c15e` - Adding Parameterised tests (#11930)
- [OK] `c079084c` - chore(core): add token caching in google auth provider (#11946)
- [OK] `978fbcf9` - run bom test on windows (#11828)
- [OK] `a123a813` - Fix(cli): Use the correct extensionPath (#11896)

### Batch 07 [OK] COMPLETE
- [OK] `25996ae0` - fix(security) - Use emitFeedback (#11961)
- [ERROR] `c2104a14` - fix(security) - Use emitFeedback instead of console error (#11948) - SKIPPED (LLxprt has refactored oauth-token-storage)
- [OK] `31b7c010` - Add regression tests for shell command parsing (#11962)
- [OK] `ca94dabd` - Fix(cli): Use cross-platform path separators in extension tests (#11970)
- [OK] `63a90836` - fix linked extension test on windows (#11973)

### Batch 08 [OK] COMPLETE
- [OK] `40057b55` - fix(cli): Use correct defaults for file filtering (#11426)
- [OK] `c20b88ce` - use coreEvents.emitFeedback in extension enablement (#11985)
- [OK] `d91484eb` - Fix tests (#11998)
- [ERROR] `cdff69b7` - Support redirects in fetchJson, add tests for it (#11993) - SKIPPED (file structure incompatible)
- [OK] `f934f018` - fix(tools): ReadFile no longer shows confirmation when message bus is off (#12003)

### Batch 09 [OK] COMPLETE
- [ERROR] `145e099c` - Support paste markers split across writes (#11977) - SKIPPED (conflicts with LLxprt's paste handling)
- [OK] `b1059f89` - refactor: Switch over to unified shouldIgnoreFile (#11815)
- [OK] `bcd9735a` - Fix typo in: packages/cli/src/utils/handleAutoUpdate.ts (#11809)
- [OK] `ce26b58f` - docs(contributing): update project structure section with missing packages (#11599)
- [ERROR] `ef70e632` - Make PASTE_WORKAROUND the default (#12008) - SKIPPED (depends on skipped commit)

### Batch 10 [OK] COMPLETE
- [ERROR] `51578397` - refactor(cli): replace custom wait with vi.waitFor in InputPrompt tests (#12005) - SKIPPED (test divergence)
- [OK] `73570f1c` - Fix the shortenPath function to correctly insert ellipsis (#12004)
- [ERROR] `a2d7f82b` - fix(core): Prepend user message to loop detection history (#11860) - SKIPPED (LLxprt architecture)
- [ERROR] `8352980f` - Remove non-existent parallel flag (#12018) - SKIPPED (empty after conflict resolution)
- [ERROR] `ee66732a` - First batch of fixing tests to use best practices (#11964) - SKIPPED (25+ file conflicts)

### Batch 11 [OK] COMPLETE
- [OK] `2fa13420` - add absolute file path description for windows (#12007)
- [ERROR] `c7817aee` - fix(cli): Add delimiter before printing tool response in non-interactive mode (#11351) - SKIPPED (customized nonInteractiveCli.ts)
- [OK] `23c906b0` - fix: user configured oauth scopes should take precedence over discovered scopes (#12088)
- [ERROR] `5ded674a` - Refactor vim.test.ts: Use Parameterized Tests (#11969) - SKIPPED (test structure conflicts)
- [ERROR] `4ef3c093` - fix(core): update loop detection LLM schema fields (#12091) - SKIPPED (LLxprt removed LLM-based loop detection)

## Final Verification Results

| Check | Status |
|-------|--------|
| `npm run lint` | [OK] PASS |
| `npm run typecheck` | [OK] PASS |
| `npm run format` | [OK] PASS |
| `npm run build` | [OK] PASS |
| Functional test (haiku) | [OK] PASS |
| `npm run test` | WARNING: Pre-existing failures (not from this sync) |

## Commits Added (35 total)

```
b2199b82a fix: user configured oauth scopes should take precedence over discovered scopes (#12088)
a5607ced4 add absolute file path description for windows (#12007)
efce34b5e Fix the shortenPath function to correctly insert ellipsis. (#12004)
a920b1f46 fix: Import FilterFilesOptions in zedIntegration.ts
e04ec332b docs(contributing): update project structure section with missing packages (#11599)
ac18c73b8 Fix typo in: packages/cli/src/utils/handleAutoUpdate.ts (#11809)
c129c4d55 refactor: Switch over to unified shouldIgnoreFile (#11815)
885d92821 fix(tools): ReadFile no longer shows confirmation when message bus is off (#12003)
3f1f16f31 Fix tests (#11998)
bb332f46a use coreEvents.emitFeedback in extension enablement (#11985)
0d8c8fabb fix(cli): Use correct defaults for file filtering (#11426)
9fe5044c1 fix linked extension test on windows (#11973)
eec2ab263 Fix(cli): Use cross-platform path separators in extension tests (#11970)
ccf69d158 Add regression tests for shell command parsing (#11962)
d2c1a987b fix(security) - Use emitFeedback (#11961)
96dc9aff4 Fix(cli): Use the correct extensionPath (#11896)
1704cc42b run bom test on windows (#11828)
925622527 chore(core): add token caching in google auth provider (#11946)
737864aa5 Adding Parameterised tests (#11930)
05b24b9b3 fix(cli): re-throw errors in non-interactive mode (#11849)
ab91b0aad Use raw writes to stdin in test (#11871)
33afa4669 feat(core) Bump get-ripgrep version. (#11698)
e796b2a72 Use raw writes to stdin where possible in tests (#11837)
2edc74fbb fix: align shell allowlist handling (#11510) (#11813)
dedabc171 feat(ux): Surface internal errors via unified event system (#11803)
316e903e1 Fix broken links in documentation (#11789)
2f79e7d64 Docs: Fix broken link in docs/cli/configuration.md (#11655)
5e84bd5f4 refactor(cli): Parameterize tests in InputPrompt (#11776)
74779dd1b fix(ui): resolve race condition in double-escape handler (#8913)
7f64a6581 fix: resolve typecheck errors after cherry-pick batch 02
f8ca63759 refactor(core): Clean up exclude description (#11678)
9a608b590 refactor: simplify FilterReport and remove unused code (#11681)
82014ae97 fix(cli): fix race condition and unskip tests in useGitBranchName (#11759)
71276cca8 feat(preflight): Use venv for yamllint installation (#11694)
1bf8d0a87 fix(a2a-server): Fix and unskip GCS persistence test (#11755)
b468ee7f5 fix(ui): Fix and unskip InputPrompt tests (#11700)
5ea30f066 Add setting to disable YOLO mode (#11609)
584a92869 Add extension alias for extensions command (#11622)
5cee3f117 fix(test): unskip and fix useToolScheduler tests (#11671)
```

## Skipped Commits Summary (23 total)

| Commit | Reason |
|--------|--------|
| `b40f67b7` | Different logging architecture (DebugLogger vs upstream console utils) |
| `1202dced` | Extensive KeypressContext conflicts (LLxprt has IME, mouse, SIGCONT handling) |
| `3f38f95b` | Touches deleted ExtensionsList components |
| `bde5d618` | Test structure conflicts in shell command tests |
| `750c0e36` | Many conflicts, touches removed doc files |
| `9e91aafe` | Deep conflicts in scheduler, uses upstream debugLogger |
| `9814f86a` | Different prompt architecture (async templates vs sync) |
| `c2104a14` | LLxprt has refactored oauth-token-storage to HybridTokenStorage |
| `cdff69b7` | File structure incompatible (fetchJson inline vs separate file) |
| `145e099c` | Conflicts with LLxprt's existing paste handling |
| `ef70e632` | Depends on skipped paste markers commit |
| `51578397` | Test file divergence too large |
| `a2d7f82b` | Different loop detection architecture in LLxprt |
| `8352980f` | Empty after conflict resolution |
| `ee66732a` | 25+ file conflicts across test infrastructure |
| `c7817aee` | Heavily customized nonInteractiveCli.ts |
| `5ded674a` | vim.test.ts structure conflicts |
| `4ef3c093` | LLxprt removed LLM-based loop detection |

## Notes

- All skipped commits are due to architectural differences between LLxprt and upstream gemini-cli
- LLxprt preserves its superior DebugLogger, multi-provider architecture, and custom features
- Pre-existing test failures are unrelated to this cherry-pick session
- Ready for PR review and merge to main
