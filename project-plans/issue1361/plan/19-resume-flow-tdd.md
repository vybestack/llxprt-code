# Phase 19: Resume Flow TDD

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P19`

## Prerequisites
- Required: Phase 18a completed
- Verification: `test -f project-plans/issue1361/.completed/P18a.md`
- Phase 05a completed (SessionRecordingService — creates test session files)
- Phase 08a completed (ReplayEngine — replays during resume)
- Phase 11a completed (SessionLockManager — lock before replay)

## Requirements Implemented (Expanded)

### REQ-RSM-001: Resume Most Recent
**Full Text**: `--continue` (bare) resumes the most recent unlocked session for the current project.
**Behavior**:
- GIVEN: 3 session files for project hash "abc", newest is unlocked
- WHEN: resumeSession({ continueRef: CONTINUE_LATEST, projectHash: "abc", ... }) is called
- THEN: Returns history from the most recently modified session
**Why This Matters**: Quick resume without remembering session IDs.

### REQ-RSM-002: Resume Specific Session
**Full Text**: `--continue <id>` resumes a specific session by exact ID, unique prefix, or numeric index.
**Behavior**:
- GIVEN: Session with ID "a1b2c3d4" exists
- WHEN: resumeSession({ continueRef: "a1b2c3d4", ... }) is called
- THEN: Returns history from that specific session
**Why This Matters**: User can choose which session to resume.

### REQ-RSM-003: Session Discovery
**Full Text**: Scan chatsDir for session-*.jsonl, read first line, filter by projectHash.
**Behavior**:
- GIVEN: chatsDir with 5 .jsonl files, 3 matching projectHash "abc"
- WHEN: SessionDiscovery.listSessions(chatsDir, "abc") is called
- THEN: Returns 3 SessionSummary objects sorted newest-first
**Why This Matters**: Discovery is the foundation for --continue, --list-sessions, --delete-session.

### REQ-RSM-004: Replay and Initialize
**Full Text**: Replay session file, seed with IContent[], return initialized recording service.
**Behavior**:
- GIVEN: Valid session file with 5 content events
- WHEN: resumeSession() completes
- THEN: result.history has 5 IContent items, result.recording is initialized for append
**Why This Matters**: Full state reconstruction from event log.

### REQ-RSM-005: Provider Mismatch Warning
**Full Text**: If current provider differs from session's provider, warn and record provider_switch.
**Behavior**:
- GIVEN: Session recorded with provider "anthropic", current provider is "openai"
- WHEN: resumeSession() completes
- THEN: result.warnings includes provider mismatch warning; provider_switch event recorded
**Why This Matters**: User must know the provider changed since last session.

### REQ-RSM-006: File Reopened for Append
**Full Text**: Session file is reopened for continued recording with seq continuing from lastSeq.
**Behavior**:
- GIVEN: Session file with lastSeq=50
- WHEN: resumeSession() completes, then new content is recorded
- THEN: New events have seq > 50
**Why This Matters**: Continued recording maintains monotonic sequence.

## Implementation Tasks

### Files to Create
- `packages/core/src/recording/SessionDiscovery.test.ts` — Discovery tests
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P19`
  - MUST include: `@requirement:REQ-RSM-003`

- `packages/core/src/recording/resumeSession.test.ts` — Resume flow tests
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P19`
  - MUST include: `@requirement:REQ-RSM-001, REQ-RSM-002, REQ-RSM-004, REQ-RSM-005, REQ-RSM-006`

### Test Strategy
Use real SessionRecordingService to create session files in temp dirs. Then test discovery and resume against those real files.

### SessionDiscovery Test Cases (BEHAVIORAL)

1. **listSessions finds matching project sessions** — create 3 sessions with matching hash, 1 with different hash → returns 3
2. **listSessions sorts newest-first** — create 3 sessions with staggered times → first result is most recent
3. **listSessions returns empty for no matches** — different project hash → returns []
4. **listSessions returns empty for non-existent dir** — missing chatsDir → returns []
5. **listSessions reads session metadata from header** — verify sessionId, provider, model in results
6. **resolveSessionRef by exact ID** — resolve full session ID → correct session
7. **resolveSessionRef by prefix** — resolve first 8 chars → correct session
8. **resolveSessionRef ambiguous prefix** — 2 sessions share prefix → error with matching IDs
9. **resolveSessionRef by numeric index** — resolve "1" → first session (newest)
10. **resolveSessionRef not found** — resolve non-existent ID → error

### Resume Flow Test Cases (BEHAVIORAL)

11. **Resume most recent session** — create 2 sessions, CONTINUE_LATEST → returns history from most recent
12. **Resume specific session by ID** — create 2 sessions, specify ID → returns correct history
13. **Resume reconstructs history correctly** — session with 3 content events → result.history has 3 IContent items
14. **Resume handles compressed session** — session with compression → result.history reflects post-compression state
15. **Resume returns correct metadata** — verify provider, model, sessionId in result.metadata
16. **Resume no sessions found** — empty chatsDir → error "No sessions found"
17. **Resume specific session not found** — wrong ID → error "Session not found"
18. **Resume locked session fails** — lock session first, then resume → error "in use"
19. **Resume CONTINUE_LATEST skips locked** — lock newest, resume with CONTINUE_LATEST → resumes second newest
20. **Resume all locked returns error** — lock all sessions → error "All sessions in use"
21. **Resume provider mismatch records switch** — session with anthropic, resume with openai → provider_switch event in file
22. **Resume initializes recording for append** — resume, record new content, flush → new events appended with seq continuing
23. **Resume returns replay warnings** — corrupt mid-file line → result.warnings includes warning

### Property-Based Tests (30%+ of total — minimum 10 property tests)

24. **Discovery finds all sessions matching any valid projectHash** — fc.uuid for hash, create N sessions, verify count matches
25. **resolveSessionRef always finds exact match when present** — fc.uuid for sessionId, create session, resolve → found
26. **Resume preserves any valid IContent through write-replay cycle** — fc.record for IContent, record, resume → history matches
27. **Session ordering is consistent regardless of creation count** — fc.nat(1-10) sessions, verify newest always first
28. **Provider mismatch detection works for any provider strings** — fc.string pairs, verify mismatch detected when different
29. **Sequence continuation after resume produces monotonic seq** — fc.nat for original event count, resume, add events, verify all seq monotonic
30. **Discovery returns empty array for any non-matching hash** — fc.uuid for hash, create sessions with different hash, verify empty result
31. **resolveSessionRef by numeric index always works within range** — fc.nat(1-N) for N sessions, verify correct session resolved for each valid index
32. **Resume result always has non-null recording service** — fc.nat(1-5) for session events, resume, verify result.recording is defined and has correct sessionId
33. **Any compression followed by any content count produces correct resume history length** — fc.nat pairs for pre/post compression counts, resume, verify history length = 1 + post-count

### FORBIDDEN Patterns
- No mocking SessionRecordingService/ReplayEngine/SessionLockManager — use real instances
- No mock theater — verify actual file contents and replay results
- No testing for NotYetImplemented

## Required Code Markers

Every test case MUST include:
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P19
 * @requirement REQ-RSM-001 (or appropriate REQ-RSM-*)
 */
```

## Verification Commands

```bash
# Test files exist
test -f packages/core/src/recording/SessionDiscovery.test.ts
test -f packages/core/src/recording/resumeSession.test.ts

# Count tests
TOTAL_D=$(grep -c "it(\|test(" packages/core/src/recording/SessionDiscovery.test.ts)
TOTAL_R=$(grep -c "it(\|test(" packages/core/src/recording/resumeSession.test.ts)
TOTAL=$((TOTAL_D + TOTAL_R))
echo "Total: $TOTAL (Discovery: $TOTAL_D, Resume: $TOTAL_R)"
[ "$TOTAL" -lt 23 ] && echo "FAIL: Insufficient tests"

# Property-based tests
PROPERTY_D=$(grep -c "fc\.\|test\.prop" packages/core/src/recording/SessionDiscovery.test.ts)
PROPERTY_R=$(grep -c "fc\.\|test\.prop" packages/core/src/recording/resumeSession.test.ts)
echo "Property: $((PROPERTY_D + PROPERTY_R))"

# No mock theater
grep -r "toHaveBeenCalled\|mockImplementation\|vi\.mock" packages/core/src/recording/SessionDiscovery.test.ts packages/core/src/recording/resumeSession.test.ts && echo "FAIL"

# No reverse testing
grep -r "NotYetImplemented" packages/core/src/recording/SessionDiscovery.test.ts packages/core/src/recording/resumeSession.test.ts && echo "FAIL"

# Tests fail against stub
cd packages/core && npx vitest run src/recording/SessionDiscovery.test.ts 2>&1 | tail -5
cd packages/core && npx vitest run src/recording/resumeSession.test.ts 2>&1 | tail -5
```

### Semantic Verification Checklist
- [ ] Tests create real session files using SessionRecordingService
- [ ] Tests verify actual replay results (history contents, not just array length)
- [ ] Lock-related tests use real SessionLockManager
- [ ] Discovery tests verify sorting order
- [ ] Property-based tests generate meaningful session data

## Success Criteria
- 23+ behavioral tests across both files
- 10+ property-based tests (30%+ of total = 10/33 = 30.3%)
- All tagged with plan/requirement markers
- Tests fail against stubs

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionDiscovery.test.ts
git checkout -- packages/core/src/recording/resumeSession.test.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P19.md`


---

## Addendum: Ambiguous Resolution Edge Case Tests

### Context
`resolveSessionRef` supports both numeric index references (e.g., "1" for the first session) and prefix matching (e.g., "abc" matches "session-abcdef123.jsonl"). An edge case arises when a session ID prefix looks like a numeric index.

### Additional Tests

**Test: Numeric-looking session ID prefix vs. index resolution**

- GIVEN: Three sessions exist: `session-123abc.jsonl`, `session-456def.jsonl`, `session-789ghi.jsonl` (sorted by recency: 789ghi is most recent = index 1, 456def = index 2, 123abc = index 3)
- WHEN: `resolveSessionRef("1")` is called
- THEN: It resolves as numeric index 1 (most recent session = `session-789ghi.jsonl`), NOT as a prefix match against `session-123abc.jsonl`
- Rationale: Numeric index takes precedence over prefix matching. Pure digit strings are always treated as 1-based indices.
- `@requirement REQ-RSM-003`

**Test: Ambiguous prefix that matches multiple sessions**

- GIVEN: Two sessions exist: `session-ab12cd.jsonl`, `session-ab34ef.jsonl`
- WHEN: `resolveSessionRef("ab")` is called
- THEN: Error is thrown indicating ambiguous match — prefix "ab" matches 2 sessions. Error message includes both matching session IDs.
- `@requirement REQ-RSM-003`

**Test: Exact session ID match takes precedence over prefix**

- GIVEN: Two sessions exist: `session-abc.jsonl`, `session-abcdef.jsonl`
- WHEN: `resolveSessionRef("abc")` is called
- THEN: Resolves to `session-abc.jsonl` (exact match), not ambiguous error despite "abc" also being a prefix of "abcdef"


---

## Addendum: mtime Tiebreaker Test

### Context

Session discovery sorts sessions by file modification time (`mtime`). When two session files have identical mtime values (unlikely in production but possible in tests or fast CI), the sort must use a deterministic tiebreaker: session ID lexicographic descending.

### Test Case

**Test: Identical mtime selects lexicographically greater session ID**

- GIVEN: Two session files in the same chatsDir, both for the same projectHash. File A has sessionId `"aaa11111"` and file B has sessionId `"zzz99999"`. Both files have been `utimes()`-set to the exact same mtime (e.g., `2026-02-11T12:00:00.000Z`).
- WHEN: `SessionDiscovery.listSessions(chatsDir, projectHash)` is called.
- THEN: The first element in the returned array has sessionId `"zzz99999"` (lexicographically greater), and the second has `"aaa11111"`.
- COROLLARY: When `resumeSession({ continueRef: CONTINUE_LATEST, ... })` is called, the session with ID `"zzz99999"` is selected (assuming neither is locked).
- `@plan PLAN-20260211-SESSIONRECORDING.P19`
- `@requirement REQ-RSM-001, REQ-RSM-003`

### Implementation Notes

- Use `fs.utimesSync()` to set both files to identical mtime after creation.
- Create the session files using real `SessionRecordingService` instances with explicit session IDs.
- This test should be in `SessionDiscovery.test.ts` alongside the existing sorting tests.

### Property-Based Extension

**Test: Tiebreaker is deterministic for any two session IDs with same mtime**

- `fc.tuple(fc.hexaString({minLength: 8, maxLength: 8}), fc.hexaString({minLength: 8, maxLength: 8}))` — generate two distinct session IDs
- Create two session files, set identical mtime
- Call `listSessions()` twice — verify same order both times
- Verify the first result has the lexicographically greater session ID
- `@requirement REQ-RSM-003`

- `@requirement REQ-RSM-003`
