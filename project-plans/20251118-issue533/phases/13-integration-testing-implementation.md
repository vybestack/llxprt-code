# Phase 13: CLI Integration Implementation

## Phase ID
`PLAN-20251118-ISSUE533.P13`

## Prerequisites
- Required: Phase 12 completed (10 integration tests written)
- Verification: Integration tests exist and fail naturally
- Expected: config.ts needs --profile flag added

## Implementation Tasks

### Files to Modify

#### 1. `packages/cli/src/config/config.ts`
**Action**: Add --profile flag to Yargs configuration

**Location**: In the Yargs options definition

```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P13
 * @requirement REQ-PROF-001.1
 */
.option('profile', {
  type: 'string',
  description: 'Inline profile configuration as JSON string (for CI/CD)',
  conflicts: 'profile-load', // Mutual exclusivity
  group: 'Profile:',
})
```

#### 2. `packages/cli/src/config/config.ts`
**Action**: Add environment variable support

```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P13
 * @requirement REQ-INT-003.2
 */
.env('LLXPRT') // Enables LLXPRT_PROFILE env var
```

#### 3. `packages/cli/src/gemini.tsx`
**Action**: Handle inline profile reapplication after initialization

**Location**: Post-initialization profile reapplication (around lines 395-421)

**Problem**: The current code attempts to reload the profile by name after initialization (lines 400-421). When a profile is provided via the --profile flag (inline JSON), there is no profile file to reload, causing "profile file not found" warnings. The profile has already been applied during bootstrap via Config.bootstrap() which calls prepareRuntimeForProfile().

**Solution**: Modify gemini.tsx to detect if the profile came from inline JSON (--profile flag or LLXPRT_PROFILE env var) and if so, skip the profile reload by name since:
1. The profile was already applied during bootstrap
2. There is no profile file to reload (it was inline JSON)

**Implementation**: Add check before the profile reapplication logic

```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P13
 * @requirement REQ-INT-003.3
 * Post-initialization profile handling for inline profiles
 * 
 * Skip profile reapplication for inline profiles since:
 * 1. They were already applied during Config.bootstrap()
 * 2. There is no profile file to reload (inline JSON)
 */
// Around line 395-421 in gemini.tsx
const bootstrapProfileName =
  argv.profileLoad !== undefined ? argv.profileLoad : process.env.LLXPRT_BOOTSTRAP_PROFILE?.trim() || '';
  
// Check if we have an inline profile (--profile flag or LLXPRT_PROFILE env var)
const hasInlineProfile = argv.profile !== undefined || process.env.LLXPRT_PROFILE !== undefined;

if (
  !argv.provider &&
  bootstrapProfileName !== '' &&
  !hasInlineProfile && // Skip reapplication for inline profiles - already applied in bootstrap
  runtimeSettingsService.getCurrentProfileName?.() !== null
) {
  try {
    await loadProfileByName(bootstrapProfileName, config, providerManager);
  } catch (error) {
    console.warn(`[cli] Warning: Failed to reapply profile "${bootstrapProfileName}":`, error);
  }
}
```

**Why this works**:
- When --profile is used, Config.bootstrap() calls parseInlineProfile() and prepareRuntimeForProfile(), applying all settings
- The profile reapplication logic (lines 400-421) is meant for --profile-load (load by name), not inline profiles
- By detecting hasInlineProfile, we prevent attempting to reload a non-existent profile file
- This maintains the correct precedence: CLI args > inline profile > environment variables

**Test Case**: Add to Phase 12 integration tests

```typescript
/**
 * @plan:PLAN-20251118-ISSUE533.P13
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

#### 4. Integration with Bootstrap

Ensure that the parsed --profile flag value is passed to `parseBootstrapArgs()`:

```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P13
 * @requirement REQ-INT-003.1
 */
// In the CLI initialization flow, the --profile value from Yargs
// should be available in process.argv and picked up by parseBootstrapArgs()
```

## Required Code Markers

All changes MUST include:
```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P13
 * @requirement REQ-XXX
 */
```

## Verification Commands

```bash
# 1. Verify --profile option added
grep -n "option('profile'" packages/cli/src/config/config.ts
# Expected: 1 match

# 2. Verify conflicts with profile-load
grep -A 3 "option('profile'" packages/cli/src/config/config.ts | grep conflicts
# Expected: Match

# 3. Run all Phase 12 integration tests
npm test packages/cli/src/integration-tests/cli-args.integration.test.ts -- --grep "@plan:.*P12"
# Expected: All 11 tests PASS

# 4. TypeScript compilation
npm run typecheck
# Expected: 0 errors

# 5. Full integration test suite
npm run test:integration
# Expected: All tests pass
```

## Success Criteria

- All 11 Phase 12 tests pass
- --profile flag appears in --help
- Mutual exclusivity enforced by Yargs
- Environment variable support working
- TypeScript compiles with no errors

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P13.md`

```markdown
Phase: P13
Completed: [YYYY-MM-DD HH:MM]
Files Modified:
  - packages/cli/src/config/config.ts (--profile option added)
  - packages/cli/src/gemini.tsx (inline profile reapplication handling)
Test Results:
  - Phase 12 tests: 11/11 PASS [OK]
  - Integration suite: PASS [OK]
  - TypeScript: 0 errors [OK]
```
