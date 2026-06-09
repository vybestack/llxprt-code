# Phase 11a: Auth Move Implementation Verification

Plan ID: PLAN-20260608-ISSUE1586.P11a

## Verification Tasks
- [ ] All auth package tests pass
- [ ] No NotYetImplemented in production code
- [ ] No TODO/FIXME/HACK/STUB in implementation
- [ ] No forbidden auth imports (core, cli/root, providers, tools — full scan per anti-shim-policy)
- [ ] No relative import escape from packages/auth/src
- [ ] KeyringTokenStore accepts ISecureStore via constructor
- [ ] AuthPrecedenceResolver accepts ISettingsService + IProviderKeyStorage via constructor
- [ ] CodexDeviceFlow accepts optional IDebugLogger
- [ ] precedence.ts refactored: SettingsService type import replaced with ISettingsService; ProviderRuntimeContext type import replaced with IProviderRuntimeContext; debugLogger value import replaced with injected IDebugLogger boundary; no imports from `../settings/`, `../runtime/`, `../utils/`, or `../debug/` remain

## TDD Pass/Fail Verification
- [ ] ALL tests pass (stubs replaced with DI implementations)

## Full Forbidden Import Scan (per anti-shim-policy/integration-contract)
```bash
# Auth production code must not import from core, cli/root, providers, or tools
if rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code[^-]|@vybestack/llxprt-code-providers" packages/auth/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' 2>/dev/null; then
  echo "FAIL: forbidden imports in auth package production code"; exit 1
fi
```

## Deferred Implementation Detection
```bash
if grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/auth/src --include='*.ts' 2>/dev/null | grep -v '.test.ts' | grep -v '.spec.ts' | grep -q .; then
  echo "FAIL: deferred markers in auth production code"; exit 1
fi
if grep -rn -E "throw new Error\('Not" packages/auth/src --include='*.ts' 2>/dev/null | grep -v '.test.ts' | grep -v '.spec.ts' | grep -q .; then
  echo "FAIL: NotYetImplemented in auth production code"; exit 1
fi
```