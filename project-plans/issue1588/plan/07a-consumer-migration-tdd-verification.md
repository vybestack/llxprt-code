# Phase 07a: Consumer Migration TDD Verification (Including Provider/CLI Vertical-Slice Tests)

## Phase ID

`PLAN-20260608-ISSUE1588.P07a`

## Prerequisites

- Required: Phase 07 completed.

## Requirements Implemented (Expanded)

### REQ-TEST-001: Behavioral Refactoring Verification (Including Deferred P04b Slices)

**Full Text**: Integration tests must verify real package boundaries and key consumer flows before implementation changes. Provider/CLI vertical-slice tests are now in P07 scope.

**Behavior**:

- GIVEN P07 tests (including deferred provider/CLI vertical-slice integration tests)
- WHEN reviewer reads and runs them
- THEN tests would catch broken provider/CLI settings behavior after migration

**Why This Matters**: Consumer migration can compile while behavior regresses. Provider/CLI vertical-slice tests deferred from P04b must verify real cross-package paths.

## Implementation Tasks

No production implementation. Review P07 tests.

## Verification Commands

```bash
rg -n "@plan PLAN-20260608-ISSUE1588.P07|@requirement REQ-CONS-001|@requirement REQ-TEST-001" packages --glob '*.test.ts'
rg -n "toHaveBeenCalled|not\.toThrow|NotYetImplemented" packages/providers/src/__tests__/settings-integration packages/cli/src/__tests__/settings-integration --glob '*.test.ts'
# Verify provider/CLI integration tests exist (deferred from P04b)
test -f packages/providers/src/__tests__/settings-integration/provider-settings.integration.test.ts && echo "OK: provider vertical-slice exists" || echo "FAIL: missing provider vertical-slice"
test -f packages/cli/src/__tests__/settings-integration/profile-startup.integration.test.ts && echo "OK: CLI vertical-slice exists" || echo "FAIL: missing CLI vertical-slice"
# Verify expected-failure output for deferred tests
npm run test --workspace @vybestack/llxprt-code-providers -- --run src/__tests__/settings-integration 2>&1 | tee /tmp/p07a-provider-output.txt
npm run test --workspace @vybestack/llxprt-code -- --run src/__tests__/settings-integration 2>&1 | tee /tmp/p07a-cli-output.txt
grep -E "Cannot find module|Module not found|ERR_MODULE_NOT_FOUND" /tmp/p07a-provider-output.txt /tmp/p07a-cli-output.txt && echo "FAIL: module resolution errors" || echo "OK: no module resolution errors"
```

Expected: markers present; provider/CLI vertical-slice integration test files exist; no mock-theater patterns; failure output shows behavioral failures not module resolution errors.

## Semantic Verification Checklist

- [ ] Tests use real SettingsService where possible.
- [ ] Tests assert model/base URL/profile/storage outcomes.
- [ ] Tests are not structure-only.
- [ ] Test cleanup imports follow `analysis/call-site-migration-matrix.md` classifications.
- [ ] Tests that relied on `resetSettingsService()` clearing context now use explicit `clearActiveProviderRuntimeContext()` or `deactivateSettingsRuntimeContext()`.
- [ ] Provider vertical-slice test uses settings-only sentinel (no old core singleton).
- [ ] CLI vertical-slice test exercises in-package temp-filesystem profile load or documents limitation with static import guards.
- [ ] Each vertical-slice test names exact production entrypoint/import path.
- [ ] Expected-failure output confirms behavioral/stub failures, not module resolution errors.

## Success Criteria

P08 can implement consumer migration against behavioral tests including provider/CLI vertical-slice integration tests.

## Failure Recovery

Return to P07.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P07a.md`.
