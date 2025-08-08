# Task 1: Semantic Color Infrastructure

## Context

We need to implement a semantic color token system that provides meaningful color abstractions while maintaining backward compatibility with the existing Colors API. This task creates the foundation for the entire theme improvement.

## Requirements

1. Create semantic token definitions that map to color purposes
2. Implement a semantic color resolver that works with existing themes  
3. Maintain full backward compatibility with Colors API
4. Follow all standards in @llxprt-code/docs/RULES.md

## Implementation Steps

### 1. Create Semantic Token Types
Create `packages/cli/src/ui/themes/semantic-tokens.ts`:
```typescript
export interface SemanticColors {
  text: {
    primary: string;
    secondary: string;
    accent: string;
  };
  status: {
    success: string;
    warning: string;
    error: string;
  };
  background: {
    primary: string;
    secondary: string;
  };
  border: {
    default: string;
    focused: string;
  };
}
```

### 2. Create Semantic Resolver
Create `packages/cli/src/ui/themes/semantic-resolver.ts`:
- Implement `resolveSemanticColors(theme: ColorsTheme): SemanticColors`
- Map theme colors to semantic tokens with intelligent defaults
- Handle custom themes without semantic definitions

### 3. Extend Theme Manager
Update `packages/cli/src/ui/themes/theme-manager.ts`:
- Add `getSemanticColors(): SemanticColors` method
- Cache resolved semantic colors
- Update on theme switch

### 4. Create Compatibility Layer
Create `packages/cli/src/ui/themes/theme-compat.ts`:
- Re-export existing Colors for backward compatibility
- Add deprecation notices (commented out initially)
- Provide migration utilities

### 5. Write Behavioral Tests
Create `packages/cli/src/ui/themes/semantic-tokens.test.ts`:
- Test that semantic colors resolve correctly for all built-in themes
- Test custom theme handling
- Test theme switching updates semantic colors
- Verify backward compatibility

## Self-Verification Checklist

- [ ] All built-in themes resolve to valid semantic colors
- [ ] Custom themes without semantic definitions still work
- [ ] Existing Colors API continues to function
- [ ] No TypeScript errors or warnings
- [ ] All tests pass including new behavioral tests
- [ ] Theme switching updates semantic colors correctly

## RULES.md Compliance

From @llxprt-code/docs/RULES.md:
- [ ] **No `any` types**: All types are properly defined
- [ ] **No empty catch blocks**: Error handling is explicit
- [ ] **Behavioral tests only**: Tests verify behavior, not structure
- [ ] **No mock abuse**: Tests use real theme data
- [ ] **Formatting**: Run `npm run format` before completion
- [ ] **Linting**: Run `npm run lint` and fix all issues
- [ ] **Type checking**: Run `npm run typecheck` successfully

## Expected Outputs

1. Working semantic color system accessible via theme manager
2. All existing code continues to work unchanged
3. Behavioral tests proving the system works correctly
4. Clean git diff with no unrelated changes

## Notes for Implementation

- Start with the type definitions to establish the contract
- Use the existing theme manager's getter pattern for consistency  
- Consider memoization for performance (themes don't change often)
- Default mappings should cover 90% of use cases