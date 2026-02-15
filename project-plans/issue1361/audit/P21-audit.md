# P21 Audit

## Plan Requirements
- Create `packages/core/src/recording/sessionManagement.ts` as a **stub** with markers:
  - `@plan:PLAN-20260211-SESSIONRECORDING.P21`
  - `@requirement:REQ-MGT-001, REQ-MGT-002, REQ-MGT-003`
- Include stub functions that throw NotYetImplemented:
  - `handleListSessions(chatsDir, projectHash)`
  - `handleDeleteSession(ref, chatsDir, projectHash)`
  - `formatSessionTable(sessions)`
- Modify `packages/core/src/recording/index.ts` to export session management symbols.
- Semantic checklist:
  - list/delete signatures as specified
  - async/Promise returns
  - use SessionDiscovery and SessionLockManager types/signatures
- Architectural boundary addendum:
  - core returns raw data only (no table formatting, no console output, no ANSI UX logic).

## What Was Actually Done
- `packages/core/src/recording/sessionManagement.ts` exists and includes required plan/requirement markers (present, though formatted as `@plan PLAN-...` and `@requirement ...`, not colon style).
- Instead of stubs, the file contains **real implementations**:
  - `listSessions(chatsDir, projectHash)` calls `SessionDiscovery.listSessions(...)` and returns `{ sessions }`.
  - `deleteSession(ref, chatsDir, projectHash)`:
    - lists sessions,
    - resolves ref via `SessionDiscovery.resolveSessionRef(...)`,
    - checks lock via `SessionLockManager.isLocked(...)`,
    - handles stale locks via `isStale/removeStaleLock`,
    - deletes session file and lock file,
    - returns structured success/error result objects.
- No `formatSessionTable(...)` exists in core, consistent with boundary addendum prohibiting formatting in core.
- Function names differ from plan text (`listSessions`/`deleteSession` vs `handleListSessions`/`handleDeleteSession`).
- `packages/core/src/recording/index.ts` exports the new session management functions and result types.

## Gaps
1. **Stub vs implementation mismatch**: Plan explicitly requested NotYetImplemented stubs, but full behavior was implemented.
2. **Function naming mismatch**: Expected `handleListSessions`/`handleDeleteSession`; actual names are `listSessions`/`deleteSession`.
3. **Marker syntax mismatch (minor)**: Plan verification grep expects `@plan:PLAN-...`; file uses `@plan PLAN-...` (space, no colon), which may fail strict grep.
4. **`formatSessionTable` omission vs plan text**: Plan tasks include stub `formatSessionTable`, but addendum says formatting must be CLI-only. Actual implementation follows addendum (no formatter in core), so this is a **plan-internal inconsistency resolved in favor of architecture**.

## Severity
- Gap 1 (stub vs implementation): **Medium** (scope drift from phase intent, though functionally stronger).
- Gap 2 (naming mismatch): **Medium** (contract/API mismatch with plan text; may affect downstream expectations).
- Gap 3 (marker syntax): **Low** (metadata/verification fragility).
- Gap 4 (format function): **Low** as an implementation gap, **Medium** as plan quality issue (conflicting requirements).

## Summary Verdict
**Partial pass with material deviations.**

The core architectural intent (raw-data core behavior, no CLI formatting) is respected, and index exports were added correctly. However, the phase did not implement the requested stub shape/signatures and instead delivered production logic with different function names. This should be treated as a plan compliance miss unless the phase scope was intentionally advanced and the plan updated accordingly.