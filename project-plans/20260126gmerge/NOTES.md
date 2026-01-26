# Cherry-Pick Notes: v0.13.0 to v0.14.0

**Branch:** `20260126gmerge`

---

## Running Notes

### Planning Phase (2026-01-26)

- Created branch `20260126gmerge` from main
- Fetched upstream tags
- Analyzed 33 commits in v0.13.0..v0.14.0 range
- Research findings:
  - LLxprt UI scrolling is MORE advanced than upstream (batching, drag-drop)
  - Quota handling architecture completely different (errorParsing.ts vs useQuotaAndFallback.ts)
  - ModelConfigService incompatible with multi-provider
  - One test needs reimplementation (list_directory flaky fix)

---

## Batch Notes

### Batch 1

**Executed:** 2026-01-26 14:38-14:55

**f51d74586c (retryInfo parsing):** SKIPPED - Empty after merge, changes already present in LLxprt.

**16113647de (windows pty crash):** SKIPPED - Empty after merge, changes already present in LLxprt.

**f5bd474e51 (policy server name spoofing):** PICKED as 8dee84781
- Applied cleanly
- Security fix for MCP tool policy engine

**fa93b56243 (extension reloading):** SKIPPED - Too complex
- 24 files touched
- Many files deleted in LLxprt (extension-manager.ts, AuthDialog.tsx, ScopeSelector.tsx, etc.)
- Would require significant manual rework
- Recommend: Create separate issue for extension reloading feature if needed

**9787108532 (tool ordering):** PICKED as 5c505bf63
- Applied cleanly
- Ensures consistent tool listing order

### Batch 2

**Executed:** 2026-01-26 14:55-15:10

**224a33db2e (animated components tracking):** PICKED as 18d8a445a
- Applied cleanly
- Improved tracking for UI animation components

**0f5dd2229c (remove policy TOML files):** SKIPPED
- Files already removed in LLxprt (read-only.toml, write.toml, yolo.toml)
- No action needed

**5f6453a1e0 (policy priority tests):** PICKED as 0b5ef0274
- Applied cleanly
- Adds comprehensive priority range validation tests

**9ba1cd0336 (shell cwd in description):** PICKED as 1f2c6a441
- Applied cleanly
- Includes current working directory in shell command description

**c585470a71 (InputPrompt it.each tests):** PICKED as 6610f7915
- Applied cleanly
- Consolidates repetitive tests using it.each pattern

**Additional commits:**
- d20155a4a - fix: post-batch 2 - semantic-colors.ts export structure
- 173e16f71 - chore: format changes from batch 2

### Batch 3

**Executed:** 2026-01-26 15:10-15:25

**77614eff5b (multi-replace test):** PICKED as bfafeec5f
- Minor conflict in file-system.test.ts (resolved by keeping LLxprt assertions)
- Adds test for replacing multiple instances of a string

**c13ec85d7d (keychain storage name):** SKIPPED
- Files deleted in LLxprt (extensionSettings.ts, docs/extensions/index.md)
- No action needed

**f05d937f39 (consistent param names):** SKIPPED - Too complex
- 20+ files with conflicts
- Renames file_path -> absolute_path across all tools
- Recommend: Consider as dedicated refactoring task if desired

**c81a02f8d2 (DiscoveredTool policy):** PICKED as cd8ad1e3f
- Conflicts in:
  - discovered.toml - Merged comments from both sides
  - tool-registry.ts - Kept LLxprt version, added DISCOVERED_TOOL_PREFIX export
  - tool-registry.test.ts - Kept LLxprt version
- Integrates discovered tools with policy engine

### Batch 4 (Reimplement)

**Executed:** 2026-01-26 15:25-15:30

**b445db3d46 (list_directory flaky test):** REIMPLEMENTED as 064ceff8e
- Could not cherry-pick directly due to:
  - Different rig.setup() signature (async vs sync)
  - Different expectToolCallSuccess signature
- Reimplemented by:
  - Replacing waitForToolCall() + expect().toBeTruthy() with expectToolCallSuccess()
  - Adding try-catch for better error diagnostics
  - Removing unused expect import

---

## Follow-ups Created

| Item | Description | Status |
|------|-------------|--------|
| Extension Reloading | fa93b56243 - Consider porting extension enable/disable if needed | TODO |
| Consistent Param Names | f05d937f39 - Consider file_path -> absolute_path rename refactor | TODO |

---

## Deviations from Plan

| Batch | Deviation | Reason |
|-------|-----------|--------|
| 1 | 2 commits skipped (already present) | f51d74586c and 16113647de merged empty |
| 1 | fa93b56243 skipped | Too many conflicts (24 files, many deleted) |
| 2 | 0f5dd2229c skipped | Policy TOML files already removed |
| 3 | c13ec85d7d skipped | Files deleted in LLxprt |
| 3 | f05d937f39 skipped | Too many conflicts (20+ files) |

---

## Verification Summary

- **Lint:** All batches PASS
- **Typecheck:** All batches PASS
- **Tests:** 3062 tests passed, 52 skipped (all batches)
- **Build:** PASS
- **Smoke test:** PASS (synthetic profile haiku generation)
