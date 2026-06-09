# Phase 17: Consumer Migration Implementation + Core Factory Functions

Plan ID: PLAN-20260608-ISSUE1586.P17

> **Phase framing:** Implementation phase. This phase creates core DI factory functions (`createKeyringTokenStore`, `createAuthPrecedenceResolver`) now that `KeyringTokenStore` and `AuthPrecedenceResolver` classes exist in `packages/auth` (after P11). It finalizes all consumer imports. P15 created the auth-factories.ts type-import stub and rewrote consumer imports; P17 implements the actual factory function bodies.

## Prerequisites
- Required: Phase 16a completed
- Auth production code fully moved and DI-refactored in packages/auth (P11 completed)

## Phase Tasks

1. Ensure all P16 integration tests pass.
2. Verify all CLI auth provider imports use @vybestack/llxprt-code-auth.
3. Verify all core auth re-exports use @vybestack/llxprt-code-auth.
4. Verify providers package imports auth types from @vybestack/llxprt-code-auth.
5. Create `packages/core/src/auth-factories.ts` with DI factory functions per C-CB-09:
   - `createKeyringTokenStore()`: injects core SecureStore + DebugLogger
   - `createAuthPrecedenceResolver(config, settingsService, oauthManager?, getActiveRuntimeContext?)`: injects core implementations; forwards optional `oauthManager` from caller to constructor
6. Export factory functions from `packages/core/src/index.ts`.
7. Run full test suites for auth, core, CLI, and providers.

**Note on factory function scheduling:** Core DI factory functions are created in P17 (not P08) because they construct `KeyringTokenStore` and `AuthPrecedenceResolver` classes that don't exist in `packages/auth` until P09-P11. P08 creates only DI interface definitions and auth-package-local implementations. By P17, auth code is fully moved and DI-refactored, so factory functions can safely import from `@vybestack/llxprt-code-auth`.

## TDD Pass/Fail Expectation
- **Expected: ALL PASS** — All consumer imports migrated; all integration tests should pass.

## Verification Commands

```bash
npm run test --workspace @vybestack/llxprt-code-auth
npm run test --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code
npm run test --workspace @vybestack/llxprt-code-providers
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run typecheck --workspace @vybestack/llxprt-code
npm run typecheck --workspace @vybestack/llxprt-code-providers

# Structural compatibility: SettingsService satisfies ISettingsInterface
# This is verified by tsc --noEmit above (providers typechecks only if structural typing works)

# No CLI auth imports from core for auth types
node -e "
const fs = require('fs');
const { execSync } = require('child_process');
const forbidden = ['@vybestack/llxprt-code-core/auth', 'core/src/auth'];
const dir = 'packages/cli/src/auth';
let violations = [];
try {
  const files = execSync('find ' + dir + ' -type f -name \"*.ts\" 2>/dev/null', {encoding:'utf8'}).trim().split('\\n').filter(f => f);
  for (const f of files) {
    if (f.endsWith('.test.ts') || f.endsWith('.spec.ts')) continue;
    const content = fs.readFileSync(f, 'utf8');
    for (const pat of forbidden) {
      if (content.includes(pat)) { violations.push(f + ': ' + pat); }
    }
  }
} catch(e) {}
if (violations.length > 0) { console.error('FAIL: CLI still importing auth from core:'); violations.forEach(v => console.error('  ' + v)); process.exit(1); }
console.log('OK: no CLI auth imports from core');
"

# No providers imports from core/auth
node -e "
const fs = require('fs');
const { execSync } = require('child_process');
const forbidden = ['@vybestack/llxprt-code-core/auth'];
const dir = 'packages/providers/src';
let violations = [];
try {
  const files = execSync('find ' + dir + ' -type f -name \"*.ts\" 2>/dev/null', {encoding:'utf8'}).trim().split('\\n').filter(f => f);
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    if (content.includes('@vybestack/llxprt-code-core/auth')) { violations.push(f); }
  }
} catch(e) {}
if (violations.length > 0) { console.error('FAIL: providers still importing from core/auth:'); violations.forEach(v => console.error('  ' + v)); process.exit(1); }
console.log('OK: no providers imports from core/auth');
"

# No core auth path imports anywhere (using Node.js verifier)
node -e "
const fs = require('fs');
const { execSync } = require('child_process');
const forbidden = ['@vybestack/llxprt-code-core/auth', 'core/src/auth'];
const scanDirs = ['packages/cli/src', 'packages/providers/src', 'packages/core/src/core'];
let violations = [];
for (const dir of scanDirs) {
  try {
    const files = execSync('find ' + dir + ' -type f -name \"*.ts\" 2>/dev/null', {encoding:'utf8'}).trim().split('\\n').filter(f => f);
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      for (const pat of forbidden) {
        if (content.includes(pat)) { violations.push(f + ': ' + pat); }
      }
    }
  } catch(e) {}
}
if (violations.length > 0) { console.error('FAIL: old core/auth imports remain anywhere in repo:'); violations.forEach(v => console.error('  ' + v)); process.exit(1); }
console.log('OK: no old core/auth imports remain');
"
```