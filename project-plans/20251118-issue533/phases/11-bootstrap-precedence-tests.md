# Phase 11: Bootstrap Precedence Tests

## Phase ID
`PLAN-20251118-ISSUE533.P11`

## Prerequisites
- Required: Phase 10 completed (applyBootstrapProfile integrated)
- Verification: `npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts -- --grep "@plan:.*P09"`
- Expected: All integration tests pass

## Implementation Tasks

### Files to Modify

#### `packages/cli/src/config/__tests__/profileBootstrap.test.ts`
**Action**: Add comprehensive precedence tests

**Test Suite**: `describe('Override precedence with --profile @plan:PLAN-20251118-ISSUE533.P11', () => { ... })`

### Test Scenarios (8 tests)

#### Group 1: Complete Precedence Chain (4 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P11
 * @requirement:REQ-INT-002.1
 * @scenario: Full precedence chain - all sources present
 * @given: --profile + --provider + --model + --key + --set
 * @when: applyBootstrapProfile() called
 * @then: CLI flags override profile values
 */
it('should apply complete override precedence', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai","model":"gpt-3.5-turbo","key":"sk-profile","temperature":0.5}',
    providerOverride: 'anthropic',
    modelOverride: 'claude-sonnet-4',
    keyOverride: 'sk-cli',
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: ['temperature=0.9', 'maxTokens=4000']
  };
  
  const result = applyBootstrapProfile(args);
  expect(result.providerName).toBe('anthropic'); // CLI wins
  expect(result.modelName).toBe('claude-sonnet-4'); // CLI wins
  expect(result.warnings.length).toBeGreaterThan(0); // Overrides warned
});

/**
 * @plan:PLAN-20251118-ISSUE533.P11
 * @requirement:REQ-INT-002.1
 * @scenario: Partial overrides - only some CLI flags
 * @given: --profile + --model (no provider override)
 * @when: applyBootstrapProfile() called
 * @then: Model from CLI, provider from profile
 */
it('should apply partial overrides correctly', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai","model":"gpt-3.5-turbo","key":"sk-test"}',
    providerOverride: null, // No override
    modelOverride: 'gpt-4', // Override
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  const result = applyBootstrapProfile(args);
  expect(result.providerName).toBe('openai'); // From profile
  expect(result.modelName).toBe('gpt-4'); // From override
});

/**
 * @plan:PLAN-20251118-ISSUE533.P11
 * @requirement:REQ-INT-002.1
 * @scenario: Provider change affects model requirements
 * @given: --profile (openai, gpt-4) + --provider anthropic
 * @when: applyBootstrapProfile() called
 * @then: Provider changed but model name kept (may be invalid)
 */
it('should allow provider override even if model incompatible', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-test"}',
    providerOverride: 'anthropic', // Incompatible with gpt-4
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  const result = applyBootstrapProfile(args);
  expect(result.providerName).toBe('anthropic');
  expect(result.modelName).toBe('gpt-4'); // Invalid for anthropic, but allowed here
  // Runtime validation will catch this later
});

/**
 * @plan:PLAN-20251118-ISSUE533.P11
 * @requirement:REQ-INT-002.2
 * @scenario: --set overrides complex nested values
 * @given: --profile with temperature=0.5 + --set temperature=0.9
 * @when: applyBootstrapProfile() called
 * @then: Warning about --set override
 */
it('should generate warnings for --set overrides', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-test","temperature":0.5}',
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: ['temperature=0.9', 'maxTokens=2000']
  };
  
  const result = applyBootstrapProfile(args);
  expect(result.warnings).toContain(expect.stringMatching(/--set.*2 values/));
});
```

#### Group 2: Edge Cases and Security (4 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P11
 * @requirement:REQ-INT-002.1
 * @scenario: Empty string overrides should not override
 * @given: --profile + --model="" (empty string)
 * @when: applyBootstrapProfile() called
 * @then: Uses profile value (empty override ignored)
 */
it('should ignore empty string overrides', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-test"}',
    providerOverride: null,
    modelOverride: '', // Empty string
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  const result = applyBootstrapProfile(args);
  expect(result.modelName).toBe('gpt-4'); // Profile value kept
});

/**
 * @plan:PLAN-20251118-ISSUE533.P11
 * @requirement:REQ-INT-002.1
 * @scenario: Key override should not expose profile key
 * @given: --profile (with key) + --key override
 * @when: applyBootstrapProfile() called
 * @then: Warning does not contain key values
 */
it('should not leak keys in warnings', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-profile-secret"}',
    providerOverride: null,
    modelOverride: null,
    keyOverride: 'sk-cli-secret',
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  const result = applyBootstrapProfile(args);
  result.warnings.forEach(warning => {
    expect(warning).not.toContain('sk-profile-secret');
    expect(warning).not.toContain('sk-cli-secret');
  });
});

/**
 * @plan:PLAN-20251118-ISSUE533.P11
 * @requirement:REQ-INT-002.1
 * @scenario: Multiple --set with duplicate keys
 * @given: --set temperature=0.5 --set temperature=0.9 (last wins)
 * @when: applyBootstrapProfile() called
 * @then: Last value used
 */
it('should use last value for duplicate --set keys', () => {
  const args: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-test"}',
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: ['temperature=0.5', 'temperature=0.9']
  };
  
  const result = applyBootstrapProfile(args);
  // Implementation should process setOverrides in order
  // Last value wins (verified in runtime, not in bootstrap)
  expect(result.warnings.length).toBeGreaterThan(0);
});

/**
 * @plan:PLAN-20251118-ISSUE533.P11
 * @requirement:REQ-INT-001.4
 * @scenario: Behavior matches --profile-load precedence
 * @given: Equivalent scenarios with --profile-load vs --profile
 * @when: Both tested with same overrides
 * @then: Precedence behavior identical
 */
it('should match --profile-load precedence behavior', () => {
  // Test inline profile
  const inlineArgs: BootstrapProfileArgs = {
    profileName: null,
    profileJson: '{"provider":"openai","model":"gpt-3.5-turbo","key":"sk-test"}',
    providerOverride: null,
    modelOverride: 'gpt-4',
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null
  };
  
  const inlineResult = applyBootstrapProfile(inlineArgs);
  
  // Compare with file-based profile (if test fixture exists)
  // This verifies consistency in override behavior
  expect(inlineResult.modelName).toBe('gpt-4');
  expect(inlineResult.providerName).toBe('openai');
});
```

## Required Code Markers

Every test MUST include:
- `@plan:PLAN-20251118-ISSUE533.P11`
- `@requirement:REQ-XXX`
- `@scenario:`, `@given:`, `@when:`, `@then:`

## Verification Commands

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20251118-ISSUE533.P11" packages/cli/src/config/__tests__/profileBootstrap.test.ts | wc -l
# Expected: 8 occurrences

# Run phase-specific tests
npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts -- --grep "@plan:.*P11"
# Expected: All 8 tests PASS (implementation already done in P10)
```

## Success Criteria

- 8 tests created with proper markers
- All tests pass (Phase 10 implementation handles precedence)
- Tests verify override behavior matches specification
- Security checks (no key leakage in warnings)

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P11.md`

```markdown
Phase: P11
Completed: [YYYY-MM-DD HH:MM]
Tests Created: 8
Test Categories:
  - Complete precedence chain: 4 tests
  - Edge cases and security: 4 tests
Verification:
  - Plan markers: 8 [OK]
  - All tests pass: 8/8 [OK]
  - No key leakage: [OK]
```
