# Phase 04c Verification: Vertical-Slice Integration TDD (Core Only)

## Phase ID

`PLAN-20260608-ISSUE1588.P04c` (verified correct: P04b suffix is "a" for verification sub-phase)

## Prerequisites

- Required: Phase 04b completed.

## Requirements Implemented (Expanded)

### REQ-TEST-001: Behavioral Refactoring Verification (Core Slice)

**Full Text**: Integration tests must verify real package boundaries and key consumer flows before implementation changes.

**Behavior**:

- GIVEN P04b core integration test
- WHEN reviewer reads and runs it
- THEN the test proves the core→settings cross-package contract and would catch broken core behavior after migration

**Why This Matters**: Integration-first testing is mandatory for multi-component features per PLAN.md. Core vertical-slice test is in P04b; provider/CLI vertical-slice tests are deferred to P07.

## Implementation Tasks

No production implementation. Review P04b core integration test.

## Verification Commands

```bash
# Verify core integration test exists (P04b scope: core only)
rg -n "@plan PLAN-20260608-ISSUE1588.P04b|@requirement REQ-TEST-001" packages/core/src/__tests__/settings-integration --glob '*.test.ts'
# Verify provider/CLI integration tests do NOT exist yet (deferred to P07)
test ! -d packages/providers/src/__tests__/settings-integration && echo "OK: provider integration tests not in P04b" || echo "WARN: provider integration tests found in P04b scope"
test ! -d packages/cli/src/__tests__/settings-integration && echo "OK: CLI integration tests not in P04b" || echo "WARN: CLI integration tests found in P04b scope"
# Verify expected-failure output inspection
npm run test --workspace @vybestack/llxprt-code-core -- --run src/__tests__/settings-integration 2>&1 | tee /tmp/p04b-verify-output.txt
grep -E "Cannot find module|Module not found|ERR_MODULE_NOT_FOUND" /tmp/p04b-verify-output.txt && echo "FAIL: module resolution errors" || echo "OK: no module resolution errors"
grep -E "NotYetImplemented|stub|Expected.*Received|AssertionError|settings" /tmp/p04b-verify-output.txt && echo "OK: behavioral failures present (expected TDD red)" || echo "WARN: no expected behavioral failure patterns found"
# Verify NO consumer imports in settings package tests
# Verify NO consumer imports in settings package tests (enforcing: must return zero)
SETTINGS_CONSUMER_IMPORTS=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code" packages/settings/src --glob '*.ts' --glob '*.tsx' 2>/dev/null || true)
test -z "$SETTINGS_CONSUMER_IMPORTS" && echo "OK: settings has no consumer imports" || { echo "FAIL: forbidden consumer imports in settings:"; echo "$SETTINGS_CONSUMER_IMPORTS"; exit 1; }
# Verify no mock-theater or reverse-testing patterns
rg -n "toHaveBeenCalled|not\.toThrow|NotYetImplemented" packages/core/src/__tests__/settings-integration --glob '*.test.ts'
# Verify test commands use workspace-relative paths
rg -n "^npm run test.*--workspace.*-- --run packages/" project-plans/issue1588/plan/04b*.md && echo "FAIL: root-absolute path found" || echo "OK: no root-absolute paths"
npm run typecheck
```

Expected: core integration test exists with markers; provider/CLI integration test directories do NOT exist in P04b scope; failure output shows behavioral failures not module resolution errors; no consumer imports in settings package; no mock-theater; typecheck passes; no root-absolute test command paths.

## Semantic Verification Checklist

- [ ] Core integration test exercises real cross-package call paths.
- [ ] Core integration test asserts behavioral outcomes (values, state changes).
- [ ] Core integration test fails naturally when stubs are not implemented.
- [ ] Core integration test names the exact production entrypoint/function/class and import path being exercised.
- [ ] Core integration test would fail if production consumer wiring is absent (not just if settings package is missing).
- [ ] Provider/CLI vertical-slice integration tests do NOT exist yet (deferred to P07).
- [ ] Integration test commands use workspace-relative paths (not root-absolute `packages/...` paths from workspace cwd).
- [ ] Test file naming uses `.test.ts` or `.spec.ts` consistent with repo.
- [ ] **No integration tests in `packages/settings` import consumer packages.**
- [ ] **Settings package tests are limited to settings-owned behavior only.**
- [ ] Expected-failure output inspection confirms behavioral/stub failures, not module resolution errors.

## Success Criteria

P05 can implement settings package with the core cross-package contract tested. Settings package test suite is consumer-import-free. Provider/CLI integration tests are correctly deferred to P07.

## Failure Recovery

Return to P04b.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P04c.md`.