# Phase 22: Session Management TDD

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P22`

## Prerequisites
- Required: Phase 21a completed
- Verification: `test -f project-plans/issue1361/.completed/P21a.md`
- Phase 05a (SessionRecordingService — creates test sessions)
- Phase 20a (SessionDiscovery — for listing)
- Phase 11a (SessionLockManager — for lock checking)

## Requirements Implemented (Expanded)

### REQ-MGT-001: List Sessions Table
**Full Text**: `--list-sessions` displays a table with index, session ID (truncated), start time, last updated, provider/model, and file size.
**Behavior**:
- GIVEN: 3 session files for the current project
- WHEN: handleListSessions() is called
- THEN: Output contains table with 3 rows, each with correct session metadata
**Why This Matters**: Users need to browse sessions before choosing to resume or delete.

### REQ-MGT-002: Delete Session
**Full Text**: `--delete-session <id>` resolves by ID/prefix/index and deletes the file plus sidecar.
**Behavior**:
- GIVEN: Session "a1b2c3d4" exists
- WHEN: handleDeleteSession("a1b2c3d4") is called
- THEN: Session file deleted, confirmation printed
**Why This Matters**: Users can clean up old sessions.

### REQ-MGT-003: Refuse to Delete Locked Session
**Full Text**: Active sessions cannot be deleted.
**Behavior**:
- GIVEN: Session is locked by running process
- WHEN: handleDeleteSession() attempts deletion
- THEN: Error thrown: "Cannot delete: session is in use by another process"
**Why This Matters**: Data safety — never delete an active conversation.

### REQ-MGT-004: Stale Lock on Delete Target
**Full Text**: If target session has a stale lock (dead process), proceed with deletion.
**Behavior**:
- GIVEN: Session has .lock with dead PID
- WHEN: handleDeleteSession() is called
- THEN: Stale lock removed, session deleted
**Why This Matters**: Crashed sessions shouldn't be permanently undeletable.

## Implementation Tasks

### Files to Create
- `packages/core/src/recording/sessionManagement.test.ts`
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P22`
  - MUST include: `@requirement:REQ-MGT-001` through `@requirement:REQ-MGT-004`

### Test Strategy
Create real session files using SessionRecordingService. For listing, capture output (or test the formatSessionTable helper). For deletion, verify file absence on disk.

### Test Cases (BEHAVIORAL)

1. **handleListSessions returns session data** — create 3 sessions → function returns/outputs session info for all 3
2. **List sessions sorted newest-first** — create sessions with different timestamps → output order matches newest-first
3. **List sessions with correct metadata** — verify sessionId, provider, model, size in output
4. **List sessions empty returns appropriate message** — no sessions → "No sessions found"
5. **formatSessionTable produces readable output** — pass session data → formatted string has columns
6. **handleDeleteSession by exact ID** — create session, delete by full ID → file removed from disk
7. **handleDeleteSession by prefix** — delete by first 8 chars → correct file removed
8. **handleDeleteSession by numeric index** — delete by "1" → removes first (newest) session
9. **Delete removes .lock sidecar too** — create .lock alongside .jsonl, delete session → both removed
10. **Delete locked session fails** — lock session (current PID), attempt delete → throws error
11. **Delete stale-locked session succeeds** — create stale .lock (dead PID), delete → succeeds, both files removed
12. **Delete non-existent session fails** — delete bad ID → error "Session not found"
13. **Delete from empty directory fails** — no sessions → error
14. **Delete confirmation includes session ID** — verify output message includes the session ID that was deleted

### Property-Based Tests (30%+ of total — minimum 7 property tests)

15. **formatSessionTable handles any number of sessions** — fc.nat(0-20) sessions, verify output has correct row count
16. **Delete always removes both .jsonl and .lock** — fc.boolean for lock existence, create files, delete → verify both gone
17. **List always returns sessions sorted by mtime** — fc.array of dates, create sessions with those dates, verify sorted
18. **resolveSessionRef via any valid index always works** — fc.nat within range, verify correct session resolved
19. **Any valid session can be listed then deleted** — fc.uuid for sessionIds, create, list, delete each by ID → all removed
20. **formatSize produces human-readable output for any byte count** — fc.nat(0-1e9) for byte count, verify output contains a number and unit (B/KB/MB)
21. **Delete non-existent session always throws for any invalid ref** — fc.string for random refs that don't match any session, verify error thrown

### FORBIDDEN Patterns
- No mocking fs, SessionDiscovery, or SessionLockManager — use real instances
- No mock theater
- No testing for NotYetImplemented

## Required Code Markers

Every test case MUST include:
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P22
 * @requirement REQ-MGT-001 (or appropriate REQ-MGT-*)
 */
```

## Verification Commands

```bash
# Test file exists
test -f packages/core/src/recording/sessionManagement.test.ts

# Count tests
TOTAL=$(grep -c "it(\|test(" packages/core/src/recording/sessionManagement.test.ts)
PROPERTY=$(grep -c "fc\.\|test\.prop\|fc\.assert" packages/core/src/recording/sessionManagement.test.ts)
echo "Total: $TOTAL, Property: $PROPERTY"
[ "$TOTAL" -lt 14 ] && echo "FAIL: Insufficient tests"

# No mock theater
grep -r "toHaveBeenCalled\|mockImplementation\|vi\.mock" packages/core/src/recording/sessionManagement.test.ts && echo "FAIL"

# No reverse testing
grep -r "NotYetImplemented" packages/core/src/recording/sessionManagement.test.ts && echo "FAIL"

# Tests fail against stub
cd packages/core && npx vitest run src/recording/sessionManagement.test.ts 2>&1 | tail -5
```

### Semantic Verification Checklist
- [ ] Tests create real session files with SessionRecordingService
- [ ] Tests verify actual file deletion on disk
- [ ] Lock tests use real SessionLockManager
- [ ] List tests verify output content (not just that function returned)
- [ ] No test would pass with stub implementation

## Success Criteria
- 14+ behavioral tests
- 7+ property-based tests (30%+ of total = 7/21 = 33.3%)
- All tagged with plan/requirement markers
- Tests fail against stub

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/sessionManagement.test.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P22.md`
