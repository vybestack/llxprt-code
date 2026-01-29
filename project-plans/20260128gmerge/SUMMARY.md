# Summary: v0.14.0 → v0.15.4 Sync

**Branch:** `20260128gmerge`
**Date:** 2026-01-28

---

## Overview

Syncing LLxprt Code with upstream gemini-cli from v0.14.0 to v0.15.4.

---

## Counts

| Decision | Count |
|----------|-------|
| PICK | 19 |
| SKIP | 25 |
| REIMPLEMENT | 10 |
| Release/Nightly automation | 25 |
| **Total in range** | 79 |

---

## High-Priority Items

### 1. KeypressContext Unified ANSI Parser (`9e4ae214a` + `c0b766ad7`)
**Priority:** HIGH
**Effort:** 1-2 days

Upstream refactored input parsing to fix ESC+mouse garbage input. We're adopting this architectural improvement.

### 2. Session Resuming / --continue Fix (`6893d2744`)
**Priority:** HIGH  
**Effort:** 1-2 days

User reported: "Could not restore AI context - history service unavailable"
Root cause: History restore times out when auth/provider aren't ready.

### 3. Hook Execution Engine (`4ef4bd6f0`)
**Priority:** HIGH
**Effort:** Low (new file)

LLxprt has hooks infrastructure but is MISSING hookRunner.ts. Critical for hooks to work.

### 4. Ink Version Bump
**Priority:** MEDIUM
**Effort:** Low

Bump from `@jrichman/ink@6.4.7` to `6.4.8` (gemini-cli's current version).

---

## Notable SKIPs

| Item | Reason |
|------|--------|
| Clearcut telemetry (3 commits) | Removed from LLxprt |
| Ink scrolling overhaul (cbbf56512) | 45+ files, different architecture |
| Smart-edit tool | LLxprt uses replace + fuzzy edit |
| Experiments infrastructure | Not in LLxprt |
| Model configs migration | LLxprt uses multi-provider architecture |

---

## Notable Findings

### Scrollbar Drag - Already Implemented!
Research found that LLxprt's `ScrollProvider.tsx` already has full drag support. No work needed.

### Kitty Protocol - NOT Removed
Upstream simplified the parser but KEPT Kitty CSI-u support. We're adopting the improved architecture.

### Ink Fork Status
- LLxprt: `@jrichman/ink@6.4.7`
- gemini-cli: `@jrichman/ink@6.4.8`  
- Mainline: `6.6.0`
- No evidence fork will merge to mainline soon

---

## Batch Schedule Summary

| Batch | Type | Commits | Verify |
|-------|------|---------|--------|
| 1 | PICK | 8 | Quick |
| 2 | PICK | 6 | Full |
| 3 | PICK | 2 | Quick |
| 4 | PICK+MANUAL | 2 | Full |
| 5 | REIMPLEMENT | KeypressContext | Quick |
| 6 | REIMPLEMENT | Editor+tmux | Full |
| 7 | REIMPLEMENT | Extension fixes | Quick |
| 8 | REIMPLEMENT | Extension reload | Full |
| 9 | REIMPLEMENT | Animated scroll | Quick |
| 10 | REIMPLEMENT | Session resuming | Full |

---

## Risk Assessment

| Risk | Item | Mitigation |
|------|------|------------|
| HIGH | KeypressContext refactor | Detailed plan, extensive testing |
| HIGH | Session resuming | P0 items first, iterate |
| MEDIUM | Hooks integration | New file, test thoroughly |
| LOW | Cherry-pick conflicts | Standard resolution process |
