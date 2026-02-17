# Phase 16: SessionBrowserDialog — TDD

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P16`

## Prerequisites
- Required: Phase 15a completed
- Verification: `test -f project-plans/issue1385/.completed/P15a.md`
- Expected files: `packages/cli/src/ui/components/SessionBrowserDialog.tsx` (stub from P15)

## Requirements Implemented (Expanded)

### REQ-SB-012 through REQ-SB-025: Visual Rendering
### REQ-RW-001 through REQ-RW-007: Wide Mode Layout
### REQ-RN-001 through REQ-RN-013: Narrow Mode Layout
### REQ-SB-006: Empty State
### REQ-SB-007: No User Message Fallback
### REQ-SB-009: Loading State
### REQ-SB-019: Preview Loading Text
### REQ-SB-020: Error Display
### REQ-SB-021: Controls Bar
### REQ-SB-023: Search Cursor
### REQ-SB-025: Preview Fallback Italic
### REQ-DL-013: Delete Confirmation Inline Box
### REQ-DL-014: Delete Confirmation Options
### REQ-PG-002: Page Indicator (Multi-Page Only)
### REQ-PG-005: PgUp/PgDn Hint
### REQ-RS-003: Resuming Status Display
### REQ-RS-006: Conversation Confirmation Display
### REQ-SO-002: Active Sort Bracketed
### REQ-SO-006: Sort Label Colors
### REQ-SO-007: Sort Cycle Hint
### REQ-SR-005: Match Count Display
### REQ-SR-011: No Sessions Match Query Display
### REQ-SR-012: Tab Hint and Match Count
### REQ-RT-001 through REQ-RT-004: Relative Time Display

## Test Cases

### File to Create
- `packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx`
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P16`

### Test Strategy
Component tests use Ink's testing library (`ink-testing-library` or `@testing-library/react` with Ink renderer). Tests render the component with various states provided through mock props and verify the rendered output contains expected text, elements, and structure.

Since the component delegates ALL state management to `useSessionBrowser`, component tests focus on RENDERING correctness — verifying that the right visual elements appear based on the hook's state. The hook's behavior is already tested in P13.

For testing, we can either:
1. Pass props that trigger specific hook states (simulating loaded sessions, search terms, etc.)
2. Or provide a wrapper that pre-populates the hook state

The component receives callbacks (`onSelect`, `onClose`). Rendering behavior depends on what the hook returns from those callbacks.

### BEHAVIORAL Tests — Layout

1. **Loading state shows spinner**: When isLoading, renders "Loading sessions...".
2. **Empty state shows message**: When no sessions, renders "No sessions found for this project."
3. **Empty state shows supplemental text**: Renders "Sessions are created automatically..."
4. **Empty state shows Esc hint**: Renders "Press Esc to close".
5. **Wide mode has rounded border**: When not narrow, renders with border.
6. **Narrow mode has no border**: When narrow, renders without border.
7. **Title "Session Browser" in wide mode**: Renders "Session Browser" title.
8. **Title "Sessions" in narrow mode**: Renders shorter "Sessions" title.

### BEHAVIORAL Tests — Search Bar

9. **Search bar renders**: Renders "Search:" label.
10. **Search term displayed**: With searchTerm "auth", renders "auth" in search bar.
11. **Match count displayed**: Shows "5 sessions found".
12. **Tab hint in search mode**: Shows "(Tab to navigate)" when isSearching.
13. **Zero results message includes quoted query (REQ-SR-011)**: When search term "xyzzy" yields no results, rendered output contains exact string 'No sessions match "xyzzy"' with the query in double quotes.

### BEHAVIORAL Tests — Sort Bar

14. **Sort bar renders in wide mode**: Shows sort labels.
15. **Active sort bracketed**: Shows "[newest]" when sortOrder is newest.
16. **Sort cycle hint**: Shows "(press s to cycle)" in wide mode.
17. **Sort bar hidden in narrow**: In narrow mode, sort bar not rendered.
18. **Sort hint in narrow controls**: In narrow mode, controls show "s:newest".

### BEHAVIORAL Tests — Session Rows

19. **Session row shows index**: Row shows "#1" for first session.
20. **Session row shows relative time**: Shows "2 hours ago".
21. **Session row shows provider/model**: Shows "gemini / gemini-2.5-pro".
22. **Session row shows file size (wide)**: Shows "1.2KB" in wide mode.
23. **Session row shows preview**: Shows quoted first message text.
24. **Preview loading shows "Loading..."**: When previewState is 'loading'.
25. **Preview none shows "(no user message)"**: When previewState is 'none'.
26. **Preview error shows "(preview unavailable)"**: When previewState is 'error'.
27. **Selected row bullet accent**: Selected row has accent bullet.
28. **Lock indicator shows "(in use)"**: Locked session shows warning text.
29. **Narrow mode hides file size**: In narrow, file size not shown.
30. **Narrow mode hides provider**: In narrow, shows model only.
31. **Narrow mode truncates model to 20 chars**: Long model names truncated with "...".
32. **Narrow mode truncates preview to 30 chars**: Long previews truncated with "...".
33. **Narrow mode shows short session ID on selected**: Selected row shows 8-char ID.
34. **Narrow mode hides index number**: Index (#1, #2) not shown in narrow mode.

### BEHAVIORAL Tests — Pagination

35. **Page indicator multi-page**: Shows "Page 1 of 3" with multiple pages.
36. **Page indicator hidden single page**: No page indicator for single-page lists.
37. **PgUp/PgDn hint shown**: Shows "PgUp/PgDn to page" hint.

### BEHAVIORAL Tests — Detail Line

38. **Detail line in wide mode**: Shows session ID, provider/model, time below list.
39. **Detail line hidden in narrow**: No detail line in narrow mode.

### BEHAVIORAL Tests — Error Display

40. **Error shows inline**: When error is set, renders error text in error color.
41. **Error above controls**: Error appears above the controls bar.

### BEHAVIORAL Tests — Resume Status

42. **Resuming shows status**: When isResuming, renders "Resuming...".

### BEHAVIORAL Tests — Delete Confirmation

43. **Delete confirmation inline box**: When deleteConfirmIndex set, renders bordered confirmation.
44. **Confirmation shows session preview**: Shows the session's first message.
45. **Confirmation shows options**: Shows "[Y] Yes  [N] No  [Esc] Cancel".

### BEHAVIORAL Tests — Conversation Confirmation

46. **Conversation confirmation renders**: When conversationConfirmActive, shows confirmation.
47. **Confirmation text correct**: Shows "Resuming will replace the current conversation. Continue?".
48. **Confirmation options**: Shows "[Y] Yes  [N] No".

### BEHAVIORAL Tests — Controls Bar

49. **Full controls in wide mode**: Shows all keyboard hints.
50. **Abbreviated controls in narrow mode**: Shows compact hints.
51. **Controls reduced when empty**: Only "Esc Close" when list is empty.

### BEHAVIORAL Tests — Skipped Notice

52. **Skipped notice when count > 0**: Shows "Skipped N unreadable session(s)."
53. **No skipped notice when count is 0**: No notice displayed.

### Property-Based Tests

54. **Property: any session list renders without crash**: For random session arrays, component renders.
55. **Property: preview state always maps to text**: Every PreviewState value produces visible text.

### FORBIDDEN Patterns
```typescript
// NO snapshot testing (too brittle for Ink)
expect(output).toMatchSnapshot() // FORBIDDEN

// NO testing internal state
expect(component.state.searchTerm).toBe('abc') // FORBIDDEN

// OK: Testing rendered output text
expect(lastFrame()).toContain('Session Browser')
```

### Behavior-Only Assertion Rule
Tests must assert user-visible rendered output, not implementation structure. Tests for borders, titles, and layout elements (e.g., "wide mode has rounded border") are acceptable ONLY because they map directly to requirement IDs (REQ-RW-001, REQ-SB-012, etc.). Each such test must:
- Verify the user-visible effect (presence of border characters in rendered output)
- NOT assert component tree structure or CSS-like properties directly
- Be tied to a specific requirement ID in the test description or comment

## Verification Commands

```bash
# Test file exists
test -f packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx || echo "FAIL"

# Test count
grep -c "it(" packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx
# Expected: 45+

# Key rendering tests
grep -c "wide\|narrow\|border\|layout" packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx
# Expected: 5+
grep -c "Loading\|empty\|No sessions" packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx
# Expected: 3+
grep -c "delete\|confirmation\|Delete" packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx
# Expected: 3+
grep -c "resume\|Resuming\|conversation" packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx
# Expected: 3+

# Tests fail against stub
cd packages/cli && npx vitest run src/ui/components/__tests__/SessionBrowserDialog.spec.tsx 2>&1 | tail -5
# Expected: FAIL
```

## Success Criteria
- 45+ behavioral tests covering all rendering scenarios
- 2+ property tests
- Tests verify visible output, not internal state
- Tests fail against stub

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx
rm -f packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P16.md`
