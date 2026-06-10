# Phase 06: Interfaces Stub

Plan ID: PLAN-20260608-ISSUE1586.P06

> **Filename matches content:** `06-interfaces-stub.md` — interfaces phase

## Prerequisites
- Required: Phase 05a completed
- packages/auth scaffold exists and builds

## Requirements Implemented

### REQ-INTF-001.1: ISecureStore Interface
**Full Text**: `packages/auth` MUST define `ISecureStore` interface for token persistence.
**Behavior**: GIVEN KeyringTokenStore needs persistent storage, WHEN constructed with ISecureStore, THEN save/get/delete/list/has operations delegate to the injected implementation.
**Methods**: `get(key: string): Promise<string | null>`, `set(key: string, value: string): Promise<void>`, `delete(key: string): Promise<boolean>`, `list(): Promise<string[]>`, `has(key: string): Promise<boolean>`.
**Evidence**: `keyring-token-store.ts` uses `secureStore.set()` (L330), `secureStore.get()` (L347), `secureStore.delete()` (L395), `secureStore.list()` (L414, L437). Core's `SecureStore` also has `has()` (L657). Error handling catches `SecureStoreError` with `error.code` (L349).

### REQ-INTF-001.2: ISettingsService Interface
**Full Text**: `packages/auth` MUST define `ISettingsService` interface for settings access.
**Behavior**: GIVEN AuthPrecedenceResolver needs provider settings, WHEN constructed with ISettingsService, THEN settings lookups delegate to injected implementation.

### REQ-INTF-001.3: IProviderKeyStorage Interface
**Full Text**: `packages/auth` MUST define `IProviderKeyStorage` interface for provider key access.
**Behavior**: GIVEN AuthPrecedenceResolver needs provider key storage, WHEN constructed with IProviderKeyStorage, THEN key lookups delegate to the injected implementation.
**Note (Blocker 4):** `IProviderKeyStorage` is an **instance contract** defining the shape of a provider key storage object (`getKey`, `listKeys`, `hasKey`). The core function `getProviderKeyStorage()` is a **factory/injection concern** that returns an object satisfying this interface — it stays in core, the interface lives in auth. Auth's `AuthPrecedenceResolver` constructor accepts an `IProviderKeyStorage` instance; core's DI factory (`createAuthPrecedenceResolver` in `auth-factories.ts`) calls `getProviderKeyStorage()` to produce and inject that instance.

### REQ-INTF-001.4: IDebugLogger Interface
**Full Text**: `packages/auth` MUST define `IDebugLogger` interface for logging.
**Behavior**: GIVEN auth components need debug/error/warn logging, WHEN constructed with IDebugLogger, THEN log messages delegate to the injected implementation.
**Note (Blocker 5):** The `IDebugLogger` contract MUST be defined from actual auth code usage found by P00a preflight grep, not from assumptions. The `IDebugLogger` instance contract defines `debug`, `error`, `warn`. The `debugLogger` export from `../utils/debugLogger.js` (module-level singleton) and `DebugLogger` class from `../debug/index.js` (constructor) are core-level factory concerns — auth receives an `IDebugLogger` instance via DI injection, not the factory. The IDebugLogger interface method shape is derived from preflight evidence (see P00a IDebugLogger Contract Preflight Check).

### REQ-INTF-001.5: IProviderRuntimeContext Interface
**Full Text**: `packages/auth` MUST define `IProviderRuntimeContext` interface for runtime context.

## Implementation Tasks

### Files to Create (in packages/auth/src/interfaces/)
- `packages/auth/src/interfaces/secure-store.ts` — ISecureStore (get, set, delete, list, has), ISecureStoreError, SecureStoreErrorCode
  - MUST include: `@plan:PLAN-20260608-ISSUE1586.P06`
  - MUST include: `@requirement:REQ-INTF-001.1`
- `packages/auth/src/interfaces/settings-service.ts` — ISettingsService
- `packages/auth/src/interfaces/provider-key-storage.ts` — IProviderKeyStorage
- `packages/auth/src/interfaces/debug-logger.ts` — IDebugLogger
- `packages/auth/src/interfaces/runtime-context.ts` — IProviderRuntimeContext
- `packages/auth/src/interfaces/index.ts` — re-exports

**Note:** These files are created IN the auth package (not in core) because auth owns the interfaces it needs. Core implements them.

## Verification Commands

```bash
# Check plan markers
if rg -n "@plan:PLAN-20260608-ISSUE1586.P06" packages/auth/src/interfaces 2>/dev/null | grep -c . | grep -qv '^0$'; then
  echo "OK: plan markers found"
else
  echo "FAIL: no plan markers found"; exit 1
fi

# Check requirement markers
if rg -n "@requirement:REQ-INTF-" packages/auth/src/interfaces 2>/dev/null | grep -c . | grep -qv '^0$'; then
  echo "OK: requirement markers found"
else
  echo "FAIL: no requirement markers found"; exit 1
fi

# Compile-time type test
npm run typecheck --workspace @vybestack/llxprt-code-auth

# No core imports in auth production code
if rg -n "@vybestack/llxprt-code-core" packages/auth/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' 2>/dev/null; then
  echo "FAIL: forbidden core imports in auth"; exit 1
fi

# No relative import escape from auth/src
if rg -n "from ['\"].*\.\./\.\./" packages/auth/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' 2>/dev/null; then
  echo "FAIL: relative import escape from auth/src"; exit 1
fi
```