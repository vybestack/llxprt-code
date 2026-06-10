# Phase 09: Auth Code Move Stubs

Plan ID: PLAN-20260608-ISSUE1586.P09

## Prerequisites
- Required: Phase 08a completed
- DI interfaces defined and verified, package scaffold builds

## Requirements Implemented

### REQ-AUTH-001.1: All auth production code moves to packages/auth
### REQ-PROXY-001.1: Core proxy infrastructure moves to packages/auth/src/proxy/

## Phase Tasks

This phase is stub/move scaffolding only. No new behavioral tests are created in P09. All 20 existing test files are relocated to `packages/auth` (7 after DI refactoring, 13 as-is). The test refactoring (DI double creation) is part of the move itself, not TDD. P10 creates or adapts behavioral tests with precise expected pass/fail criteria.

1. Move `types.ts` → `packages/auth/src/types.ts` (update internal imports only)
2. Move `token-store.ts` → `packages/auth/src/token-store.ts`
3. Move `oauth-errors.ts` → `packages/auth/src/oauth-errors.ts`
4. Move `token-merge.ts` → `packages/auth/src/token-merge.ts`
5. Move `token-sanitization.ts` → `packages/auth/src/token-sanitization.ts`
6. Stub `keyring-token-store.ts` → `packages/auth/src/keyring-token-store.ts` (constructor throws NotYetImplemented until DI wired)
7. Stub `precedence.ts` → `packages/auth/src/precedence.ts` (core imports must be replaced: `SettingsService` type import → `ISettingsService`, `ProviderRuntimeContext` type import → `IProviderRuntimeContext`, `debugLogger` value import → injected `IDebugLogger` boundary). The stub preserves structure but replaces core imports with auth-owned interfaces.
8. Stub `auth-precedence-resolver.ts` → `packages/auth/src/auth-precedence-resolver.ts` (DI not yet wired)
9. Move `anthropic-device-flow.ts` → `packages/auth/src/flows/anthropic-device-flow.ts`
10. Stub `codex-device-flow.ts` → `packages/auth/src/flows/codex-device-flow.ts` (DebugLogger→IDebugLogger not wired)
11. Move `qwen-device-flow.ts` → `packages/auth/src/flows/qwen-device-flow.ts`
12. Move proxy files → `packages/auth/src/proxy/` (framing, proxy-socket-client, proxy-token-store, proxy-provider-key-storage)
13. Update `packages/auth/src/index.ts` to export all moved types + stubs. **MUST export `AuthPrecedenceResolver` from main entry (verified by shared script Check 7). MUST export `flushRuntimeAuthScope` from main entry (verified by shared script Check 8).**
14. Move test files to their **final destination** per the test migration matrix (see below). **Test migration policy applies:** all 20 test files move to `packages/auth`. Tests that import `@vybestack/llxprt-code-core` or `@vybestack/llxprt-code-providers` must be refactored with local DI test doubles before moving to `packages/auth`. 7 tests require DI refactoring (see `analysis/auth-file-classification.md` Test Migration Policy). 13 tests have no cross-package deps and move as-is. Zero tests are relocated to owning packages. By P18, zero files remain under `core/src/auth/`.

**TDD ordering note:** Relocating/refactoring existing tests as part of P09 is a refactoring exception to the normal TDD flow (P09 = stub, P10 = test). This is justified because: (a) the tests already exist and are being relocated, not newly authored; (b) the refactoring (DI double replacement) preserves existing behavioral coverage; (c) P10 then adds new behavioral tests for the DI-refactored stubs with precise pass/fail expectations. The expected outcome of P09's test relocation is that all relocated tests compile in `packages/auth` and that the 13 as-is tests pass, while the 7 DI-refactored tests depend on stub wiring status (some may naturally fail until P11 wires the DI). P10 creates additional behavioral tests for the DI components with explicit pass/fail criteria.

15. Verify move map covers all 15 production + 20 test = 35 files per auth-move-map.md

## Files to Create (stubs with NotYetImplemented)
- `packages/auth/src/keyring-token-store.ts`
- `packages/auth/src/precedence.ts`
- `packages/auth/src/auth-precedence-resolver.ts`
- `packages/auth/src/flows/codex-device-flow.ts`

## Files to Move (as-is with import path updates)
- All others per auth-move-map.md

## Verification Commands

```bash
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run build --workspace @vybestack/llxprt-code-auth

# Verify no core imports in auth package production code
# Using canonical import/export specifier parsing (not substring matching)
# Reference: shared verifier script at scripts/verify-auth-extraction-gate.js
node project-plans/issue1586/scripts/verify-auth-extraction-gate.js

# Verify no relative import escape from auth/src
# (shared verifier also checks this, but this is a quick local check)
if rg -n "from ['\"].*\.\./\.\./" packages/auth/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' 2>/dev/null; then
  echo "FAIL: relative import escape from auth/src"; exit 1
fi

# Verify test file migration: all 20 moved to packages/auth
# All original 20 test files must be accounted for in ONE of these locations:

# Verify all 20 test files moved to packages/auth (final destination for all)
auth_test_count=$(find packages/auth/src -name '*.test.ts' -o -name '*.spec.ts' | wc -l | tr -d ' ')
echo "INFO: $auth_test_count test files in packages/auth"
if [ "$auth_test_count" -lt 20 ]; then
  echo "FAIL: only $auth_test_count of 20 original auth tests found in packages/auth"; exit 1
fi

# Verify ZERO tests remain in core/src/auth/
core_auth_test_count=$(find packages/core/src/auth -name '*.test.ts' -o -name '*.spec.ts' 2>/dev/null | wc -l | tr -d ' ')
if [ "$core_auth_test_count" -gt 0 ]; then
  echo "FAIL: $core_auth_test_count test files still under core/src/auth/ — move to packages/auth"; exit 1
fi

# Test migration enforcement: auth tests must not import core/providers
# Using canonical import/export specifier parsing (not substring matching)
node -e "
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
// Canonical import specifier regex
const CANONICAL_IMPORT_RE = /(?:require\(\s*|from\s+|import\(\s*)['\"](@?[^'\"]+)['\"]/g;
const CANONICAL_REEXPORT_RE = /export\s+(?:type\s+)?(?:\{[^}]*\}\s+from|[*]\s+from)\s+['\"]([^'\"]+)['\"]/g;
const forbidden = ['@vybestack/llxprt-code-core', '@vybestack/llxprt-code-providers'];
try {
  const files = execSync('find packages/auth/src -name \"*.test.ts\" -o -name \"*.spec.ts\"', {encoding:'utf8'}).trim().split('\\n').filter(f => f);
  let violations = [];
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    let match;
    const importRe = new RegExp(CANONICAL_IMPORT_RE.source, 'g');
    while ((match = importRe.exec(content)) !== null) {
      for (const pkg of forbidden) {
        if (match[1] === pkg || match[1].startsWith(pkg + '/')) {
          violations.push(f + ': test imports ' + match[1]);
        }
      }
    }
    const reexportRe = new RegExp(CANONICAL_REEXPORT_RE.source, 'g');
    while ((match = reexportRe.exec(content)) !== null) {
      for (const pkg of forbidden) {
        if (match[1] === pkg || match[1].startsWith(pkg + '/')) {
          violations.push(f + ': test re-exports ' + match[1]);
        }
      }
    }
  }
  if (violations.length > 0) { console.error('FAIL: auth tests must not import/re-export core/providers:'); violations.forEach(v => console.error('  ' + v)); process.exit(1); }
  console.log('OK: no forbidden core/providers imports in auth test files (canonical specifier scan)');
} catch(e) { console.log('INFO: no auth test files found yet (pre-move)'); }
```