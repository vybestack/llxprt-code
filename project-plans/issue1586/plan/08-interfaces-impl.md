# Phase 08: Interfaces Implementation

Plan ID: PLAN-20260608-ISSUE1586.P08

> **Filename matches content:** `08-interfaces-impl.md` — interfaces phase

## Prerequisites
- Required: Phase 07a completed
- Auth-package-local interface contract tests all pass
- Core structural compatibility tests exist but fail (expected)

## Phase Tasks

This phase wires the core→auth dependency and ensures core structural compatibility tests pass. **Note:** Core DI factory functions (`createKeyringTokenStore`, `createAuthPrecedenceResolver`) are NOT created in P08. They are deferred to P17 because they construct `KeyringTokenStore` and `AuthPrecedenceResolver` classes that do not yet exist in `packages/auth`. P08 does NOT create factory functions — P08a does NOT verify factory functions. All factory function work is in P17/P17a.

1. P08 wires the core→auth dependency (adds `@vybestack/llxprt-code-auth` to core's package.json) and exports DI interfaces from auth's index.ts. This enables core's P07 structural compatibility tests to resolve their type imports and pass.
2. Core factory functions are scheduled in P17 (consumer migration implementation) after auth code is fully moved and DI-refactored in P11.

### Auth Package Export Updates

1. Export DI interfaces from `packages/auth/src/index.ts` (ISecureStore, ISecureStoreError, SecureStoreErrorCode, ISettingsService, IProviderKeyStorage, IDebugLogger, IProviderRuntimeContext).

### Core Dependency Wiring

2. Add `@vybestack/llxprt-code-auth` dependency to `packages/core/package.json` (already done in P03 scaffold, but verify wire is active).
3. Create a compile-safe stub or type-only re-export in core that will make the P07 core structural compatibility tests pass now that core→auth dependency exists.

### Core Structural Compatibility Tests

4. The core structural compatibility tests created in P07 (`packages/core/src/__tests__/auth-interface-compat.test.ts`) should now PASS because core can import DI interface types from `@vybestack/llxprt-code-auth`, enabling TypeScript structural compatibility checks between core implementations and auth DI interfaces.
5. Verify: Core's `SecureStore` satisfies `ISecureStore` (all 5 methods: get, set, delete, list, has) — compile-time type compatibility test.
6. Verify: Core's `SettingsService` satisfies `ISettingsService` — compile-time type compatibility test.
7. Verify: Core's `DebugLogger` satisfies `IDebugLogger` — compile-time type compatibility test.

**Note on P07/P08 pass/fail expectations:** P07 core structural compatibility tests are **type-level structural compatibility checks only** — they verify TypeScript structural typing (e.g., `SettingsService` satisfies `ISettingsService`), not runtime instantiation. P07 creates these tests, and they fail in P07 because core→auth dependency wiring hasn't happened yet (import resolution). P08 wires core→auth dependency, enabling imports to resolve, at which point the type compatibility tests pass. **Factory functions are NOT created in P08 and are NOT needed for these type-level checks.** Factory functions (`createKeyringTokenStore`, `createAuthPrecedenceResolver`) are deferred to P17 because they construct `KeyringTokenStore` and `AuthPrecedenceResolver` classes that do not yet exist in `packages/auth`.

### Files to Modify
- `packages/auth/src/index.ts` — export DI interfaces (ISecureStore, ISecureStoreError, SecureStoreErrorCode, ISettingsService, IProviderKeyStorage, IDebugLogger, IProviderRuntimeContext)

## TDD Pass/Fail Expectation
- **Auth-package-local tests: ALL PASS** (were already passing in P07 — no changes needed)
- **Core structural compatibility tests: ALL PASS** (P08 wires core→auth dependency, enabling DI interface type imports to resolve; structural type compatibility checks pass at compile time. These are type-level checks only — they do NOT construct auth instances. Factory functions are deferred to P17)

## Verification Commands

```bash
npm run test --workspace @vybestack/llxprt-code-auth
npm run test --workspace @vybestack/llxprt-code-core -- src/__tests__/auth-interface-compat.test.ts
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run typecheck --workspace @vybestack/llxprt-code-auth
# No core imports in auth package (using Node.js verifier for exact package-name checks)
node -e "
const fs = require('fs');
const { execSync } = require('child_process');
const forbidden = ['@vybestack/llxprt-code-core', '@vybestack/llxprt-code', '@vybestack/llxprt-code-providers'];
const srcDir = 'packages/auth/src';
function walk(dir) {
  const entries = fs.readdirSync(dir, {withFileTypes:true});
  let violations = [];
  for (const e of entries) {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) { violations = violations.concat(walk(p)); }
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.spec.ts')) {
      const content = fs.readFileSync(p, 'utf8');
      for (const pkg of forbidden) {
        if (content.includes(pkg)) { violations.push(p + ': ' + pkg); }
      }
    }
  }
  return violations;
}
const v = walk(srcDir);
if (v.length > 0) { console.error('FAIL: forbidden core imports in auth:'); v.forEach(l => console.error('  ' + l)); process.exit(1); }
console.log('OK: no forbidden core imports in auth');
"
# Verify factory function scheduling: auth-factories.ts MUST NOT exist yet (deferred to P17)
test -f packages/core/src/auth-factories.ts && { echo "FAIL: auth-factories.ts created in P08 — must be deferred to P17 since KeyringTokenStore/AuthPrecedenceResolver do not exist in auth yet"; exit 1; }
echo "OK: auth-factories.ts correctly deferred to P17"
```
