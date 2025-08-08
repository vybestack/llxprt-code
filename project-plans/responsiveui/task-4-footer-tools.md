# Task 4: Footer and Tool Confirmations Responsive Implementation

## Context

Implement responsive behavior for the Footer component (progressive detail display) and Tool Confirmations (summary with details on demand). These components need different strategies than the grid-based components.

## Prerequisites

- Tasks 1-3 completed successfully
- Responsive infrastructure in place
- Understanding of current Footer complexity

## Requirements

1. Footer shows progressive detail based on width
2. Tool confirmations implement "press 'd' for details"
3. ASCII art replaced with text at narrow widths
4. Information priority preserved
5. Follow all standards in @llxprt-code/docs/RULES.md

## Implementation Steps

### 1. Update Footer Component
Modify `packages/cli/src/ui/components/Footer.tsx`:

```typescript
import { useResponsive } from '../hooks/useResponsive.js';

export const Footer: React.FC<FooterProps> = (props) => {
  const { breakpoint } = useResponsive();
  
  // Define what to show at each breakpoint
  const showTimestamp = breakpoint === 'WIDE';
  const showFullPaths = breakpoint !== 'NARROW';
  const showModelName = breakpoint !== 'NARROW';
  
  return (
    <Box>
      {/* Always show memory and context */}
      <MemoryIndicator compact={breakpoint === 'NARROW'} />
      <ContextIndicator compact={breakpoint === 'NARROW'} />
      
      {/* Conditionally show other elements */}
      {showModelName && <ModelIndicator />}
      {props.branch && <BranchIndicator truncate={!showFullPaths} />}
      {showTimestamp && <TimeDisplay />}
    </Box>
  );
};
```

### 2. Footer Display Examples

**NARROW (<80 cols)**:
```
Mem: 45% | Ctx: 8.2k/100k | main
```

**STANDARD (80-120 cols)**:
```
Memory: 45% | Context: 8.2k/100k | Model: gpt-4 | main
```

**WIDE (120+ cols)**:
```
Memory: 45% (2.1GB/4.8GB) | Context: 8,234/100,000 tokens | Model: gpt-4 | Branch: main | 14:32:15
```

### 3. Update Tool Confirmation Messages
Modify `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx`:

```typescript
export const ToolConfirmationMessage: React.FC<Props> = ({ tool, params }) => {
  const [showDetails, setShowDetails] = useState(false);
  
  // Create summary of essential info
  const summary = createToolSummary(tool, params);
  
  return (
    <Box flexDirection="column">
      <Text>Tool: {tool.name}</Text>
      <Text>{summary}</Text>
      
      {!showDetails && (
        <Text dimColor>Press 'd' to see full details</Text>
      )}
      
      {showDetails && (
        <Box marginTop={1}>
          <Text>Full Parameters:</Text>
          {/* Render all parameters */}
        </Box>
      )}
    </Box>
  );
};
```

### 4. Replace ASCII Art
Update `packages/cli/src/ui/components/Header.tsx`:

```typescript
const { breakpoint } = useResponsive();

if (breakpoint === 'NARROW') {
  return <Text bold>LLxprt</Text>;
}

// Show ASCII art for standard/wide
```

### 5. Write Responsive Tests
Create tests for both components:
- Footer shows/hides elements appropriately
- Tool confirmations toggle details correctly
- ASCII art falls back to text
- All information accessible at every width

## Self-Verification Checklist

- [ ] Footer displays appropriate info at each width
- [ ] Tool details accessible but not overwhelming
- [ ] ASCII art gracefully degrades to text
- [ ] No information is permanently hidden
- [ ] Keyboard shortcuts ('d') work correctly
- [ ] Clean visual hierarchy maintained

## RULES.md Compliance

From @llxprt-code/docs/RULES.md:
- [ ] **User experience**: Information is accessible
- [ ] **No overengineering**: Simple, clear solutions
- [ ] **Behavioral tests**: Test what users see/interact with
- [ ] **Performance**: No excessive re-renders
- [ ] **Code clarity**: Self-documenting code
- [ ] **Linting/Formatting**: All checks pass

## Testing Approach

```typescript
describe('Footer responsive behavior', () => {
  testResponsiveBehavior('Footer', <Footer {...mockProps} />, {
    narrow: (result) => {
      expect(result.getByText(/Mem: \d+%/)).toBeInTheDocument();
      expect(result.queryByText(/Model:/)).not.toBeInTheDocument();
      expect(result.queryByText(/\d{2}:\d{2}/)).not.toBeInTheDocument();
    },
    standard: (result) => {
      expect(result.getByText(/Memory: \d+%/)).toBeInTheDocument();
      expect(result.getByText(/Model: gpt-4/)).toBeInTheDocument();
      expect(result.queryByText(/\d{2}:\d{2}/)).not.toBeInTheDocument();
    },
    wide: (result) => {
      expect(result.getByText(/Memory: \d+% \(\d+\.\d+GB/)).toBeInTheDocument();
      expect(result.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument();
    }
  });
});

describe('ToolConfirmationMessage details toggle', () => {
  it('should show summary with details option', () => {
    const { getByText, queryByText } = render(<ToolConfirmationMessage {...props} />);
    expect(getByText("Press 'd' to see full details")).toBeInTheDocument();
    expect(queryByText('Full Parameters:')).not.toBeInTheDocument();
  });
  
  it('should show details when d is pressed', async () => {
    const { getByText, user } = render(<ToolConfirmationMessage {...props} />);
    await user.keyboard('d');
    expect(getByText('Full Parameters:')).toBeInTheDocument();
  });
});
```

## Expected Outputs

1. Footer with three levels of detail
2. Tool confirmations with toggle-able details
3. Clean text fallback for ASCII art
4. Smooth transitions between breakpoints
5. Complete test coverage

## Notes for Implementation

- Preserve current information hierarchy
- Use consistent abbreviations (Mem/Memory, Ctx/Context)
- Consider caching detail state for tool confirmations
- Test with very long branch names and paths
- Ensure color coding is preserved at all widths