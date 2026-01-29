# Research Summary: v0.14.0 → v0.15.4 Cherry-Pick Sync

Generated: 2026-01-29

## Executive Summary

This document summarizes research findings from subagent investigations to support the cherry-pick sync.

---

## 1. Session Resuming (6893d2744) - --continue Bug Investigation

### Root Cause
Core history restore waits for `geminiClient.getHistoryService()`, which stays null because GeminiChat never initializes when content generator/auth aren't ready. `resetChat()` fails or never creates chat, so the 30s polling in AppContainer times out and emits "history service unavailable." UI restore succeeds but AI context remains empty.

### Feature Gaps
1. Session resume is UI-driven polling, not a deterministic core restore path
2. No explicit resume/session selection flags beyond `--continue` (most-recent only)
3. No guarantee of provider/auth readiness before core history restore
4. No retry/deferral tied to auth/provider initialization
5. No explicit restore API in GeminiClient

### Implementation Plan (Priority Order)
- **P0:** Add core restore API (`GeminiClient.restoreHistory` or `SessionRestoreService`) that ensures content generator + chat are initialized before calling `historyService.addAll()`. Surface explicit errors when auth/config not ready.
- **P0:** Wire CLI startup to call core restore API once config/provider/auth are initialized
- **P1:** Add deferral/retry hook tied to auth/provider readiness
- **P1:** Track restore status in UI with retry action
- **P2:** Add `--resume`/`--session` flags for session selection by ID/index
- **P2:** Persist/restore metadata (provider/model/settings snapshot)

---

## 2. Kitty Keyboard Protocol Removal (9e4ae214a + c0b766ad7)

### Finding
**Upstream did NOT fully remove Kitty protocol support.** They removed Kitty-specific parsing/buffering logic and readline usage to simplify key handling and fix ESC+mouse garbage input (issue #12613), replacing it with a unified ANSI escape parser.

### What Changed
- Removed: Kitty-specific timeouts/overflow telemetry
- Added: New in-house state machine that parses raw stdin ANSI escape sequences, handling CSI codes (including Kitty CSI-u keycodes) within a single parser
- Kept: Kitty capability detection/enabling via `terminalCapabilityManager`

### Recommendation for LLxprt
**Keep Kitty protocol support**, but consider adopting upstream's unified ANSI parser approach if LLxprt has similar ESC/mouse or buffering issues. Upstream did not drop Kitty; it simplified parsing to reduce bugs. If LLxprt's current implementation is stable, no need to remove Kitty.

---

## 3. Extension Commits Analysis

| Commit | Decision | What It Does | LLxprt Action |
|--------|----------|--------------|---------------|
| cc2c48d59 | REIMPLEMENT | Fix uninstall when extension name differs from directory name | Adapt fix in `extension.ts` |
| b248ec6df | REIMPLEMENT | Adds `security.blockGitExtensions` setting and enforcement | Add setting + enforcement |
| 47603ef8e | REIMPLEMENT | Adds core memory refresh helper + MemoryChanged event on extension load/unload | Add mechanism to functional system |
| c88340314 | REIMPLEMENT | Refresh toolset on extension reload when `excludeTools` changes | Add reload handling |
| bafbcbbe8 | REIMPLEMENT | Adds `/extensions restart` and `ExtensionLoader.restartExtension` | Implement restart command |

All five commits touch `extension-manager.ts` which doesn't exist in LLxprt. Each must be adapted to LLxprt's functional extension architecture.

---

## 4. Ink Fork Status (@jrichman/ink)

### Version Comparison
- **LLxprt:** `@jrichman/ink@6.4.7`
- **gemini-cli:** `@jrichman/ink@6.4.8`
- **Mainline ink:** `6.6.0`

### Switch-Back Status
**UNKNOWN.** No evidence found that jrichman's changes have been merged to upstream `vadimdemedes/ink`. The gemini-cli project continues to use the fork with ongoing bumps.

### Recommendation
- Update LLxprt to `@jrichman/ink@6.4.8` to match gemini-cli
- Monitor upstream ink for feature parity
- A full diff of @jrichman/ink vs mainline 6.6.0 would identify blockers

---

## 5. Animated Scroll (e192efa1f)

### Implementation Plan
Add smooth 200ms ease-in-out scroll animation for PAGE_UP, PAGE_DOWN, HOME, END keys.

### Key Files to Modify
- `packages/cli/src/ui/components/shared/ScrollableList.tsx` (~160 lines)

### Architecture
- **smoothScrollState ref:** Tracks active animations
- **stopSmoothScroll callback:** Interrupts ongoing animations
- **smoothScrollTo function:** Implements animation with easing

### Code Changes Summary
1. Add `useEffect` to React imports
2. Add `ANIMATION_FRAME_DURATION_MS = 33` constant
3. Use `useAnimatedScrollbar` hook (already exists)
4. Add smooth scroll state management
5. Update `useKeypress` handler for animated keys
6. Update `scrollableEntry` useMemo

---

## 6. Scrollbar Drag Support

### Finding
**ALREADY IMPLEMENTED** in LLxprt! Full drag implementation exists in:
- `ScrollProvider.tsx`: Drag state, handleLeftPress, handleMove, handleLeftRelease
- `mouse.ts`: SGR/X11 protocol parsers
- `MouseContext.tsx`: Event broadcasting

**No action needed.**

---

## Research Sources
- Subagent investigations (deepthinker, typescriptexpert)
- gemini-cli Git history (commits, PR messages)
- LLxprt codebase analysis
- NPM package metadata
