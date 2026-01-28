# Notes: v0.14.0 → v0.15.4 Sync

**Branch:** `20260128gmerge`

---

## Research Findings (Pre-Execution)

### 1. Session Resuming (`--continue` Bug)
User reported error: "Could not restore AI context - history service unavailable"

Root cause: Core history restore waits for `geminiClient.getHistoryService()`, which stays null because GeminiChat never initializes when content generator/auth aren't ready.

Fix plan in CHERRIES.md Research Findings section.

### 2. Kitty Protocol Clarification
Initially thought upstream removed Kitty support - WRONG.

They refactored to a unified ANSI parser while KEEPING Kitty CSI-u handling. The fix addresses ESC+mouse garbage input (issue #12613).

We're adopting this improvement. See `9e4ae214a-c0b766ad7-plan.md`.

### 3. Scrollbar Drag - Already Done
Investigated adding scrollbar drag and found it's already fully implemented in `ScrollProvider.tsx`. No work needed!

### 4. Ink Fork Status
- Fork: `@jrichman/ink` by Jacob Richman (Google/gemini-cli dev)
- Hosted at: github.com/jacob314/ink
- Recent commits focus on IME fixes and cursor positioning
- No evidence of upstream merge plans
- Action: Bump to 6.4.8, continue monitoring

---

## Batch Notes

### Batch 1
(To be filled during execution)

### Batch 2
(To be filled during execution)

...
