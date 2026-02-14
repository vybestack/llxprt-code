# Phase 11: Final Verification — Full Suite, Smoke Test, End-to-End

## Phase ID

`PLAN-20260213-KEYRINGTOKENSTORE.P11`

## Prerequisites

- Required: Phase 10 completed (MultiProviderTokenStore deleted, codebase clean)
- Verification: `grep -rn "MultiProviderTokenStore" packages/ --include="*.ts" | grep -v node_modules | grep -v project-plans | wc -l` returns 0
- Expected files from previous phase:
  - `packages/core/src/auth/token-store.ts` (interface only, ~90 lines)
  - All tests passing
  - Build succeeding
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### R15.2: Equivalent Coverage for Both Paths

**Full Text**: Both the keyring path and the fallback path shall have equivalent behavioral test coverage, exercised in separate CI jobs.
**Behavior**:
- GIVEN: Tests exist for both keyring-available and keyring-unavailable scenarios
- WHEN: The full test suite runs
- THEN: Both code paths are exercised and pass
**Why This Matters**: The fallback path must not be a second-class citizen.

### R16.2: No Old Plaintext File Reading

**Full Text**: No code shall read, migrate, or acknowledge the old `~/.llxprt/oauth/*.json` plaintext token files.
**Behavior**:
- GIVEN: Complete codebase scan
- WHEN: Searching for plaintext token file operations
- THEN: Zero results
**Why This Matters**: Final confirmation of clean cut.

### R16.3: --key Flag Unaffected

**Full Text**: The `--key` flag for API key authentication shall remain unaffected.
**Behavior**:
- GIVEN: API key authentication uses ProviderKeyStorage (separate from TokenStore)
- WHEN: --key flag is used
- THEN: Works exactly as before (no regression)
**Why This Matters**: API key auth must not be collateral damage from token store changes.

### R17.1: Equivalent Test Coverage

**Full Text**: All TokenStore interface behaviors shall have equivalent coverage in new tests.
**Behavior**:
- GIVEN: All tests from Phase 05 + Phase 08
- WHEN: Coverage is analyzed
- THEN: Every TokenStore method has behavioral tests
**Why This Matters**: No regression in test quality.

### R17.2: Multiprocess Race Conditions Tested

**Full Text**: Tested with spawned child processes.
**Behavior**:
- GIVEN: Integration tests include concurrent process tests
- WHEN: Tests run
- THEN: Lock contention scenarios are verified
**Why This Matters**: Real-world concurrency must be tested.

### R17.3: Full Lifecycle Works

**Full Text**: login → store → read → refresh → logout.
**Behavior**:
- GIVEN: Integration tests include lifecycle test
- WHEN: Full lifecycle is exercised
- THEN: Each step produces correct state
**Why This Matters**: End-to-end validation of the complete flow.

### R17.4: Multiple Providers Simultaneously

**Full Text**: e.g., anthropic + gemini each in keyring.
**Behavior**:
- GIVEN: Integration tests include multi-provider test
- WHEN: Multiple providers are used concurrently
- THEN: No cross-contamination
**Why This Matters**: Most users have multiple providers.

### R17.5–R17.8: End-to-End Flows

**Full Text**: /auth login stores, /auth status reads, refresh cycle works, CI exercises both paths.
**Behavior**:
- GIVEN: All wiring complete
- WHEN: Auth commands are exercised
- THEN: All flows work through KeyringTokenStore
**Why This Matters**: Final validation of user-facing behavior.

### R18.1–R18.9: End-to-End Verification Flows

**Full Text**: All end-to-end flows through KeyringTokenStore.
**Behavior**:
- GIVEN: Complete integration
- WHEN: Each flow is verified
- THEN: All pass
**Why This Matters**: Comprehensive final verification.

## Implementation Tasks

This phase produces one CI workflow change and then runs comprehensive verification.

### CI Dual-Mode Enforcement (R15.2, R17.8)

**File to modify**: `.github/workflows/ci.yml`

**Concrete change**: Add a `secure-store-mode` matrix dimension to the existing `test` job. The current CI workflow (`.github/workflows/ci.yml`) has a `test` job with matrix `os: [ubuntu-latest, macos-latest]` and `node-version: [24.x]`. The specific edits are:

**Step 1 — Add matrix dimension** in the `test` job's `strategy.matrix`:

```yaml
strategy:
  fail-fast: false
  matrix:
    os:
      - 'ubuntu-latest'
      - 'macos-latest'
    node-version:
      - '24.x'
    secure-store-mode:
      - 'keyring'
      - 'fallback'
```

**Step 2 — Update job display name** to include the secure-store mode:

```yaml
name: 'Test (${{ matrix.os }}, ${{ matrix.secure-store-mode }})'
```

**Step 3 — Wire environment variable** in the "Run tests and generate reports" step's `env` block. Add after the existing `VITEST_TEST_TIMEOUT` entry:

```yaml
env:
  # ... existing env vars (OPENAI_API_KEY, CI, VITEST_TEST_TIMEOUT, etc.) ...
  # Force SecureStore to use encrypted-file fallback instead of keyring (R15.2)
  LLXPRT_SECURE_STORE_FORCE_FALLBACK: ${{ matrix.secure-store-mode == 'fallback' && 'true' || '' }}
```

**Step 4 — Update artifact names** to avoid collisions. Any `upload-artifact` steps that use `${{ matrix.os }}` in their name must also include `${{ matrix.secure-store-mode }}`. For example:

```yaml
name: 'coverage-reports-${{ matrix.node-version }}-${{ matrix.os }}-${{ matrix.secure-store-mode }}'
```

Similarly update `test-results-fork-*` artifact names.

**Effect**: This produces 4 test runs (2 OS × 2 modes). The `fallback` runs set `LLXPRT_SECURE_STORE_FORCE_FALLBACK=true`, which the test setup in `keyring-token-store.test.ts` (see P05) reads to inject a `MODULE_NOT_FOUND`-throwing `keytarLoader` instead of a working one. The `keyring` runs leave the env var unset, so tests use the in-memory keyring adapter.

**Why here and not in an earlier phase**: The CI workflow change is a verification/infrastructure concern, not a feature implementation concern. It belongs in the final verification phase alongside the other CI-related checks. The test code itself that reads the env var is created in P05.

### Verification Steps

1. **Full Test Suite**
   ```bash
   npm test -- --run
   ```

2. **TypeScript Compilation**
   ```bash
   npm run typecheck
   ```

3. **Linting**
   ```bash
   npm run lint
   ```

4. **Formatting**
   ```bash
   npm run format
   ```

5. **Build**
   ```bash
   npm run build
   ```

6. **Smoke Test**
   ```bash
   node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
   ```

7. **Zero Legacy References**
   ```bash
   grep -rn "MultiProviderTokenStore" packages/ --include="*.ts" | grep -v node_modules | grep -v project-plans
   # Must return 0 results
   ```

8. **Zero Plaintext Token File Operations**
   ```bash
   grep -rn "\.llxprt/oauth.*\.json" packages/ --include="*.ts" | grep -v node_modules | grep -v project-plans | grep -v "locks/"
   # Must return 0 results
   ```

9. **KeyringTokenStore Tests Pass**
   ```bash
   npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.test.ts
   npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts
   ```

10. **All Plan Markers Present**
    ```bash
    grep -r "@plan:PLAN-20260213-KEYRINGTOKENSTORE" packages/ --include="*.ts" | wc -l
    # Should be 50+ across all phases
    ```

11. **All Requirement Markers Present**
    ```bash
    grep -r "@requirement" packages/core/src/auth/keyring-token-store.ts | wc -l
    # Should be 10+
    ```

12. **Verify Traceability**
    ```bash
    # Every requirement should have at least one test AND one implementation reference
    for req in R1.1 R1.2 R1.3 R2.1 R2.2 R2.3 R3.1 R3.3 R4.1 R4.3 R5.1 R6.1 R8.1 R9.1 R13.1 R13.2; do
      impl=$(grep -c "$req" packages/core/src/auth/keyring-token-store.ts 2>/dev/null)
      test=$(grep -c "$req" packages/core/src/auth/__tests__/keyring-token-store.test.ts 2>/dev/null)
      echo "$req: impl=$impl test=$test"
    done
    ```

13. **CI Dual-Mode Enforcement (R15.2, R17.8)**
    ```bash
    # 13a. Verify the CI workflow has the secure-store-mode matrix dimension
    grep -q "secure-store-mode" .github/workflows/ci.yml && echo "OK: matrix dimension exists" || echo "FAIL: missing secure-store-mode matrix"

    # 13b. Verify BOTH matrix values are present (keyring and fallback)
    grep -q "'keyring'" .github/workflows/ci.yml && echo "OK: keyring mode in matrix" || echo "FAIL: keyring mode missing"
    grep -q "'fallback'" .github/workflows/ci.yml && echo "OK: fallback mode in matrix" || echo "FAIL: fallback mode missing"

    # 13c. Verify the LLXPRT_SECURE_STORE_FORCE_FALLBACK env var is wired in CI
    grep -q "LLXPRT_SECURE_STORE_FORCE_FALLBACK" .github/workflows/ci.yml && echo "OK: env var wired in CI" || echo "FAIL: missing env var in CI"

    # 13d. Verify the test file reads the env var
    grep -q "LLXPRT_SECURE_STORE_FORCE_FALLBACK" packages/core/src/auth/__tests__/keyring-token-store.test.ts && echo "OK: test reads env var" || echo "FAIL: test does not read env var"

    # 13e. Verify the test job name includes secure-store-mode (to distinguish CI job logs)
    grep -q 'secure-store-mode' .github/workflows/ci.yml && echo "OK: job name includes mode" || echo "FAIL: job name missing mode"

    # 13f. Verify artifact names include secure-store-mode (to prevent upload collisions)
    grep "coverage-reports-" .github/workflows/ci.yml | grep -q "secure-store-mode" && echo "OK: artifact names include mode" || echo "FAIL: artifact names may collide"

    # 13g. Run tests locally in fallback mode to confirm they pass
    LLXPRT_SECURE_STORE_FORCE_FALLBACK=true npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.test.ts
    # Expected: All tests pass (using encrypted-file fallback)

    # 13h. Run tests locally in keyring mode to confirm they pass
    npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.test.ts
    # Expected: All tests pass (using in-memory keyring adapter)

    # 13i. Verify both modes produce identical test count (equivalent coverage)
    FALLBACK_COUNT=$(LLXPRT_SECURE_STORE_FORCE_FALLBACK=true npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.test.ts 2>&1 | grep -c "[OK]\|\|PASS\|FAIL")
    KEYRING_COUNT=$(npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.test.ts 2>&1 | grep -c "[OK]\|\|PASS\|FAIL")
    [ "$FALLBACK_COUNT" -eq "$KEYRING_COUNT" ] && echo "OK: equivalent test count ($FALLBACK_COUNT)" || echo "FAIL: test count mismatch (fallback=$FALLBACK_COUNT keyring=$KEYRING_COUNT)"
    ```

### Required Code Markers

No new code markers — this is a verification-only phase.

## Verification Commands

### Automated Checks (Structural)

```bash
# COMPREHENSIVE VERIFICATION SCRIPT
echo "=== 1. Full Test Suite ==="
npm test -- --run 2>&1 | tail -5

echo "=== 2. TypeScript Compilation ==="
npm run typecheck 2>&1 | tail -3

echo "=== 3. Lint ==="
npm run lint 2>&1 | tail -3

echo "=== 4. Format ==="
npm run format 2>&1 | tail -3

echo "=== 5. Build ==="
npm run build 2>&1 | tail -3

echo "=== 6. Zero Legacy References ==="
LEGACY_COUNT=$(grep -rn "MultiProviderTokenStore" packages/ --include="*.ts" | grep -v node_modules | grep -v project-plans | wc -l)
echo "MultiProviderTokenStore references: $LEGACY_COUNT"
[ "$LEGACY_COUNT" -ne 0 ] && echo "FAIL: Legacy references remain"

echo "=== 7. Zero Plaintext Token Ops ==="
PLAINTEXT_COUNT=$(grep -rn "\.llxprt/oauth.*\.json" packages/ --include="*.ts" | grep -v node_modules | grep -v project-plans | grep -v "locks/" | wc -l)
echo "Plaintext token file references: $PLAINTEXT_COUNT"
[ "$PLAINTEXT_COUNT" -ne 0 ] && echo "FAIL: Plaintext file operations remain"

echo "=== 8. KeyringTokenStore Tests ==="
npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.test.ts 2>&1 | tail -3
npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts 2>&1 | tail -3

echo "=== 9. Plan Markers ==="
MARKERS=$(grep -r "@plan:PLAN-20260213-KEYRINGTOKENSTORE" packages/ --include="*.ts" | wc -l)
echo "Plan markers found: $MARKERS"

echo "=== 10. Smoke Test ==="
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else" 2>&1 | tail -5
```

### Structural Verification Checklist

- [ ] Full test suite passes
- [ ] TypeScript compiles
- [ ] Lint passes
- [ ] Format is clean
- [ ] Build succeeds
- [ ] Smoke test works
- [ ] Zero MultiProviderTokenStore references
- [ ] Zero plaintext token file operations
- [ ] All plan markers present
- [ ] All requirement markers present
- [ ] Traceability: every requirement has impl + test
- [ ] CI workflow has `secure-store-mode` matrix dimension (R15.2, R17.8)
- [ ] `LLXPRT_SECURE_STORE_FORCE_FALLBACK` env var wired in CI workflow
- [ ] Tests pass locally in both keyring and fallback modes

### Deferred Implementation Detection (MANDATORY)

```bash
# Final scan of ALL new/modified files
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/auth/keyring-token-store.ts
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/auth/keyring-token-store.ts
# Expected: No matches

grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/auth/keyring-token-store.ts | grep -v "// R" | grep -v "degraded\|not found\|best-effort"
# Expected: Only legitimate null/[] returns (documented by requirement)
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the entire feature work end-to-end?**
   - [ ] Token save through KeyringTokenStore reaches SecureStore
   - [ ] Token read through KeyringTokenStore retrieves from SecureStore
   - [ ] Token delete through KeyringTokenStore removes from SecureStore
   - [ ] List operations enumerate providers and buckets correctly
   - [ ] Lock mechanism coordinates concurrent processes
   - [ ] Corrupt data is handled gracefully

2. **Is this REAL, not a facade?**
   - [ ] Smoke test actually starts the application
   - [ ] No errors related to token storage
   - [ ] Build artifacts include KeyringTokenStore

3. **Is the feature REACHABLE by users?**
   - [ ] /auth login → KeyringTokenStore.saveToken → SecureStore [OK]
   - [ ] /auth status → KeyringTokenStore.getToken/listProviders → SecureStore [OK]
   - [ ] /auth logout → KeyringTokenStore.removeToken → SecureStore [OK]
   - [ ] Background refresh → KeyringTokenStore.acquireRefreshLock → lock file [OK]

4. **Are there any gaps?**
   - [ ] R16.3: --key flag still works (API key path unaffected)
   - [ ] R15.1: Fallback path works (tested with unavailable keyring)
   - [ ] R14.1: Probe-once is satisfied by shared instance in runtimeContextFactory

5. **What's MISSING?**
   - [ ] Nothing — this is the final verification phase
   - [ ] (If anything is found, it must be fixed before marking complete)

#### Feature Actually Works

```bash
# Smoke test with actual CLI
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
# Expected: Completes successfully, no token-store errors
# Actual: [PASTE OUTPUT HERE]
```

#### Edge Cases Verified

- [ ] Empty token store (fresh install) → all operations work
- [ ] Multiple providers → independent storage
- [ ] Invalid provider name → clear error message
- [ ] Corrupt data in store → graceful null return with warning
- [ ] Lock contention → second process waits, then succeeds

## Success Criteria

- ALL verification steps pass
- Full test suite: 100% pass rate
- TypeScript: zero errors
- Lint: zero errors
- Build: succeeds
- Smoke test: runs without errors
- Zero legacy references
- Zero plaintext file operations
- All plan markers traceable
- All requirements traceable to impl + tests

## Failure Recovery

If this phase fails:

1. Identify the specific failure
2. Determine which phase introduced the issue
3. Revert to that phase and re-implement
4. Re-run Phase 11 verification

## Phase Completion Marker

Create: `project-plans/issue1351_1352/.completed/P11.md`
Contents:

```markdown
Phase: P11
Completed: YYYY-MM-DD HH:MM
Files Created: [none]
Files Modified: [none]
Tests Added: 0

## Final Verification Results
- Full Test Suite: [PASS/FAIL with count]
- TypeScript: [PASS/FAIL]
- Lint: [PASS/FAIL]
- Build: [PASS/FAIL]
- Smoke Test: [PASS/FAIL]
- Legacy References: [count — must be 0]
- Plaintext File Ops: [count — must be 0]
- Plan Markers: [count]
- Requirement Markers: [count]

## Holistic Assessment
[Written assessment of the complete feature]
```
