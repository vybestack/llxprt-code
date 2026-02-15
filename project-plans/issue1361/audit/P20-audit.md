# P20 Audit

## Plan Requirements
- Phase 20 requires full implementation of `SessionDiscovery` and `resumeSession` per pseudocode references.
- Critical integration requirement: resume flow must return `IContent[]` history so Phase 26 can seed with `client.restoreHistory(history)` (not `historyService.addAll()`).
- Addendum requires `session_event` records remain excluded from UI reconstruction path; only conversation history should be returned for UI/history restore.

## Pseudocode Compliance
- `SessionDiscovery.listSessions` behavior is broadly aligned:
  - Handles missing directory (`ENOENT`) by returning empty list.
  - Filters `session-*.jsonl`, filters by `projectHash`, returns sorted newest-first.
  - Includes mtime tie-breaker by `sessionId` descending (present and compliant with addendum).
- `SessionDiscovery.resolveSessionRef` mostly aligned but with one notable divergence:
  - Implements exact match.
  - Uses numeric-ref precedence before prefix matching for all-digit refs (this appears intentional per addendum/risk note, though different from earlier pseudocode ordering).
  - Out-of-range numeric error message differs from generic pseudocode not-found message.
- `resumeSession` structure aligns with pseudocode steps 1–8:
  - Discovers sessions.
  - Resolves target (`CONTINUE_LATEST` or explicit ref).
  - Acquires lock.
  - Replays.
  - Initializes recording for append.
  - Handles provider/model mismatch.
  - Records resume info event.
  - Returns assembled result.

## What Was Actually Done
- `SessionDiscovery.ts`
  - Implemented scanning and metadata assembly.
  - Uses an internal helper `readFirstLineFromFile()` instead of calling `readSessionHeader()` during listing.
  - Still exposes `SessionDiscovery.readSessionHeader()` delegating to `ReplayEngine.readSessionHeader()`, but `listSessions()` does not use it.
- `resumeSession.ts`
  - Returns `ResumeResult` with `history: replayResult.history` when successful.
  - `history` type is `IContent[]` and is directly usable by integration code.
  - The function does not mix in `sessionEvents`; it returns only replay history in `history`.
  - Recording is initialized for resume and resume/provider events are appended.

## Gaps
1. **Plan/pseudocode integration mismatch in discovery implementation**
   - Plan verification checklist explicitly asks that `SessionDiscovery` use `readSessionHeader` from ReplayEngine.
   - Actual `listSessions()` bypasses it and parses first line itself.
   - Impact: mostly maintainability/consistency risk, not an immediate functional blocker.

2. **Potential workspaceDirs source mismatch vs pseudocode**
   - Pseudocode step 5 specifies `workspaceDirs` from replay metadata.
   - Actual code uses `request.workspaceDirs`.
   - This can change resumed metadata continuity semantics if current invocation workspace differs from original session metadata.

3. **Lock lifecycle nuance**
   - On successful resume, lock handle is retained (not released), likely intentional to keep session locked for active process.
   - Replay failure path releases lock correctly.

## Severity
- Gap 1: **Low** (consistency/architectural expectation mismatch).
- Gap 2: **Medium** (possible behavioral drift from intended replay-based continuity).
- Gap 3: **Informational** (appears intentional and operationally correct).

## Summary Verdict
**Key check passed**: `resumeSession()` does return history (`IContent[]`) as `result.history`, and it is usable for the Phase 26 integration requirement (`client.restoreHistory(history)`).

Overall Phase 20 implementation is substantially compliant with the plan/pseudocode for resume flow behavior. The main concerns are implementation consistency in `SessionDiscovery` header-reading dependency and a possible `workspaceDirs` source divergence from pseudocode intent.