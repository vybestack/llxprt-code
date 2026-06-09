# Phase 10a: Auth Move TDD Verification

Plan ID: PLAN-20260608-ISSUE1586.P10a

## Verification Tasks
- [ ] KeyringTokenStore DI test exists with in-memory ISecureStore test double; assertions on stored/retrieved data, not on mock call counts
- [ ] AuthPrecedenceResolver DI test exists with in-memory ISettingsService test double; assertions on resolution results, not on mock call counts
- [ ] CodexDeviceFlow DI test exists with optional IDebugLogger; assertions on returned data, not on logger mock calls
- [ ] ProxyTokenStore/ProxyProviderKeyStorage tests exist
- [ ] No mock theater in P10-added DI test files (no `.toHaveBeenCalled` assertions in `*.di.test.ts` or `public-exports.test.ts`)
- [ ] No reverse testing (no assertions on NotYetImplemented error messages; constructor guard tests assert on observable DI behavior — throw on incomplete wiring + working operations with proper DI)
- [ ] Pre-existing moved-as-is legacy tests (P09) may contain toHaveBeenCalled* — scoped to P10-added files only

## Phase Scope Clarification
- Production files (`keyring-token-store.ts`, `auth-precedence-resolver.ts`, `flows/codex-device-flow.ts`) contain full runtime implementations moved from core in P09. P10 did NOT add or modify production code.
- P10 scope is strictly test-only: 4 new behavioral DI test files, 74 tests total.
- The no-mock-theater rule applies to new P10 DI tests only; moved-as-is legacy tests are out of scope for P10 modification.

## TDD Pass/Fail Verification
- [ ] Moved-as-is tests PASS (types, token-merge, token-sanitization, proxy files, oauth-errors, device flows)
- [ ] P10 DI behavioral tests PASS (production runtime code was moved with full implementations in P09, so DI tests pass against real implementations, not stubs)
- [ ] No assertions on NotYetImplemented/stub error messages in P10 DI tests