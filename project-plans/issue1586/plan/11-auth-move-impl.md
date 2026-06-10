# Phase 11: Auth Code Move Implementation

Plan ID: PLAN-20260608-ISSUE1586.P11

## Prerequisites
- Required: Phase 10a completed
- Behavioral tests written for DI-refactored components

## Phase Tasks

Replace stubs with DI-refactored implementations per pseudocode:

1. **KeyringTokenStore** (C-CB-07): Replace `../storage/secure-store.js` and `../debug/index.js` imports with ISecureStore + IDebugLogger injection via constructor options.
2. **AuthPrecedenceResolver** (C-CB-06): Replace `../settings/SettingsService.js`, `../runtime/providerRuntimeContext.js`, `../storage/provider-key-storage.js`, `../debug/index.js`, `../utils/debugLogger.js` with DI interface injection.
3. **CodexDeviceFlow** (C-CB-08): Replace `../debug/index.js` with optional IDebugLogger injection.
4. **precedence.ts**: Replace type-only import of `SettingsService` with `ISettingsService` interface reference; replace type-only import of `ProviderRuntimeContext` with `IProviderRuntimeContext` interface reference; replace value import of `debugLogger` from `../utils/debugLogger.js` with an injected `IDebugLogger` boundary (passed via function parameter, module-level setter, or refactored to avoid direct core dependency). After refactoring, `precedence.ts` has zero imports from core submodules (`../settings/`, `../runtime/`, `../utils/`, `../debug/`).

**Critical clarification on file responsibility:** `precedence.ts` contains low-level cache primitives and the `OAuthManager` interface. The `AuthPrecedenceResolver` class is NOT in `precedence.ts` — it is defined in `auth-precedence-resolver.ts` and only imported/re-exported from `precedence.ts` if needed. When refactoring, ensure the `AuthPrecedenceResolver` class remains in `auth-precedence-resolver.ts` (its canonical source file) and is exported from `packages/auth/src/index.ts` as a main-entry re-export. `precedence.ts` must NOT contain the class definition.

All other moved files already have no external dependencies beyond local imports and Node builtins.

## TDD Pass/Fail Expectation
- **Expected: ALL PASS** — All DI refactoring complete; NotYetImplemented stubs replaced; all tests should pass.

## Verification Commands

```bash
npm run test --workspace @vybestack/llxprt-code-auth
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run build --workspace @vybestack/llxprt-code-auth

# Verify no forbidden auth imports (core, cli/root, providers, tools — using shared verifier for canonical specifier parsing)
node project-plans/issue1586/scripts/verify-auth-extraction-gate.js

# Verify no relative import escape
if rg -n "from ['\"].*\.\./\.\./" packages/auth/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' 2>/dev/null; then
  echo "FAIL: relative import escape from auth"; exit 1
fi
```