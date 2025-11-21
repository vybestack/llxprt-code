# Phase 14: Regression Testing

## Phase ID
`PLAN-20251118-ISSUE533.P14`

## Prerequisites
- Required: Phase 13 completed (CLI integration working)
- Verification: All previous tests pass
- Expected: Existing functionality unchanged

## Testing Tasks

### Regression Test Suites to Run

#### 1. Existing Profile Tests

```bash
# Verify --profile-load still works
npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: All existing tests pass (not just P04-P11)
```

#### 2. Existing CLI Tests

```bash
# Verify other CLI flags work
npm test packages/cli/src/integration-tests/cli-args.integration.test.ts
# Expected: All existing tests pass
```

#### 3. Full Unit Test Suite

```bash
# Run all unit tests
npm test
# Expected: No failures
```

#### 4. Integration Test Suite

```bash
# Run full integration suite
npm run test:integration
# Expected: No failures
```

### Specific Regression Scenarios

#### Scenario 1: --profile-load Still Works

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P14
 * @requirement:REQ-INT-001.4
 * @scenario: Existing --profile-load behavior unchanged
 * @given: Profile file exists at ~/.llxprt/profiles/test.json
 * @when: llxprt --profile-load test --prompt "hi"
 * @then: Loads profile from file, no errors
 */
it('should maintain --profile-load functionality', async () => {
  // Use existing test fixtures
  const result = await runCLI(['--profile-load', 'test-profile', '--prompt', 'test', '--dry-run']);
  expect(result.exitCode).toBe(0);
});
```

#### Scenario 2: Override Flags Work Without Profiles

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P14
 * @requirement:REQ-INT-001.4
 * @scenario: CLI flags work without any profile
 * @given: No --profile or --profile-load
 * @when: llxprt --provider openai --model gpt-4 --key sk-test --prompt "hi"
 * @then: Works as before
 */
it('should work with override flags only', async () => {
  const result = await runCLI([
    '--provider', 'openai',
    '--model', 'gpt-4',
    '--key', 'sk-test',
    '--prompt', 'test',
    '--dry-run'
  ]);
  expect(result.exitCode).toBe(0);
});
```

#### Scenario 3: No Profile Source Works

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P14
 * @requirement:REQ-INT-001.4
 * @scenario: CLI works with no profile at all
 * @given: No profile flags, relies on defaults or config
 * @when: llxprt --prompt "hi"
 * @then: Uses default behavior (may fail if no default provider configured)
 */
it('should handle no profile gracefully', async () => {
  const result = await runCLI(['--prompt', 'test']);
  // May succeed or fail depending on default config, but should not crash
  expect([0, 1]).toContain(result.exitCode);
});
```

## Verification Commands

```bash
# 1. All unit tests pass
npm test
# Expected: 0 failures

# 2. All integration tests pass
npm run test:integration
# Expected: 0 failures

# 3. TypeScript compiles
npm run typecheck
# Expected: 0 errors

# 4. Build succeeds
npm run build
# Expected: Success

# 5. Linting passes
npm run lint
# Expected: No errors

# 6. Format check passes
npm run format
# Expected: No changes needed
```

## Success Criteria

- All existing tests still pass
- No new TypeScript errors
- No new linting errors
- Build completes successfully
- No unintended behavior changes
- Existing CLI workflows work unchanged

## Manual Testing Checklist

- [ ] --profile-load with real profile file: Works
- [ ] --provider --model --key flags without profile: Works
- [ ] Default profile loading (no flags): Works
- [ ] Help text includes both --profile and --profile-load: OK
- [ ] Error messages unchanged for existing scenarios: OK

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P14.md`

```markdown
Phase: P14
Completed: [YYYY-MM-DD HH:MM]
Regression Results:
  - Unit tests: PASS [OK]
  - Integration tests: PASS [OK]
  - TypeScript: 0 errors [OK]
  - Build: Success [OK]
  - Lint: PASS [OK]
  - Format: PASS [OK]
Backward Compatibility: VERIFIED
  - --profile-load: Working [OK]
  - Override flags: Working [OK]
  - No profile: Working [OK]
```
