# Phase 15: SessionBrowserDialog — Stub

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P15`

## Prerequisites
- Required: Phase 14a completed
- Verification: `test -f project-plans/issue1385/.completed/P14a.md`
- Expected files:
  - `packages/cli/src/ui/hooks/useSessionBrowser.ts` (real from P14)
  - `packages/cli/src/utils/formatRelativeTime.ts` (real from P05)

## Requirements Implemented (Expanded)

### REQ-SB-012: Rounded Border (Wide)
**Full Text**: The system shall render the session browser within a rounded-border box in wide mode.
**Behavior**:
- GIVEN: Terminal is wide (not narrow)
- WHEN: Browser renders
- THEN: Content is wrapped in `<Box borderStyle="round">`

### REQ-SB-013: Selected/Unselected Bullets
**Full Text**: The system shall use `bullet` in accent color for selected, `bullet` in primary for unselected.

### REQ-SB-024: Title Bold Primary
**Full Text**: The system shall render the title text in bold with primary color.

### REQ-RW-001 through REQ-RW-007: Wide Mode Layout
**Full Text**: Full layout with all elements: border, title, search bar, sort bar, session list (two-line rows), page indicator, error display, detail line, controls bar.

### REQ-RN-001 through REQ-RN-013: Narrow Mode Layout
**Full Text**: Compact layout: no border, no sort bar, abbreviated controls, truncated names, no detail line.

### REQ-SB-006: Empty State
**Full Text**: Display "No sessions found" with supplemental text and Esc hint.

### REQ-SB-007: No User Message Fallback
**Full Text**: Display "(no user message)" for sessions without user messages.

### REQ-SB-019: Preview Loading Text
**Full Text**: Display "Loading..." for sessions with previewState 'loading'.

### REQ-SB-020: Error Display
**Full Text**: Display error text inline in error color above controls bar.

### REQ-SB-021: Controls Bar
**Full Text**: Keyboard shortcut legend in secondary color at bottom.

### REQ-SB-023: Search Cursor
**Full Text**: Search input cursor as `cursor-char` in accent color.

### REQ-DL-013: Delete Confirmation Inline
**Full Text**: Delete confirmation rendered as inline nested box.

### REQ-DL-014: Delete Confirmation Options
**Full Text**: Delete confirmation shows "[Y] Yes  [N] No  [Esc] Cancel".

### REQ-RS-003: Resuming Status
**Full Text**: Display "Resuming..." while resume is in progress.

### REQ-RS-006: Active Conversation Confirmation
**Full Text**: Inline confirmation: "Resuming will replace the current conversation. Continue?" with [Y]/[N].

## Implementation Tasks

### Files to Create

- `packages/cli/src/ui/components/SessionBrowserDialog.tsx`
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P15`
  - MUST include: `@requirement:REQ-SB-012, REQ-RW-001, REQ-RN-001`
  - MUST include: `@pseudocode session-browser-dialog.md`
  - Export `SessionBrowserDialogProps` interface
  - Export `SessionBrowserDialog` component
  - Stub: render `<Text>Session Browser (stub)</Text>`

### Type Definitions

```typescript
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P15
 * @requirement REQ-SB-012
 */
interface SessionBrowserDialogProps {
  chatsDir: string;
  projectHash: string;
  currentSessionId: string;
  hasActiveConversation: boolean;
  onSelect: (session: SessionSummary) => Promise<PerformResumeResult>;
  onClose: () => void;
}
```

### Component Structure (Stub)
```tsx
export function SessionBrowserDialog(props: SessionBrowserDialogProps): React.ReactElement {
  // Stub - renders minimal placeholder
  return <Text>Session Browser (stub)</Text>;
}
```

## Verification Commands

```bash
# File exists
test -f packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"

# Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P15" packages/cli/src/ui/components/SessionBrowserDialog.tsx
# Expected: 2+

# Props interface exported
grep "export.*SessionBrowserDialogProps\|export.*interface.*SessionBrowserDialogProps" packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"

# Component exported
grep "export.*SessionBrowserDialog" packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"

# TypeScript compiles
cd packages/cli && npx tsc --noEmit
```

## Success Criteria
- Component file exists with correct props interface
- Component renders without error
- TypeScript compiles

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/components/SessionBrowserDialog.tsx
rm -f packages/cli/src/ui/components/SessionBrowserDialog.tsx
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P15.md`
