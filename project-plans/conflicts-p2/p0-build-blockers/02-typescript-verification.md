# Task: Verify and Fix Remaining TypeScript Errors

## Objective

The build-fix-report indicates some TypeScript errors were fixed, but the merge-analysis-report lists additional errors. Verify which errors still exist and fix them.

## Files to Check and Potentially Modify

### Priority 1 - Reported in merge-analysis but may be fixed:

1. **`packages/cli/src/gemini.tsx`**
   - Check for duplicate `USER_SETTINGS_PATH` declaration (lines 21 and 23)
   - Remove duplicate if present

2. **`packages/cli/src/ui/hooks/slashCommandProcessor.ts`**
   - Line 118: Check if function call has correct number of arguments
   - Update to match expected signature

3. **`packages/core/src/config/config.ts`**
   - Line 291: Check argument count mismatch
   - Fix function call to match signature

4. **`packages/core/src/tools/todo-read.ts`**
   - Line 25: Check 'additionalProperties' in schema
   - Update schema definition to match expected type

5. **`packages/core/src/tools/todo-write.ts`**
   - Line 39: Check type assignment (number vs string)
   - Fix type to match expected

### Priority 2 - Test file:

6. **`packages/core/src/core/client.test.ts`**
   - Line 898: Check 'model' property access
   - Update test to match current API

## Verification Steps

1. Run `npm run typecheck` from root directory
2. If any errors found, fix them according to the specific issues above
3. Re-run `npm run typecheck` to confirm all errors resolved
4. Run `npm run lint` to ensure no new linting issues

## Dependencies

- None (can be done immediately)

## Estimated Time

30 minutes

## Notes

- Some of these errors may already be fixed per the build-fix-report
- Focus on actual compilation errors, not just warnings
- The duplicate identifier issue is likely the most critical
- Function signature mismatches suggest API changes between branches
