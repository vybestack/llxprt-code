# Phase 07: Interfaces TDD

Plan ID: PLAN-20260608-ISSUE1586.P07

> **Filename matches content:** `07-interfaces-tdd.md` — interfaces phase

## Prerequisites
- Required: Phase 06a completed
- Interface stubs exist in `packages/auth/src/interfaces/`

## Requirements Implemented

### REQ-INTF-001: DI Interfaces — Behavioral Tests

Write tests in two categories:
1. **Auth-package-local interface contract tests** — verify DI interfaces work with local DI test doubles.
2. **Core structural compatibility tests** — verify core implementations satisfy auth DI interfaces. These live in `packages/core/src/__tests__/`, NOT in `packages/auth/`.

## Test Migration Policy

Auth-package tests MUST use local DI test doubles only. Tests that import from `@vybestack/llxprt-code-core` or `@vybestack/llxprt-code-providers` are forbidden in `packages/auth`. Cross-package adapter/integration tests stay in the owning core/providers/cli packages. Enforcement scan:

```bash
if rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers" packages/auth/src --glob '*.test.ts' --glob '*.spec.ts' 2>/dev/null; then
  echo "FAIL: auth tests must not import core/providers"; exit 1
fi
```

## Implementation Tasks

### Files to Create — Auth-Package-Local Interface Contract Tests

These tests use local DI test doubles (in-memory implementations) to verify interface contracts. They do NOT import any core code.

- `packages/auth/src/interfaces/__tests__/secure-store.test.ts` — test ISecureStore contract with local in-memory double:
  - save → get round-trip
  - delete removes entry
  - list returns all stored keys
  - has returns boolean presence check
  - error handling when ISecureStore double throws ISecureStoreError
- `packages/auth/src/interfaces/__tests__/settings-service.test.ts` — test ISettingsService contract with local double
- `packages/auth/src/interfaces/__tests__/provider-key-storage.test.ts` — test IProviderKeyStorage contract with local double
- `packages/auth/src/interfaces/__tests__/debug-logger.test.ts` — test IDebugLogger contract with local double
- `packages/auth/src/interfaces/__tests__/runtime-context.test.ts` — test IProviderRuntimeContext contract with local double

### Files to Create — Core Structural Compatibility Tests (in core, NOT in auth)

These tests verify that core's concrete implementations satisfy auth DI interfaces. They live in `packages/core/src/__tests__/` because they import both core implementations and auth DI interfaces.

- `packages/core/src/__tests__/auth-interface-compat.test.ts` — compile-time + runtime structural compatibility tests:
  - Core `SecureStore` satisfies `ISecureStore` (get, set, delete, list, has)
  - Core `SettingsService` satisfies `ISettingsService`
  - Core `DebugLogger` satisfies `IDebugLogger`

**Note:** These core tests are created in P07 to establish the structural compatibility contract early. They are EXPECTED TO FAIL in P07 because core cannot import DI interface types from `@vybestack/llxprt-code-auth` until P08 wires the core→auth dependency (import resolution). They pass in P08 once the dependency is wired — these are compile-time type-level structural compatibility checks, not runtime instantiation tests. Core factory functions (`createKeyringTokenStore`, `createAuthPrecedenceResolver`) are deferred to P17 because the classes they construct do not yet exist in `packages/auth`. They live in core, not auth.

## Test Requirements
- Auth-package-local tests use local DI test doubles (in-memory implementations) — NOT core implementations.
- Test that a local DI test double for ISecureStore satisfies the full contract (save → get round-trip, delete, list, has, error handling with ISecureStoreError/SecureStoreErrorCode).
- Test that a local DI test double for ISettingsService provides correct return values.
- Test that an in-memory IDebugLogger implementation records log entries; assert on recorded message content (e.g., expect(logger.entries[0]).toEqual({level:'debug',message:'...'})).
- Test that in-memory/fake implementations satisfy interface shapes (TypeScript structural typing).
- NO reverse testing (e.g., no `expect().not.toThrow()`)
- NO mock theater (e.g., no `expect(mock.method).toHaveBeenCalled()`) — use in-memory/fake implementations with output assertions instead
- NO tests importing core implementations from auth package tests

## TDD Pass/Fail Expectation

### Auth-package-local tests (in packages/auth)
- **Expected: ALL PASS** — These tests use local DI test doubles that exist within the test files themselves. No external dependencies. No core factories needed. The interfaces are stubs but the test doubles implement the interface shape directly.

### Core structural compatibility tests (in packages/core)
- **Expected: FAIL (import resolution)** — These tests import auth DI interface types from `@vybestack/llxprt-code-auth` and check whether core implementations structurally satisfy them. Until P08 adds `@vybestack/llxprt-code-auth` as a dependency of core's package.json and configures the type path alias, the import statements in these tests will fail to resolve. P08 wires the core→auth dependency, which enables import resolution; after that, the type compatibility checks pass at compile time. These are **type-level structural compatibility checks only** — they verify that `SettingsService` structurally satisfies `ISettingsService` etc. via TypeScript structural typing. They do NOT construct auth instances or call factory functions. Core factory functions (`createKeyringTokenStore`, `createAuthPrecedenceResolver`) are deferred to P17 because the classes they construct (`KeyringTokenStore`, `AuthPrecedenceResolver`) do not yet exist in `packages/auth`.

## Verification Commands

```bash
# Auth-package-local tests — should all PASS
npm run test --workspace @vybestack/llxprt-code-auth

# Core structural compatibility tests — expected to FAIL until P08
npm run test --workspace @vybestack/llxprt-code-core -- src/__tests__/auth-interface-compat.test.ts
# Informational: expected to fail until P08 wires core factories
```
