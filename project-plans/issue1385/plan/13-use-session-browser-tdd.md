# Phase 13: useSessionBrowser Hook — TDD

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P13`

## Prerequisites
- Required: Phase 12a completed
- Verification: `test -f project-plans/issue1385/.completed/P12a.md`
- Expected files: `packages/cli/src/ui/hooks/useSessionBrowser.ts` (stub from P12)

## Requirements Implemented (Expanded)

This is the most complex TDD phase, covering the hook's state management for all browser behaviors.

### REQ-SB-002: Newest-First Sorting
### REQ-SB-004: Exclude Current Session
### REQ-SB-005: Hide Empty Sessions
### REQ-SB-008: Skipped Unreadable Sessions Count
### REQ-SB-009: Loading State
### REQ-SB-010: Lock Indicator
### REQ-PV-001: Immediate Metadata Render
### REQ-PV-003: Page-Scoped Preview Loading
### REQ-PV-004: Generation Counter for Stale Reads
### REQ-PV-005: Preview Caching by SessionId
### REQ-PV-006: Preview Loaded State
### REQ-PV-007: No User Message State
### REQ-PV-008: Preview Read Error State
### REQ-SR-001: Start in Search Mode
### REQ-SR-002: Real-Time Filtering
### REQ-SR-003: Include Not-Yet-Loaded Previews
### REQ-SR-004: Eventually-Consistent Filtering
### REQ-SR-005: Match Count Updates
### REQ-SR-006: Search Reset Page and Selection
### REQ-SR-007: Arrow Keys in Search Mode
### REQ-SR-008: Escape Clears Search (Non-Empty)
### REQ-SR-009: Escape Closes Browser (Empty Search)
### REQ-SR-010: Tab Switches to Nav Mode
### REQ-SR-011: No Sessions Match Query Display
### REQ-SR-013: Characters Append to Search
### REQ-SR-014: Backspace Deletes Last Char
### REQ-SO-001: Sort Options
### REQ-SO-003: s Cycles Sort in Nav Mode
### REQ-SO-004: Sort Preserved Across Search
### REQ-SO-005: Sort Triggers Preview Enrichment
### REQ-PG-001: 20 Per Page
### REQ-PG-003: PgUp Previous Page
### REQ-PG-004: PgDn Next Page
### REQ-KN-001: Up Moves Selection
### REQ-KN-002: Down Moves Selection
### REQ-KN-003: Tab Nav to Search
### REQ-KN-004: Characters No-Op in Nav
### REQ-KN-005: Backspace No-Op in Nav
### REQ-KN-006: Delete No-Op in Search
### REQ-KN-007: Backspace Never Triggers Delete
### REQ-SD-002: Selection Clamping
### REQ-SD-003: Empty List Resets
### REQ-EP-001 through REQ-EP-004: Escape Precedence
### REQ-MP-001 through REQ-MP-003: Modal Priority
### REQ-LK-001: Check Lock on Load
### REQ-LK-002: Re-check Lock at Action
### REQ-LK-004: Stale Lock Cleanup on Load
### REQ-LK-005: Locked Sessions Selectable
### REQ-DL-001: Delete Key Shows Confirmation
### REQ-DL-002: Delete No-Op on Empty
### REQ-DL-003: Confirmation Y/N/Esc Only
### REQ-DL-004: Y Deletes by SessionId
### REQ-DL-005: N Dismisses
### REQ-DL-006: Esc Dismisses
### REQ-DL-007: Refresh After Delete
### REQ-DL-008: Selection Preserved by SessionId
### REQ-DL-009: Empty Page Falls Back
### REQ-DL-010: Locked Session Delete Error
### REQ-RS-001: Enter Initiates Resume
### REQ-RS-002: Enter No-Op on Empty
### REQ-RS-003: Resuming Status
### REQ-RS-004: Enter Disabled During Resume
### REQ-RS-005: All Keys Blocked During Resume
### REQ-RS-006: Active Conversation Confirmation
### REQ-RS-013: N Dismisses Conversation Confirm
### REQ-RS-014: Esc Dismisses Conversation Confirm

## Test Cases

### File to Create
- `packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts`
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P13`

### Test Strategy
The hook is a React hook (using useState, useEffect, useCallback). Tests should use a test harness that renders the hook with `renderHook` from testing library. The hook depends on external services (SessionDiscovery, SessionLockManager, deleteSession) — tests should provide real JSONL files in temp directories where feasible, but for the hook's internal state machine logic (search, sort, pagination, keyboard handling), providing mock session data to the hook is acceptable since the hook calls external APIs through injected callbacks.

**Key insight**: The hook receives `onSelect` and `onClose` callbacks as props. For resume behavior, the hook calls `onSelect(session)` which returns a `PerformResumeResult`. The actual resume logic is tested in P10. Here we test the hook's STATE MANAGEMENT around resume (isResuming, error handling, conversation confirmation).

For initial load, the hook calls `SessionDiscovery.listSessionsDetailed` and `SessionLockManager.isLocked`. Tests can provide pre-built session data by creating helper functions that write real JSONL files.

### BEHAVIORAL Tests — Loading & Listing

1. **isLoading starts true**: On mount, isLoading is true.
2. **Sessions load from discovery**: After mount, sessions array is populated.
3. **Current session excluded**: The currentSessionId is not in the sessions array.
4. **Empty sessions excluded**: Sessions with no content events are excluded.
5. **Skipped count populated**: skippedCount reflects unreadable sessions.
6. **Lock status checked**: isLocked is set for locked sessions.
6a. **Stale locks cleaned during load**: Given a stale lock file (from crashed process), after hook loads, the session shows `isLocked: false` because `SessionLockManager.isStale()` cleaned it. (REQ-LK-004)
7. **Preview state starts as loading**: New sessions have previewState 'loading'.
7a. **Generation counter discards stale preview reads**: When page changes while preview load is in-flight, the stale result is discarded and does not update state. (REQ-PV-004)

### BEHAVIORAL Tests — Search

8. **Start in search mode**: isSearching is true on mount.
9. **Characters append to search term**: After typing 'a', searchTerm is 'a'.
10. **Backspace deletes last char**: After typing 'ab' then backspace, searchTerm is 'a'.
11. **Search filters by preview text**: Sessions not matching are excluded from filteredSessions.
12. **Search filters by provider**: Provider-matching sessions are included.
13. **Search filters by model**: Model-matching sessions are included.
14. **Not-yet-loaded previews included**: Sessions with previewState 'loading' are in filtered results.
15. **Search resets page to 0**: After navigating to page 2, typing resets to page 0.
16. **Search resets selection to 0**: After selecting item 3, typing resets to 0.
17. **Match count reflects filtered list**: filteredSessions.length matches expected count.
17a. **No-match state includes query (REQ-SR-011)**: When search yields no results, hook state includes `noMatchQuery` containing the exact search term for display as 'No sessions match "{query}"'.
17b. **Anti-fake: No-match query preserves special chars**: Given search term with quotes like `my "test"`, the `noMatchQuery` contains the exact verbatim string including quotes. This prevents fake implementation that strips or escapes the query.
18. **Tab switches to nav mode**: After Tab, isSearching is false.
19. **Tab switches back to search**: From nav mode, Tab sets isSearching to true.
20. **Arrow keys work in search mode**: Up/Down change selectedIndex while isSearching.

### BEHAVIORAL Tests — Sort

21. **Default sort is newest**: sortOrder is 'newest' on mount.
22. **s cycles sort in nav mode**: After 's', sortOrder is 'oldest'; again 'size'; again 'newest'.
23. **s does NOT cycle in search mode**: Pressing 's' in search mode appends to searchTerm.
24. **Sort preserved across search**: Changing searchTerm doesn't reset sortOrder.
25. **Oldest sort reverses order**: Sessions are ordered oldest-first.
26. **Size sort orders by fileSize**: Sessions ordered by fileSize descending.

### BEHAVIORAL Tests — Pagination

27. **20 items per page**: With 25 sessions, pageItems has 20 on page 0.
28. **PgDn goes to next page**: From page 0, PgDn sets page to 1.
29. **PgUp goes to previous page**: From page 1, PgUp sets page to 0.
30. **PgUp no-op on first page**: From page 0, PgUp keeps page at 0.
31. **PgDn no-op on last page**: From last page, PgDn keeps current page.
32. **totalPages is correct**: 25 sessions / 20 per page = 2 pages.

### BEHAVIORAL Tests — Navigation

33. **Down moves selection**: selectedIndex 0 -> 1 after Down.
34. **Up moves selection**: selectedIndex 1 -> 0 after Up.
35. **Selection wraps at bottom (clamp)**: At last item, Down stays at last.
36. **Selection stays at top (clamp)**: At 0, Up stays at 0.
37. **Characters no-op in nav mode**: Pressing 'a' in nav mode doesn't change searchTerm.
38. **Backspace no-op in nav mode**: Pressing Backspace in nav mode is ignored.

### BEHAVIORAL Tests — Escape Precedence

39. **Escape dismisses delete confirmation first**: With deleteConfirmIndex set, Escape clears it.
40. **Escape dismisses conversation confirmation second**: With conversationConfirmActive, Escape clears it.
41. **Escape clears search term third**: With searchTerm 'abc', Escape clears to ''.
42. **Escape closes browser fourth**: With empty search and no confirmations, Escape calls onClose.

### BEHAVIORAL Tests — Delete Flow

43. **Delete key shows confirmation**: Pressing Delete sets deleteConfirmIndex.
44. **Delete no-op on empty list**: With no sessions, Delete does nothing.
45. **Delete no-op in search mode**: Pressing Delete in search mode does nothing.
46. **Y confirms delete and session removed**: With confirmation showing, Y triggers delete; verify session is no longer in `sessions` array after hook re-renders (NOT by asserting deleteSession was called).
47. **N dismisses confirmation**: With confirmation showing, N clears deleteConfirmIndex.
48. **Esc dismisses confirmation**: With confirmation showing, Esc clears deleteConfirmIndex.
49. **All other keys ignored during confirmation**: With confirmation, typing 'a' does nothing.
50. **Locked session delete shows error**: Attempting delete on locked session sets error.
51. **List refreshes after delete**: After successful delete, sessions are reloaded.
52. **Selection preserved by sessionId after delete**: If selected session exists after delete, it stays selected.
53. **Selection falls back to same index after delete**: If deleted session was selected, next session at same index is selected.
54. **Empty page falls back to previous**: If deletion empties page 2, moves to page 1.

### BEHAVIORAL Tests — Resume Flow

55. **Enter initiates resume**: Pressing Enter calls onSelect with selected session.
56. **Enter no-op on empty list**: With no sessions, Enter does nothing.
57. **isResuming true during resume**: While onSelect promise is pending, isResuming is true.
58. **isResuming false after resume completes**: After promise resolves, isResuming is false.
59. **Enter disabled during resume**: While isResuming, pressing Enter again does nothing.
60. **All keys blocked during resume**: While isResuming, all keypresses are ignored.
61. **Successful resume calls onClose**: When onSelect returns ok:true, onClose is called.
62. **Failed resume shows error**: When onSelect returns ok:false, error is set.
63. **Failed resume stays open**: Browser remains open after error.
64. **Error cleared on next action**: After error, next keypress clears error.

### BEHAVIORAL Tests — Conversation Confirmation

65. **Active conversation shows confirmation**: When hasActiveConversation is true, Enter shows confirmation.
66. **Y on confirmation proceeds with resume**: Confirming Y calls onSelect.
67. **N on confirmation cancels**: Confirming N dismisses without resuming.

### Property-Based Tests (~30%)

68. **Property: selectedIndex always in bounds**: For any sequence of Up/Down/search/delete, selectedIndex is within [0, max(filteredSessions.length-1, 0)].
69. **Property: page always in bounds**: For any sequence of PgUp/PgDn/search/sort, page is within [0, max(totalPages-1, 0)].
70. **Property: filteredSessions subset of sessions**: For any search term, every item in filteredSessions exists in sessions.
71. **Property: sort order preserved**: For any sort + filter combination, filteredSessions are ordered by the active sort.
72. **Property: escape priority is strict across all 4 levels**: For any combination of (deleteConfirm, conversationConfirm, searchTerm, none), Escape handles exactly the highest-priority item and leaves lower-priority state unchanged.
73. **Property: ALL keys blocked during isResuming**: Using `fc.oneof(fc.constant('Enter'), fc.constant('Escape'), fc.constant('ArrowUp'), fc.constant('ArrowDown'), fc.constant('Tab'), fc.constant('Delete'), fc.constant('PageUp'), fc.constant('PageDown'), fc.constant('s'), fc.char())`, verify that when `isResuming === true`, the key has NO effect on any hook state (selectedIndex, page, searchTerm, sortOrder, isSearching, deleteConfirmIndex all unchanged).
74. **Property: confirmation dialogs consume only Y/N/Esc**: While deleteConfirmIndex or conversationConfirmActive is set, any key OTHER than Y/N/Escape leaves all state unchanged.

### FORBIDDEN Patterns
```typescript
// NO mocking React hooks internals
vi.mock('react', () => ({ useState: vi.fn() })) // FORBIDDEN

// NO testing implementation details
expect(setSearchTerm).toHaveBeenCalledWith('abc') // FORBIDDEN

// NO callback spy assertions (mock theater)
expect(deleteSession).toHaveBeenCalled() // FORBIDDEN - instead verify session removed from list
expect(onSelect).toHaveBeenCalledWith(session) // FORBIDDEN - instead verify isResuming state or result

// NO reverse testing
expect(handleKeypress).not.toThrow() // FORBIDDEN

// OK: State assertions after action
expect(result.current.sessions).not.toContainEqual(expect.objectContaining({ sessionId: deletedId }))
expect(result.current.isResuming).toBe(true)
```

## Verification Commands

```bash
# Test file exists
test -f packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts || echo "FAIL"

# Test count
grep -c "it(" packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts
# Expected: 60+

# Property tests
grep -c "fc\.\|property\|fast-check" packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts
# Expected: 7+

# Key behavior coverage
grep -c "search\|filter" packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts
# Expected: 10+
grep -c "sort" packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts
# Expected: 5+
grep -c "delete\|Delete" packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts
# Expected: 10+
grep -c "resume\|Resume" packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts
# Expected: 8+
grep -c "escape\|Escape" packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts
# Expected: 4+

# No mock theater
grep "vi.mock\|jest.mock" packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts && echo "CHECK: review mocks" || echo "OK: no mocks"

# Tests fail against stub
cd packages/cli && npx vitest run src/ui/hooks/__tests__/useSessionBrowser.spec.ts 2>&1 | tail -5
# Expected: FAIL
```

## Success Criteria
- 65+ behavioral tests covering all hook behaviors
- 7+ property-based tests
- No mock theater
- Tests fail against stub

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts
rm -f packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P13.md`
