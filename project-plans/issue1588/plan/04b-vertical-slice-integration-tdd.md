# Phase 04b: Vertical-Slice Integration TDD (Core Only)

## Phase ID

`PLAN-20260608-ISSUE1588.P04b`

## Prerequisites

- Required: Phase 04a verified.
- Settings package stubs exist and compile (P03 requirement).
- Settings behavioral/unit tests exist (P04) but not yet implemented.
- **Core adapter module exists** (P03b provides `settingsRuntimeAdapter.ts` with transparent no-op stubs for `activateSettingsRuntimeContext`/`deactivateSettingsRuntimeContext`). The adapter is NOT wired to configConstructor yet — production wiring is deferred to P06.
- P04b tests exercise the adapter module **directly**, not through configConstructor.

## Requirements Implemented (Expanded)

### REQ-TEST-001: Behavioral Refactoring Verification (Integration-First, Core Slice)

**Full Text**: Integration tests must verify real package boundaries and key consumer flows BEFORE implementation changes. For multi-component features with 3+ components, integration tests must be written after stubs exist but before unit test/implement phases.

**Behavior**:

- GIVEN settings package stubs and core adapter module (transparent no-op stubs)
- WHEN vertical-slice integration tests are written
- THEN tests fail naturally against stubs/missing implementation and prove cross-package contracts

**Why This Matters**: The mandatory planning docs (PLAN.md) require integration tests before implementation for multi-component features.

## Sequencing Design Decision: Core-Only Vertical Slice In P04b

Provider and CLI vertical-slice integration tests are **deferred to P07** (consumer migration TDD). Only the core vertical-slice test is written in P04b. This resolves the sequencing inconsistency identified in review-05:

- **Core vertical-slice**: Can compile using P03b adapter module. The P04b test exercises `activateSettingsRuntimeContext`/`deactivateSettingsRuntimeContext` directly. The test asserts intended behavior: after activation, `getSettingsService()` returns the registered service; after deactivation, service is cleared. The P03b transparent no-op stub means activation/deactivation are no-ops, so the test should fail asserting that `getSettingsService()` returns the expected service.
- **Provider/CLI vertical-slices**: Require production consumer import migration (P08) to pass. If written in P04b and used as pass gates in P05a/P06a, they would block those phases before P08 can run. Moving them to P07 means they fail before P08 (as intended TDD behavior) and pass after P08 implementation.

**Timeline explicitly**:
| Phase | Core vertical-slice test | Provider/CLI vertical-slice tests |
|-------|--------------------------|----------------------------------|
| P04b  | Written, fails because adapter no-ops don't create context/register service | NOT WRITTEN YET |
| P05   | Settings package implemented | - |
| P05a  | P04b core test NOT rerun (adapter still no-op; deferred to P06a) | - |
| P06   | Core adapter fully implemented + configConstructor wired to call adapter | - |
| P06a  | Rerun P04b core test as pass gate (should pass — adapter implemented + configConstructor wired) | - |
| P07   | - | Written, fail before migration |
| P08   | - | Consumer migration implemented |
| P08a  | Rerun as pass gate (should still pass) | Rerun as pass gate (should pass) |

## Critical Design Decision: Integration Test Ownership

**Tests that exercise cross-package call paths from core/providers/CLI through the settings package must NOT live in `packages/settings`.** Placing consumer integration tests inside settings would create forbidden reverse dependencies (settings importing consumers for test wiring).

**Rule**: `packages/settings` tests may only test settings-owned behavior. Integration tests that exercise how core, providers, or CLI consume settings must live in the owning consumer package or in root integration tests.

### Test Location Matrix (P04b scope: core only)

| Vertical Slice | Test Location | Phase | Reason |
|---------------|---------------|-------|--------|
| Core adapter integration with settings package | `packages/core/src/__tests__/settings-integration/` | P04b | Core owns the adapter; adapter module exists in core so test compiles immediately |
| Provider consumes settings package API | `packages/providers/src/__tests__/settings-integration/` | P07 | Requires consumer import migration to pass; deferred to consumer migration TDD |
| CLI profile/startup exercises ProfileManager/Storage | `packages/cli/src/__tests__/settings-integration/` | P07 | Requires consumer import migration to pass; deferred to consumer migration TDD |
| Settings-owned behavior (service, registry, profiles, storage) | `packages/settings/src/__tests__/` | P04 | Settings package tests settings-only behavior |

### Settings Package Test Constraint

`packages/settings` tests MUST NOT import any consumer package (core, providers, CLI, tools, a2a-server) even as dev-only fixtures. Importing consumers for test wiring violates the dependency direction contract. If a settings test needs to verify consumer-visible behavior, that test belongs in the consuming package.

## Implementation Tasks

### Vertical Slice 1: Core Adapter Integration With Settings Package

- Integration test: `activateSettingsRuntimeContext` called with a settings service registers it via `registerSettingsService` and creates a runtime context; `deactivateSettingsRuntimeContext` clears the context and resets settings state.
- **P04b tests the adapter module directly**, NOT the configConstructor production path. configConstructor production wiring is a P06 task.
- **Production entrypoint exercised**: `activateSettingsRuntimeContext` from `packages/core/src/runtime/settingsRuntimeAdapter.ts` and `getSettingsService`/`registerSettingsService` from `@vybestack/llxprt-code-settings`.
- **Settings import exercised**: `SettingsService` from `@vybestack/llxprt-code-settings`, `activateSettingsRuntimeContext` from `packages/core/src/runtime/settingsRuntimeAdapter.ts`, `getSettingsService` from `@vybestack/llxprt-code-settings`.
- **Concrete behavior tested** (the adapter → settings-package contract):
  1. `activateSettingsRuntimeContext(s1)` is called with a concrete `SettingsService` instance.
  2. P03b stub is a no-op, so the test assertion `getSettingsService() === s1` fails (the service is not actually registered because the stub does nothing).
  3. When adapter is implemented (P06): activation creates `ProviderRuntimeContext`, sets it active, calls `registerSettingsService(s1)`, and `getSettingsService()` returns `s1`.
  4. `deactivateSettingsRuntimeContext()` clears context and resets. When implemented (P06), `getSettingsService()` throws or returns undefined after deactivation.
  5. `activateSettingsRuntimeContext(s2)` after `activateSettingsRuntimeContext(s1)` switches the active context to `s2`.
- **Tests assert intended behavior, NOT stub behavior**: Tests verify that `getSettingsService()` returns the registered service, that deactivation clears state, and that re-activation switches context. In P04b these assertions will fail because the adapter is a no-op stub. In P06 they will pass because the adapter implements real behavior.

### Expected-Failure Output Assertions

Since P04b tests are expected to fail against stubs, the plan must prove failures are **behavioral assertion failures** (the adapter no-op means settings service is not registered, so `getSettingsService()` does not return the expected service), **not** module resolution, path, or setup failures. Implementation must capture and inspect test output to verify:

```bash
# Run tests and capture output — use capture-and-assert logic that exits 0 only when red phase is valid
npm run test --workspace @vybestack/llxprt-code-core -- --run src/__tests__/settings-integration 2>&1 | tee /tmp/p04b-output.txt
TEST_EXIT=${PIPESTATUS[0]:-0}
# 1. Verify no module resolution errors (would indicate path/alias/config issues — exit 1 if found)
if grep -E "Cannot find module|Module not found|ERR_MODULE_NOT_FOUND|path.*not found" /tmp/p04b-output.txt; then
  echo "FAIL: module resolution errors indicate setup problems"; exit 1
fi
# 2. Verify behavioral assertion failures ARE present (expected TDD red phase — exit 1 if absent)
# Tests should fail because getSettingsService() does not return the expected service
# (adapter no-op means service is not registered). NOT because of NotYetImplemented.
if ! grep -E "Expected.*Received|AssertionError|fail|throw|TypeError|Error" /tmp/p04b-output.txt; then
  echo "FAIL: no expected behavioral failure patterns found (test may not be exercising production path)"; exit 1
fi
echo "OK: behavioral assertion failures present (expected TDD red)"
# 3. Verify test runner exits nonzero (tests fail as expected in red phase)
if [ "$TEST_EXIT" -eq 0 ]; then
  echo "FAIL: tests should fail against stubs (TDD red phase)"; exit 1
fi
echo "OK: tests fail as expected (TDD red phase, exit=$TEST_EXIT)"
```

**Key assertion**: Tests assert **intended behavior** (service registered, context created, state changed), not stub behavior. The red phase occurs because the transparent no-op stub does not implement that behavior. When P06 implements real behavior, the same tests pass. There is NO verification for `NotYetImplemented` in test output.

**Key assertion**: If module resolution errors appear, the P03b aliases or dependencies are misconfigured. Do NOT proceed to P05 — return to P03b.

### Files to Create

- `packages/core/src/__tests__/settings-integration/adapter-integration.test.ts`

Tests must use `@plan PLAN-20260608-ISSUE1588.P04b` and `@requirement REQ-TEST-001.2` markers.

**Important**: These integration tests must NOT be import-only tests. They must verify behavioral outcomes: activation registers the service and creates context, deactivation clears context and resets state, re-activation switches context. They should exercise cross-package call paths from the adapter through settings package stubs. **Each test must fail if the adapter does not implement real behavior** — not merely if a directly imported settings class is unimplemented. Tests verify the adapter→settings contract, not just that settings package exports exist.

**P04b integration design clarification**: P04b tests exercise the **adapter module directly**. The adapter module (`settingsRuntimeAdapter.ts`) exists in core with transparent no-op stubs. P04b tests import and call `activateSettingsRuntimeContext` and `deactivateSettingsRuntimeContext`, and assert that intended behavior occurs (service registered, context created, etc.). Since the P03b adapter is a no-op, these assertions will fail — this is the expected TDD red phase. P06 replaces the no-op with real implementation, and the same P04b tests pass without changes.

The configConstructor production call-site switch from `registerSettingsService()` to `activateSettingsRuntimeContext()` is a P06 task, NOT a P03b task.

## P04b Sequencing Clarification

### Resolution
P04b integration tests exercise the **adapter module directly**. P03b provides `settingsRuntimeAdapter.ts` with transparent no-op stubs (no production config wiring). The P04b test:

1. **Imports and calls `activateSettingsRuntimeContext` directly** — the adapter module entrypoint.
2. **Asserts intended behavior**: after activation, `getSettingsService()` returns the registered service; after deactivation, context is cleared.
3. **Fails against P03b no-op stub** because the stub does not register the service or create context — assertions about `getSettingsService()` returning the service fail.

Phase ownership:
- **P03b**: Creates adapter file with transparent no-op stubs. Does NOT wire configConstructor.
- **P04b**: Integration test exercises `activateSettingsRuntimeContext`/`deactivateSettingsRuntimeContext` directly. Asserts intended behavior. Fails because stub is no-op.
- **P05**: Settings package implementation makes settings stubs real.
- **P05a**: P04b core test NOT rerun (adapter still no-op; deferred to P06a).
- **P06**: Replaces adapter no-op stub with full behavioral implementation AND wires configConstructor to call `activateSettingsRuntimeContext()`. The same P04b test passes without changes.
- **P06a**: First pass gate for production configConstructor/runtime wiring. P04b core test should now pass.
- **P07**: Provider/CLI vertical-slice integration tests (deferred from P04b).
- **P08**: Consumer migration implementation.

This ensures P04b tests intended behavior through the adapter module. When P06 implements real behavior, the same tests pass.

## Verification Commands

```bash
npm run typecheck
# Run core integration test using workspace-relative path
npm run test --workspace @vybestack/llxprt-code-core -- --run src/__tests__/settings-integration
# Capture and inspect failure output — use capture-and-assert logic that exits 0 only when red phase is valid
npm run test --workspace @vybestack/llxprt-code-core -- --run src/__tests__/settings-integration 2>&1 | tee /tmp/p04b-output.txt
TEST_EXIT=${PIPESTATUS[0]:-0}
# 1. Verify no module resolution errors (exit 1 if found)
if grep -E "Cannot find module|Module not found|ERR_MODULE_NOT_FOUND" /tmp/p04b-output.txt; then
  echo "FAIL: module resolution errors indicate setup problems"; exit 1
fi
# 2. Verify behavioral assertion failures ARE present (tests assert intended behavior, fail because stub is no-op)
if ! grep -E "Expected.*Received|AssertionError|Error|fail" /tmp/p04b-output.txt; then
  echo "FAIL: no expected behavioral failure patterns found (test may not be exercising production path)"; exit 1
fi
# 3. Verify test runner exits nonzero (TDD red phase must fail)
if [ "$TEST_EXIT" -eq 0 ]; then
  echo "FAIL: tests should fail against stubs (TDD red phase)"; exit 1
fi
echo "OK: expected-failure check passes (behavioral assertion failures present, no module errors, nonzero exit)"
# Check that settings package has NO consumer imports (not even dev-only)
SETTINGS_CONSUMER_IMPORTS=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings/src --glob '*.ts' 2>/dev/null || true)
test -z "$SETTINGS_CONSUMER_IMPORTS" && echo "OK: settings has no consumer imports" || { echo "FAIL: forbidden consumer imports in settings:"; echo "$SETTINGS_CONSUMER_IMPORTS"; exit 1; }
rg -n "@plan PLAN-20260608-ISSUE1588.P04b|@requirement REQ-TEST-001" packages/core/src/__tests__/settings-integration --glob '*.test.ts'
```

Expected: typecheck passes; core integration test file exists with behavioral assertions; settings package has zero consumer imports; test fails naturally against no-op stubs (assertion failures, not NotYetImplemented); failure output shows behavioral assertion failures (Expected/Received mismatches), NOT module resolution errors and NOT NotYetImplemented errors.

## Semantic Verification Checklist

- [ ] Core integration test exercises the adapter module directly (`activateSettingsRuntimeContext`/`deactivateSettingsRuntimeContext`).
- [ ] Core integration test asserts **intended behavior** (service registered, context created, state changed), NOT stub behavior (NotYetImplemented).
- [ ] Core integration test would fail if adapter implementation is missing (no-op stub does not register service or create context).
- [ ] Core integration test is not mock theater — it asserts values and state changes, not mock invocations.
- [ ] Core integration test file exists at `packages/core/src/__tests__/settings-integration/adapter-integration.test.ts`.
- [ ] Integration test commands use workspace-relative paths (not package-cwd-absolute paths).
- [ ] Tests use `.test.ts` or `.spec.ts` extension consistent with existing repo.
- [ ] NO integration tests exist inside `packages/settings/src/__tests__/integration` that import consumer packages.
- [ ] Settings package tests do not import core, providers, CLI, or tools (not even as dev fixtures).
- [ ] Provider/CLI vertical-slice integration tests are NOT created in P04b (deferred to P07).
- [ ] Expected-failure verification uses capture-and-assert logic: exits 0 only when nonzero exit, behavioral assert failures present, and no module resolution errors. Does NOT grep for `NotYetImplemented`.
- [ ] configConstructor is NOT modified in P03b. Production call-site switch is a P06 task.

## Success Criteria

Core vertical-slice integration test exists in `packages/core` and fails against no-op stubs with behavioral assertion failures. P05 implements settings package knowing the core cross-package contract is tested. Settings package test suite remains consumer-import-free. Provider/CLI integration tests are correctly deferred to P07.

## Failure Recovery

Fix tests before P04b verification. Do not proceed to P05 without the core integration test. Do NOT move consumer tests into settings package to work around compilation issues.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P04b.md`.