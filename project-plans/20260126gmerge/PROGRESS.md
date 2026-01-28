# Cherry-Pick Progress: v0.13.0 to v0.14.0

**Branch:** `20260126gmerge`  
**Started:** 2026-01-26  
**Completed:** 2026-01-27

---

## Batch Progress

| Batch | Type | Upstream SHA(s) | Status | LLxprt Commit(s) | Notes |
|------:|------|-----------------|--------|------------------|-------|
| 1 | PICK x5 | f51d745, 1611364, f5bd474, fa93b56, 9787108 | DONE | 8dee84781, 5c505bf63 | f51d745 skipped (already present), 1611364 skipped (already present), fa93b56 skipped (too many conflicts) |
| 2 | PICK x5 | 224a33d, 0f5dd22, 5f6453a, 9ba1cd0, c585470 | DONE | 18d8a445a, 0b5ef0274, 1f2c6a441, 6610f7915, d20155a4a, 173e16f71 | 0f5dd22 skipped (files already removed) |
| 3 | PICK x4 | 77614ef, c13ec85, f05d937, c81a02f | DONE | bfafeec5f, cd8ad1e3f | c13ec85 skipped (files deleted), f05d937 skipped (too many conflicts) |
| 4 | REIMPLEMENT x1 | b445db3 | DONE | 064ceff8e | Full verify passed |

---

## Feature Implementation Progress (TDD)

| Feature | Phase | Status | LLxprt Commit | Notes |
|---------|-------|--------|---------------|-------|
| Extension Reloading (fa93b56243) | Phase 1 - Session Scope | DONE | 70a48a815 | SettingScope.Session for runtime-only |
| Extension Reloading (fa93b56243) | Phase 2 - Command Reloading | DONE | aff32d409 | Filter commands by enabled state |
| Extension Reloading (fa93b56243) | Phase 3 - Tab Completion | DONE | f15a1e2f1 | Filter tab completion |
| Consistent Params (f05d937f39) | Phase 1 - write-file, edit | DONE | b3698d634 | absolute_path as primary |
| Consistent Params (f05d937f39) | Phase 2 - glob, grep, ls | DONE | e95318659 | dir_path as primary |
| Consistent Params (f05d937f39) | Phase 3 - shell | DONE | 18db6603b | dir_path as primary |
| Extension Settings (c13ec85d7d) | Phase 1 - Schema | DONE | 965d4a804 | ExtensionSettingSchema |
| Extension Settings (c13ec85d7d) | Phase 2 - Storage | DONE | 784dcf88f | ExtensionSettingsStorage |
| Extension Settings (c13ec85d7d) | Phase 3 - Prompt UI | DONE | e67a27bea | maybePromptForSettings |
| Extension Settings (c13ec85d7d) | Phase 4 - Integration | DONE | aa9866c14 | settingsIntegration layer |
| Extension Settings (c13ec85d7d) | Phase 5 - Keychain | DONE | d0ecb81a5 | Keychain integration |

---

## Status Legend

- `TODO` - Not started
- `DOING` - In progress
- `DONE` - Completed successfully
- `BLOCKED` - Waiting on something
- `FAILED` - Failed, needs investigation

---

## Verification Log

| Batch | Quick Verify | Full Verify | Issues |
|------:|--------------|-------------|--------|
| 1 | PASS | N/A | None |
| 2 | PASS | PASS | None |
| 3 | PASS | N/A | None |
| 4 | PASS | PASS | None |

---

## Timeline

| Event | Timestamp | Notes |
|-------|-----------|-------|
| Planning complete | 2026-01-26 | CHERRIES.md, SUMMARY.md, PLAN.md created |
| Batch 1 started | 2026-01-26 14:38 | |
| Batch 1 completed | 2026-01-26 14:55 | 2 picked, 3 skipped |
| Batch 2 started | 2026-01-26 14:55 | |
| Batch 2 completed | 2026-01-26 15:10 | 4 picked, 1 skipped |
| Batch 3 started | 2026-01-26 15:10 | |
| Batch 3 completed | 2026-01-26 15:25 | 2 picked, 2 skipped |
| Batch 4 started | 2026-01-26 15:25 | |
| Batch 4 completed | 2026-01-26 15:30 | 1 reimplemented |
| PR ready | 2026-01-26 15:35 | All batches complete |

---

## Summary

### Commits Applied (11 total)

**Batch 1:**
- `8dee84781` - fix(core): prevent server name spoofing in policy engine (upstream f5bd474e51)
- `5c505bf63` - List tools in a consistent order (upstream 9787108532)

**Batch 2:**
- `18d8a445a` - Improve tracking of animated components (upstream 224a33db2e)
- `0b5ef0274` - feat(policy): Add comprehensive priority range validation tests (upstream 5f6453a1e0)
- `1f2c6a441` - feat(shell): include cwd in shell command description (upstream 9ba1cd0336)
- `6610f7915` - refactor(cli): consolidate repetitive tests in InputPrompt using it.each (upstream c585470a71)
- `d20155a4a` - fix: post-batch 2 - semantic-colors.ts export structure
- `173e16f71` - chore: format changes from batch 2

**Batch 3:**
- `bfafeec5f` - fix(#11707): should replace multiple instances of a string test (upstream 77614eff5b)
- `cd8ad1e3f` - fix: integrate DiscoveredTool with Policy Engine (upstream c81a02f8d2)

**Batch 4:**
- `064ceff8e` - reimplement: make list dir test less flaky (upstream b445db3d46)

### Commits Skipped (4 total - 3 others REIMPLEMENTED as features)

1. `f51d74586c` - refactor: parse string for retryInfo - Already present in LLxprt
2. `16113647de` - Fix/windows pty crash - Already present in LLxprt
3. `0f5dd2229c` - chore: remove unused CLI policy TOML files - Files already removed
4. `fa93b56243` - [Extension Reloading] - **REIMPLEMENTED** via TDD (commits 70a48a815, aff32d409, f15a1e2f1)
5. `f05d937f39` - Use consistent param names - **REIMPLEMENTED** via TDD (commits b3698d634, e95318659, 18db6603b)
6. `c13ec85d7d` - Update keychain storage name - **REIMPLEMENTED** via TDD (commits 965d4a804, 784dcf88f, e67a27bea, aa9866c14, d0ecb81a5)

---

## Final Verification

| Check | Status | Notes |
|-------|--------|-------|
| npm run lint | PASS | No lint errors |
| npm run typecheck | PASS | No type errors |
| npm run test | PASS | All tests passing |
| npm run build | PASS | Build successful |
| Smoke test | PASS | Generated haiku successfully |
