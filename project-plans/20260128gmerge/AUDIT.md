# Audit: v0.14.0 -> v0.15.4 Sync

**Branch:** `20260128gmerge`
**Date:** 2026-01-28

---

## Summary

| Category | Count |
|----------|-------|
| Upstream commits analyzed | 54 |
| PICK (direct cherry-pick) | 13 applied |
| REIMPLEMENT (adapted) | 11 applied |
| SKIP (not applicable) | 27 |
| DEFERRED (future PR) | 3 (Batch 5) |

---

## Per-Commit Outcomes

### Batch 1 (PICK - Low Risk)

| SHA | Subject | Outcome | Notes |
|-----|---------|---------|-------|
| 054497c7a | Handle null command in VSCode IDE detection | APPLIED | Clean |
| 475e92da5 | Fix test in windows | APPLIED | Clean |
| ef4030331 | Fix typos in some files | APPLIED | types.ts conflict (deleted) |
| 5ff7cdc9e | Add extreme priority value tests | APPLIED | Clean |
| 331dbd563 | Preserve tabs on paste | APPLIED | Branding conflict |
| 4ab94dec5 | Fix flaky file system integration test | APPLIED | Clean |
| 3c9052a75 | Stop printing garbage for F1,F2 keys | SKIPPED | Keyboard architecture conflicts |
| 2136598e8 | Harden modifiable tool temp workspace | APPLIED | Minor test fix |

### Batch 2 (PICK - Medium Risk)

| SHA | Subject | Outcome | Notes |
|-----|---------|---------|-------|
| 5ba6bc713 | Add Angular support to base prompt | APPLIED | Minor conflict |
| 51f952e70 | Use ripgrep --json output | SKIPPED | Already implemented |
| fd59d9dd9 | Fix shift+return in vscode | SKIPPED | Already implemented |
| 9116cf2ba | Rename icon to prefix | SKIPPED | Requires refactor |
| c1076512d | Deprecate read_many_files | SKIPPED | Extensive docs needed |
| 2abc288c5 | Make useFullWidth the default | APPLIED | Clean |

### Batch 3 (PICK - Extension/A2A)

| SHA | Subject | Outcome | Notes |
|-----|---------|---------|-------|
| a0a682826 | Fix downloading from private GitHub repos | APPLIED | Test conflict |
| 69339f08a | Add listCommands endpoint to a2a server | APPLIED | Branding fixes |

### Batch 4 (PICK + Manual)

| SHA | Subject | Outcome | Notes |
|-----|---------|---------|-------|
| 4ef4bd6f0 | Hook Execution Engine | APPLIED | debugLogger fix, LLXPRT env |
| - | Ink bump 6.4.7 -> 6.4.8 | APPLIED | Manual change |

### Batch 5 (REIMPLEMENT - Deferred)

| SHA | Subject | Outcome | Notes |
|-----|---------|---------|-------|
| 9e4ae214a | Revamp KeypressContext | DEFERRED | 1000+ line change |
| c0b766ad7 | Simplify switch case | DEFERRED | Part of above |

### Batch 6 (REIMPLEMENT)

| SHA | Subject | Outcome | Notes |
|-----|---------|---------|-------|
| 37ca643a6 | Fix editor diff drift | REIMPLEMENTED | contentOverrides param |
| 22b055052 | Fix tmux gradient crash | REIMPLEMENTED | ThemedGradient component |

### Batch 7 (REIMPLEMENT)

| SHA | Subject | Outcome | Notes |
|-----|---------|---------|-------|
| cc2c48d59 | Fix extension uninstall | REIMPLEMENTED | path.basename fix |
| b248ec6df | Add blockGitExtensions setting | REIMPLEMENTED | Schema + enforcement |

### Batch 8 (REIMPLEMENT)

| SHA | Subject | Outcome | Notes |
|-----|---------|---------|-------|
| 47603ef8e | Memory refresh helper | REIMPLEMENTED | MemoryChanged event |
| c88340314 | Toolset refresh on reload | REIMPLEMENTED | maybeRefreshGeminiTools |
| bafbcbbe8 | /extensions restart command | REIMPLEMENTED | With completion |

### Batch 9 (REIMPLEMENT)

| SHA | Subject | Outcome | Notes |
|-----|---------|---------|-------|
| e192efa1f | Animated scroll | REIMPLEMENTED | 200ms ease-in-out |

### Batch 10 (REIMPLEMENT)

| SHA | Subject | Outcome | Notes |
|-----|---------|---------|-------|
| 6893d2744 | Session resuming | REIMPLEMENTED | GeminiClient.restoreHistory() |

---

## Skip Justifications

### Already Implemented in LLxprt

| SHA | Subject | LLxprt Equivalent |
|-----|---------|-------------------|
| 51f952e70 | ripgrep --json | ripGrep.ts already uses --json |
| fd59d9dd9 | shift+return | backslashTimeout handling |
| f581ae81d | Drag scrollbar | ScrollProvider.tsx drag support |
| f64994871 | Batch scroll events | useBatchedScroll hook |

### Not Applicable to LLxprt

| SHA | Subject | Reason |
|-----|---------|--------|
| 2077521f8 | YAML fixes | Different issue template format |
| 2e2b06671 | Temp dir in prompt | Prompt section doesn't exist |
| 3154c06dc | Ripgrep race condition | LLxprt uses @lvce-editor/ripgrep |
| 046b3011c | Sticky borders | Architecture-specific |
| 395587105 | Truncate headers | Architecture-specific |

### Requires Extensive Refactoring

| SHA | Subject | Scope |
|-----|---------|-------|
| 9116cf2ba | icon->prefix rename | Extension manager refactor |
| c1076512d | read_many_files deprecation | 7 files, docs, tests |
| cbbf56512 | Ink scrolling | 2364 lines, new components |

---

## Verification Summary

### Tests Passing

```
CLI:        3142 passed | 52 skipped
A2A:        45 passed
VSCode IDE: 32 passed | 1 skipped
```

### Build Status

All packages build successfully.

### Lint Status

No lint errors.

### Type Check Status

No type errors.

---

## Risk Assessment

### Low Risk (Verified)
- All PICK commits with clean cherry-pick
- All REIMPLEMENT commits with passing tests

### Medium Risk (Monitor)
- Session restore fix (Batch 10) - needs real-world testing
- Extension lifecycle (Batch 8) - complex state management

### Deferred Risk
- KeypressContext (Batch 5) - 1000+ lines, affects all keyboard input

---

## Recommendations

1. **Merge this branch** - All critical changes applied and verified
2. **Create follow-up PR for Batch 5** - KeypressContext unified parser
3. **Test --continue flag** - Session restore fix needs real-world validation
4. **Monitor extension restart** - New /extensions restart command
5. **Consider deprecating read_many_files** - In future release

---

## Sign-off

- [x] All batches executed (except deferred Batch 5)
- [x] All verification passed
- [x] Documentation updated
- [x] No critical issues remaining
