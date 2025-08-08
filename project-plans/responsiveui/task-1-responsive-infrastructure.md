# Task 1: Responsive Infrastructure

## Context

Create the foundational responsive design system for llxprt. This includes breakpoint definitions, responsive utilities, and testing helpers that all other responsive work will build upon.

## Requirements

1. Define consistent breakpoint system
2. Create responsive utility functions
3. Build useResponsive hook for components
4. Implement responsive testing utilities
5. Follow all standards in @llxprt-code/docs/RULES.md

## Implementation Steps

### 1. Create Breakpoint Definitions
Create `packages/cli/src/ui/utils/responsive.ts`:
```typescript
export const BREAKPOINTS = {
  NARROW: 80,
  STANDARD: 120,
  WIDE: 160
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

export function getBreakpoint(width: number): Breakpoint {
  if (width < BREAKPOINTS.NARROW) return 'NARROW';
  if (width < BREAKPOINTS.STANDARD) return 'STANDARD';
  return 'WIDE';
}
```

### 2. Create Responsive Utilities
Add to `packages/cli/src/ui/utils/responsive.ts`:
```typescript
export function isNarrowWidth(width: number): boolean {
  return width < BREAKPOINTS.NARROW;
}

export function truncateMiddle(text: string, maxLength: number): string {
  // Implementation for path-like truncation
  // Keep start and end, ellipsis in middle
}

export function truncateEnd(text: string, maxLength: number): string {
  // Standard truncation with ellipsis at end
}
```

### 3. Implement useResponsive Hook
Create `packages/cli/src/ui/hooks/useResponsive.ts`:
```typescript
export function useResponsive() {
  const { columns } = useTerminalSize();
  const breakpoint = getBreakpoint(columns);
  
  return {
    width: columns,
    breakpoint,
    isNarrow: breakpoint === 'NARROW',
    isStandard: breakpoint === 'STANDARD', 
    isWide: breakpoint === 'WIDE'
  };
}
```

### 4. Create Testing Utilities
Create `packages/cli/src/test-utils/responsive-testing.ts`:
```typescript
export function renderAtWidth(
  component: React.ReactElement,
  width: number
) {
  // Mock terminal width and render
}

export function testResponsiveBehavior(
  name: string,
  component: React.ReactElement,
  assertions: {
    narrow?: (result: RenderResult) => void;
    standard?: (result: RenderResult) => void;
    wide?: (result: RenderResult) => void;
  }
) {
  // Helper to test at all breakpoints
}
```

### 5. Write Infrastructure Tests
Create `packages/cli/src/ui/utils/responsive.test.ts`:
- Test breakpoint calculations
- Test truncation utilities
- Test hook behavior at different widths
- Verify testing utilities work correctly

## Self-Verification Checklist

- [ ] Breakpoint system covers all terminal widths
- [ ] Utilities handle edge cases (very narrow, very wide)
- [ ] Hook provides convenient component API
- [ ] Testing utilities enable easy responsive testing
- [ ] All code follows TypeScript best practices
- [ ] No performance issues with resize handling

## RULES.md Compliance

From @llxprt-code/docs/RULES.md:
- [ ] **No `any` types**: All types explicitly defined
- [ ] **Pure functions**: Utilities have no side effects
- [ ] **Testable code**: All functions independently testable
- [ ] **No magic numbers**: Breakpoints defined as constants
- [ ] **Formatting**: Run `npm run format` before completion
- [ ] **Linting**: Run `npm run lint` and fix all issues

## Testing Approach

```typescript
// Example behavioral test
describe('responsive utilities', () => {
  it('should identify narrow width correctly', () => {
    expect(isNarrowWidth(79)).toBe(true);
    expect(isNarrowWidth(80)).toBe(false);
  });

  it('should truncate paths intelligently', () => {
    const path = '/users/john/projects/llxprt/src/index.ts';
    expect(truncateMiddle(path, 30)).toBe('/users/.../llxprt/src/index.ts');
  });
});
```

## Expected Outputs

1. Complete responsive utility module
2. Working useResponsive hook
3. Testing utilities for responsive components
4. Comprehensive test coverage
5. Clean, documented code

## Notes for Implementation

- Consider debouncing resize events in the hook
- Make utilities pure functions for easy testing
- Provide good defaults for truncation
- Think about SSR compatibility (no window object)