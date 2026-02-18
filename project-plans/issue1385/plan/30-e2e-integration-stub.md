# Phase 30: End-to-End Integration — Stub

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P30`

## Prerequisites

- Required: Phase 29a completed
- Verification: `test -f project-plans/issue1385/.completed/P29a.md`
- Expected files from previous phases (all components must be present):
  - `packages/cli/src/ui/commands/continueCommand.ts` — /continue command (P18-P20)
  - `packages/cli/src/ui/components/SessionBrowserDialog.tsx` — browser dialog (P15-P17)
  - `packages/cli/src/ui/hooks/useSessionBrowser.ts` — browser hook (P12-P14)
  - `packages/cli/src/services/performResume.ts` — shared resume utility (P09-P11)
  - `packages/cli/src/ui/commands/formatSessionSection.ts` — stats section (P24-P26)
  - `packages/core/src/recording/SessionDiscovery.ts` — extended with new methods (P06-P08)
  - `packages/cli/src/ui/utils/formatRelativeTime.ts` — time formatter (P03-P05)
  - Integration wiring in UIState, UIActions, DialogManager, slashCommandProcessor (P21-P23)
  - Legacy cleanup complete — --resume removed (P27-P29)
- Preflight verification: Phase 0.5 completed

## Requirements Implemented (Expanded)

This phase sets up the end-to-end integration test infrastructure. It covers cross-cutting requirements that span multiple components:

### REQ-SW-001: Two-Phase Swap
**Full Text**: When resuming a session, the system shall acquire and replay the new session before disposing the old session (two-phase swap).
**Behavior**:
- GIVEN: An active session recording
- WHEN: The user resumes a different session
- THEN: The new session is fully acquired before the old one is disposed
**Why This Matters**: Prevents data loss if the new session fails to load.

### REQ-SW-002: Phase 1 Failure Preservation
**Full Text**: If Phase 1 (acquiring the new session) fails, the system shall leave the old session fully intact.
**Behavior**:
- GIVEN: An active session
- WHEN: Resume Phase 1 fails (e.g., locked session)
- THEN: The old session continues as if nothing happened

### REQ-EN-001: /continue Opens Browser
**Full Text**: `/continue` (no args) opens the session browser dialog.
**Behavior**:
- GIVEN: User is in an active CLI session
- WHEN: User types `/continue`
- THEN: The session browser dialog opens

### REQ-EN-002: /continue Latest
**Full Text**: `/continue latest` resumes the most recent resumable session.
**Behavior**:
- GIVEN: Multiple JSONL sessions exist
- WHEN: User types `/continue latest`
- THEN: The most recent unlocked, non-current, non-empty session is resumed

### REQ-EH-001: Discovery Failure
**Full Text**: If session discovery fails, the system displays "Failed to load sessions: {details}".
**Behavior**:
- GIVEN: The session directory has permission issues
- WHEN: The session browser tries to load sessions
- THEN: An error state is displayed

### REQ-CV-001: Client History Conversion
**Full Text**: `resumeSession()` returns `IContent[]` which must be converted to `Content[]` for the generative client using `geminiClient.restoreHistory()`.
**Behavior**:
- GIVEN: A successful resume returning IContent[]
- WHEN: The resume flow completes
- THEN: `geminiClient.restoreHistory()` is called with the history

### REQ-CV-002: UI History Conversion
**Full Text**: `IContent[]` must be converted to `HistoryItemWithoutId[]` for the UI using `iContentToHistoryItems()`.
**Behavior**:
- GIVEN: A successful resume returning IContent[]
- WHEN: The resume flow completes
- THEN: `iContentToHistoryItems()` converts the history for UI display

## Implementation Tasks

### Files to Create

- `packages/cli/src/__tests__/sessionBrowserE2E.spec.ts` — End-to-end integration test file (stub with describe blocks and placeholder structure)
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P30`
  - Sets up shared test infrastructure: temp directories, JSONL session file creation helpers, cleanup
  - Defines describe blocks for each integration scenario (to be filled in P31)

### Test Infrastructure Setup

The E2E test file needs helper functions:

```typescript
/**
 * Create a minimal JSONL session file for testing.
 * Writes session_start header + optional content events.
 */
async function createTestSession(dir: string, opts: {
  sessionId: string;
  provider?: string;
  model?: string;
  messages?: Array<{ speaker: 'user' | 'model'; text: string }>;
}): Promise<string> // returns file path

/**
 * Create the chats directory structure expected by SessionDiscovery.
 */
async function setupChatsDir(baseDir: string, projectHash: string): Promise<string>
```

These helpers create REAL JSONL files on the filesystem — no mocking.

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P30
 * @requirement REQ-SW-001, REQ-EN-001, REQ-EN-002, REQ-EH-001, REQ-CV-001, REQ-CV-002
 */
```

## Verification Commands

### Automated Checks

```bash
# 1. Test file exists
test -f packages/cli/src/__tests__/sessionBrowserE2E.spec.ts && echo "OK" || echo "MISSING"

# 2. Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P30" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 1+

# 3. Test infrastructure helpers defined
grep "createTestSession\|setupChatsDir" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: Both present

# 4. TypeScript compiles
npm run typecheck
# Expected: Pass
```

### Semantic Verification Checklist

1. **Test infrastructure complete?**
   - [ ] Helper to create JSONL session files
   - [ ] Helper to set up chats directory
   - [ ] Cleanup in afterEach/afterAll
   - [ ] describe blocks for each scenario

2. **No mock theater?**
   - [ ] No `vi.mock` or `jest.mock`
   - [ ] Helpers create real files on real filesystem

## Success Criteria

- Test infrastructure file exists with helpers and describe blocks
- TypeScript compiles
- No mock theater
- describe blocks cover the key integration scenarios

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/__tests__/sessionBrowserE2E.spec.ts`
2. Re-run Phase 30

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P30.md`
Contents:
```markdown
Phase: P30
Completed: YYYY-MM-DD HH:MM
Files Created: [list with line counts]
Verification: [paste of verification command outputs]
```
