# Task 3: Provider/Model Dialogs Responsive Implementation

## Context

Make the Provider and Model selection dialogs responsive, with special focus on search functionality becoming primary UI at narrow widths. These dialogs should gracefully transition from grid to list layouts.

## Prerequisites

- Task 1 (Responsive Infrastructure) completed
- Responsive utilities available
- Existing search functionality in model dialog

## Requirements

1. Implement responsive grid/list layouts
2. Make search primary at narrow widths
3. Maintain selection functionality at all sizes
4. Preserve keyboard navigation
5. Follow all standards in @llxprt-code/docs/RULES.md

## Implementation Steps

### 1. Update ProviderModelDialog
Modify `packages/cli/src/ui/components/ProviderModelDialog.tsx`:

```typescript
import { useResponsive } from '../hooks/useResponsive.js';

export const ProviderModelDialog: React.FC<Props> = ({ models, onSelect }) => {
  const { breakpoint } = useResponsive();
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filter models based on search
  const filteredModels = filterModels(models, searchTerm);
  
  if (breakpoint === 'NARROW') {
    return (
      <Box flexDirection="column">
        <SearchInput 
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search models..."
        />
        <ModelList 
          models={filteredModels}
          onSelect={onSelect}
          layout="vertical"
        />
      </Box>
    );
  }
  
  // Standard and wide use grid with dynamic columns
  const columns = breakpoint === 'STANDARD' ? 2 : 4;
  
  return (
    <Box flexDirection="column">
      {filteredModels.length > 10 && (
        <SearchInput 
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search models..."
        />
      )}
      <ModelGrid
        models={filteredModels}
        onSelect={onSelect}
        columns={columns}
      />
    </Box>
  );
};
```

### 2. Implement List Layout (Narrow)
Single column with clear selection indicators:
```
Search models... [input]

> gpt-4-turbo ←
  claude-3-opus
  gemini-1.5-pro
  [...]
```

### 3. Implement Grid Layouts (Standard/Wide)
- **Standard**: 2-3 columns with comfortable spacing
- **Wide**: 4+ columns utilizing full width
- Show search only when list is long (>10 items)

### 4. Update ProviderDialog
Apply same responsive patterns:
- Narrow: List with provider descriptions
- Standard/Wide: Grid of provider cards
- Consistent selection behavior

### 5. Write Responsive Tests
Create `packages/cli/src/ui/components/ProviderModelDialog.responsive.test.tsx`:
- Test search appears appropriately
- Test grid columns adjust correctly
- Test selection works at all widths
- Test keyboard navigation preserved

## Self-Verification Checklist

- [ ] Dialogs usable at all terminal widths
- [ ] Search prominent when needed
- [ ] Selection state clearly visible
- [ ] Keyboard navigation works correctly
- [ ] No horizontal scrolling needed
- [ ] Performance good with many items

## RULES.md Compliance

From @llxprt-code/docs/RULES.md:
- [ ] **Accessibility**: Keyboard navigation maintained
- [ ] **No magic numbers**: Use breakpoint constants
- [ ] **Behavioral tests**: Test user interactions
- [ ] **Type safety**: Proper TypeScript types
- [ ] **Clean commits**: Focused changes only
- [ ] **Formatting**: Run `npm run format`

## Testing Approach

```typescript
describe('ProviderModelDialog responsive behavior', () => {
  const models = generateMockModels(20); // Many models to test search
  
  testResponsiveBehavior(
    'ProviderModelDialog',
    <ProviderModelDialog models={models} onSelect={jest.fn()} />,
    {
      narrow: (result) => {
        // Search should be visible immediately
        expect(result.getByPlaceholder('Search models...')).toBeInTheDocument();
        // List layout
        expect(result.container.querySelector('[role="list"]')).toBeInTheDocument();
      },
      standard: (result) => {
        // Search visible due to many models
        expect(result.getByPlaceholder('Search models...')).toBeInTheDocument();
        // Grid with 2-3 columns
        const grid = result.container.querySelector('[role="grid"]');
        expect(grid).toHaveStyle({ gridTemplateColumns: expect.stringMatching(/repeat\([2-3]/) });
      },
      wide: (result) => {
        // Grid with 4+ columns
        const grid = result.container.querySelector('[role="grid"]');
        expect(grid).toHaveStyle({ gridTemplateColumns: expect.stringMatching(/repeat\([4-9]/) });
      }
    }
  );
});
```

## Expected Outputs

1. Fully responsive dialog components
2. Search-first experience at narrow widths
3. Dynamic grid layouts for wider screens
4. Preserved functionality at all sizes
5. Comprehensive responsive tests

## Notes for Implementation

- Keep selection indicators consistent across layouts
- Consider focus management when switching layouts
- Test with various numbers of items
- Ensure descriptions don't break layouts
- Consider loading states at different widths