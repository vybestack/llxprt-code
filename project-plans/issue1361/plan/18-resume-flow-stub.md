# Phase 18: Resume Flow Stub

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P18`

## Prerequisites
- Required: Phase 08a completed (ReplayEngine works — needed for replay)
- Verification: `test -f project-plans/issue1361/.completed/P08a.md`
- Required: Phase 11a completed (SessionLockManager works — needed for lock acquisition)
- Verification: `test -f project-plans/issue1361/.completed/P11a.md`
- Required: Phase 05a completed (SessionRecordingService works — needed for recording initialization)
- Verification: `test -f project-plans/issue1361/.completed/P05a.md`

## Requirements Implemented (Expanded)

### REQ-RSM-001: Resume Most Recent
**Full Text**: `--continue` (bare) resumes the most recent unlocked session for the current project.
**Behavior**:
- GIVEN: Multiple session files exist for the project
- WHEN: resumeSession() is called with CONTINUE_LATEST
- THEN: The most recently modified unlocked session is resumed
**Why This Matters**: Quick resume without remembering session IDs.

### REQ-RSM-003: Session File Discovery
**Full Text**: Scan chatsDir, read first line of each .jsonl file, filter by projectHash.
**Behavior**:
- GIVEN: A chatsDir with multiple session files from different projects
- WHEN: SessionDiscovery.listSessions() is called with a projectHash
- THEN: Only sessions matching that projectHash are returned, sorted newest-first
**Why This Matters**: Users only see sessions from their current project.

### REQ-RSM-004: Replay and Seed
**Full Text**: Replay → seed HistoryService with IContent[] → reconstruct UI.
**Behavior**:
- GIVEN: A session file is selected for resume
- WHEN: resumeSession() completes
- THEN: Returns history IContent[], metadata, and initialized recording service
**Why This Matters**: Session state is fully reconstructed from the event log.

## Implementation Tasks

### Files to Create
- `packages/core/src/recording/SessionDiscovery.ts` — Session discovery utility stub
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P18`
  - MUST include: `@requirement:REQ-RSM-003`
  - `listSessions(chatsDir, projectHash)`: returns Promise.resolve([]) (stub)
  - `resolveSessionRef(ref, sessions)`: throws NotYetImplemented (stub)

- `packages/core/src/recording/resumeSession.ts` — Resume flow stub
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P18`
  - MUST include: `@requirement:REQ-RSM-001, REQ-RSM-004`
  - `resumeSession(request)`: throws NotYetImplemented (stub)
  - `CONTINUE_LATEST` constant exported

### Files to Modify
- `packages/core/src/recording/index.ts` — Add SessionDiscovery, resumeSession, CONTINUE_LATEST exports

### Required Code Markers
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P18
 * @requirement REQ-RSM-001, REQ-RSM-003, REQ-RSM-004
 */
```

## Verification Commands

```bash
# Files exist
test -f packages/core/src/recording/SessionDiscovery.ts || echo "FAIL"
test -f packages/core/src/recording/resumeSession.ts || echo "FAIL"

# Plan markers
grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P18" packages/core/src/recording/ | wc -l
# Expected: 2+

# TypeScript compiles
cd packages/core && npx tsc --noEmit

# Method signatures
grep -q "listSessions" packages/core/src/recording/SessionDiscovery.ts || echo "FAIL"
grep -q "resolveSessionRef" packages/core/src/recording/SessionDiscovery.ts || echo "FAIL"
grep -q "resumeSession" packages/core/src/recording/resumeSession.ts || echo "FAIL"
grep -q "CONTINUE_LATEST" packages/core/src/recording/resumeSession.ts || echo "FAIL"

# Barrel exports
grep -q "SessionDiscovery" packages/core/src/recording/index.ts || echo "FAIL"
grep -q "resumeSession\|CONTINUE_LATEST" packages/core/src/recording/index.ts || echo "FAIL"

# No TODO
grep -r "TODO" packages/core/src/recording/SessionDiscovery.ts packages/core/src/recording/resumeSession.ts && echo "FAIL"
```

### Semantic Verification Checklist
- [ ] SessionDiscovery is a static utility class (matches pseudocode)
- [ ] listSessions returns Promise<SessionSummary[]>
- [ ] resolveSessionRef returns { session } or { error } discriminated union
- [ ] resumeSession returns Promise<ResumeResult | ResumeError>
- [ ] CONTINUE_LATEST is a unique sentinel constant

## Success Criteria
- Stubs compile
- Correct function/method signatures
- Barrel exports work

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionDiscovery.ts
git checkout -- packages/core/src/recording/resumeSession.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P18.md`
