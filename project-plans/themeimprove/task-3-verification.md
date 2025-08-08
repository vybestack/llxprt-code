# Task 3: Theme Implementation Verification

## Context

This is a verification task to be executed by a different subagent after Tasks 1 and 2 are complete. The goal is to independently verify that the semantic color implementation meets all requirements and maintains quality standards.

## Requirements

1. Verify semantic color infrastructure works correctly
2. Confirm core components migrated properly
3. Check backward compatibility maintained
4. Ensure all RULES.md standards are followed
5. Validate behavioral tests are comprehensive

## Verification Steps

### 1. Infrastructure Verification

Check `packages/cli/src/ui/themes/`:
- [ ] `semantic-tokens.ts` exports correct TypeScript interfaces
- [ ] `semantic-resolver.ts` handles all built-in themes
- [ ] `theme-manager.ts` provides `getSemanticColors()` method
- [ ] All methods have proper return types (no `any`)

### 2. Component Migration Verification

For each migrated component, verify:
- [ ] No direct `Colors.*` imports remain
- [ ] All colors come from semantic tokens
- [ ] No hardcoded hex/rgb colors
- [ ] Components still render correctly

Test manually:
```bash
# Switch between themes and verify components look correct
/theme dark
/theme light  
/theme ansi
```

### 3. Backward Compatibility Check

- [ ] Existing code using `Colors` API still works
- [ ] No breaking changes to public APIs
- [ ] Custom themes continue to function
- [ ] No runtime errors when switching themes

### 4. Test Quality Verification

Review test files to ensure:
- [ ] Tests are behavioral, not structural
- [ ] No testing of private methods or internals
- [ ] Tests verify actual color output, not implementation
- [ ] Good coverage of edge cases

Example of good behavioral test:
```typescript
// GOOD: Tests behavior
expect(getComputedStyle(element).color).toBe('#00ff00');

// BAD: Tests structure  
expect(element.className).toContain('success-color');
```

### 5. Code Quality Checks

Run and verify:
```bash
npm run lint        # No errors
npm run typecheck   # No errors
npm run test        # All pass
npm run format      # No changes
```

### 6. RULES.md Compliance Audit

From @llxprt-code/docs/RULES.md, verify:
- [ ] **No `any` types**: Search for `any` in changed files
- [ ] **Error handling**: No empty catch blocks
- [ ] **No debugging code**: No console.logs or commented code
- [ ] **Clean commits**: Changes are focused and relevant
- [ ] **Test quality**: Tests are meaningful and behavioral

## Verification Report Template

```markdown
## Semantic Color Implementation Verification

### Infrastructure ✓/✗
- Type definitions complete
- Resolver handles all themes
- Manager integration working
- Backward compatibility maintained

### Component Migration ✓/✗
- TodoPanel fully migrated
- Dialogs using semantic colors
- Footer components updated
- No hardcoded colors found

### Test Coverage ✓/✗
- Behavioral tests present
- Edge cases covered
- Theme switching tested
- No structural tests

### Code Quality ✓/✗
- Lint passing
- Types correct
- Format clean
- RULES.md compliant

### Recommendations
[Any issues found or improvements suggested]
```

## Failure Criteria

Fail the verification if:
1. Any hardcoded colors remain in migrated components
2. Behavioral tests are missing or test structure
3. Backward compatibility is broken
4. RULES.md violations are present
5. Visual appearance changed unintentionally

## Success Criteria

Pass the verification when:
1. All semantic infrastructure works correctly
2. Core components fully migrated
3. All tests are behavioral and passing
4. Code meets all quality standards
5. No regressions in functionality