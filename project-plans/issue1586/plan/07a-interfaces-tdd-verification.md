# Phase 07a: Interfaces TDD Verification

Plan ID: PLAN-20260608-ISSUE1586.P07a

> **Filename matches content:** `07a-interfaces-tdd-verification.md` — interfaces phase

## Behavioral Verification
- [ ] Each DI interface has behavioral tests in `packages/auth/src/interfaces/__tests__/`
- [ ] Tests use real data flows (input → output) with local DI test doubles
- [ ] No mock theater patterns
- [ ] No reverse testing patterns
- [ ] No tests importing core implementations from auth package — core structural compatibility tested in core (`packages/core/src/__tests__/auth-interface-compat.test.ts`)
- [ ] All auth-package tests are package-local to `packages/auth` (no cross-package dependencies)

## ISecureStore Contract Verification
- [ ] ISecureStore tests cover get, set, delete, list, and has methods
- [ ] ISecureStoreError/SecureStoreErrorCode are tested in error-handling scenarios
- [ ] Error code matching tested (e.g., `error.code === 'CORRUPT'`)

## TDD Pass/Fail Verification
- [ ] Auth-package-local interface contract tests ALL PASS (use local DI test doubles — no external deps)
- [ ] Core structural compatibility tests (in `packages/core/src/__tests__/`) are expected to FAIL until P08 wires core→auth dependency (import resolution). These are **type-level structural compatibility checks only** — they verify that `SettingsService` structurally satisfies `ISettingsService` etc. via TypeScript structural typing. They do NOT construct auth instances or call factory functions. Factory functions (`createKeyringTokenStore`, `createAuthPrecedenceResolver`) are deferred to P17 because the classes they construct do not yet exist in `packages/auth`.
- [ ] Failure of core tests in P07 is natural (import resolution), not artificial

## Fraud Detection
```bash
mock_theater=$(grep -rn "toHaveBeenCalled\|toHaveBeenCalledWith" packages/auth/src/interfaces/__tests__ 2>/dev/null | grep -c . || true)
if [ "$mock_theater" -ne 0 ]; then
  echo "FAIL: mock theater patterns found ($mock_theater)"; exit 1
fi
reverse_test=$(grep -rn "toThrow('NotYetImplemented')\|expect.*not\.toThrow()" packages/auth/src/interfaces/__tests__ 2>/dev/null | grep -c . || true)
if [ "$reverse_test" -ne 0 ]; then
  echo "FAIL: reverse testing patterns found ($reverse_test)"; exit 1
fi
```
