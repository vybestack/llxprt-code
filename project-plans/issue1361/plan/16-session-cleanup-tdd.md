# Phase 16: Session Cleanup TDD

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P16`

## Prerequisites
- Required: Phase 15a completed
- Verification: `test -f project-plans/issue1361/.completed/P15a.md`

## Requirements Implemented (Expanded)

### REQ-CLN-001: Updated Scan Pattern
**Full Text**: Session cleanup scans for `session-*.jsonl` files.
**Behavior**:
- GIVEN: A chats directory with 3 `.jsonl` session files
- WHEN: getAllSessionFiles() is called
- THEN: Returns 3 entries for the `.jsonl` files
**Why This Matters**: Cleanup targets only the new JSONL session format.

### REQ-CLN-002: Lock-Aware Active Protection
**Full Text**: Before deleting any .jsonl file, check if a corresponding .lock sidecar exists and is held by a running process.
**Behavior**:
- GIVEN: A .jsonl file with an active .lock file (current PID)
- WHEN: shouldDeleteSession() evaluates it
- THEN: Returns 'skip'
**Why This Matters**: Active sessions must never be deleted.

### REQ-CLN-003: Stale Lock Cleanup
**Full Text**: Dead PID in lock file → delete both lock and data file.
**Behavior**:
- GIVEN: A .jsonl file with a .lock file containing a dead PID
- WHEN: shouldDeleteSession() evaluates it
- THEN: Returns 'stale-delete'
**Why This Matters**: Crashed sessions should be cleaned up.

### REQ-CLN-004: Orphaned Lock Cleanup
**Full Text**: .lock files with no corresponding .jsonl file are deleted.
**Behavior**:
- GIVEN: A `.lock` file with no matching `.jsonl` file
- WHEN: cleanupStaleLocks() runs
- THEN: Orphaned lock is deleted; returns count of cleaned locks
**Why This Matters**: Prevents lock file accumulation.

## Implementation Tasks

### Files to Create
- `packages/cli/src/utils/sessionCleanup.test.ts` (or add to existing test file)
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P16`
  - MUST include: `@requirement:REQ-CLN-001` through `@requirement:REQ-CLN-004`

### Test Cases (BEHAVIORAL)

1. **getAllSessionFiles finds .jsonl files** — create temp dir with session-*.jsonl, call function → returns entries
2. **getAllSessionFiles skips non-session files** — create random .txt files → not included
3. **getAllSessionFiles ignores old .json files** — create persisted-session-*.json → not included (old cleanup handles those)
4. **shouldDeleteSession skips locked .jsonl** — create .jsonl + active .lock (current PID) → returns 'skip'
5. **shouldDeleteSession allows unlocked .jsonl** — create .jsonl with no .lock → returns 'delete'
6. **shouldDeleteSession detects stale lock** — create .jsonl + .lock with dead PID (999999999) → returns 'stale-lock-only'
7. **cleanupStaleLocks removes orphaned .lock** — create .lock with no .jsonl → lock deleted, returns 1
8. **cleanupStaleLocks keeps non-orphaned .lock** — create .jsonl + .lock → lock NOT deleted
9. **cleanupStaleLocks removes stale .lock** — create .jsonl + stale .lock (dead PID) → lock deleted
10. **cleanupStaleLocks returns count** — 3 orphaned locks → returns 3
11. **Empty chats directory returns empty list** — no files → returns []
12. **Non-existent chats directory returns empty list** — missing dir → returns []
13. **Header reading for .jsonl extracts session info** — create valid .jsonl, scan → sessionInfo has correct sessionId, startTime

### Property-Based Tests (30%+ of total — minimum 7 property tests)

14. **Any number of .jsonl files are all discovered** — fc.nat for count, create files, verify all found
15. **Orphaned lock cleanup is safe for any file count** — fc.nat for orphaned + non-orphaned counts, verify only orphaned deleted
16. **Lock-aware protection never deletes active sessions** — fc.array of active/inactive/stale states, verify active never in delete list
17. **Stale lock detection is consistent with PID liveness** — fc.boolean for alive/dead, verify consistent results
18. **Non-session files are never deleted regardless of count** — fc.array of random filenames (not matching session patterns), verify none deleted
19. **Cleanup returns correct count for any combination of deletable/non-deletable** — fc.tuple(fc.nat, fc.nat, fc.nat) for active/stale/unlocked counts, verify deleted count matches unlocked + stale

### FORBIDDEN Patterns
- No mocking fs operations — use real temp directories
- No mock theater
- Tests must verify actual file presence/absence on disk

## Verification Commands

```bash
# Test file exists
test -f packages/cli/src/utils/sessionCleanup.test.ts || echo "Check test file location"

# Count tests
TOTAL=$(grep -c "it(\|test(" packages/cli/src/utils/sessionCleanup.test.ts 2>/dev/null || echo 0)
echo "Total: $TOTAL"
[ "$TOTAL" -lt 15 ] && echo "FAIL: Insufficient tests"

# No mock theater
grep -r "toHaveBeenCalled\|mockImplementation" packages/cli/src/utils/sessionCleanup.test.ts && echo "FAIL"

# No reverse testing
grep -r "NotYetImplemented" packages/cli/src/utils/sessionCleanup.test.ts && echo "FAIL"

# Tests fail against stub
npm run test -- --grep "cleanup" 2>&1 | tail -10
```

### Semantic Verification Checklist
- [ ] Tests create real temp directories with real session files
- [ ] Tests verify actual file deletion/preservation on disk
- [ ] Lock-aware tests create real .lock files with real/fake PIDs
- [ ] Property-based tests generate meaningful file configurations
- [ ] No test would pass with stub implementation

## Success Criteria
- 13+ behavioral tests
- 6+ property-based tests (30%+ of total = 6/19 = 31.6%)
- All tagged with plan/requirement markers
- Tests fail against stub

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/sessionCleanup.test.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P16.md`


---

## Addendum: Stale Lock With Recent Session Test (Architecture Review FIX 5)

### Critical Test Case

23. **Stale lock with recent session file → lock removed, session file preserved** — GIVEN: A `.jsonl` file created 1 hour ago (well within retention policy) with a `.lock` file containing a dead PID (999999999). WHEN: `identifySessionsToDelete()` runs with a retention policy of maxAge=7 days. THEN: The `.lock` file is removed (stale lock cleanup). The `.jsonl` file is NOT in the deletion list (it does not meet the age/count policy). Verify on disk: `.lock` gone, `.jsonl` still exists.
    - `@requirement REQ-CLN-003`
    - `@plan PLAN-20260211-SESSIONRECORDING.P16`
    - This test MUST fail if the implementation uses `OR action == 'stale-delete'` logic

24. **Stale lock with OLD session file → lock removed AND session file deleted** — GIVEN: A `.jsonl` file created 30 days ago (exceeds maxAge=7 days) with a `.lock` file containing a dead PID. WHEN: cleanup runs. THEN: BOTH `.lock` and `.jsonl` are removed — but the `.jsonl` deletion is due to the retention policy, NOT the stale lock status.
    - `@requirement REQ-CLN-003`
    - Distinguishes between "stale lock triggers deletion" (WRONG) and "retention policy triggers deletion" (CORRECT)

### Property-Based Test

25. **Stale lock status never causes deletion of sessions within retention window** — fc.tuple(fc.nat(0, 3), fc.nat(0, 3)) for (stale_within_retention, stale_outside_retention) counts. Create N files within retention + M files outside retention, all with stale locks. Run cleanup. Assert: exactly M files deleted (only those outside retention). All N within-retention files preserved. All stale locks removed regardless.
    - `@requirement REQ-CLN-003`

