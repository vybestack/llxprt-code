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

## Additional Work

| Feature | LLxprt Commit | Notes |
|---------|---------------|-------|
| Interactive Shell UI (181898cb) | 6df7e5f99, 612101d0c | Phases 1-4: terminalSerializer, AnsiOutput, ShellInputPrompt, keyToAnsi, Config wiring |
| StickyHeader Integration | e77e438e3 | Complete integration in ToolGroupMessage |
| Settings Scope Fix | c0202daea | Exclude Session scope from forScope() iteration |
| AnsiOutput Rendering | 18cb40ceb | Port serializeTerminalToObject() for PTY mode ANSI colors |
| AnsiOutput Fix | 8fdfcd3e0 | Pass AnsiOutput directly instead of JSON.stringify |
| AnsiOutput dimColor | 8b4ba4cbc | Sync dimColor and color handling with upstream |
| AnsiOutput Type Chain | 0dc3c0317 | Full type support through CoreToolScheduler → shell → UI chain |

---

## Summary

- **Total batches:** 5
- **Completed:** 4 (1 skipped - features already present)
- **In progress:** 0
- **Remaining:** 0
- **Additional features:** 7 (Interactive Shell, StickyHeader integration, Settings fix, AnsiOutput rendering + fixes + type chain)

---

## Verification Log

| Batch | Quick Verify | Full Verify | Issues |
|------:|--------------|-------------|--------|
| 1 | [OK] lint, typecheck | [OK] | None |
| 2 | [OK] lint, typecheck | [OK] build, test | Added missing Command enums and CoreEvent.ModelChanged |
| 3 | [OK] lint, typecheck | N/A | None |
| 4 | SKIPPED | N/A | All features already in LLxprt |
| 5 | [OK] lint, typecheck | N/A | None |
| Shell Fix | [OK] lint, typecheck | N/A | None |

---

## Key Findings

### Batch 4 Analysis (Already Implemented)
- **3cbb170aa (ThemedGradient)**: LLxprt already has ThemedGradient.tsx with tmux-safe gradient handling
- **60fe5acd6 (Animated Scroll)**: LLxprt already has smoothScrollTo, smoothScrollState, ANIMATION_FRAME_DURATION_MS in ScrollableList.tsx
- **2b8adf8cf (Drag Scrollbar)**: LLxprt already has dragStateRef, handleLeftPress, handleMove in ScrollProvider.tsx with full drag support

### Interactive Shell Fix
- ShellExecutionService now emits `AnsiOutput` (array of token arrays) instead of plain strings when PTY mode is active
- Added `ShellExecutionConfig` interface for terminal dimensions, pager, color settings
- `shellCommandProcessor` now handles both string and AnsiOutput types
- Terminal dimensions passed from `useGeminiStream` through AppContainer

### Commits Applied
1. **1587bf8f0** - Batch 1: Tool display names (PascalCase), extensions await handler, hook result aggregation, abort fix
2. **29ac8b252** - Batch 2: Keyboard shortcuts docs, toml-loader tests, auto reset fallback, buffer cleanup, editor settings
3. **e0d9a129a** - Batch 3: StickyHeader component for Ink UI
4. **6bf8dbabf** - Batch 5: MALFORMED_FUNCTION_CALL handling with retry support
5. **6df7e5f99** - Interactive Shell UI support (181898cb) - Phases 1-3 complete
6. **612101d0c** - Interactive Shell Phase 4 wiring
7. **e77e438e3** - StickyHeader integration in ToolGroupMessage
8. **c0202daea** - Settings Session scope fix
9. **18cb40ceb** - AnsiOutput rendering for PTY mode
10. **8fdfcd3e0** - Pass AnsiOutput directly to resultDisplay
11. **8b4ba4cbc** - Sync AnsiOutput dimColor and color handling
12. **0dc3c0317** - Full AnsiOutput type support through execution chain
