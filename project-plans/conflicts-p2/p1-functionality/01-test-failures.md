# Task: Fix Failing Tests

## Objective

Fix the 2-3 failing tests identified in the reports, focusing on test correctness and ensuring they properly validate the merged functionality.

## Files to Modify

### Priority 1 - Known Failures:

1. **Token Count Test** (location TBD - likely in core tests)
   - Expected: 75 tokens
   - Actual: 93 tokens
   - Update expectation or fix tokenizer if incorrect

2. **Model Update Test** (location TBD - likely in CLI tests)
   - Expected: 'gemini-2.5-flash'
   - Actual: 'gemini-2.5-pro'
   - Update test to match new default model

3. **Shell Path Test** (`packages/core/src/tools/shell.test.ts`)
   - Fix platform-specific path handling
   - Ensure proper escaping of malformed paths

### Priority 2 - OpenAI Provider Tests:

4. **`packages/cli/src/providers/openai/OpenAIProvider.switch.test.ts`**
   - 2 tests failing related to async stream parsing
   - These may need mock updates or test refactoring

## Specific Changes Needed

### For Token Count Test:

1. Locate the test expecting 75 tokens
2. Verify the actual token count is correct (93 might be right with new tokenizer)
3. Update expectation if the new count is correct
4. If not, investigate tokenizer changes

### For Model Update Test:

1. Find test checking for 'gemini-2.5-flash'
2. Update to expect 'gemini-2.5-pro' (new default)
3. Or make test model-agnostic if appropriate

### For Shell Path Test:

1. Review the malformed path test case
2. Ensure it handles platform differences (Windows vs Unix)
3. Update assertions to be platform-aware

### For OpenAI Provider Tests:

1. Review mock Response implementation
2. Ensure ReadableStream is properly mocked
3. Update test to properly consume async streams

## Verification Steps

1. Run `npm test` from root directory
2. Verify each fixed test passes
3. Ensure no new test failures introduced
4. Run tests in both Node and test environment

## Dependencies

- P0 tasks must be complete (build must pass)

## Estimated Time

1 hour

## Notes

- Token count differences might be due to provider-specific tokenization
- Model default changes are likely intentional
- Platform-specific tests need careful handling
- OpenAI streaming tests may need environment-specific fixes
