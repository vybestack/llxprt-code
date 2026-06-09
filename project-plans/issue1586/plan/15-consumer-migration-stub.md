# Phase 15: Consumer Migration Scaffolding

Plan ID: PLAN-20260608-ISSUE1586.P15

> **Phase framing:** This phase creates scaffolding only — type-import stubs and import rewrites. It creates the `auth-factories.ts` type-import stub (no constructor calls — classes don't exist in auth yet) and updates all consumer imports from old core/auth paths to `@vybestack/llxprt-code-auth`. It also removes core auth subpath exports from `package.json`. No implementation logic, no factory function bodies, and no cleanup of legacy files/directories. Implementation (factory function bodies) is P17. Cleanup (removing `core/src/auth/` directory) is P18. This phase is scaffolding only.

## Prerequisites
- Required: Phase 14a completed
- Auth package fully built with all exports

## Requirements Implemented

### REQ-API-001.2: CLI and consumers MUST import auth types directly from @vybestack/llxprt-code-auth

## Phase Tasks

1. Update `packages/core/src/index.ts`: replace direct auth exports with re-exports from `@vybestack/llxprt-code-auth`.
2. Create `packages/core/src/auth-factories.ts` type-import stub (factory functions deferred until P17 when auth classes exist in `packages/auth`; in P15, create the file with type imports only, no constructor calls or runtime logic — just `import type` declarations and empty/throwing function signatures).
3. Update `packages/cli/src/auth/types.ts`: change auth re-exports from core to auth package. (OAuthProvider stays in this file.)
4. Update `packages/cli/src/auth/oauth-manager.ts`: import auth types from auth package.
5. Update `packages/cli/src/auth/oauth-provider-base.ts`: import from auth package.
6. Update `packages/cli/src/auth/auth-flow-orchestrator.ts`: import from auth package.
7. Update `packages/cli/src/auth/codex-oauth-provider.ts`: import CodexDeviceFlow from auth package.
8. Update `packages/cli/src/auth/proxy/credential-store-factory.ts`: import KeyringTokenStore, ProxyTokenStore from auth package.
9. Update all other CLI auth files per consumer-migration.md (C-CM-01 through C-CM-07, C-CM-09, C-CM-10).
10. Update providers package auth imports (C-CM-08):
    - `packages/providers/src/BaseProvider.ts` — import `AuthPrecedenceResolver`, `AuthPrecedenceConfig`, `OAuthManager` from `@vybestack/llxprt-code-auth`; keep `SettingsService` import from `@vybestack/llxprt-code-core`. Constructor call changes from positional `new AuthPrecedenceResolver(config, oauthManager, settingsService)` to options-object form `new AuthPrecedenceResolver(config, { oauthManager, settingsService })` because the canonical post-DI constructor uses the options-object pattern (unified with C-CB-06/C-CB-09). `SettingsService` satisfies `ISettingsService` by structural typing.
    - `packages/providers/src/gemini/GeminiProvider.ts`
    - `packages/providers/src/anthropic/AnthropicProvider.ts`
    - `packages/providers/src/openai/OpenAIProvider.ts`
    - `packages/providers/src/openai-vercel/OpenAIVercelProvider.ts`
    - `packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts`
    - `packages/providers/src/BaseProvider.test.ts`
    - `packages/providers/src/openai/openai-oauth.spec.ts` — `flushRuntimeAuthScope`
    - `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts` — `type CodexOAuthToken`
11. Update core non-auth files importing from auth:
    - `packages/core/src/core/StreamProcessor.ts` — `flushRuntimeAuthScope` from `../auth/precedence.js` → `@vybestack/llxprt-code-auth` or core re-export
12. Remove core auth subpath exports from `packages/core/package.json`:
    - Remove `"./auth/precedence.js": "./dist/src/auth/precedence.js"` from exports
    - Remove `"./auth/types.js": "./dist/src/auth/types.js"` from exports

## Verification Commands

```bash
# Verify no CLI auth imports from core (using Node.js verifier for exact package-name checks)
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

# Verify no providers imports from core/auth
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

# Verify core non-auth files no longer import from core/auth
node -e "
const fs = require('fs');
const { execSync } = require('child_process');
const forbidden = ['core/src/auth', '../auth/'];
const dir = 'packages/core/src/core';
let violations = [];
try {
  const files = execSync('find ' + dir + ' -type f -name \"*.ts\" 2>/dev/null', {encoding:'utf8'}).trim().split('\\n').filter(f => f);
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    for (const pat of forbidden) {
      if (content.includes(pat)) { violations.push(f + ': ' + pat); }
    }
  }
} catch(e) {}
if (violations.length > 0) { console.error('FAIL: core non-auth files still importing from core/auth:'); violations.forEach(v => console.error('  ' + v)); process.exit(1); }
console.log('OK: no core/auth imports in core non-auth files');
"

# Verify core auth subpath exports are REMOVED — exit only if exports still present
node -e "
const pkg = require('./packages/core/package.json');
const exports = pkg.exports || {};
const remaining = Object.keys(exports).filter(k => k === './auth/precedence.js' || k === './auth/types.js');
if (remaining.length > 0) {
  console.error('FAIL: core still has auth subpath exports:', remaining);
  process.exit(1);
}
console.log('OK: no auth subpath exports in core package.json');
"

npm run typecheck --workspace @vybestack/llxprt-code-core
npm run typecheck --workspace @vybestack/llxprt-code
```