# Task: Code Cleanup

## Objective

Clean up merge artifacts, remove unused code, fix linting warnings, and improve code quality throughout the affected files.

## Files to Modify

### Priority 1 - Merge Artifacts:

1. **All files marked MM (double modified)**
   - `packages/cli/src/gemini.tsx`
   - `packages/cli/src/ui/hooks/slashCommandProcessor.ts`
   - `packages/core/src/core/client.test.ts`
   - `packages/core/src/tools/shell.test.ts`
   - `packages/core/src/tools/shell.ts`
   - `packages/core/src/tools/mcp-client.test.ts`
   - `packages/core/src/telemetry/clearcut-logger/clearcut-logger.ts`
   - `packages/core/src/utils/user_id.test.ts`
   - `packages/cli/src/ui/App.tsx`
   - `packages/core/src/config/config.ts`
   - `packages/core/src/core/oauth2.test.ts`
   - Check for duplicate code, commented blocks, merge artifacts

### Priority 2 - Linting Issues:

2. **Fix remaining linting warnings**
   - Unused variables
   - React Hook dependencies
   - Missing type annotations
   - Improper any usage

### Priority 3 - Dead Code:

3. **Remove unused imports and functions**
   - Use eslint to identify
   - Remove commented-out code
   - Clean up test utilities

## Specific Changes Needed

### For Each MM File:

1. Look for:
   - Duplicate imports
   - Commented code blocks from merge
   - Inconsistent formatting
   - Duplicate functions/logic

2. Clean up:
   - Remove obvious merge artifacts
   - Consolidate duplicate logic
   - Fix formatting inconsistencies

### Linting Fixes:

1. Run `npm run lint` with auto-fix
2. Manually fix remaining issues
3. Add proper types instead of `any`
4. Fix React Hook dependency arrays

### Code Quality:

1. Remove console.log statements
2. Add missing error handling
3. Improve variable names
4. Add missing JSDoc comments

## Verification Steps

1. Run `npm run lint` - should pass with 0 warnings
2. Run `npm run typecheck` - should pass
3. Check for no TODO/FIXME comments from merge
4. Verify no commented-out code remains
5. Ensure consistent code style

## Dependencies

- All P1 tasks must be complete

## Estimated Time

45 minutes

## Notes

- Focus on mechanical cleanup first
- Don't refactor working code
- Preserve all functionality
- Document any questionable areas for later review
