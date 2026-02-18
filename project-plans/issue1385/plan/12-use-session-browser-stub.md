# Phase 12: useSessionBrowser Hook — Stub

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P12`

## Prerequisites
- Required: Phase 11a completed
- Verification: `test -f project-plans/issue1385/.completed/P11a.md`
- Expected files:
  - `packages/cli/src/services/performResume.ts` (real from P11)
  - `packages/cli/src/utils/formatRelativeTime.ts` (real from P05)
  - Core extensions: `listSessionsDetailed`, `hasContentEvents`, `readFirstUserMessage` (real from P08)

## Requirements Implemented (Expanded)

### REQ-SB-002: List Sessions Newest-First
**Full Text**: When the session browser opens, the system shall list all JSONL sessions matching the current project hash, sorted newest-first by default.
**Behavior**:
- GIVEN: Sessions exist for the current project
- WHEN: The browser opens
- THEN: Sessions are listed newest-first

### REQ-SB-004: Exclude Current Session
**Full Text**: The system shall exclude the current active session from the session browser list.
**Behavior**:
- GIVEN: The user is in an active session
- WHEN: The session browser loads
- THEN: The current session is not in the list

### REQ-SB-005: Hide Empty Sessions
**Full Text**: The system shall hide empty sessions from the browser list.
**Behavior**:
- GIVEN: Some sessions have no content beyond session_start
- WHEN: The session list loads
- THEN: Empty sessions are not shown

### REQ-SB-008: Skipped Count
**Full Text**: When some session files have unreadable headers, the system shall exclude those sessions and display an inline notice.

### REQ-SB-009: Loading State
**Full Text**: The system shall display a loading state while the initial session list is being fetched.

### REQ-SB-010: Lock Indicator
**Full Text**: The system shall indicate sessions locked by another process with "(in use)".

### REQ-PV-001 through REQ-PV-010: Preview Loading
**Behavior**: Previews load asynchronously per-page with generation counter; cached by sessionId.

### REQ-SR-001 through REQ-SR-014: Search
**Behavior**: Filters by preview/provider/model; not-yet-loaded previews included; eventually-consistent.

### REQ-SO-001 through REQ-SO-007: Sort
**Behavior**: Cycles newest/oldest/size; preserved across search changes.

### REQ-PG-001 through REQ-PG-005: Pagination
**Behavior**: 20 per page; PgUp/PgDn navigation.

### REQ-KN-001 through REQ-KN-007: Keyboard Navigation
**Behavior**: Up/Down selection, Tab mode switch, Backspace no-op in nav mode.

### REQ-SD-001 through REQ-SD-003: Selection
**Behavior**: Selected index clamped to filtered list; empty list resets to 0.

### REQ-EP-001 through REQ-EP-004: Escape Precedence
**Behavior**: Delete confirm > conversation confirm > clear search > close.

### REQ-MP-001 through REQ-MP-003: Modal Priority
**Behavior**: Delete confirm/conversation confirm consume Y/N/Esc; isResuming blocks all.

### REQ-LK-001 through REQ-LK-006: Lock Status
**Behavior**: Check once on load; re-check at action time; stale cleanup.

### REQ-DL-001 through REQ-DL-014: Delete Flow
**Behavior**: Delete key shows confirmation; Y deletes, N/Esc dismisses; locked sessions error.

### REQ-RS-001 through REQ-RS-014: Resume Flow (Browser Path)
**Behavior**: Enter resumes; confirmation for active conversation; two-phase swap; inline errors.

## Implementation Tasks

### Files to Create

- `packages/cli/src/ui/hooks/useSessionBrowser.ts`
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P12`
  - MUST include: `@requirement:REQ-SB-002, REQ-SR-001, REQ-SO-001, REQ-PG-001, REQ-KN-001`
  - MUST include: `@pseudocode use-session-browser.md`
  - Export `EnrichedSessionSummary` type
  - Export `PreviewState` type
  - Export `UseSessionBrowserProps` interface
  - Export `UseSessionBrowserResult` interface
  - Export `useSessionBrowser` hook function
  - All state variables as per pseudocode lines 10-38
  - All derived computations as stubs
  - All handlers as stubs

### Type Definitions

```typescript
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P12
 * @requirement REQ-PV-006
 */
type PreviewState = 'loading' | 'loaded' | 'none' | 'error';

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P12
 * @requirement REQ-SB-003
 */
interface EnrichedSessionSummary extends SessionSummary {
  firstUserMessage?: string;
  previewState: PreviewState;
  isLocked: boolean;
}

interface UseSessionBrowserProps {
  chatsDir: string;
  projectHash: string;
  currentSessionId: string;
  onSelect: (session: SessionSummary) => Promise<PerformResumeResult>;
  onClose: () => void;
}

interface UseSessionBrowserResult {
  // State
  sessions: EnrichedSessionSummary[];
  filteredSessions: EnrichedSessionSummary[];
  searchTerm: string;
  sortOrder: 'newest' | 'oldest' | 'size';
  selectedIndex: number;
  page: number;
  isSearching: boolean;
  isLoading: boolean;
  isResuming: boolean;
  deleteConfirmIndex: number | null;
  conversationConfirmActive: boolean;
  error: string | null;
  skippedCount: number;

  // Derived
  totalPages: number;
  pageItems: EnrichedSessionSummary[];
  selectedSession: EnrichedSessionSummary | null;

  // Actions
  handleKeypress: (input: string, key: Key) => void;
}
```

### Stub Behavior
- `useSessionBrowser` returns an object with all state initialized to defaults
- `handleKeypress` is a no-op
- `sessions` and `filteredSessions` are empty arrays
- `isLoading` starts as `true`
- All other state is at defaults (empty string, 0, false, null)

## Verification Commands

```bash
# File exists
test -f packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"

# Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P12" packages/cli/src/ui/hooks/useSessionBrowser.ts
# Expected: 3+

# Types exported
grep "export.*EnrichedSessionSummary" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"
grep "export.*PreviewState" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"
grep "export.*useSessionBrowser" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"

# All state fields present
grep "searchTerm" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"
grep "sortOrder" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"
grep "selectedIndex" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"
grep "isResuming" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"
grep "deleteConfirmIndex" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"
grep "skippedCount" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"
grep "conversationConfirmActive" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"

# TypeScript compiles
cd packages/cli && npx tsc --noEmit
```

## Success Criteria
- Hook file exists with complete type definitions
- All state variables defined
- All return fields present
- TypeScript compiles

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/hooks/useSessionBrowser.ts
rm -f packages/cli/src/ui/hooks/useSessionBrowser.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P12.md`
