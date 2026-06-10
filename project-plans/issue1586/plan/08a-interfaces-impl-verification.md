# Phase 08a: Interfaces Implementation Verification

Plan ID: PLAN-20260608-ISSUE1586.P08a

> **Filename matches content:** `08a-interfaces-impl-verification.md` — interfaces phase

## Verification Tasks
- [ ] All P07 auth-package-local tests pass (unchanged — they were already passing)
- [ ] Core structural compatibility tests (from P07) now pass (core→auth dependency established)
- [ ] No TODO/FIXME/HACK in implementation code
- [ ] `npm run typecheck` passes for core and auth
- [ ] No core imports in auth package production code
- [ ] No core implementation imports in auth package tests

**Note on factory functions:** Core DI factory functions (`createKeyringTokenStore`, `createAuthPrecedenceResolver`) are deferred to P17 because they construct `KeyringTokenStore` and `AuthPrecedenceResolver` classes that do not yet exist in `packages/auth`. P08a does NOT verify factory functions. P08a verifies only: (1) core→auth dependency wiring enables P07 core structural compatibility tests to pass at the type level, and (2) DI interfaces are exported from auth's index.ts. Factory function verification is in P17a.

## Core Structural Compatibility Tests
- [ ] Core's `SecureStore` satisfies `ISecureStore` (all 5 methods: get, set, delete, list, has)
- [ ] Core's `SettingsService` satisfies `ISettingsService`
- [ ] Core's `DebugLogger` satisfies `IDebugLogger`

## ISecureStore Full Contract Verification
- [ ] ISecureStore interface exported from auth includes get, set, delete, list, has
- [ ] ISecureStoreError interface exported from auth includes code, message, remediation
- [ ] SecureStoreErrorCode type exported from auth with all 6 codes
- [ ] Core's SecureStore satisfies full ISecureStore including list() and has()

## TDD Pass/Fail Verification
- [ ] ALL auth-package-local tests pass (already passing from P07)
- [ ] ALL core structural compatibility tests pass (now passing — P08 wired core→auth dependency, enabling type-level structural compatibility checks. These are type-level checks only, not runtime instantiation or factory function tests. Factory functions are deferred to P17.)
