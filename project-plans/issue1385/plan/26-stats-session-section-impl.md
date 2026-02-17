# Phase 26: /stats Session Section — Implementation

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P26`

## Prerequisites

- Required: Phase 25a completed
- Verification: `test -f project-plans/issue1385/.completed/P25a.md`
- Expected files from previous phase:
  - `packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts` — 13+ failing tests
  - `packages/cli/src/ui/commands/formatSessionSection.ts` — stub from P24
- Preflight verification: Phase 0.5 completed

## Requirements Implemented (Expanded)

### REQ-ST-001: /stats Session Section
**Full Text**: The `/stats` command shall include a "Session" section in its output.
**Behavior**:
- GIVEN: A session recording is active with known metadata
- WHEN: `formatSessionSection(metadata)` is called
- THEN: Returns an array of lines starting with a "Session:" header

### REQ-ST-002: Session ID Display
**Full Text**: The session section shall display the session ID (truncated to 12 characters).
**Behavior**:
- GIVEN: Session metadata with any sessionId
- WHEN: `formatSessionSection(metadata)` is called
- THEN: Output includes `"  ID: "` followed by the first 12 characters of the sessionId

### REQ-ST-003: Session Start Time
**Full Text**: The session section shall display the session start time as a relative time.
**Behavior**:
- GIVEN: Session metadata with a `startTime` in ISO-8601 format
- WHEN: `formatSessionSection(metadata)` is called
- THEN: Output includes `"  Started: "` followed by a human-readable relative time

### REQ-ST-004: File Size
**Full Text**: The session section shall display the session file size.
**Behavior**:
- GIVEN: Session metadata with `filePath` pointing to a real file
- WHEN: `formatSessionSection(metadata)` is called
- THEN: Output includes `"  File size: "` followed by a formatted file size string

### REQ-ST-005: Resumed Status
**Full Text**: The session section shall display whether this is a resumed session (yes/no).
**Behavior**:
- GIVEN: Session metadata with `isResumed` boolean
- WHEN: `formatSessionSection(metadata)` is called
- THEN: Output includes `"  Resumed: yes"` or `"  Resumed: no"`

### REQ-ST-006: No Active Session Fallback
**Full Text**: If no session recording is active, the section shall display "No active session recording."
**Behavior**:
- GIVEN: Metadata is null
- WHEN: `formatSessionSection(null)` is called
- THEN: Output includes `"  No active session recording."`

## Implementation Tasks

### Pseudocode Reference
Implement `formatSessionSection()` from pseudocode `stats-session-section.md` lines 12-44:

- Line 12-13: Function signature `formatSessionSection(metadata: SessionRecordingMetadata | null): Promise<string[]>`
- Line 14-15: Initialize lines array, push "Session:" header and empty line prefix
- Line 17-20: Null check → return "No active session recording."
- Line 22-23: Truncate sessionId to first 12 chars → `"  ID: " + sessionId.substring(0, 12)`
- Line 25-27: Parse startTime → format with `formatRelativeTime(startDate)` → `"  Started: ..."`
- Line 29-38: If filePath is non-null, `fs.stat()` the file → format size → `"  File size: ..."`. Catch errors gracefully (file may not exist yet due to deferred materialization)
- Line 40-41: `"  Resumed: " + (isResumed ? "yes" : "no")`
- Line 43-44: Return lines

### Files to Modify

- `packages/cli/src/ui/commands/formatSessionSection.ts`
  - Replace stub with full implementation per pseudocode
  - Import `formatRelativeTime` from `../utils/formatRelativeTime.js`
  - Import `fs` from `node:fs/promises`
  - Import `SessionRecordingMetadata` from `../types/SessionRecordingMetadata.js`
  - ADD comment: `@plan PLAN-20260214-SESSIONBROWSER.P26`
  - ADD comment: `@pseudocode stats-session-section.md lines 12-44`

### DO NOT MODIFY
- `packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts` — Tests from P25 must not be altered

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P26
 * @requirement REQ-ST-001, REQ-ST-002, REQ-ST-003, REQ-ST-004, REQ-ST-005, REQ-ST-006
 * @pseudocode stats-session-section.md lines 12-44
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260214-SESSIONBROWSER.P26" packages/cli/src/ | wc -l
# Expected: 1+ (formatSessionSection.ts)

# Check pseudocode reference
grep "pseudocode.*stats-session-section" packages/cli/src/ui/commands/formatSessionSection.ts
# Expected: Present

# Tests pass
npm run test -- --run packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts
# Expected: ALL PASS (Green phase)

# TypeScript compiles
npm run typecheck
# Expected: Pass
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for deferred implementation markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/cli/src/ui/commands/formatSessionSection.ts | grep -v ".spec.ts"
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/cli/src/ui/commands/formatSessionSection.ts | grep -v ".spec.ts"
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/cli/src/ui/commands/formatSessionSection.ts | grep -v ".spec.ts"
# Expected: No matches in implementation (stub replaced)
```

### Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] REQ-ST-001: Returns lines with "Session:" header
   - [ ] REQ-ST-002: Truncates ID to 12 chars
   - [ ] REQ-ST-003: Uses formatRelativeTime for start time
   - [ ] REQ-ST-004: Uses fs.stat for file size (with error handling)
   - [ ] REQ-ST-005: Maps boolean to "yes"/"no"
   - [ ] REQ-ST-006: Returns "No active session recording." for null

2. **Is this REAL implementation?**
   - [ ] No empty returns
   - [ ] No TODOs
   - [ ] No placeholders

3. **Would tests FAIL if implementation was removed?**
   - [ ] Yes — all 13+ tests would fail

#### Feature Actually Works

```bash
# All formatSessionSection tests pass
npm run test -- --run packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts 2>&1 | tail -10
# Expected: All tests pass

# Full test suite still passes
npm run test
# Expected: No regressions
```

#### Integration Points Verified

- [ ] `formatRelativeTime` imported and called correctly
- [ ] `fs.stat` used with proper error handling
- [ ] `SessionRecordingMetadata` type matches the one from P21

## Success Criteria

- All 13+ tests from P25 pass (Green phase)
- No deferred implementation markers
- TypeScript compiles
- Full test suite passes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/ui/commands/formatSessionSection.ts`
2. Re-run Phase 26 with corrected implementation
3. MUST NOT modify test files from P25

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P26.md`
Contents:
```markdown
Phase: P26
Completed: YYYY-MM-DD HH:MM
Files Modified: [list with diff stats]
Tests Passing: [count]
Verification: [paste of verification command outputs]
```
