# Responsive UI Findings: Terminal Width Adaptation Analysis

## Overview

Upstream commit `4f2974db` introduces systematic responsive design for narrow terminals. This analysis examines how these patterns can enhance llxprt's UI, particularly for our unique components like TodoPanel and provider dialogs.

## Upstream Implementation

### Core Architecture
- **Breakpoint**: 80 columns (consistent across all components)
- **Utility**: `isNarrowWidth()` function for conditional rendering
- **Strategy**: Progressive degradation from wide to narrow layouts

### Component Adaptations

#### Header Component
```typescript
// Three ASCII art sizes based on width
width >= 130: Full "gemini" ASCII art
width >= 80:  Shortened ASCII art
width < 80:   Tiny "G" logo only
```

#### Footer Component
- **Wide**: Horizontal layout with full paths
- **Narrow**: Vertical stacking, truncated paths
- **Path truncation**: Middle ellipsis (...) for long paths

#### Context Display
- **Wide**: Inline comma-separated lists
- **Narrow**: Vertical bullet lists
- **Truncation**: Smart ellipsis for long items

#### Tool Messages
- **Wide**: Full parameter display
- **Narrow**: Wrapped parameters, reduced padding

### Testing Strategy
- Explicit width testing (30, 50, 80, 100, 120 columns)
- Snapshot testing for layout verification
- Mock terminal dimensions

## Current llxprt Implementation

### Existing Responsive Features

#### LayoutManager
```typescript
const { rows: terminalHeight, columns: terminalWidth } = useTerminalSize();
// 8-column padding calculation
// Height constraints for scrolling
```

#### ProviderModelDialog
```typescript
// Dynamic column calculation
const maxColumns = Math.max(1, Math.floor((terminalWidth - 4) / minItemWidth));
// Responsive grid layout
```

#### Current Breakpoints (Inconsistent)
- TodoPanel: No responsive behavior
- Dialogs: Dynamic but no fixed breakpoints
- Footer: Some width checks but not systematic

### Unique llxprt Components Needing Responsive Design

#### TodoPanel
- **Current**: Fixed width layout
- **Needs**: 
  - Narrow mode: Vertical task list
  - Wide mode: Side-by-side with progress
  - Task text truncation

#### ProviderModelDialog
- **Current**: Basic grid responsiveness
- **Needs**:
  - Narrow mode: Single column
  - Medium mode: 2-3 columns
  - Wide mode: 4+ columns

#### Enhanced Footer
- **Current**: Complex multi-line display
- **Needs**:
  - Progressive information hiding
  - Priority-based element display

#### Memory/Context Indicators
- **Current**: Always full display
- **Needs**:
  - Compact number formats
  - Icon-only modes

## Gap Analysis

### What We're Missing
1. **Consistent Breakpoints**: No standardized width thresholds
2. **Progressive Enhancement**: Limited degradation strategies
3. **Testing Infrastructure**: No responsive testing patterns
4. **Utilities**: No shared responsive helpers

### What We Have That Upstream Doesn't
1. **Complex Layouts**: TodoPanel with multiple information layers
2. **Dynamic Content**: Provider/model lists with varying items
3. **Rich Indicators**: Memory, context, progress displays
4. **Interactive Dialogs**: Selection states and navigation

## Enhancement Opportunities

### 1. Multi-Tier Breakpoint System
```typescript
export const BREAKPOINTS = {
  TINY: 50,      // Minimal UI
  NARROW: 80,    // Upstream standard
  MEDIUM: 120,   // Comfortable
  WIDE: 160,     // Full features
  ULTRA: 200     // Enhanced features
} as const;
```

### 2. Component-Specific Strategies

#### TodoPanel Responsive Modes
```typescript
// TINY (< 50): Hidden or summary only
// NARROW (50-80): Vertical list, abbreviated text
// MEDIUM (80-120): Two columns
// WIDE (120+): Full layout with progress bars
```

#### Provider Dialog Responsive Grid
```typescript
// Calculate based on item width and padding
const columns = calculateResponsiveColumns(width, {
  minItemWidth: 20,
  padding: 4,
  minColumns: 1,
  maxColumns: 6
});
```

### 3. Smart Content Adaptation

#### Text Truncation Strategies
- **Path**: Middle ellipsis (maintain file extension)
- **Task**: End ellipsis (preserve beginning)
- **Model names**: Smart abbreviation (gpt-4-turbo → gpt-4-t...)

#### Progressive Information Display
```typescript
// Priority levels for footer information
Priority.CRITICAL: Always show (errors, warnings)
Priority.HIGH: Show in NARROW+
Priority.MEDIUM: Show in MEDIUM+
Priority.LOW: Show in WIDE+
```

### 4. Advanced Responsive Features

#### Dynamic ASCII Art
- Multiple llxprt logo variants
- Animated transitions between sizes
- Custom art for ultra-wide displays

#### Responsive Tables
- Column hiding based on priority
- Horizontal scrolling for narrow views
- Condensed formatting options

## Testing Strategy

### 1. Responsive Test Utilities
```typescript
describe.each([30, 50, 80, 120, 160, 200])('at %d columns', (width) => {
  beforeEach(() => mockTerminalWidth(width));
  // Component-specific tests
});
```

### 2. Visual Regression Testing
- Snapshot tests for each breakpoint
- Layout verification utilities
- Responsive behavior assertions

### 3. Real-World Scenarios
- SSH sessions (typically 80 columns)
- Split terminals (various widths)
- Mobile terminals (very narrow)
- Ultra-wide monitors (200+ columns)

## Implementation Approach

### Phase 1: Infrastructure
1. Create responsive utilities module
2. Define breakpoint constants
3. Add responsive testing helpers

### Phase 2: Core Components
1. Update Footer with systematic breakpoints
2. Add responsive TodoPanel layouts
3. Enhance dialog responsive behavior

### Phase 3: Advanced Features
1. Implement progressive information display
2. Add smart truncation strategies
3. Create responsive ASCII art system

### Phase 4: Polish
1. Animation transitions
2. User preferences (disable responsive)
3. Documentation and examples

## Benefits

1. **Usability**: Better experience across all terminal sizes
2. **Accessibility**: Works in constrained environments
3. **Flexibility**: Adapts to user preferences
4. **Professional**: Polished behavior at any size

## Risks and Mitigations

### Risk 1: Complexity
- **Mitigation**: Start with simple breakpoints, iterate

### Risk 2: Performance
- **Mitigation**: Memoize calculations, debounce resizing

### Risk 3: Testing Burden
- **Mitigation**: Automated responsive test utilities

## Recommendations

1. **Adopt Multi-Tier System**: Go beyond upstream's single breakpoint
2. **Test-First Development**: Build responsive tests before implementation
3. **Progressive Enhancement**: Start with mobile-first approach
4. **Component Library**: Create responsive component primitives
5. **User Control**: Allow responsive behavior customization

## Conclusion

While upstream provides a solid foundation with their 80-column breakpoint system, llxprt's richer UI demands a more sophisticated multi-tier responsive approach. By building on their patterns while adding advanced features for our unique components, we can create a best-in-class terminal UI that works beautifully at any size.