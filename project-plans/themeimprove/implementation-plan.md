# Theme Improvement Implementation Plan

## Overview

This plan implements semantic color tokens for llxprt while avoiding VSCode's over-granular pitfall. The implementation follows a test-first approach with behavioral testing and autonomous task execution.

## Guiding Principles

1. **Simplicity First**: Basic themes need only ~10 color definitions
2. **Progressive Enhancement**: Advanced themes can override specific tokens
3. **Backward Compatibility**: Existing Colors API remains during transition
4. **Test-First Development**: Write behavioral tests before implementation
5. **RULES.md Compliance**: Follow all coding standards from @llxprt-code/docs/RULES.md

## Architecture

### Semantic Token Hierarchy
```
Base Tokens (Required):
├── text.primary
├── text.secondary  
├── text.accent
├── status.success
├── status.warning
├── status.error
├── background.primary
├── background.secondary
├── border.default
└── border.focused

Extended Tokens (Optional, inherit from base):
├── todo.completed → status.success
├── todo.active → status.warning
├── todo.pending → text.secondary
├── provider.selected → text.accent
├── memory.high → status.error
├── memory.medium → status.warning
└── memory.low → status.success
```

## Implementation Phases

### Phase 1: Semantic Infrastructure
- Create semantic token system
- Add theme migration utilities
- Implement backward compatibility layer

### Phase 2: Core Component Migration  
- Migrate TodoPanel to semantic colors
- Update Provider/Model dialogs
- Convert Footer components

### Phase 3: Full Migration
- Update all remaining components
- Migrate test utilities
- Add theme validation

### Phase 4: Polish & Documentation
- Theme development tools
- Migration guide for custom themes
- Deprecation warnings for direct Colors usage

## Task Structure

Each task file is self-contained with:
1. Context and requirements
2. Specific implementation steps
3. Self-verification criteria
4. RULES.md compliance checklist

## Verification Strategy

- **Primary Agent**: Implements the feature
- **Verification Agent**: Reviews implementation against requirements
- **All Tests**: Behavioral only, no structural testing
- **No Mocks**: Test actual behavior, not implementation details

## Success Criteria

1. All existing themes work without modification
2. New themes require only base token definitions
3. No breaking changes to current UI
4. Improved theme consistency across components
5. Full RULES.md compliance