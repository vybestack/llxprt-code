# Phase 5 - UI Integration (todo-lists)

## Goal

Add visual representation of todo lists in the CLI interface to enhance user experience.

## Deliverables

- [ ] Visual todo list component for the CLI UI
- [ ] Auto-display of todo list when modified
- [ ] Todo status indicators (icons/colors)
- [ ] Integration with existing UI hooks

## UI Implementation Tasks

### Todo Display Component

- [ ] Create `/packages/cli/src/ui/components/TodoDisplay.tsx`
- [ ] Show todos grouped by status (in_progress first, then pending, then completed)
- [ ] Use appropriate icons: ⏳ (in_progress), ○ (pending), ✓ (completed)
- [ ] Display priority with colors or indicators

### UI Integration

- [ ] Hook into TodoWrite tool responses to trigger display
- [ ] Add todo display to the conversation flow
- [ ] Ensure proper formatting in terminal output
- [ ] Handle empty todo lists gracefully

### User Experience

- [ ] Todo list appears after any TodoWrite operation
- [ ] Compact display that doesn't overwhelm the conversation
- [ ] Clear visual hierarchy showing current focus
- [ ] Support for terminal color themes

## Checklist (implementer)

- [ ] TodoDisplay component renders todo lists correctly
- [ ] Component integrates with existing UI system
- [ ] Todo updates trigger visual refresh
- [ ] Status and priority are visually distinct
- [ ] Terminal output is clean and readable
- [ ] Type checking and linting pass

## Self-verify

```bash
npm run test -- TodoDisplay
npm run typecheck
npm run lint
# Manual test: Run CLI and verify todo list displays properly
```
