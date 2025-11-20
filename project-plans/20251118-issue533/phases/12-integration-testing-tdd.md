# Phase 12: CLI Integration Tests (TDD)

## Phase ID
`PLAN-20251118-ISSUE533.P12`

## Prerequisites
- Required: Phase 11 completed (bootstrap integration working)
- Verification: All bootstrap tests pass
- Expected: --profile flag ready for end-to-end testing

## Implementation Tasks

### Files to Modify

#### `packages/cli/src/integration-tests/cli-args.integration.test.ts`
**Action**: Add integration tests for --profile flag end-to-end

**Test Suite**: `describe('--profile CLI integration @plan:PLAN-20251118-ISSUE533.P12', () => { ... })`

### Test Scenarios (11 tests)

#### Group 1: Basic CLI Integration (3 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P12
 * @requirement:REQ-INT-003.1
 * @scenario: CLI accepts --profile flag
 * @given: llxprt --profile '{"provider":"openai","model":"gpt-4","key":"sk-test"}' --prompt "test"
 * @when: CLI starts
 * @then: No parsing errors, profile applied
 */
it('should accept --profile flag', async () => {
  const profile = JSON.stringify({
    provider: 'openai',
    model: 'gpt-4',
    key: 'sk-test123'
  });
  
  // Mock or use test mode to avoid actual API calls
  const result = await runCLI(['--profile', profile, '--prompt', 'test', '--dry-run']);
  
  expect(result.exitCode).toBe(0);
  expect(result.stderr).not.toContain('error');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P12
 * @requirement:REQ-INT-003.1
 * @scenario: CLI with --profile and overrides
 * @given: --profile + --model override
 * @when: CLI starts
 * @then: Override applied, no errors
 */
it('should apply overrides with --profile', async () => {
  const profile = JSON.stringify({
    provider: 'openai',
    model: 'gpt-3.5-turbo',
    key: 'sk-test'
  });
  
  const result = await runCLI([
    '--profile', profile,
    '--model', 'gpt-4',
    '--prompt', 'test',
    '--dry-run'
  ]);
  
  expect(result.exitCode).toBe(0);
  // Verify model override was applied (check logs or config)
});

/**
 * @plan:PLAN-20251118-ISSUE533.P12
 * @requirement:REQ-INT-003.1
 * @scenario: CLI rejects invalid profile JSON
 * @given: --profile with malformed JSON
 * @when: CLI starts
 * @then: Error message displayed, exit code 1
 */
it('should reject invalid JSON in --profile', async () => {
  const result = await runCLI([
    '--profile', '{invalid json}',
    '--prompt', 'test'
  ]);
  
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('Invalid JSON');
});
```

#### Group 2: Mutual Exclusivity Enforcement (2 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P12
 * @requirement:REQ-INT-001.2
 * @scenario: CLI rejects both --profile and --profile-load
 * @given: --profile + --profile-load both specified
 * @when: CLI starts
 * @then: Error about mutual exclusivity, exit code 1
 */
it('should reject both --profile and --profile-load', async () => {
  const profile = JSON.stringify({
    provider: 'openai',
    model: 'gpt-4',
    key: 'sk-test'
  });
  
  const result = await runCLI([
    '--profile', profile,
    '--profile-load', 'my-profile',
    '--prompt', 'test'
  ]);
  
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('Cannot use both --profile and --profile-load');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P12
 * @requirement:REQ-INT-001.2
 * @scenario: Error message provides helpful guidance
 * @given: Both profile flags
 * @when: CLI starts
 * @then: Error suggests choosing one method
 */
it('should provide helpful mutual exclusivity error', async () => {
  const result = await runCLI([
    '--profile', '{}',
    '--profile-load', 'test'
  ]);
  
  expect(result.stderr).toContain('Choose one profile source');
  expect(result.stderr).toMatch(/--profile.*inline.*--profile-load.*saved/);
});
```

#### Group 3: Environment Integration (3 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P12
 * @requirement:REQ-INT-003.2
 * @scenario: Profile from environment variable
 * @given: LLXPRT_PROFILE env var set
 * @when: CLI starts without --profile
 * @then: Uses profile from env var
 */
it('should read profile from environment variable', async () => {
  const profile = JSON.stringify({
    provider: 'openai',
    model: 'gpt-4',
    key: 'sk-env-test'
  });
  
  const result = await runCLI(['--prompt', 'test', '--dry-run'], {
    env: { LLXPRT_PROFILE: profile }
  });
  
  expect(result.exitCode).toBe(0);
});

/**
 * @plan:PLAN-20251118-ISSUE533.P12
 * @requirement:REQ-INT-003.2
 * @scenario: CLI flag overrides environment variable
 * @given: LLXPRT_PROFILE set + --profile flag
 * @when: CLI starts
 * @then: Uses --profile flag (higher precedence)
 */
it('should prioritize --profile over environment', async () => {
  const envProfile = JSON.stringify({ provider: 'openai', model: 'gpt-3.5-turbo', key: 'sk-env' });
  const cliProfile = JSON.stringify({ provider: 'anthropic', model: 'claude-sonnet-4', key: 'sk-cli' });
  
  const result = await runCLI(['--profile', cliProfile, '--prompt', 'test', '--dry-run'], {
    env: { LLXPRT_PROFILE: envProfile }
  });
  
  expect(result.exitCode).toBe(0);
  // Verify anthropic was used (CLI flag wins)
});

/**
 * @plan:PLAN-20251118-ISSUE533.P12
 * @requirement:REQ-INT-003.2
 * @scenario: Invalid JSON in environment variable
 * @given: LLXPRT_PROFILE with invalid JSON
 * @when: CLI starts
 * @then: Error message, exit code 1
 */
it('should reject invalid JSON in environment variable', async () => {
  const result = await runCLI(['--prompt', 'test'], {
    env: { LLXPRT_PROFILE: '{invalid}' }
  });
  
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('Invalid JSON');
});
```

#### Group 4: Post-Initialization Profile Handling (1 test)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P12
 * @requirement:REQ-INT-003.3
 * @scenario: Inline profile does not trigger reapplication warning
 * @given: --profile with inline JSON
 * @when: CLI runs and completes
 * @then: No "Failed to reapply profile" warning appears
 */
it('should not warn about profile reapplication for inline profiles', async () => {
  const profile = JSON.stringify({
    provider: 'openai',
    model: 'gpt-4',
    key: 'sk-test'
  });
  
  const result = await runCLI([
    '--profile', profile,
    '--prompt', 'test',
    '--dry-run'
  ]);
  
  expect(result.stderr).not.toContain('Failed to reapply profile');
  expect(result.stderr).not.toContain('profile file not found');
});
```

#### Group 5: Security and Limits (2 tests)

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P12
 * @requirement:REQ-PROF-003.3
 * @scenario: CLI rejects profile exceeding size limit
 * @given: --profile with >10KB JSON
 * @when: CLI starts
 * @then: Error about size limit, exit code 1
 */
it('should reject oversized profile', async () => {
  const largeProfile = JSON.stringify({
    provider: 'openai',
    model: 'gpt-4',
    key: 'sk-test',
    data: 'x'.repeat(10241)
  });
  
  const result = await runCLI(['--profile', largeProfile, '--prompt', 'test']);
  
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('exceeds maximum size of 10KB');
});

/**
 * @plan:PLAN-20251118-ISSUE533.P12
 * @requirement:REQ-PROF-003.3
 * @scenario: CLI rejects profile with dangerous fields
 * @given: --profile with __proto__ field
 * @when: CLI starts
 * @then: Error about disallowed field, exit code 1
 */
it('should reject profile with dangerous fields', async () => {
  const maliciousProfile = JSON.stringify({
    provider: 'openai',
    model: 'gpt-4',
    key: 'sk-test',
    __proto__: { polluted: true }
  });
  
  const result = await runCLI(['--profile', maliciousProfile, '--prompt', 'test']);
  
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('Disallowed field');
});
```

## Required Code Markers

Every test MUST include:
- `@plan:PLAN-20251118-ISSUE533.P12`
- `@requirement:REQ-XXX`
- `@scenario:`, `@given:`, `@when:`, `@then:`

## Helper Function

```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P12
 * Helper to run CLI in test mode
 */
async function runCLI(args: string[], options?: { env?: Record<string, string> }): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  // Implementation: spawn CLI process with args, capture output
  // Use --dry-run or mock providers to avoid actual API calls
}
```

## Verification Commands

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20251118-ISSUE533.P12" packages/cli/src/integration-tests/cli-args.integration.test.ts | wc -l
# Expected: 11 occurrences

# Run phase-specific tests (should fail initially)
npm test packages/cli/src/integration-tests/cli-args.integration.test.ts -- --grep "@plan:.*P12"
# Expected: Tests exist but fail (CLI doesn't handle --profile yet)
```

## Success Criteria

- 11 integration tests created
- Tests have proper markers and annotations
- Tests fail naturally (CLI integration not complete)
- Helper function for running CLI exists

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P12.md`

```markdown
Phase: P12
Completed: [YYYY-MM-DD HH:MM]
Tests Created: 11
Test Categories:
  - Basic CLI integration: 3 tests
  - Mutual exclusivity: 2 tests
  - Environment integration: 3 tests
  - Post-initialization handling: 1 test
  - Security and limits: 2 tests
Verification:
  - Plan markers: 11 [OK]
  - Tests fail naturally: [OK]
```
