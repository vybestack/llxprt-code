# Phase 07: Profile Parsing Tests (TDD)

## Phase ID
`PLAN-20251118-ISSUE533.P07`

## Prerequisites
- Required: Phase 06 completed (stub functions exist)
- Verification: `grep -c "function parseInlineProfile" packages/cli/src/config/profileBootstrap.ts`
- Expected: Stub functions exist and compile

## Implementation Tasks

### Files to Modify

#### `packages/cli/src/config/__tests__/profileBootstrap.test.ts`
**Action**: Add test suite for profile JSON parsing and validation

**Test Suite**: `describe('parseInlineProfile() @plan:PLAN-20251118-ISSUE533.P07', () => { ... })`

### Test Scenarios (16 behavioral tests with edge cases)

#### Group 1: Valid Profile Parsing (5 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-002.1
 * @scenario: Minimal valid profile
 * @given: JSON with provider, model, key
 * @when: parseInlineProfile() is called
 * @then: Returns BootstrapRuntimeState with provider and model
 */
it('should parse minimal valid profile', () => {
  const json = '{"provider":"openai","model":"gpt-4","key":"sk-test123"}';
  const result = parseInlineProfile(json);
  expect(result.providerName).toBe('openai');
  expect(result.modelName).toBe('gpt-4');
  expect(result.warnings).toEqual([]);
});

/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-002.1
 * @scenario: Profile with optional fields
 * @given: JSON with provider, model, key, temperature, maxTokens
 * @when: parseInlineProfile() is called
 * @then: Returns profile with all fields
 */
it('should parse profile with optional fields', () => {
  const json = '{"provider":"openai","model":"gpt-4","key":"sk-test","temperature":0.7,"maxTokens":2000}';
  const result = parseInlineProfile(json);
  expect(result.providerName).toBe('openai');
  expect(result.modelName).toBe('gpt-4');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-002.1
 * @scenario: Profile with extra whitespace
 * @given: JSON with whitespace formatting
 * @when: parseInlineProfile() is called
 * @then: Parses successfully ignoring whitespace
 */
it('should parse profile with whitespace', () => {
  const json = `{
    "provider": "anthropic",
    "model": "claude-sonnet-4",
    "key": "sk-ant-test"
  }`;
  const result = parseInlineProfile(json);
  expect(result.providerName).toBe('anthropic');
  expect(result.modelName).toBe('claude-sonnet-4');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-002.3
 * @scenario: Profile with nested configuration
 * @given: JSON with nested objects (e.g., tool_choice)
 * @when: parseInlineProfile() is called
 * @then: Parses nested structure
 */
it('should parse profile with nested objects', () => {
  const json = '{"provider":"openai","model":"gpt-4","key":"sk-test","tool_choice":{"type":"auto"}}';
  const result = parseInlineProfile(json);
  expect(result.providerName).toBe('openai');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-002.1
 * @scenario: Profile with all supported providers
 * @given: JSON for anthropic, openai, google, azure
 * @when: parseInlineProfile() is called
 * @then: Each provider parses correctly
 */
it('should parse profiles for all supported providers', () => {
  const providers = [
    { provider: 'openai', model: 'gpt-4', key: 'sk-test' },
    { provider: 'anthropic', model: 'claude-sonnet-4', key: 'sk-ant-test' },
    { provider: 'google', model: 'gemini-pro', key: 'AIza-test' },
    { provider: 'azure', model: 'gpt-4', key: 'test-key', baseurl: 'https://test.openai.azure.com' }
  ];
  
  providers.forEach(profile => {
    const json = JSON.stringify(profile);
    const result = parseInlineProfile(json);
    expect(result.providerName).toBe(profile.provider);
  });
});
```

#### Group 2: JSON Parsing Errors and Edge Cases (3 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-003.1
 * @scenario: Invalid JSON syntax
 * @given: Malformed JSON string
 * @when: parseInlineProfile() is called
 * @then: Throws error with JSON parsing details
 */
it('should throw error for invalid JSON syntax', () => {
  const json = '{provider:"openai",model:"gpt-4"}'; // Missing quotes
  expect(() => parseInlineProfile(json)).toThrow(/Invalid JSON/);
});

/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-003.1
 * @scenario: Empty string
 * @given: Empty string ""
 * @when: parseInlineProfile() is called
 * @then: Throws error "Profile JSON cannot be empty"
 */
it('should throw error for empty string', () => {
  expect(() => parseInlineProfile('')).toThrow('Profile JSON cannot be empty');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-003.1
 * @scenario: Whitespace-only string
 * @given: "   " (spaces only)
 * @when: parseInlineProfile() is called
 * @then: Throws error "Profile JSON cannot be empty"
 */
it('should throw error for whitespace-only string', () => {
  expect(() => parseInlineProfile('   ')).toThrow('Profile JSON cannot be empty');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-003.1
#### Group 3: Schema Validation Errors with Boundary Conditions (4 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-003.2
 * @scenario: Missing required field - provider
 * @given: JSON without provider field
 * @when: parseInlineProfile() is called
 * @then: Throws error "'provider' is required"
 */
it('should throw error when provider is missing', () => {
  const json = '{"model":"gpt-4","key":"sk-test"}';
  expect(() => parseInlineProfile(json)).toThrow("'provider' is required");
});

/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-003.2
 * @scenario: Missing required field - model
 * @given: JSON without model field
 * @when: parseInlineProfile() is called
 * @then: Throws error "'model' is required"
 */
it('should throw error when model is missing', () => {
  const json = '{"provider":"openai","key":"sk-test"}';
  expect(() => parseInlineProfile(json)).toThrow("'model' is required");
});

/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-003.2
 * @scenario: Invalid provider value
 * @given: JSON with unsupported provider
 * @when: parseInlineProfile() is called
 * @then: Throws error with supported providers list
 */
it('should throw error for invalid provider', () => {
  const json = '{"provider":"invalid-provider","model":"test","key":"test"}';
  expect(() => parseInlineProfile(json)).toThrow(/Supported providers:/);
});

/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-003.2
 * @scenario: Invalid field type
 * @given: JSON with wrong type (e.g., temperature as string)
 * @when: parseInlineProfile() is called
 * @then: Throws error "'temperature' must be a number"
 */
it('should throw error for invalid field types', () => {
  const json = '{"provider":"openai","model":"gpt-4","key":"sk-test","temperature":"0.7"}';
  expect(() => parseInlineProfile(json)).toThrow("'temperature' must be a number");
});

/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-003.2
 * @scenario: Temperature out of range
#### Group 4: Security Validation (4 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-003.3
 * @scenario: Nesting depth exceeds limit
 * @given: JSON with >5 levels of nesting
 * @when: parseInlineProfile() is called
 * @then: Throws error "Profile nesting depth exceeds maximum of 5"
 */
it('should throw error for excessive nesting depth', () => {
  const json = '{"a":{"b":{"c":{"d":{"e":{"f":"too deep"}}}}}}';
  expect(() => parseInlineProfile(json)).toThrow('Profile nesting depth exceeds maximum of 5');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-003.3
 * @scenario: Nesting depth at limit (5 levels)
 * @given: JSON with exactly 5 levels
 * @when: parseInlineProfile() is called
 * @then: Accepts (does not throw)
 */
it('should accept nesting depth at limit', () => {
  const json = '{"provider":"openai","model":"gpt-4","key":"sk-test","config":{"nested":{"level":{"four":{"five":"ok"}}}}}';
  expect(() => parseInlineProfile(json)).not.toThrow(/nesting depth/);
});

/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-003.3
 * @scenario: Disallowed field - __proto__
 * @given: JSON with __proto__ field
 * @when: parseInlineProfile() is called
 * @then: Throws error "Disallowed field"
 */
it('should reject __proto__ field', () => {
  const json = '{"provider":"openai","model":"gpt-4","key":"sk-test","__proto__":{"polluted":true}}';
  expect(() => parseInlineProfile(json)).toThrow(/Disallowed field.*__proto__/);
});

/**
 * @plan:PLAN-20251118-ISSUE533.P07
 * @requirement:REQ-PROF-003.3
 * @scenario: Disallowed field - constructor
 * @given: JSON with constructor field
 * @when: parseInlineProfile() is called
 * @then: Throws error "Disallowed field"
 */
it('should reject constructor field', () => {
  const json = '{"provider":"openai","model":"gpt-4","key":"sk-test","constructor":{"polluted":true}}';
  expect(() => parseInlineProfile(json)).toThrow(/Disallowed field.*constructor/);
});
```

## Required Code Markers

Every test MUST include:
- `@plan:PLAN-20251118-ISSUE533.P07`
- `@requirement:REQ-XXX`
- `@scenario:`, `@given:`, `@when:`, `@then:`

## Verification Commands

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20251118-ISSUE533.P07" packages/cli/src/config/__tests__/profileBootstrap.test.ts | wc -l
# Expected: 16 occurrences

# Run phase-specific tests (should fail initially)
npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts -- --grep "@plan:.*P07"
# Expected: Tests exist but fail (stubs return empty values)
```

## Success Criteria

- 16 comprehensive behavioral tests with edge cases covering boundary conditions and error scenarios
- Tests fail naturally (stub returns empty/wrong values)
- All tests have behavioral annotations
- No reverse testing (no NotYetImplemented checks)

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P07.md`

```markdown
Phase: P07
Completed: [YYYY-MM-DD HH:MM]
Tests Created: 16
Test Categories:
  - Valid parsing: 5 tests
  - JSON errors and edge cases: 3 tests
  - Schema validation with boundary conditions: 4 tests
  - Security validation: 4 tests
Verification:
  - Plan markers: 16 [OK]
  - Requirement markers: 16 [OK]
  - Behavioral annotations: 16 [OK]
  - Tests fail naturally: [OK]
```
