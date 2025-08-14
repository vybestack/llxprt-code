# Phase 4: EmojiFilter TDD

## Worker Command
```bash
claude --dangerously-skip-permissions -p "
Write comprehensive BEHAVIORAL tests for EmojiFilter based on:
- specification.md requirements [REQ-001]
- analysis/pseudocode/EmojiFilter.md
- Example data from specification

CREATE: packages/core/src/filters/test/EmojiFilter.spec.ts

MANDATORY RULES:
1. Test ACTUAL BEHAVIOR with real data flows
2. NEVER test for NotYetImplemented
3. Each test must transform INPUT → OUTPUT
4. NO mock verification tests
5. NO structure-only tests

Required test scenarios (20 tests minimum):

/**
 * @requirement REQ-001.1
 * @scenario Filter emojis from text
 * @given '✅ Task completed! 🎉'
 * @when filterText() in auto mode
 * @then Returns '[OK] Task completed!'
 */

/**
 * @requirement REQ-001.3
 * @scenario Allowed mode passes through
 * @given '🚀 Launch sequence'
 * @when filterText() in allowed mode
 * @then Returns '🚀 Launch sequence' unchanged
 */

/**
 * @requirement REQ-001.3
 * @scenario Error mode blocks execution
 * @given '✅ Success!'
 * @when filterText() in error mode
 * @then Returns { blocked: true, error: 'Emojis detected in content' }
 */

Include 30% PROPERTY-BASED tests:
test.prop([fc.string()])('handles any Unicode input', (input) => {
  const result = filter.filterText(input);
  expect(result.filtered).toBeDefined();
  expect(typeof result.emojiDetected).toBe('boolean');
});

FORBIDDEN:
- expect(mockService.method).toHaveBeenCalled()
- expect(() => fn()).not.toThrow()
- expect(fn).toThrow('NotYetImplemented')
"
```

## Expected Tests
- Text filtering in all modes
- Stream chunk handling
- Tool argument filtering
- File content protection
- Edge cases (split emojis, empty input)
- Property-based tests (30%)

## Verification
```bash
# Check for mock theater
grep -r "toHaveBeenCalled" packages/core/src/filters/test/
[ $? -eq 0 ] && echo "FAIL: Mock verification found"

# Check for behavioral assertions
grep -E "toBe\(|toEqual\(|toMatch\(" packages/core/src/filters/test/

# Verify 30% property tests
TOTAL=$(grep -c "test\(" packages/core/src/filters/test/*.spec.ts)
PROPERTY=$(grep -c "test\.prop\(" packages/core/src/filters/test/*.spec.ts)
PERCENTAGE=$((PROPERTY * 100 / TOTAL))
[ $PERCENTAGE -lt 30 ] && echo "FAIL: Only $PERCENTAGE% property tests"

# Run tests - should fail naturally
npm test packages/core/src/filters/test/
```