# Responsive UI Implementation Plan

## Overview

This plan implements a practical responsive design system for llxprt, focusing on three breakpoints and smart component adaptation. The implementation follows test-first development with behavioral testing.

## Guiding Principles

1. **Three-Tier System**: NARROW (<80), STANDARD (80-120), WIDE (120+)
2. **Progressive Enhancement**: Start mobile-first, enhance with space
3. **Content Priority**: Never hide critical information
4. **Behavioral Testing**: Test actual layout behavior, not CSS
5. **RULES.md Compliance**: Follow all coding standards

## Architecture

### Breakpoint System
```typescript
export const BREAKPOINTS = {
  NARROW: 80,    // Vertical layouts, search-first
  STANDARD: 120, // Comfortable defaults  
  WIDE: 160      // Full features
} as const;
```

### Component Strategies

#### TodoPanel
- **NARROW**: Task list with status icons only
- **STANDARD**: Add progress indicators
- **WIDE**: Full layout with detailed progress

#### Provider/Model Dialogs  
- **NARROW**: Single column with search
- **STANDARD**: 2-3 column grid
- **WIDE**: 4+ column grid

#### Footer
- **NARROW**: Essential info only (memory, context)
- **STANDARD**: Add model and branch
- **WIDE**: Full details with timestamps

#### Tool Confirmations
- **ALL WIDTHS**: Show summary + "Press 'd' for details"

## Implementation Phases

### Phase 1: Responsive Infrastructure
- Create breakpoint utilities
- Add responsive testing helpers
- Implement useResponsive hook

### Phase 2: Core Components
- TodoPanel responsive layouts
- Dialog responsive grids
- Footer progressive display

### Phase 3: Enhanced Features
- Tool confirmation details system
- Smart truncation utilities
- ASCII art text fallback

### Phase 4: Polish & Testing
- Comprehensive responsive tests
- Performance optimization
- Documentation

## Task Structure

Each task is self-contained with:
1. Clear context and goals
2. Specific implementation steps
3. Self-verification criteria
4. Testing requirements
5. RULES.md compliance

## Verification Strategy

- **Implementation Agent**: Builds the feature
- **Verification Agent**: Validates against requirements  
- **Test-First**: Write tests before implementation
- **Real Behavior**: Test actual rendering at different widths

## Success Criteria

1. All components adapt smoothly between breakpoints
2. No information is unnecessarily hidden
3. Search functionality enhanced at narrow widths
4. Performance remains excellent
5. Full test coverage for responsive behavior