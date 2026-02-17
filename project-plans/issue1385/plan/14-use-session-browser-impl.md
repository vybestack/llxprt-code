# Phase 14: useSessionBrowser Hook — Implementation

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P14`

## Prerequisites
- Required: Phase 13a completed
- Verification: `test -f project-plans/issue1385/.completed/P13a.md`
- Expected files:
  - `packages/cli/src/ui/hooks/useSessionBrowser.ts` (stub from P12)
  - `packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts` (tests from P13)

## Requirements Implemented
This phase makes all TDD tests from Phase 13 pass. This is the most complex implementation phase, implementing the full state machine for the session browser hook.

## Algorithm Overview (from pseudocode use-session-browser.md)

### State Management (lines 10-38)
- All state via useState hooks: sessions, searchTerm, sortOrder, selectedIndex, page, isSearching, isLoading, isResuming, deleteConfirmIndex, conversationConfirmActive, error, skippedCount
- Preview cache via useRef: Map<string, {firstUserMessage?: string, previewState: PreviewState}>
- Generation counter via useRef: number (incremented on page/sort/refresh)

### Derived State (lines 40-95)
- `filteredSessions`: Filter by searchTerm against firstUserMessage, provider, model; include non-loaded previews
- `sortedSessions`: Sort filteredSessions by sortOrder (newest: lastModified desc, oldest: lastModified asc, size: fileSize desc)
- `totalPages`: Math.ceil(sortedSessions.length / PAGE_SIZE)
- `pageItems`: sortedSessions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
- `selectedSession`: pageItems[selectedIndex] or null

### loadSessions (lines 100-140)
1. Set isLoading = true
2. Call SessionDiscovery.listSessionsDetailed(chatsDir, projectHash)
3. Check lock status for each session via SessionLockManager.isLocked
4. Filter out currentSessionId
5. Filter out empty sessions via SessionDiscovery.hasContentEvents
6. Store skippedCount
7. Enrich with cached previews or set previewState: 'loading'
8. Set isLoading = false
9. Trigger preview loading for visible page

### loadPreviewsForPage (lines 145-185)
1. Increment generation counter
2. For each session on current page without cached preview:
   a. Call SessionDiscovery.readFirstUserMessage(session.filePath)
   b. If generation counter has changed, discard result
   c. Cache result by sessionId
   d. Update session's previewState and firstUserMessage

### handleKeypress (lines 190-340) — Modal Priority Stack
```
IF isResuming: RETURN (all keys blocked)
IF deleteConfirmIndex !== null:
  Y -> executeDelete
  N/Esc -> dismissDelete
  all others -> RETURN
IF conversationConfirmActive:
  Y -> executeResume
  N/Esc -> dismissConversationConfirm
  all others -> RETURN

// Normal keyboard handling
IF key.escape:
  searchTerm non-empty -> clearSearch
  ELSE -> onClose()

IF key.tab:
  toggle isSearching

IF isSearching:
  characters -> appendToSearchTerm
  backspace -> deleteLastChar
  up/down -> moveSelection
  enter -> initiateResume
  pgup/pgdn -> changePage
  delete -> NO-OP

IF NOT isSearching (nav mode):
  up/down -> moveSelection
  enter -> initiateResume
  delete -> showDeleteConfirmation
  's' -> cycleSort
  pgup/pgdn -> changePage
  characters -> NO-OP
  backspace -> NO-OP
```

### initiateResume (lines 280-300)
1. If no selectedSession: return
2. If hasActiveConversation: set conversationConfirmActive = true; return
3. executeResume()

### executeResume (lines 305-325)
1. Set isResuming = true
2. Clear error
3. const result = await onSelect(selectedSession)
4. Set isResuming = false
5. If result.ok: onClose()
6. If !result.ok: set error = result.error; refresh list

### executeDelete (lines 330-365)
1. const sessionToDelete = pageItems[deleteConfirmIndex]
2. Clear deleteConfirmIndex
3. Call deleteSession with sessionToDelete.sessionId
4. If error: set error
5. Refresh session list
6. Preserve selection by sessionId: find old selected session in new list
7. If not found: clamp to same index or move to previous page if page empty

## Implementation Notes

- Use `useCallback` for all handlers to avoid unnecessary re-renders
- Use `useEffect` for initial load (mount effect)
- Use `useEffect` for preview loading (triggered by page/sort/sessions changes)
- Generation counter prevents stale preview data
- Preview cache persists across re-renders via useRef
- Selection clamping happens in a useEffect watching filteredSessions changes
- PAGE_SIZE constant = 20

### Do NOT Modify
- `packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts` — Tests must pass WITHOUT modification

## Verification Commands

```bash
# All hook tests pass
cd packages/cli && npx vitest run src/ui/hooks/__tests__/useSessionBrowser.spec.ts
# Expected: ALL PASS

# Plan markers
grep "@plan PLAN-20260214-SESSIONBROWSER.P12" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL: P12"
grep "@plan PLAN-20260214-SESSIONBROWSER.P14" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL: P14"

# Pseudocode reference
grep "@pseudocode" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL: pseudocode ref"

# Deferred implementation detection
grep -n "TODO\|FIXME\|HACK\|NotYetImplemented" packages/cli/src/ui/hooks/useSessionBrowser.ts && echo "FAIL" || echo "OK"
grep -n "return \[\]\|return \{\}" packages/cli/src/ui/hooks/useSessionBrowser.ts | grep -v "test\|spec" && echo "CHECK: empty returns" || echo "OK"

# TypeScript compiles
cd packages/cli && npx tsc --noEmit

# Generation counter exists
grep "generation\|generationRef\|generationCounter" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL: no generation counter"

# PAGE_SIZE constant
grep "PAGE_SIZE\|pageSize\|20" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "CHECK: page size"
```

## Success Criteria
- ALL tests from Phase 13 pass
- Tests pass WITHOUT modification
- Full state machine implemented
- Generation counter for stale read protection
- Preview caching operational
- Modal priority stack correct
- Escape precedence correct
- No deferred implementation markers

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/hooks/useSessionBrowser.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P14.md`
