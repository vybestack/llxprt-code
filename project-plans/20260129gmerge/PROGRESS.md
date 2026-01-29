# Progress: v0.15.4 → v0.16.0 Cherry-Pick

**Branch:** `20260129gmerge`
**Started:** 2026-01-29
**Completed:** 2026-01-29

---

## Batch Progress

| Batch | Type | Upstream SHA(s) | Status | LLxprt Commit | Notes |
|------:|------|-----------------|--------|---------------|-------|
| 1 | PICK | e8038c727 d3cf28eb4 cab9b1f37 1c8fe92d0 1c87e7cd2 1ffb9c418 540f60696 | DONE | 1587bf8f0 | Skipped e8038c727 (test file deleted), 1c87e7cd2 (ripgrep different approach), 540f60696 (LLxprt keeps read-many-files) |
| 2 | PICK | 4d85ce40b 0075b4f11 aa9922bc9 ad1f0d995 a810ca80b 43916b98a 13d8d9477 | DONE | 29ac8b252 | Skipped 4d85ce40b (already in LLxprt), 0075b4f11 (ToolsList.tsx deleted). Added CoreEvent.ModelChanged, Command enums. |
| 3 | REIMPLEMENT | ee7065f66 fb99b9537 d30421630 (Sticky Headers) | DONE | e0d9a129a | Created StickyHeader.tsx component. Full ToolMessage integration deferred. |
| 4 | REIMPLEMENT | 3cbb170aa 60fe5acd6 2b8adf8cf (UI Improvements) | SKIPPED | N/A | All features already present in LLxprt: ThemedGradient, animated scroll, drag scrollbar |
| 5 | REIMPLEMENT | fb0324295 (MALFORMED_FUNCTION_CALL) | DONE | 6bf8dbabf | Added MALFORMED_FUNCTION_CALL handling to InvalidStreamError |

---

## Summary

- **Total batches:** 5
- **Completed:** 4 (1 skipped - features already present)
- **In progress:** 0
- **Remaining:** 0

---

## Verification Log

| Batch | Quick Verify | Full Verify | Issues |
|------:|--------------|-------------|--------|
| 1 | [OK] lint, typecheck | [OK] | None |
| 2 | [OK] lint, typecheck | [OK] build, test | Added missing Command enums and CoreEvent.ModelChanged |
| 3 | [OK] lint, typecheck | N/A | None |
| 4 | SKIPPED | N/A | All features already in LLxprt |
| 5 | [OK] lint, typecheck | N/A | None |

---

## Key Findings

### Batch 4 Analysis (Already Implemented)
- **3cbb170aa (ThemedGradient)**: LLxprt already has ThemedGradient.tsx with tmux-safe gradient handling
- **60fe5acd6 (Animated Scroll)**: LLxprt already has smoothScrollTo, smoothScrollState, ANIMATION_FRAME_DURATION_MS in ScrollableList.tsx
- **2b8adf8cf (Drag Scrollbar)**: LLxprt already has dragStateRef, handleLeftPress, handleMove in ScrollProvider.tsx with full drag support

### Commits Applied
1. **1587bf8f0** - Batch 1: Tool display names (PascalCase), extensions await handler, hook result aggregation, abort fix
2. **29ac8b252** - Batch 2: Keyboard shortcuts docs, toml-loader tests, auto reset fallback, buffer cleanup, editor settings
3. **e0d9a129a** - Batch 3: StickyHeader component for Ink UI
4. **6bf8dbabf** - Batch 5: MALFORMED_FUNCTION_CALL handling with retry support
