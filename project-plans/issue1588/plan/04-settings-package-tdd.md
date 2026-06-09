# Phase 04: Settings Package Behavioral And Boundary Tests

## Phase ID

`PLAN-20260608-ISSUE1588.P04`

## Prerequisites

- Required: Phase 03a verified.

## Requirements Implemented (Expanded)

### REQ-SVC-001: SettingsService Behavior Preservation

**Full Text**: SettingsService must preserve provider/global reads and writes, provider switching, changed events, profile import/export, current profile handling, and clear behavior.

**Behavior**:

- GIVEN real settings data
- WHEN settings methods are exercised
- THEN values, events, and state transitions match current behavior

**Why This Matters**: The extracted package must be behaviorally identical.

### REQ-REG-001: Settings Registry Behavior Preservation

**Full Text**: Registry validation, normalization, parsing, aliases, completion options, protected keys, provider config keys, and direct setting specs must preserve behavior.

**Behavior**:

- GIVEN registry keys and values
- WHEN registry functions run
- THEN outputs match current behavior and compression strategy values remain valid

**Why This Matters**: Settings schema is the validation source of truth.

### REQ-PROF-001: Profile And Storage Behavior Preservation

**Full Text**: Profile JSON and storage path behavior must be preserved, including `save` and `load`.

**Behavior**:

- GIVEN temp profile files and settings services
- WHEN profile/storage APIs run
- THEN actual paths and JSON content match current behavior

**Why This Matters**: User profiles are persisted data.

## Implementation Tasks

### Files to Create/Modify

- SettingsService behavioral tests in `packages/settings`.
- Settings registry tests in `packages/settings`.
- ProfileManager and Storage tests in `packages/settings`.
- Runtime settings singleton isolation test in `packages/settings`.

Tests must use `@plan PLAN-20260608-ISSUE1588.P04` and requirement markers.

**Constraint**: Settings package tests MUST NOT import any consumer package (`@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code`, etc.) even as dev-only test fixtures. Integration tests that exercise cross-package consumption paths belong in P04b consumer-owned test directories, not here.

**Test ownership boundary**: Settings package tests verify ONLY settings-owned state: singleton registration, retrieval, and reset behavior for `getSettingsService`/`registerSettingsService`/`resetSettingsService`. They MUST NOT import or assert anything about core `ProviderRuntimeContext`. Assertions about context creation/clearing belong in core adapter tests (P06).

### Test Naming And Location Conventions

| Test Type | Location | Conventions |
|-----------|----------|-------------|
| SettingsService unit/behavioral | `packages/settings/src/__tests__/SettingsService.test.ts` | `.test.ts` extension, co-located `__tests__` directory |
| Registry tests | `packages/settings/src/__tests__/settingsRegistry.test.ts` | Same as above |
| ProfileManager tests | `packages/settings/src/profiles/__tests__/ProfileManager.test.ts` | Co-located with source in profiles subdirectory |
| Storage tests | `packages/settings/src/storage/__tests__/Storage.test.ts` | Co-located with source in storage subdirectory |
| Singleton helpers tests | `packages/settings/src/__tests__/settingsServiceInstance.test.ts` | Same as SettingsService — **tests ONLY settings-owned state (singleton get/register/reset), NOT core ProviderRuntimeContext** |

Test file naming follows the existing repo convention of `.test.ts` (or `.spec.ts` where the repo already uses that extension in the same package). Integration tests live in owning consumer packages per P04b location matrix.

## Verification Commands

```bash
# Run ALL settings package tests including nested subdirectories (profiles, storage)
npm run test --workspace @vybestack/llxprt-code-settings -- --run
rg -n "toThrow.*NotYetImplemented|not\.toThrow|toHaveBeenCalled" packages/settings --glob '*.test.ts'
# Must-be-zero scan (enforcing capture-and-check-empty)
FORBIDDEN_TEST_PATTERNS=$(rg -n "toThrow.*NotYetImplemented|not\.toThrow|toHaveBeenCalled" packages/settings --glob '*.test.ts' 2>/dev/null || true)
test -z "$FORBIDDEN_TEST_PATTERNS" && echo "OK: no forbidden test patterns" || { echo "FAIL: forbidden test patterns found:"; echo "$FORBIDDEN_TEST_PATTERNS"; exit 1; }
# Verify settings package tests do NOT import consumer packages (enforcing capture-and-check-empty)
SETTINGS_CONSUMER_IMPORTS=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings/src --glob '*.ts' --glob '*.tsx' 2>/dev/null || true)
test -z "$SETTINGS_CONSUMER_IMPORTS" && echo "OK: settings has no consumer imports" || { echo "FAIL: forbidden consumer imports in settings:"; echo "$SETTINGS_CONSUMER_IMPORTS"; exit 1; }
# Verify settings tests do NOT import or reference core ProviderRuntimeContext (enforcing)
SETTINGS_CTX_REFS=$(rg -n "ProviderRuntimeContext|providerRuntimeContext|getActiveProviderRuntimeContext|clearActiveProviderRuntimeContext" packages/settings/src --glob '*.ts' 2>/dev/null || true)
test -z "$SETTINGS_CTX_REFS" && echo "OK: settings does not reference core ProviderRuntimeContext" || { echo "FAIL: settings references core ProviderRuntimeContext:"; echo "$SETTINGS_CTX_REFS"; exit 1; }
```

### Red-Phase Capture-And-Assert Logic

Since P04 creates tests that must fail against incomplete stubs, verification MUST use capture-and-assert logic that exits 0 only when a valid TDD red state is confirmed:

```bash
# Run settings package tests and capture output
npm run test --workspace @vybestack/llxprt-code-settings -- --run 2>&1 | tee /tmp/p04-test-output.txt
P04_EXIT=${PIPESTATUS[0]:-0}
# 1. Verify no module resolution errors (exit 1 if found — indicates config/alias problems)
if grep -E "Cannot find module|Module not found|ERR_MODULE_NOT_FOUND" /tmp/p04-test-output.txt; then
  echo "FAIL: module resolution errors indicate setup problems"; exit 1
fi
# 2. Verify behavioral/stub failures ARE present (exit 1 if absent — test must exercise real behavior)
if ! grep -E "Expected.*Received|AssertionError|Error|throw|fail" /tmp/p04-test-output.txt; then
  echo "FAIL: no expected behavioral failure patterns found (tests may not be exercising behavior)"; exit 1
fi
# 3. Verify test runner exits nonzero (TDD red phase must fail)
if [ "$P04_EXIT" -eq 0 ]; then
  echo "FAIL: tests should fail against stubs (TDD red phase)"; exit 1
fi
echo "OK: P04 red-phase check passes (behavioral failures present, no module errors, nonzero exit)"
```

Expected: all tests (including nested `src/profiles/__tests__` and `src/storage/__tests__`) run and fail naturally before implementation if stubs are incomplete; no reverse tests or mock theater; settings package tests do not import consumer packages; settings package tests do not reference core ProviderRuntimeContext; red-phase capture-and-assert logic confirms valid TDD red state.

## Semantic Verification Checklist

- [ ] Tests assert values and state changes.
- [ ] Tests would fail if moved implementation is empty.
- [ ] Profile tests verify actual JSON/path behavior.
- [ ] Registry tests verify compression strategy values without importing core compression.
- [ ] Settings package tests do not import consumer packages (not even dev-only fixtures).
- [ ] Settings package tests do not import or reference core `ProviderRuntimeContext` (context assertions belong in core tests).

## Success Criteria

Behavioral tests are in place and fail for missing implementation, not missing test setup.

## Failure Recovery

Fix tests before P04a.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P04.md`.
