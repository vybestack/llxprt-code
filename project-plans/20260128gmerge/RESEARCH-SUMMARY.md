# Research Summary: v0.14.0 → v0.15.4 Sync

This document summarizes all research findings from subagent investigations during the cherry-pick sync.

## Table of Contents
1. [Session Resuming Bug](#session-resuming-bug)
2. [Kitty Keyboard Protocol](#kitty-keyboard-protocol)
3. [Extension Commits](#extension-commits)
4. [Ink Fork Status](#ink-fork-status)
5. [Animated Scroll](#animated-scroll)
6. [Scrollbar Drag Support](#scrollbar-drag-support)

---

## Session Resuming Bug

**Issue**: User tried `--continue` and got:
```
INFO: Session restored (100 messages restored from UI cache from 1/28/2026, 12:29:21 PM)
!  Could not restore AI context - history service unavailable.
```

### Root Cause
Core history restore waits for `geminiClient.getHistoryService()`, which stays null because GeminiChat never initializes when content generator/auth aren't ready. `resetChat()` fails or never creates chat, so the 30s polling in AppContainer times out and emits "history service unavailable." UI restore succeeds but AI context remains empty.

### Feature Gaps
1. Session resume is UI-driven polling, not a deterministic core restore path
2. No explicit resume/session selection flags beyond `--continue` (most-recent only)
3. No guarantee of provider/auth readiness before core history restore; failures silently degrade to UI-only restore
4. No retry/deferral tied to auth/provider initialization or config readiness
5. No explicit restore API in GeminiClient to ensure HistoryService exists before `addAll()`

### Implementation Plan

**P0 (Critical)**:
- Add a core restore API (`GeminiClient.restoreHistory` or `SessionRestoreService`) that ensures content generator + chat are initialized before calling `historyService.addAll()`
- Surface explicit errors when auth/config not ready
- Wire CLI startup to call the core restore API once config/provider/auth are initialized (before rendering UI or immediately after auth success)
- Replace AppContainer polling with a single call + success/failure state

**P1 (Important)**:
- Add deferral/retry hook tied to auth/provider readiness (e.g., when refreshAuth completes, re-run restore if pending)
- Track restore status in UI and expose a user-visible banner when AI context could not be restored, including retry action

**P2 (Nice-to-have)**:
- Add `--resume`/`--session` flags (like upstream) to resume by explicit session id/tag
- Persist/restore more metadata (provider/model/settings snapshot) and validate compatibility before restore

---

## Kitty Keyboard Protocol

**Question**: Why did upstream remove Kitty keyboard protocol support?

### Finding
**Upstream did NOT fully remove Kitty protocol support**. They removed Kitty-specific parsing/buffering logic and readline usage to simplify key handling and fix ESC+mouse garbage input (issue #12613), replacing it with a unified ANSI escape parser.

### What Changed
- Removed: Kitty-specific timeouts/overflow telemetry
- Removed: readline dependency for key parsing
- Added: New in-house state machine that parses raw stdin ANSI escape sequences
- Kept: Kitty capability detection/enabling via terminalCapabilityManager
- Kept: Kitty CSI-u keycode handling within the unified parser

### Replacement Mechanism
A new state machine parser that handles:
- CSI codes (including Kitty CSI-u keycodes)
- Separate buffering for paste/backslash
- Mouse event filtering

### Recommendation for LLxprt
**Keep Kitty protocol support**, but consider adopting upstream's unified ANSI parser approach if LLxprt has similar ESC/mouse or buffering issues. Upstream did not drop Kitty; it simplified parsing to reduce bugs and remove kitty-specific buffering/telemetry. If LLxprt's current implementation is stable and already handles timeouts, no need to remove Kitty.

### Evidence Sources
- Commit 9e4ae214a / PR #12746 body (Revamp KeypressContext)
- Issue #12613 (ESC+mouse garbage input)
- Issue #12040 (prior ESC breakage in kitty mode)
- Commit c0b766ad7 / PR #12798 (switch-case simplification)

---

## Extension Commits

All five extension-related commits touch `extension-manager.ts` which doesn't exist in LLxprt (we use functional approach). Each needs adaptation:

| Commit | Decision | What It Does | LLxprt Action |
|--------|----------|--------------|---------------|
| cc2c48d59 | REIMPLEMENT | Fix uninstall when extension name differs from directory name | Adapt fix to extension.ts |
| b248ec6df | REIMPLEMENT | Add `security.blockGitExtensions` setting and enforcement | Add setting + enforcement |
| 47603ef8e | REIMPLEMENT | Add core memory refresh helper + MemoryChanged event on extension load/unload | Add refresh mechanism |
| c88340314 | REIMPLEMENT | Refresh toolset on extension reload when excludeTools changes | Adapt to LLxprt tool governance |
| bafbcbbe8 | REIMPLEMENT | Add `/extensions restart` command + ExtensionLoader.restartExtension | Add command |

**Note**: These were all implemented in Batch 7-8 of this sync.

---

## Ink Fork Status

**See [ink-fork-research.md](ink-fork-research.md) for detailed analysis.**

### Current Versions
- **LLxprt**: `npm:@jrichman/ink@6.4.8` (bumped in Batch 4)
- **gemini-cli HEAD**: `npm:@jrichman/ink@6.4.8` (same — IN SYNC)
- **Latest fork on npm**: `@jrichman/ink@6.4.9` (published 2026-02-04)
- **Mainline ink**: `6.6.0` (vadimdemedes/ink)

### Why the Fork Exists
jacob314 (Jacob Richman, Google/gemini-cli engineer) forked ink to add native `overflow: 'scroll'` support for the chat UI. The feature uses Yoga's `YGOverflowScroll` and adds scrollbar rendering, `scrollTop`/`scrollLeft` props, and programmatic scroll APIs.

**Upstream issue [vadimdemedes/ink#765](https://github.com/vadimdemedes/ink/issues/765) is still OPEN** — the fork's changes have NOT been merged to mainline ink.

### Fork Timeline
- 2025-10-31: gemini-cli switches to @jrichman/ink@6.4.0
- 2025-11-17: v0.15.4 ships with @jrichman/ink@6.4.3
- 2026-01-10: Updated to 6.4.7
- 2026-01-26: Updated to 6.4.8 (current)
- 2026-02-04: 6.4.9 published on npm

### Can LLxprt Switch Back to Mainline ink?
**No, not yet.** The scrolling feature is essential and not in mainline. No reversion signals from upstream. Fork is actively maintained with ongoing version bumps.

### Recommended Action
1. **Stay on @jrichman/ink** — no choice until scrolling lands in mainline
2. Consider bumping to 6.4.9 (check changelog first)
3. Monitor vadimdemedes/ink#765 for upstream merge
4. Track fork divergence as mainline advances (6.6.0 → ...)

---

## Animated Scroll

### Implementation Plan (from upstream e192efa1f)

**File**: `packages/cli/src/ui/components/shared/ScrollableList.tsx`

**Key Concepts**:
1. **smoothScrollState ref**: Tracks active animations with start time, from/to positions, duration, timer
2. **stopSmoothScroll callback**: Interrupts ongoing animations by clearing timers
3. **smoothScrollTo function**: Implements 200ms ease-in-out animation using setInterval
4. **Easing function**: `t < 0.5 ? 2*t² : -1 + (4-2*t)*t`
5. **Frame rate**: 33ms intervals (~30fps)

**Changes Required**:
1. Add `useEffect` to imports
2. Add `ANIMATION_FRAME_DURATION_MS = 33` constant
3. Replace Colors import with `useAnimatedScrollbar` hook
4. Add smoothScrollState ref and stopSmoothScroll callback
5. Implement smoothScrollTo function
6. Update useKeypress handler to call stopSmoothScroll/smoothScrollTo
7. Update scrollableEntry useMemo

**Edge Cases Handled**:
- SCROLL_TO_ITEM_END sentinel (resolve to concrete value before animation)
- Mid-animation PAGE_DOWN uses target position
- Arrow key interruption stops smooth scroll
- Empty lists

---

## Scrollbar Drag Support

### Status: [OK] ALREADY IMPLEMENTED

Scrollbar drag support is fully implemented in LLxprt's Ink UI.

**Location**: `packages/cli/src/ui/contexts/ScrollProvider.tsx`

**Implementation includes**:
- Drag state management using refs (lines 118-127)
- Mouse press handler for thumb/track detection (lines 176-265)
- Mouse move handler for smooth dragging (lines 267-316)
- Mouse release handler for cleanup (lines 318-329)

**Mouse Events Supported**:
- `left-press`: Initiates drag or jumps track
- `move`: Updates scroll position during drag
- `left-release`: Ends drag operation
- `scroll-up`/`scroll-down`: Wheel scrolling

**Test Coverage**: Comprehensive in `ScrollProvider.test.tsx`

**No action required** - feature is production-ready and well-tested.

---

## Summary

| Topic | Status | Priority |
|-------|--------|----------|
| Session Resuming | Needs P0 fix for --continue bug | High |
| Kitty Protocol | Keep support, consider unified parser later | Low |
| Extension Commits | All 5 reimplemented in Batch 7-8 | Done |
| Ink Fork | Both at 6.4.8, can't leave fork yet (scrolling not in mainline) | Low |
| Animated Scroll | Implementation plan ready | Medium |
| Scrollbar Drag | Already implemented | Done |
