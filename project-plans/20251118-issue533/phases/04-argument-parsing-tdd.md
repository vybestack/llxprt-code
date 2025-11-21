# Phase 04: Argument Parsing Tests (TDD)

## Phase ID
`PLAN-20251118-ISSUE533.P04`

## Prerequisites
- Required: Phase 03 completed (profileJson field exists)
- Verification: `grep "profileJson: string | null" packages/cli/src/config/profileBootstrap.ts`
- Expected: Field exists in BootstrapProfileArgs interface

## Implementation Tasks

### Files to Modify

#### `packages/cli/src/config/__tests__/profileBootstrap.test.ts`
**Action**: Add test suite for `--profile` flag parsing

**Test Suite**: `describe('--profile flag parsing @plan:PLAN-20251118-ISSUE533.P04', () => { ... })`

### Test Scenarios (15 tests)

#### Group 1: Basic Parsing (5 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-PROF-001.1
 * @scenario: Valid inline profile with space separator
 * @given: --profile '{"provider":"openai","model":"gpt-4"}'
 * @when: parseBootstrapArgs() is called
 * @then: bootstrapArgs.profileJson contains the JSON string
 */
it('should parse --profile with space-separated JSON string', () => {
  process.argv = ['node', 'llxprt', '--profile', '{"provider":"openai","model":"gpt-4"}'];
  const result = parseBootstrapArgs();
  expect(result.args.profileJson).toBe('{"provider":"openai","model":"gpt-4"}');
  expect(result.args.profileName).toBeNull();
});

/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-PROF-001.1
 * @scenario: Valid inline profile with equals syntax
 * @given: --profile='{"provider":"openai","model":"gpt-4"}'
 * @when: parseBootstrapArgs() is called
 * @then: bootstrapArgs.profileJson contains the JSON string
 */
it('should parse --profile with equals syntax', () => {
  process.argv = ['node', 'llxprt', '--profile={"provider":"openai","model":"gpt-4"}'];
  const result = parseBootstrapArgs();
  expect(result.args.profileJson).toBe('{"provider":"openai","model":"gpt-4"}');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-PROF-001.1
 * @scenario: Empty JSON object
 * @given: --profile '{}'
 * @when: parseBootstrapArgs() is called
 * @then: profileJson is '{}' (validation happens later)
 */
it('should accept empty JSON object', () => {
  process.argv = ['node', 'llxprt', '--profile', '{}'];
  const result = parseBootstrapArgs();
  expect(result.args.profileJson).toBe('{}');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-PROF-001.1
 * @scenario: Profile with whitespace
 * @given: --profile '{ "provider" : "openai" , "model" : "gpt-4" }'
 * @when: parseBootstrapArgs() is called
 * @then: profileJson preserves whitespace
 */
it('should preserve whitespace in JSON string', () => {
  const json = '{ "provider" : "openai" , "model" : "gpt-4" }';
  process.argv = ['node', 'llxprt', '--profile', json];
  const result = parseBootstrapArgs();
  expect(result.args.profileJson).toBe(json);
});

/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-PROF-001.1
 * @scenario: Profile with other flags
 * @given: --profile '{"provider":"openai","model":"gpt-4"}' --prompt "test"
 * @when: parseBootstrapArgs() is called
 * @then: Both profileJson and prompt flags parsed
 */
it('should parse --profile alongside other flags', () => {
  process.argv = [
    'node', 'llxprt', 
    '--profile', '{"provider":"openai","model":"gpt-4"}',
    '--prompt', 'test prompt'
  ];
  const result = parseBootstrapArgs();
  expect(result.args.profileJson).toBe('{"provider":"openai","model":"gpt-4"}');
  // Note: This test assumes --prompt parsing exists; adjust if needed
});
```

#### Group 2: Error Cases (4 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-PROF-001.1
 * @scenario: Missing value for --profile
 * @given: --profile without argument
 * @when: parseBootstrapArgs() is called
 * @then: Throws error "--profile requires a value"
 */
it('should throw error when --profile has no value', () => {
  process.argv = ['node', 'llxprt', '--profile'];
  expect(() => parseBootstrapArgs()).toThrow('--profile requires a value');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-PROF-001.1
 * @scenario: --profile followed by another flag
 * @given: --profile --prompt "test"
 * @when: parseBootstrapArgs() is called
 * @then: Throws error "--profile requires a value"
 */
it('should throw error when --profile is followed by another flag', () => {
  process.argv = ['node', 'llxprt', '--profile', '--prompt', 'test'];
  expect(() => parseBootstrapArgs()).toThrow('--profile requires a value');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-PROF-001.1
 * @scenario: Empty string value
 * @given: --profile ''
 * @when: parseBootstrapArgs() is called
 * @then: profileJson is '' (validation fails later, but parsing succeeds)
 */
it('should accept empty string (validation fails later)', () => {
  process.argv = ['node', 'llxprt', '--profile', ''];
  const result = parseBootstrapArgs();
  expect(result.args.profileJson).toBe('');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-PROF-003.3
 * @scenario: JSON string exceeds 10KB limit
 * @given: --profile with >10KB string
 * @when: parseBootstrapArgs() is called
 * @then: Throws error "Profile JSON exceeds maximum size of 10KB"
 */
it('should throw error for JSON exceeding 10KB', () => {
  const largeJson = '{"data":"' + 'x'.repeat(10241) + '"}';
  process.argv = ['node', 'llxprt', '--profile', largeJson];
  expect(() => parseBootstrapArgs()).toThrow('Profile JSON exceeds maximum size of 10KB');
});
```

#### Group 3: Mutual Exclusivity (4 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-INT-001.2
 * @scenario: Both --profile and --profile-load specified
 * @given: --profile '{"provider":"openai","model":"gpt-4"}' --profile-load my-profile
 * @when: parseBootstrapArgs() is called
 * @then: Throws mutual exclusivity error
 */
it('should throw error when both --profile and --profile-load are used', () => {
  process.argv = [
    'node', 'llxprt',
    '--profile', '{"provider":"openai","model":"gpt-4"}',
    '--profile-load', 'my-profile'
  ];
  expect(() => parseBootstrapArgs()).toThrow(/Cannot use both --profile and --profile-load/);
});

/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-INT-001.2
 * @scenario: Order independence (profile-load first)
 * @given: --profile-load my-profile --profile '{"provider":"openai","model":"gpt-4"}'
 * @when: parseBootstrapArgs() is called
 * @then: Throws same mutual exclusivity error
 */
it('should throw error regardless of flag order', () => {
  process.argv = [
    'node', 'llxprt',
    '--profile-load', 'my-profile',
    '--profile', '{"provider":"openai","model":"gpt-4"}'
  ];
  expect(() => parseBootstrapArgs()).toThrow(/Cannot use both --profile and --profile-load/);
});

/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-INT-001.2
 * @scenario: Error message includes helpful guidance
 * @given: Both flags specified
 * @when: parseBootstrapArgs() is called
 * @then: Error message suggests choosing one method
 */
it('should provide helpful error message for mutual exclusivity', () => {
  process.argv = [
    'node', 'llxprt',
    '--profile', '{}',
    '--profile-load', 'test'
  ];
  expect(() => parseBootstrapArgs()).toThrow(/Choose one profile source/);
});

/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-INT-001.2
 * @scenario: Only --profile (no conflict)
 * @given: --profile '{"provider":"openai","model":"gpt-4"}'
 * @when: parseBootstrapArgs() is called
 * @then: No error, profileJson populated, profileName null
 */
it('should not throw error when only --profile is used', () => {
  process.argv = ['node', 'llxprt', '--profile', '{"provider":"openai","model":"gpt-4"}'];
  const result = parseBootstrapArgs();
  expect(result.args.profileJson).toBe('{"provider":"openai","model":"gpt-4"}');
  expect(result.args.profileName).toBeNull();
});
```

#### Group 4: Edge Cases (2 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-PROF-001.1
 * @scenario: Multiple --profile flags (last wins)
 * @given: --profile '{"provider":"openai"}' --profile '{"provider":"anthropic","model":"claude"}'
 * @when: parseBootstrapArgs() is called
 * @then: Last --profile value is used
 */
it('should use last --profile value when multiple specified', () => {
  process.argv = [
    'node', 'llxprt',
    '--profile', '{"provider":"openai","model":"gpt-4"}',
    '--profile', '{"provider":"anthropic","model":"claude-sonnet-4"}'
  ];
  const result = parseBootstrapArgs();
  expect(result.args.profileJson).toBe('{"provider":"anthropic","model":"claude-sonnet-4"}');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P04
 * @requirement:REQ-PROF-001.1
 * @scenario: JSON with special characters
 * @given: --profile with newlines, quotes, etc.
 * @when: parseBootstrapArgs() is called
 * @then: String preserved exactly (parsing happens later)
 */
it('should preserve JSON with special characters', () => {
  const json = '{"provider":"openai","model":"gpt-4","prompt":"Say \\"hello\\""}';
  process.argv = ['node', 'llxprt', '--profile', json];
  const result = parseBootstrapArgs();
  expect(result.args.profileJson).toBe(json);
});
```

## Required Code Markers

Every test MUST include in its description or comment:
- `@plan:PLAN-20251118-ISSUE533.P04`
- `@requirement:REQ-XXX` (relevant requirement)
- `@scenario:` description
- `@given:` input
- `@when:` action
- `@then:` expected outcome

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20251118-ISSUE533.P04" packages/cli/src/config/__tests__/profileBootstrap.test.ts | wc -l
# Expected: 15 occurrences (one per test)

# Check requirements covered
grep -r "@requirement:REQ-PROF-001" packages/cli/src/config/__tests__/profileBootstrap.test.ts | wc -l
# Expected: 10+ occurrences

# Run phase-specific tests (should fail initially)
npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts -- --grep "@plan:.*P04"
# Expected: Tests exist but fail (implementation not done yet)
```

### Manual Verification Checklist

- [ ] 15 tests created
- [ ] All tests have plan markers
- [ ] All tests have requirement markers
- [ ] All tests have behavioral descriptions (@scenario, @given, @when, @then)
- [ ] NO tests check for NotYetImplemented
- [ ] NO tests use expect().not.toThrow() without checking specific behavior
- [ ] Tests fail naturally (e.g., "profileJson is undefined")
- [ ] Tests DO NOT modify implementation code

## Success Criteria

- 15 tests created with proper markers
- Tests fail with "profileJson is undefined" or similar (natural failure)
- NOT "Error: NotYetImplemented" (reverse testing)
- Tests verify actual values, not mock calls
- All tests have behavioral annotations

## Failure Recovery

If this phase fails:

1. Verify Phase 03 completed: `grep "profileJson:" packages/cli/src/config/profileBootstrap.ts`
2. Check test syntax: `npm test packages/cli/src/config/profileBootstrap.test.ts`
3. Verify no reverse testing: `grep "NotYetImplemented" packages/cli/src/config/profileBootstrap.test.ts`
4. Re-write tests following behavioral pattern

## Pseudocode Reference

**File**: `analysis/pseudocode/parse-bootstrap-args.md`
**Lines Referenced**:
- Lines 031-040: `--profile` case implementation
- Lines 060-067: Mutual exclusivity check
- Lines 070-074: Size limit check

Tests are written to EXPECT the behavior described in these pseudocode lines.

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P04.md`

```markdown
Phase: P04
Completed: [YYYY-MM-DD HH:MM]
Tests Created: 15
Test Categories:
  - Basic parsing: 5 tests
  - Error cases: 4 tests
  - Mutual exclusivity: 4 tests
  - Edge cases: 2 tests
Verification:
  - Plan markers: 15 [OK]
  - Requirement markers: 15 [OK]
  - Behavioral annotations: 15 [OK]
  - Tests fail naturally: [OK]
  - No reverse testing: [OK]
```
