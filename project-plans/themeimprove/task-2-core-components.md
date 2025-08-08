# Task 2: Core Component Migration

## Context

With semantic infrastructure in place, migrate the most important llxprt UI components to use semantic colors. This task focuses on TodoPanel, Provider/Model dialogs, and Footer components.

## Prerequisites

- Task 1 (Semantic Infrastructure) must be completed and verified
- Semantic color system is working and tested

## Requirements

1. Migrate TodoPanel to semantic colors
2. Update Provider/Model dialogs for semantic theming
3. Convert Footer status indicators
4. Maintain exact visual appearance with current themes
5. Follow all standards in @llxprt-code/docs/RULES.md

## Implementation Steps

### 1. Migrate TodoPanel
Update `packages/cli/src/ui/components/TodoPanel.tsx`:
- Replace `Colors.AccentGreen` → `theme.status.success` (completed)
- Replace `Colors.AccentYellow` → `theme.status.warning` (in progress)  
- Replace `Colors.Gray` → `theme.text.secondary` (pending)
- Replace `Colors.AccentBlue` → `theme.text.accent` (progress indicator)

### 2. Update Provider/Model Dialogs
Update `packages/cli/src/ui/components/ProviderModelDialog.tsx` and `ProviderDialog.tsx`:
- Replace hardcoded `#00ff00` → `theme.text.accent` (selection)
- Replace `Colors.Gray` → `theme.border.default` (borders)
- Replace `Colors.Foreground` → `theme.text.primary`

### 3. Convert Footer Components
Update `packages/cli/src/ui/components/Footer.tsx`:
- Memory indicators use `theme.status.*` based on percentage
- Context indicators use semantic colors
- Branch/model info uses `theme.text.secondary`

### 4. Update Related Components
- `MemoryUsageDisplay.tsx`: Use status colors for thresholds
- `ContextIndicator.tsx`: Use semantic colors for percentages
- Any other components touched by these changes

### 5. Write Migration Tests
Create behavioral tests for each component:
- Test that colors change appropriately with theme switches
- Verify status states show correct colors
- Ensure selection states are visible in all themes

## Self-Verification Checklist

- [ ] TodoPanel shows correct colors for all task states
- [ ] Provider dialogs highlight selections properly
- [ ] Footer adapts colors based on status thresholds
- [ ] All themes display components correctly
- [ ] No hardcoded colors remain in migrated components
- [ ] Visual appearance matches current implementation

## RULES.md Compliance

From @llxprt-code/docs/RULES.md:
- [ ] **Component integrity**: No breaking changes to component APIs
- [ ] **Behavioral tests**: Test color changes, not CSS classes
- [ ] **No regression**: Existing functionality preserved
- [ ] **Clean code**: Remove commented old code
- [ ] **Formatting**: Run `npm run format` before completion
- [ ] **Linting**: Run `npm run lint` and fix all issues

## Testing Approach

```typescript
// Example behavioral test
it('should show success color for completed todos', () => {
  const { getByText } = render(<TodoPanel todos={[completedTodo]} />);
  const todoItem = getByText('Completed task');
  // Test computed styles, not implementation
  expect(getComputedStyle(todoItem).color).toBe(expectedSuccessColor);
});
```

## Expected Outputs

1. All core components using semantic colors
2. Visual appearance unchanged with existing themes
3. Behavioral tests for color changes
4. Clean, reviewable git diff

## Notes for Implementation

- Use theme consumer pattern consistently
- Test with multiple themes to ensure compatibility
- Consider extracting common patterns into utilities
- Document any non-obvious color mappings