# Task 2: TodoPanel Responsive Implementation

## Context

Make the TodoPanel component responsive using the infrastructure from Task 1. The panel should gracefully adapt from detailed view to compact task list based on terminal width.

## Prerequisites

- Task 1 (Responsive Infrastructure) must be completed
- Responsive utilities and hooks are available

## Requirements  

1. Implement three responsive layouts for TodoPanel
2. Maintain task visibility at all widths
3. Show appropriate detail level for each breakpoint
4. Add behavioral tests for all layouts
5. Follow all standards in @llxprt-code/docs/RULES.md

## Implementation Steps

### 1. Update TodoPanel Component
Modify `packages/cli/src/ui/components/TodoPanel.tsx`:

```typescript
import { useResponsive } from '../hooks/useResponsive.js';

export const TodoPanel: React.FC<TodoPanelProps> = ({ todos }) => {
  const { breakpoint } = useResponsive();
  
  if (breakpoint === 'NARROW') {
    return <TodoPanelNarrow todos={todos} />;
  }
  
  if (breakpoint === 'STANDARD') {
    return <TodoPanelStandard todos={todos} />;
  }
  
  return <TodoPanelWide todos={todos} />;
};
```

### 2. Implement Narrow Layout
Compact view showing just status and truncated task names:
```
Todo (2/5):
✓ Build project
⟳ Run tests...
○ Deploy app...
```

### 3. Implement Standard Layout  
Add progress indicators but keep vertical layout:
```
Todo Progress: 2 of 5 (40%)
✓ Build project
⟳ Run tests [50%]
○ Deploy application
○ Update documentation
○ Create release
```

### 4. Implement Wide Layout
Full existing layout with progress bars and details:
- Progress visualization
- Full task descriptions
- Tool parameters shown
- Timing information

### 5. Write Responsive Tests
Create `packages/cli/src/ui/components/TodoPanel.responsive.test.tsx`:
- Test narrow layout shows only essential info
- Test standard layout includes progress
- Test wide layout shows full details
- Test transitions between breakpoints

## Self-Verification Checklist

- [ ] TodoPanel renders correctly at all widths
- [ ] No information is lost, only reformatted
- [ ] Task status always visible
- [ ] Progress indication scales appropriately
- [ ] Truncation works for long task names
- [ ] Performance is good during resize

## RULES.md Compliance

From @llxprt-code/docs/RULES.md:
- [ ] **Component modularity**: Separate layout components
- [ ] **No hardcoded widths**: Use breakpoint system
- [ ] **Behavioral tests**: Test what users see
- [ ] **Clean code**: No commented alternatives
- [ ] **Formatting**: Run `npm run format` before completion
- [ ] **Type safety**: No `any` types

## Testing Approach

```typescript
describe('TodoPanel responsive behavior', () => {
  const todos = [
    { id: '1', content: 'Build project', status: 'completed' },
    { id: '2', content: 'Run tests', status: 'in_progress' },
    { id: '3', content: 'Deploy', status: 'pending' }
  ];

  testResponsiveBehavior('TodoPanel', <TodoPanel todos={todos} />, {
    narrow: (result) => {
      expect(result.getByText('Todo (1/3):')).toBeInTheDocument();
      expect(result.getByText('✓ Build project')).toBeInTheDocument();
      expect(result.queryByText('[50%]')).not.toBeInTheDocument();
    },
    standard: (result) => {
      expect(result.getByText('Todo Progress: 1 of 3')).toBeInTheDocument();
      expect(result.getByText('⟳ Run tests [50%]')).toBeInTheDocument();
    },
    wide: (result) => {
      expect(result.getByTestId('progress-bar')).toBeInTheDocument();
      // Full layout tests
    }
  });
});
```

## Expected Outputs

1. TodoPanel with three distinct responsive layouts
2. Smooth transitions between breakpoints
3. Behavioral tests for all layouts
4. No regressions in functionality
5. Clean, maintainable code structure

## Notes for Implementation

- Consider extracting layout components for clarity
- Use consistent status icons across all layouts
- Preserve color coding at all widths
- Think about animation/transition possibilities
- Test with real todo data of various lengths