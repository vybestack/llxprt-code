# Phase 17: SessionBrowserDialog — Implementation

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P17`

## Prerequisites
- Required: Phase 16a completed
- Verification: `test -f project-plans/issue1385/.completed/P16a.md`
- Expected files:
  - `packages/cli/src/ui/components/SessionBrowserDialog.tsx` (stub from P15)
  - `packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx` (tests from P16)
  - `packages/cli/src/ui/hooks/useSessionBrowser.ts` (impl from P14)
  - `packages/cli/src/utils/formatRelativeTime.ts` (impl from P05)

## Requirements Implemented

This phase implements ALL visual rendering requirements. The component is a pure renderer — all state management is delegated to `useSessionBrowser` (already implemented in P14).

### REQ-SB-012: Rounded border in wide mode
### REQ-SB-013: Selected/unselected bullets
### REQ-SB-014: Index numbers (wide)
### REQ-SB-026: Hide index (narrow)
### REQ-SB-015: Relative time
### REQ-SB-016: Provider/model secondary
### REQ-SB-017: File size right-aligned (wide)
### REQ-SB-018: Preview text quoted truncated
### REQ-SB-019: Preview loading text
### REQ-SB-020: Error display inline
### REQ-SB-021: Controls bar
### REQ-SB-023: Search cursor accent
### REQ-SB-024: Title bold primary
### REQ-SB-025: Preview fallback italic
### REQ-SB-006: Empty state
### REQ-SB-007: No user message fallback
### REQ-SB-009: Loading state
### REQ-SB-010: Lock indicator "(in use)"
### REQ-RW-001 through REQ-RW-007: Wide mode layout
### REQ-RN-001 through REQ-RN-013: Narrow mode layout
### REQ-SO-002: Active sort bracketed
### REQ-SO-006: Sort label colors
### REQ-SO-007: Sort cycle hint
### REQ-SR-005: Match count
### REQ-SR-012: Tab hint
### REQ-PG-002: Page indicator (multi-page only)
### REQ-PG-005: PgUp/PgDn hint
### REQ-SD-001: Detail line (wide)
### REQ-DL-013: Delete confirmation inline box
### REQ-DL-014: Delete confirmation options
### REQ-RS-003: Resuming status
### REQ-RS-006: Conversation confirmation inline
### REQ-RT-001 through REQ-RT-004: Relative time in rows

## Implementation Tasks

### Component Architecture (from pseudocode session-browser-dialog.md)

The component composes several sub-sections rendered conditionally:

```
SessionBrowserDialog
  ├── LoadingView (when isLoading)
  ├── EmptyView (when !isLoading && filteredSessions.length === 0 && !searchTerm)
  ├── NoResultsView (when !isLoading && filteredSessions.length === 0 && searchTerm)
  └── BrowserView (normal rendering)
       ├── TitleBar
       ├── SearchBar (cursor, term, match count, mode hint)
       ├── SortBar (wide only) — [active] inactive inactive + hint
       ├── SkippedNotice (if skippedCount > 0)
       ├── SessionList (paginated slice)
       │    └── SessionRow × N (or SessionRowNarrow × N)
       │         └── DeleteConfirmation (inline, if deleteConfirmIndex matches)
       ├── ConversationConfirmation (if showConversationConfirm)
       ├── PageIndicator (if totalPages > 1)
       ├── ErrorDisplay (if error)
       ├── ResumeStatus (if isResuming)
       ├── DetailLine (wide only, if selectedSession exists)
       └── ControlsBar
```

### Files to Modify

- `packages/cli/src/ui/components/SessionBrowserDialog.tsx`
  - Replace stub with full implementation
  - ADD: `@plan PLAN-20260214-SESSIONBROWSER.P17`
  - Implements: ALL REQ-SB, REQ-RW, REQ-RN rendering requirements

### Key Implementation Details

#### 1. Hook Integration (pseudocode session-browser-dialog.md lines 10-30)
```tsx
const browserState = useSessionBrowser({
  chatsDir: props.chatsDir,
  projectHash: props.projectHash,
  currentSessionId: props.currentSessionId,
  hasActiveConversation: props.hasActiveConversation,
  onSelect: props.onSelect,
  onClose: props.onClose,
});
```

#### 2. Responsive Layout (pseudocode session-browser-dialog.md lines 35-50)
```tsx
const { isNarrow } = useResponsive();
// Wide: <Box borderStyle="round"> with all elements
// Narrow: <Box> (no border) with compact elements
```

#### 3. Session Row (Wide) — (pseudocode lines 60-90)
Two lines per row:
- Line 1: bullet + index + relative time + provider/model + file size (right)
- Line 2: preview text (quoted, truncated to 80 chars)
- Lock indicator: "(in use)" in warning color inline after file size

#### 4. Session Row (Narrow) — (pseudocode lines 95-120)
Two lines per row:
- Line 1: bullet + abbreviated relative time + model (truncated 20) + [8-char ID on selected row]
- Line 2: preview text (truncated to 30 chars)
- No index, no provider, no file size

#### 5. Search Bar (pseudocode lines 130-145)
```tsx
<Box>
  <Text>Search: </Text>
  <Text>{searchTerm}</Text>
  <Text color={accent}>▌</Text>
  {isSearching && <Text dimColor> (Tab to navigate)</Text>}
  <Text dimColor>  {matchCount} session{matchCount !== 1 ? 's' : ''} found</Text>
</Box>
```

#### 6. Sort Bar — Wide Only (pseudocode lines 150-165)
```tsx
{!isNarrow && (
  <Box>
    <Text>Sort: </Text>
    {SORT_OPTIONS.map(opt => (
      <Text key={opt} color={opt === sortOrder ? accent : secondary}>
        {opt === sortOrder ? `[${opt}]` : opt}
      </Text>
    ))}
    <Text dimColor>  (press s to cycle)</Text>
  </Box>
)}
```

#### 7. Delete Confirmation — Inline Box (pseudocode lines 170-190)
Rendered within the session list, adjacent to the selected row:
```tsx
<Box borderStyle="single" paddingX={1}>
  <Text>Delete "{previewText}" ({relativeTime})? </Text>
  <Text>[Y] Yes  [N] No  [Esc] Cancel</Text>
</Box>
```

#### 8. Conversation Confirmation — Inline Box (pseudocode lines 195-210)
```tsx
<Box borderStyle="round" paddingX={1}>
  <Text>Resuming will replace the current conversation. Continue?</Text>
  <Text>[Y] Yes  [N] No</Text>
</Box>
```

#### 9. Controls Bar (pseudocode lines 215-240)
Wide:  `↑↓ Navigate  Enter Resume  Del Delete  s Sort  Tab Search/Nav  Esc Close`
Narrow: `↑↓ Nav  Enter Resume  Del Delete  s:{sortOrder}  Esc Close`
Empty: `Esc Close`

#### 10. Color Tokens — Uses SemanticColors from '../colors.js'
- Title: `SemanticColors.text.primary` + bold
- Search cursor: `SemanticColors.text.accent`
- Selected bullet: `SemanticColors.text.accent`
- Unselected bullet: `SemanticColors.text.primary`
- Index: `SemanticColors.text.secondary`
- Provider/model: `SemanticColors.text.secondary`
- File size: `SemanticColors.text.secondary`
- Preview: `SemanticColors.text.secondary`
- Lock indicator: `SemanticColors.status.warning`
- Error: `SemanticColors.status.error`
- Controls: `SemanticColors.text.secondary`
- Active sort: `SemanticColors.text.accent`
- Inactive sort: `SemanticColors.text.secondary`

### Do NOT Modify
- `packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx` — tests must pass unmodified
- `packages/cli/src/ui/hooks/useSessionBrowser.ts` — already complete

## Verification Commands

```bash
# All tests pass
cd packages/cli && npx vitest run src/ui/components/__tests__/SessionBrowserDialog.spec.tsx
# Expected: ALL PASS

# Tests pass WITHOUT modification
git diff --name-only packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx
# Expected: no output (file unchanged from P16)

# Deferred implementation detection
grep -n "TODO\|FIXME\|HACK\|STUB\|XXX" packages/cli/src/ui/components/SessionBrowserDialog.tsx && echo "FAIL" || echo "OK"

# Uses SemanticColors
grep "SemanticColors" packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"

# Uses useResponsive
grep "useResponsive" packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"

# Uses useSessionBrowser
grep "useSessionBrowser" packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"

# Uses formatRelativeTime
grep "formatRelativeTime" packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"
```

## Success Criteria
- All P16 tests pass without modification
- Component renders correctly in wide and narrow modes
- All visual elements match mockup/spec
- SemanticColors used for all color tokens
- TypeScript compiles

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/components/SessionBrowserDialog.tsx
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P17.md`
