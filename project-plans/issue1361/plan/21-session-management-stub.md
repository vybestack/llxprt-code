# Phase 21: Session Management Stub

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P21`

## Prerequisites
- Required: Phase 20a completed (SessionDiscovery works — needed for listing/resolving sessions)
- Verification: `test -f project-plans/issue1361/.completed/P20a.md`
- Required: Phase 11a completed (SessionLockManager works — needed for delete safety check)
- Verification: `test -f project-plans/issue1361/.completed/P11a.md`

## Requirements Implemented (Expanded)

### REQ-MGT-001: List Sessions
**Full Text**: `--list-sessions` displays a table with index, session ID, start time, last updated, provider/model, and file size for all sessions matching the current project.
**Behavior**:
- GIVEN: Multiple session files exist for the project
- WHEN: handleListSessions() is called
- THEN: A formatted table is printed to stdout and process exits with code 0
**Why This Matters**: Users need to see available sessions before choosing which to resume.

### REQ-MGT-002: Delete Session
**Full Text**: `--delete-session <id>` resolves the argument to a session file and deletes it.
**Behavior**:
- GIVEN: A session file matching the provided ID/prefix/index
- WHEN: handleDeleteSession(ref) is called
- THEN: The session file and its sidecar .lock file are deleted
**Why This Matters**: Users need to manage disk space and remove unwanted sessions.

### REQ-MGT-003: Refuse to Delete Locked Session
**Full Text**: If the session is locked by an active process, deletion fails with a clear error.
**Behavior**:
- GIVEN: A session file with an active .lock held by a running process
- WHEN: handleDeleteSession() attempts to delete it
- THEN: Error: "Cannot delete: session is in use by another process"
**Why This Matters**: Prevents deleting sessions that are actively being used.

## Implementation Tasks

### Files to Create
- `packages/core/src/recording/sessionManagement.ts` — Management command stubs
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P21`
  - MUST include: `@requirement:REQ-MGT-001, REQ-MGT-002, REQ-MGT-003`
  - `handleListSessions(chatsDir, projectHash)`: throws NotYetImplemented (stub)
  - `handleDeleteSession(ref, chatsDir, projectHash)`: throws NotYetImplemented (stub)
  - `formatSessionTable(sessions)`: throws NotYetImplemented (stub)

### Files to Modify
- `packages/core/src/recording/index.ts` — Add sessionManagement exports

### Required Code Markers
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P21
 * @requirement REQ-MGT-001, REQ-MGT-002, REQ-MGT-003
 */
```

## Verification Commands

```bash
# File exists
test -f packages/core/src/recording/sessionManagement.ts || echo "FAIL"

# Plan markers
grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P21" packages/core/src/recording/ | wc -l
# Expected: 1+

# TypeScript compiles
cd packages/core && npx tsc --noEmit

# Method signatures
grep -q "handleListSessions" packages/core/src/recording/sessionManagement.ts || echo "FAIL"
grep -q "handleDeleteSession" packages/core/src/recording/sessionManagement.ts || echo "FAIL"

# Barrel export
grep -q "handleListSessions\|handleDeleteSession" packages/core/src/recording/index.ts || echo "FAIL"

# No TODO
grep -r "TODO" packages/core/src/recording/sessionManagement.ts && echo "FAIL"
```

### Semantic Verification Checklist
- [ ] handleListSessions takes (chatsDir: string, projectHash: string)
- [ ] handleDeleteSession takes (ref: string, chatsDir: string, projectHash: string)
- [ ] Functions return Promise (async operations)
- [ ] Uses SessionDiscovery and SessionLockManager types in signatures

## Success Criteria
- Stub compiles
- Correct signatures
- Barrel export works

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/sessionManagement.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P21.md`


---

## Addendum: Core/CLI Boundary for Session Management

### Architectural Constraint
`SessionDiscovery` in `packages/core/src/recording/` is a **core-layer** module. It returns raw `SessionSummary[]` data objects. It MUST NOT contain any:
- Table formatting or column alignment logic
- Terminal color codes or ANSI escape sequences
- Human-friendly date formatting (e.g., "2 hours ago")
- Interactive prompts or confirmation dialogs
- Console output of any kind

### Boundary Definition
- **Core layer** (`packages/core/`): `SessionDiscovery.listSessions()` returns `SessionSummary[]` where each summary contains raw data: `{ sessionId: string, filePath: string, lastModified: Date, sizeBytes: number, turnCount: number, provider?: string, model?: string }`.
- **CLI layer** (`packages/cli/`): The CLI command handler for `--list-sessions` receives `SessionSummary[]` and is solely responsible for:
  - Formatting as a table (column widths, alignment, headers)
  - Relative time display ("2 hours ago")
  - Color coding (active vs. stale sessions)
  - Truncation of long session IDs for display
  - Output format switching (table vs. JSON for `--output json`)

### Why This Matters
Keeping UX formatting out of core ensures testability (unit tests check data, not string formatting), reusability (other consumers like an API server or IDE plugin can use the same core API), and separation of concerns.
