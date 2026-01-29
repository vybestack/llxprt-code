# Notes: v0.14.0 -> v0.15.4 Sync

**Branch:** `20260128gmerge`
**Date:** 2026-01-28

---

## Conflicts Resolved

### Batch 1

| Commit | File | Resolution |
|--------|------|------------|
| ef4030331 | types.ts | DELETED - file moved to ideContext.ts in LLxprt |
| ef4030331 | ide-client.ts | Merged typo fixes into LLxprt's version |
| 331dbd563 | textUtils.test.ts | Branding: @google/gemini-cli-core -> @vybestack/llxprt-code-core |
| 2136598e8 | modifiable-tool.ts | console.error alignment for test compatibility |

### Batch 2

| Commit | File | Resolution |
|--------|------|------------|
| 5ba6bc713 | prompts.ts | Minor merge conflict in Angular support section |
| 2abc288c5 | settings.ts | Adjusted useFullWidth default handling |

### Batch 3

| Commit | File | Resolution |
|--------|------|------------|
| a0a682826 | github.test.ts | Property name alignment (browser_download_url vs url) |
| 69339f08a | Multiple a2a-server files | Branding: @google/gemini-cli-core -> @vybestack/llxprt-code-core |

### Batch 4

| Commit | File | Resolution |
|--------|------|------------|
| 4ef4bd6f0 | hookRunner.ts | Fixed debugLogger import to DebugLogger.getLogger() pattern |
| 4ef4bd6f0 | hookRunner.ts | Added LLXPRT_PROJECT_DIR as primary env var |

---

## Skipped Commits

### Batch 1: 3c9052a75 (F1/F2 keys)
**Reason:** Complex keyboard handling conflicts at time of cherry-pick
**Impact:** None - fixed by Batch 5 unified ANSI parser implementation
**Status:** Resolved in commit e2c41612d

### Batch 2: 51f952e70 (ripgrep --json)
**Reason:** Already implemented in LLxprt differently
**Impact:** None

### Batch 2: fd59d9dd9 (shift+return VSCode)
**Reason:** LLxprt already has backslash+enter handling via backslashTimeout
**Impact:** None

### Batch 2: 9116cf2ba (icon->prefix rename)
**Reason:** Requires extension manager refactoring not present in LLxprt
**Impact:** Low - cosmetic naming difference
**Follow-up:** Consider in future extension system cleanup

### Batch 2: c1076512d (read_many_files deprecation)
**Reason:** Extensive documentation and test updates across 7 files
**Impact:** None - tool still works, just not deprecated
**Follow-up:** Consider deprecation in future release

---

## Deviations from Upstream

### LLxprt-specific Branding

All references to:
- `@google/gemini-cli` -> `@vybestack/llxprt-code`
- `@google/gemini-cli-core` -> `@vybestack/llxprt-code-core`
- `GEMINI_` env vars -> `LLXPRT_` (with GEMINI/CLAUDE kept for compatibility)
- `gemini` logger names -> `llxprt`

### Functional vs Class-based Architecture

LLxprt uses functional approach for extensions vs upstream's ExtensionManager class.
Batches 7 and 8 reimplemented extension features to match LLxprt's patterns.

### A2A Server Privacy

A2A server packages remain PRIVATE in LLxprt (not published to npm).

---

## Research Findings

### Kitty Keyboard Protocol (Batch 5) - IMPLEMENTED

Upstream did NOT remove Kitty protocol support. They:
1. Replaced readline/PassThrough with unified ANSI parser
2. Fixed ESC+mouse garbage input (issue #12613)
3. Kept Kitty CSI-u sequence handling in the parser

**LLxprt Implementation (e2c41612d):**
- Adopted unified ANSI parser with character-by-character generator
- Added table-driven KEY_INFO_MAP dispatch
- Removed kittyProtocolEnabled prop (no longer needed)
- Fixed F1/F2/ESC+mouse garbage input
- All tests passing

### Ink Fork Status

| Package | Version |
|---------|---------|
| LLxprt | @jrichman/ink@6.4.7 -> 6.4.8 |
| Upstream gemini-cli | @jrichman/ink@6.4.8 |
| Mainline ink | 6.6.0 |

No evidence of jrichman's changes being merged to mainline ink.
Timeline to switch back: Unknown - need to diff fork against 6.6.0.

### Scrollbar Drag

Already fully implemented in LLxprt's ScrollProvider.tsx.
No work needed.

---

## Known Issues Post-Sync

### --continue Session Restore

**Fixed in Batch 10.** Root cause was history service null during restore.
New GeminiClient.restoreHistory() API ensures chat initialization first.

### F1/F2 Keys - FIXED

Fixed by Batch 5 unified ANSI parser (commit e2c41612d).
The new parser correctly handles function key escape sequences.

---

## Files Created

| File | Purpose |
|------|---------|
| ThemedGradient.tsx | Safe gradient for tmux (Batch 6) |
| hookRunner.ts | Hook execution engine (Batch 4) |
| hookRunner.test.ts | Hook runner tests (Batch 4) |
| extensions.ts (a2a) | Extension commands (Batch 3) |
| extensions.test.ts (a2a) | Extension command tests (Batch 3) |
| types.ts (a2a) | Command type definitions (Batch 3) |
