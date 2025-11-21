# Phase 09: Bootstrap Integration Tests (TDD)

## Phase ID
`PLAN-20251118-ISSUE533.P09`

## Prerequisites
- Required: Phase 08 completed (parseInlineProfile working)
- Verification: `npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts -- --grep "@plan:.*P07"`
- Expected: All profile parsing tests pass

## Implementation Tasks

### Files to Modify

#### `packages/cli/src/config/__tests__/profileBootstrap.test.ts`
**Action**: Add test suite for bootstrap integration with inline profiles

**Test Suite**: `describe('applyBootstrapProfile() with --profile @plan:PLAN-20251118-ISSUE533.P09', () => { ... })`

### Test Scenarios (12 tests)

#### Group 1: Basic Profile Application (4 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P09
 * @requirement:REQ-INT-001.1
 * @scenario: Apply inline profile without overrides
 * @given: profileJson with provider, model, key
 * @when: applyBootstrapProfile() called
 * @then: Returns BootstrapRuntimeState with provider, model from JSON
 */
it('should apply inline profile successfully', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-test123"}',
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  const result = applyBootstrapProfile(args);
  expect(result.providerName).toBe('openai');
  expect(result.modelName).toBe('gpt-4');
  expect(result.warnings).toEqual([]);
});

/**
 * @plan:PLAN-20251118-ISSUE533.P09
 * @requirement:REQ-INT-001.1
 * @scenario: Apply inline profile with Anthropic provider
 * @given: profileJson with provider=anthropic
 * @when: applyBootstrapProfile() called
 * @then: Returns correct provider and model
 */
it('should apply Anthropic inline profile', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"anthropic","model":"claude-sonnet-4","key":"sk-ant-test"}',
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  const result = applyBootstrapProfile(args);
  expect(result.providerName).toBe('anthropic');
  expect(result.modelName).toBe('claude-sonnet-4');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P09
 * @requirement:REQ-INT-001.1
 * @scenario: Inline profile with optional fields
 * @given: profileJson with temperature, maxTokens, etc.
 * @when: applyBootstrapProfile() called
 * @then: Profile applied with all fields
 */
it('should apply inline profile with optional fields', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-test","temperature":0.7,"maxTokens":2000}',
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  const result = applyBootstrapProfile(args);
  expect(result.providerName).toBe('openai');
  expect(result.modelName).toBe('gpt-4');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P09
 * @requirement:REQ-INT-001.1
 * @scenario: Neither profileName nor profileJson provided
 * @given: Both fields are null
 * @when: applyBootstrapProfile() called
 * @then: Returns empty result (no profile loaded)
 */
it('should return empty result when no profile specified', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: null,
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  const result = applyBootstrapProfile(args);
  expect(result.providerName).toBe('');
  expect(result.modelName).toBe('');
});
```

#### Group 2: Override Precedence (4 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P09
 * @requirement:REQ-INT-002.1
 * @scenario: Model override takes precedence
 * @given: profileJson has model=gpt-3.5, modelOverride=gpt-4
 * @when: applyBootstrapProfile() called
 * @then: Uses gpt-4 from override, not profile
 */
it('should apply model override over inline profile', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai","model":"gpt-3.5-turbo","key":"sk-test"}',
    providerOverride: null,
    modelOverride: 'gpt-4',
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  const result = applyBootstrapProfile(args);
  expect(result.modelName).toBe('gpt-4');
  expect(result.providerName).toBe('openai'); // From profile
});

/**
 * @plan:PLAN-20251118-ISSUE533.P09
 * @requirement:REQ-INT-002.1
 * @scenario: Provider override takes precedence
 * @given: profileJson has provider=openai, providerOverride=anthropic
 * @when: applyBootstrapProfile() called
 * @then: Uses anthropic from override
 */
it('should apply provider override over inline profile', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-test"}',
    providerOverride: 'anthropic',
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  const result = applyBootstrapProfile(args);
  expect(result.providerName).toBe('anthropic');
  expect(result.modelName).toBe('gpt-4'); // From profile
});

/**
 * @plan:PLAN-20251118-ISSUE533.P09
 * @requirement:REQ-INT-002.1
 * @scenario: Key override takes precedence
 * @given: profileJson has key=sk-old, keyOverride=sk-new
 * @when: applyBootstrapProfile() called
 * @then: Warning generated about key override
 */
it('should apply key override with warning', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-old"}',
    providerOverride: null,
    modelOverride: null,
    keyOverride: 'sk-new',
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  const result = applyBootstrapProfile(args);
  expect(result.warnings).toContain('--key override applied (from --profile)');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P09
 * @requirement:REQ-INT-002.1
 * @scenario: Multiple overrides
 * @given: profileJson + provider, model, key overrides
 * @when: applyBootstrapProfile() called
 * @then: All overrides take precedence, warnings generated
 */
it('should apply multiple overrides with warnings', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai","model":"gpt-3.5-turbo","key":"sk-old"}',
    providerOverride: 'anthropic',
    modelOverride: 'claude-sonnet-4',
    keyOverride: 'sk-ant-new',
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  const result = applyBootstrapProfile(args);
  expect(result.providerName).toBe('anthropic');
  expect(result.modelName).toBe('claude-sonnet-4');
  expect(result.warnings.length).toBeGreaterThan(0);
});
```

#### Group 3: Validation Error Handling (2 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P09
 * @requirement:REQ-INT-001.3
 * @scenario: Invalid JSON in profileJson
 * @given: profileJson with malformed JSON
 * @when: applyBootstrapProfile() called
 * @then: Throws error with helpful message
 */
it('should throw error for invalid JSON', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{invalid json}',
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  expect(() => applyBootstrapProfile(args)).toThrow(/Invalid JSON/);
});

/**
 * @plan:PLAN-20251118-ISSUE533.P09
 * @requirement:REQ-INT-001.3
 * @scenario: Profile validation failure
 * @given: profileJson missing required field
 * @when: applyBootstrapProfile() called
 * @then: Throws error with validation details
 */
it('should throw error for profile validation failure', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai"}', // Missing model
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  expect(() => applyBootstrapProfile(args)).toThrow(/'model' is required/);
});
```

#### Group 4: Backward Compatibility (2 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P09
 * @requirement:REQ-INT-001.4
 * @scenario: Existing --profile-load behavior unchanged
 * @given: profileName set (not profileJson)
 * @when: applyBootstrapProfile() called
 * @then: Loads from file as before
 */
it('should maintain --profile-load behavior', () => {
  const args: BootstrapProfileArgs = {
    profileName: 'existing-profile',
    profileJson: null,
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  // This test assumes existing profile loading still works
  // May need to mock file system or use test fixture
  const result = applyBootstrapProfile(args);
  expect(result.providerName).toBeTruthy();
});

/**
 * @plan:PLAN-20251118-ISSUE533.P09
 * @requirement:REQ-INT-001.4
 * @scenario: Command-line only overrides still work
 * @given: No profile, only overrides
 * @when: applyBootstrapProfile() called
 * @then: Overrides applied as before
 */
it('should apply overrides without profile', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: null,
    providerOverride: 'openai',
    modelOverride: 'gpt-4',
    keyOverride: 'sk-test',
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  const result = applyBootstrapProfile(args);
  expect(result.providerName).toBe('openai');
  expect(result.modelName).toBe('gpt-4');
});
```

## Required Code Markers

Every test MUST include:
- `@plan:PLAN-20251118-ISSUE533.P09`
- `@requirement:REQ-XXX`
- `@scenario:`, `@given:`, `@when:`, `@then:`

## Verification Commands

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20251118-ISSUE533.P09" packages/cli/src/config/__tests__/profileBootstrap.test.ts | wc -l
# Expected: 12 occurrences

# Run phase-specific tests (should fail initially)
npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts -- --grep "@plan:.*P09"
# Expected: Tests exist but fail (applyBootstrapProfile not integrated yet)
```

## Success Criteria

- 12 tests created with proper markers
- Tests fail naturally (function doesn't handle profileJson yet)
- All tests have behavioral annotations
- No reverse testing

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P09.md`

```markdown
Phase: P09
Completed: [YYYY-MM-DD HH:MM]
Tests Created: 12
Test Categories:
  - Basic profile application: 4 tests
  - Override precedence: 4 tests
  - Validation errors: 2 tests
  - Backward compatibility: 2 tests
Verification:
  - Plan markers: 12 [OK]
  - Requirement markers: 12 [OK]
  - Behavioral annotations: 12 [OK]
  - Tests fail naturally: [OK]
```
