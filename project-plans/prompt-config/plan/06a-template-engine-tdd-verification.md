# Task 06a: Verify TemplateEngine TDD Tests

## Objective

Adversarially verify that the TemplateEngine tests are truly behavioral and cover all requirements without mock theater or structural testing.

## Verification Steps

### 1. Test File Exists

```bash
test -f packages/core/test/prompt-config/TemplateEngine.spec.ts || echo "FAIL: Test file missing"
```

### 2. Test Count Verification

```bash
# Count actual test cases
TEST_COUNT=$(grep -c "it(" packages/core/test/prompt-config/TemplateEngine.spec.ts)
if [ $TEST_COUNT -lt 15 ]; then
  echo "FAIL: Only $TEST_COUNT tests (minimum 15 required)"
fi
```

### 3. Behavioral Test Verification

```bash
# Check for forbidden mock patterns
grep -n "toHaveBeenCalled\|toHaveBeenCalledWith" test/prompt-config/TemplateEngine.spec.ts && echo "FAIL: Mock verification found"

# Check for structure-only testing  
grep -n "toHaveProperty\|toBeDefined\|toBeUndefined" test/prompt-config/TemplateEngine.spec.ts | \
  grep -v "specific value" && echo "FAIL: Structure-only test found"

# Check for no-op tests
grep -n "not\.toThrow\|not\.toReject" test/prompt-config/TemplateEngine.spec.ts | \
  grep -v "specific error" && echo "FAIL: No-op error test found"

# Verify behavioral assertions exist
grep -c "toBe\|toEqual\|toMatch\|toContain" test/prompt-config/TemplateEngine.spec.ts || echo "FAIL: No behavioral assertions found"
```

### 4. Requirements Coverage

```bash
# Check each REQ is tested
for req in "REQ-004.1" "REQ-004.2" "REQ-004.3" "REQ-004.4" "REQ-010.4"; do
  grep -q "@requirement $req" test/prompt-config/TemplateEngine.spec.ts || echo "FAIL: $req not tested"
done

# Verify @requirement tags have behavioral assertions
grep -A 10 "@requirement" test/prompt-config/TemplateEngine.spec.ts | \
  grep -q "expect.*toBe\|expect.*toEqual" || echo "FAIL: Requirements lack behavioral assertions"
```

### 5. Test Quality Checks

```bash
# Each test should have proper documentation
grep -B 5 "it(" test/prompt-config/TemplateEngine.spec.ts | \
  grep -c "@scenario" || echo "WARNING: Tests missing @scenario tags"

# Tests should test actual transformations
grep -c "const result = engine.processTemplate" test/prompt-config/TemplateEngine.spec.ts || \
  echo "FAIL: Tests not calling processTemplate"

# Tests should verify specific output values
grep -c "toBe('[^']*')\|toEqual(" test/prompt-config/TemplateEngine.spec.ts || \
  echo "FAIL: Tests not verifying specific values"
```

### 6. Edge Case Coverage

Verify key edge cases are tested:

```bash
# Empty template
grep -q "empty.*template\|template.*empty" test/prompt-config/TemplateEngine.spec.ts || \
  echo "FAIL: Empty template not tested"

# Malformed variables
grep -q "malformed\|unclosed\|broken" test/prompt-config/TemplateEngine.spec.ts || \
  echo "FAIL: Malformed variables not tested"

# No variables
grep -q "no variables\|plain text" test/prompt-config/TemplateEngine.spec.ts || \
  echo "FAIL: Template without variables not tested"

# Special characters
grep -q "special.*character\|quotes\|brackets" test/prompt-config/TemplateEngine.spec.ts || \
  echo "FAIL: Special characters not tested"
```

### 7. Run Tests

```bash
cd packages/core

# All tests should fail with NotYetImplemented
npm test TemplateEngine.spec.ts 2>&1 | grep -c "NotYetImplemented" || \
  echo "FAIL: Tests not failing with NotYetImplemented"

# No tests should pass
npm test TemplateEngine.spec.ts 2>&1 | grep "passing" && \
  echo "FAIL: Some tests passing (should all fail)"
```

### 8. Mock Theater Detection

Advanced checks for sophisticated mock fraud:

```bash
# Circular mock testing
grep -B5 -A5 "mockReturnValue\|mockResolvedValue" test/prompt-config/TemplateEngine.spec.ts | \
  grep "expect.*toBe\|expect.*toEqual" && echo "FAIL: Circular mock test detected"

# Test expecting implementation details
grep "private\|_.*(" test/prompt-config/TemplateEngine.spec.ts && \
  echo "FAIL: Testing private methods"
```

### 9. Template Test Patterns

Verify specific template patterns are tested:

```bash
# Multiple same variable
grep -q "{{MODEL}}.*{{MODEL}}" test/prompt-config/TemplateEngine.spec.ts || \
  echo "WARNING: Repeated variable not tested"

# Adjacent variables
grep -q "{{[^}]*}}{{" test/prompt-config/TemplateEngine.spec.ts || \
  echo "WARNING: Adjacent variables not tested"

# Variables with spaces
grep -q "{{.*[[:space:]].*}}" test/prompt-config/TemplateEngine.spec.ts || \
  echo "WARNING: Variables with spaces not tested"
```

## Fraud Patterns to Detect

1. **Mock theater**: Tests that verify mocks instead of behavior
2. **Structure tests**: Only checking properties exist
3. **Stub tests**: Expecting NotYetImplemented to be thrown
4. **Implementation tests**: Testing how, not what
5. **Missing coverage**: Key requirements not tested

## Success Criteria

- 15+ behavioral tests
- All REQ tags covered
- All tests fail with NotYetImplemented
- No mock verification
- Specific output values tested
- Edge cases covered