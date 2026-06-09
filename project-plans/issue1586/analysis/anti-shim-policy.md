# Anti-Shim Policy

Plan ID: PLAN-20260608-ISSUE1586

## Allowed True Contracts

A true contract is allowed in core only when all conditions hold:

1. It is a DI interface owned by `packages/auth` that core implements.
2. It is named for auth domain semantics, not as a core compatibility type.
3. It does not import from `@vybestack/llxprt-code-core`.
4. It does not re-export a core symbol as an auth package compatibility type.
5. It has behavioral tests proving auth uses it correctly.

Examples: `ISecureStore`, `ISettingsService`, `IDebugLogger`, `IProviderKeyStorage`, `IProviderRuntimeContext`.

## Forbidden Shims

A shim is forbidden if it does any of the following:

- Re-exports auth package APIs from `packages/core/src/auth/**` wrapper files.
- Preserves old core auth import paths under `packages/core/src/auth/`.
- Preserves old core auth subpath exports (e.g., `@vybestack/llxprt-code-core/auth/precedence.js`, `@vybestack/llxprt-code-core/auth/types.js`) in `exports` field.
- Wraps auth package symbols only to avoid updating callers.
- Adds `V2`, `New`, `Copy`, `Compat`, or parallel implementation files.
- Adds core as a production dependency of auth while auth depends on nothing from core.

## Allowed Core Re-exports

Core MAY re-export auth types from `@vybestack/llxprt-code-auth` through `packages/core/src/index.ts`:

```typescript
export { AuthPrecedenceResolver, type OAuthManager, type OAuthToken, type TokenStore, KeyringTokenStore, OAuthError, OAuthErrorFactory, flushRuntimeAuthScope, type RuntimeAuthScopeFlushResult, type RuntimeAuthScopeCacheEntrySummary } from '@vybestack/llxprt-code-auth';
```

This is NOT a shim because:
- It is a direct main-entry re-export, not a wrapper or compatibility layer.
**Allowed:** Direct main-index re-exports for consumer convenience (`export { X } from '@vybestack/llxprt-code-auth'` in `packages/core/src/index.ts`). These are passthrough re-exports that add no logic, no renaming, and no wrapper code. They are transparent — the consumer can equivalently import directly from `@vybestack/llxprt-code-auth`.
- It does not add any indirection or compatibility shim.
- Consumers who need auth types can also import directly from `@vybestack/llxprt-code-auth`.

### Re-export Policy

**Allowed:** Direct main-index re-exports for consumer convenience (`export { X } from '@vybestack/llxprt-code-auth'` in `packages/core/src/index.ts`). These are passthrough re-exports that add no logic, no renaming, and no wrapper code. They are transparent — the consumer can equivalently import directly from `@vybestack/llxprt-code-auth`.

### AuthPrecedenceResolver Public Entry Path

`AuthPrecedenceResolver` is the primary public entry point of `packages/auth` (REQ-AUTH-001.4). It is **defined** in `auth-precedence-resolver.ts` (the canonical source file) and MUST be **exported** from `packages/auth/src/index.ts` as a main-entry re-export. The naming is unambiguous: `auth-precedence-resolver.ts` contains the class definition; `precedence.ts` contains low-level cache primitives and the `OAuthManager` interface. Consumers import `AuthPrecedenceResolver` from `@vybestack/llxprt-code-auth` (the main entry), not from `@vybestack/llxprt-code-auth/auth-precedence-resolver.js`. Old consumers importing from `@vybestack/llxprt-code-core/auth/precedence.js` must migrate to the auth package main entry. `flushRuntimeAuthScope` (defined in `precedence.ts`) is also exported from the auth package main entry via `index.ts` re-export.

Verification of AuthPrecedenceResolver ownership and entry path is included in:
1. P18/P19 canonical verification script (`scripts/verify-auth-extraction-gate.js`): checks that `auth-precedence-resolver.ts` exists and exports the class, and that `index.ts` re-exports it.
2. P19 full verification suite: explicit node checks for both conditions.

### AuthPrecedenceResolver Old-Path Migration Verification

After migration, no consumer should import `AuthPrecedenceResolver` from `@vybestack/llxprt-code-core/auth/precedence.js`. All consumers must import from `@vybestack/llxprt-code-auth` (main entry). This is verified by the old-path scan in P18/P19 (canonical verification script `scripts/verify-auth-extraction-gate.js` check #3).

**Forbidden:** Wrapper/deep-path compatibility shims — any file under `packages/core/src/auth/` that re-exports auth package APIs, any deep-path subpath export (`@vybestack/llxprt-code-core/auth/precedence.js`), any `V2`/`New`/`Compat`/`Copy` suffixed compatibility file, or any re-export that renames, transforms, or adds logic around the auth symbol.

## Public API / Deep-Path Compatibility Policy

### Allowed Auth Package Exports

Only these may be re-exported or imported by consumers:

**Main entry (`@vybestack/llxprt-code-auth`):**
- `AuthPrecedenceResolver`, `AuthPrecedenceConfig`
- `OAuthManager` (interface)
- `OAuthToken`, `TokenStore`, `KeyringTokenStore`, `OAuthTokenRequestMetadata`
- `OAuthError`, `OAuthErrorFactory`
- `AuthStatus`, `BucketStats`, `DeviceCodeResponse`, `CodexOAuthToken`
- `CodexDeviceFlow`, `AnthropicDeviceFlow`, `QwenDeviceFlow`
- `mergeRefreshedToken`, `sanitizeTokenForProxy`
- `ProxyTokenStore`, `ProxySocketClient`, `ProxyProviderKeyStorage`
- `encodeFrame`, `FrameDecoder` (proxy framing)
- `flushRuntimeAuthScope`, `RuntimeAuthScopeFlushResult`, `RuntimeAuthScopeCacheEntrySummary`
- All DI interfaces (`ISecureStore`, `ISettingsService`, `IProviderKeyStorage`, `IDebugLogger`, `IProviderRuntimeContext`)

**No sub-path exports:** Consumers must use the main entry point. If a sub-path is needed later, it must be explicitly added to `packages/auth/package.json` `exports` field.

### Symbol-Level Migration Table: `@vybestack/llxprt-code-core/auth/precedence.js` and `@vybestack/llxprt-code-core/auth/types.js`

The current `@vybestack/llxprt-code-core` package exposes `./auth/precedence.js` and `./auth/types.js` subpath exports. After migration, these subpaths are removed. Every symbol currently imported via those deep paths must be available from the auth package main entry (`@vybestack/llxprt-code-auth`). The table below maps each symbol:

#### `@vybestack/llxprt-code-core/auth/precedence.js` → `@vybestack/llxprt-code-auth`

| Symbol | Type | Current Deep-Path Consumers | Migration Action |
|--------|------|---------------------------|-----------------|
| `AuthPrecedenceResolver` | class | `providers/BaseProvider.ts` | Main-entry export in auth |
| `AuthPrecedenceConfig` | type | `providers/BaseProvider.ts` | Main-entry export in auth |
| `OAuthManager` | interface | `providers/BaseProvider.ts`, `GeminiProvider.ts`, `AnthropicProvider.ts`, `OpenAIProvider.ts`, `OpenAIVercelProvider.ts`, `OpenAIResponsesProviderBase.ts` | Main-entry export in auth |
| `OAuthTokenRequestMetadata` | type | `providers/BaseProvider.test.ts` | Main-entry export in auth |
| `flushRuntimeAuthScope` | function | `providers/openai/openai-oauth.spec.ts`, `core/core/StreamProcessor.ts` | Main-entry export in auth (REQ-API-001) |
| `RuntimeAuthScopeFlushResult` | type | `cli/runtime/runtimeContextFactory.ts`, `cli/runtime/runtimeRegistry.ts` | Main-entry export in auth |
| `RuntimeAuthScopeCacheEntrySummary` | type | (re-exported via core index.ts) | Main-entry export in auth |
| `RuntimeScopedState` | interface | `auth-precedence-resolver.ts` (internal) | Internal to auth package; no external consumer |
| `runtimeScopedStates` | Map | `auth-precedence-resolver.ts` (internal) | Internal to auth package; no external consumer |
| `buildCacheKey`, `ensureRuntimeState`, `getValidCachedEntry`, `invalidateEntry`, `invalidateMatchingEntries`, `storeRuntimeScopedToken`, `recordCacheHit`, `recordCacheMiss`, `registerSettingsSubscriptions`, `resolveProfileId` | functions | `auth-precedence-resolver.ts` (internal) | Internal to auth package; no external consumer |

#### `@vybestack/llxprt-code-core/auth/types.js` → `@vybestack/llxprt-code-auth`

| Symbol | Type | Current Deep-Path Consumers | Migration Action |
|--------|------|---------------------------|-----------------|
| `CodexOAuthTokenSchema` | Zod schema | `providers/openai-responses/OpenAIResponsesProviderBase.ts` | Main-entry export in auth |
| `CodexOAuthToken` | type | `providers/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts` | Main-entry export in auth |
| `OAuthTokenSchema` | Zod schema | (internal) | Main-entry export in auth |
| `OAuthToken` | type | (via main index) | Main-entry export in auth |
| `AuthStatus`, `BucketStats`, `DeviceCodeResponse`, `ProviderOAuthConfig`, `TokenResponse`, `CodexTokenResponse`, `CodexTokenResponseSchema`, `ProviderOAuthConfigSchema`, `DeviceCodeResponseSchema`, `TokenResponseSchema`, `AuthStatusSchema`, `BucketStatsSchema` | types/schemas | (via main index or internal) | Main-entry export in auth |

**Decision on `flushRuntimeAuthScope`:** This function moves to `packages/auth` as a main-entry export. It is auth-domain logic (flushing runtime-scoped auth credentials) defined in `precedence.ts`. It is consumed by:
- `packages/core/src/core/StreamProcessor.ts` (relative import `../auth/precedence.js`)
- `packages/providers/src/openai/openai-oauth.spec.ts` (deep-path import)
- `packages/cli/src/auth/BucketFailoverHandlerImpl.ts` (via `@vybestack/llxprt-code-core` main-index)
- `packages/cli/src/auth/auth-status-service.ts` (via main-index)
- `packages/cli/src/runtime/runtimeContextFactory.ts` (via main-index)

After migration, `StreamProcessor.ts` imports from `@vybestack/llxprt-code-auth` (or via core re-export). Providers spec imports from `@vybestack/llxprt-code-auth`. CLI files import from `@vybestack/llxprt-code-auth` (or via core re-export for convenience).

### Forbidden Old-Path Scans (Canonical — referenced from P18 and P19)

These scans are consolidated in the canonical verification script `scripts/verify-auth-extraction-gate.js` (check #3). The inline commands below are preserved for ad-hoc use. After migration, these must return zero matches:

```bash
# No direct core auth path imports anywhere in repo
# Node.js verifier for exact package-name checks (avoids brittle regex)
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
if (violations.length > 0) { console.error('FAIL: old core/auth imports remain:'); violations.forEach(v => console.error('  ' + v)); process.exit(1); }
console.log('OK: no old core/auth imports');
"

# No relative core auth path imports
if rg -n "from ['\"].*core/src/auth" packages/ --glob '*.ts' 2>/dev/null; then
  echo "FAIL: found relative core/src/auth imports"; exit 1
fi
```

## Required Scans (Canonical — referenced from P18 and P19)

All anti-shim and package-cycle scans are consolidated into a single canonical verification script at `scripts/verify-auth-extraction-gate.js`. P09, P11, P15, P17, P18, and P19 reference this script instead of inlining duplicate scan logic. The script uses canonical import/export specifier parsing (matching `from '...'`, `from "..."`, `require('...')`, `require("...")`, `import('...')`, and `export ... from '...'` patterns) instead of raw substring scans. This avoids false positives from comments mentioning package names, test fixture strings, or other non-import occurrences. The script checks:

1. Auth package has zero vybestack dependencies (both `dependencies` and `devDependencies` checked; devDependencies must also avoid `@vybestack/*` unless explicitly justified by a verifier/test-only rule — no such exception exists in this plan)
2. Auth production source has no forbidden imports (canonical specifier parsing, excluding test files): `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-cli`, `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code-tools`, `@vybestack/llxprt-code`
3. Auth test source has no forbidden imports (canonical specifier parsing on `*.test.ts` and `*.spec.ts`): `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`
4. No old core/auth canonical import specifiers in consumer packages (`@vybestack/llxprt-code-core/auth`), plus relative-path escapes to `core/src/auth`
5. No V2/New/Compat/Copy auth files
6. Core auth subpath exports removed (exits only if `./auth/precedence.js` or `./auth/types.js` remain)
7. AuthPrecedenceResolver defined in `auth-precedence-resolver.ts` (canonical source) and re-exported from `packages/auth/src/index.ts` (canonical specifier parsing, not substring)
8. `flushRuntimeAuthScope` exported from auth main entry (substring check in index.ts content)
9. Core auth directory empty/removed
10. `auth-factories.ts` at correct path (`packages/core/src/auth-factories.ts`, NOT inside `auth/` subdir)
11. Package cycle proof: auth has zero vybestack deps (both prod and dev), DAG is acyclic
12. Auth index.ts does not re-export from forbidden packages (canonical re-export specifier parsing)
13. Relative import boundary: auth/src must not escape via `../../../` or relative paths to `core/`, `cli/`, or `providers/`
14. Compile/public import tests for `AuthPrecedenceResolver`, `flushRuntimeAuthScope`, and core factory exports

```bash
# Canonical verification gate (referenced from P09, P11, P15, P17, P18, and P19)
node project-plans/issue1586/scripts/verify-auth-extraction-gate.js
```

Individual scan commands for specific checks are preserved below for ad-hoc use:

```bash
# 1. Auth package must not depend on core/cli/providers (exact package-name check)
node -e "const p=require('./packages/auth/package.json'); const deps=Object.keys(p.dependencies||{}); ['@vybestack/llxprt-code-core','@vybestack/llxprt-code','@vybestack/llxprt-code-providers'].forEach(k=>{if(deps.includes(k)){console.error('FORBIDDEN:',k);process.exit(1)}})"

# 2. Auth source forbidden import check (exact package-name check via Node.js)
node -e "
const fs = require('fs');
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
if (v.length > 0) { console.error('FAIL: forbidden imports in auth package:'); v.forEach(l => console.error('  ' + l)); process.exit(1); }
console.log('OK: no forbidden imports in auth package');
"

# 3. No old core/auth import paths (exact package-name check via Node.js)
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
if (violations.length > 0) { console.error('FAIL: old core/auth imports remain:'); violations.forEach(v => console.error('  ' + v)); process.exit(1); }
console.log('OK: no old core/auth imports');
"

# 4. No V2/Compat/New/Copy auth files (single canonical scan)
node -e "
const { execSync } = require('child_process');
const files = execSync('find packages -type f -name \"*.ts\" 2>/dev/null', {encoding:'utf8'}).trim().split('\\n').filter(f => f);
const bad = files.filter(f => /(?:V2|New|Copy|Compat)[Aa]uth|[Aa]uth(?:V2|New|Copy|Compat)/.test(f));
if (bad.length > 0) { console.error('FAIL: V2/Compat/New/Copy auth files found:'); bad.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('OK: no V2/Compat/New/Copy auth files');
"

# 5. Core auth subpath exports removed (exit only if ./auth/precedence.js or ./auth/types.js still present)
node -e "
const pkg = require('./packages/core/package.json');
const exports = pkg.exports || {};
const remaining = Object.keys(exports).filter(k => k === './auth/precedence.js' || k === './auth/types.js');
if (remaining.length > 0) {
  console.error('FAIL: core still has auth subpath exports:', remaining);
  process.exit(1);
}
console.log('OK: no auth subpath exports');
"
```

## Auth Package Relative-Import Boundary Checks

Auth package source must not reach outside its own package via relative imports:

```bash
# No relative import escape from auth/src
if rg -n "from ['\"].*\.\./\.\./" packages/auth/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' 2>/dev/null; then
  echo "FAIL: relative import escape from auth/src"; exit 1
fi

# Forbidden: relative imports reaching into core/cli/providers via ../../../
if rg -n "from ['\"].*\.\./\.\./\.\./" packages/auth/src --glob '*.ts' 2>/dev/null; then
  echo "FAIL: deep relative import escape from auth"; exit 1
fi

# Forbidden: importing from sibling packages via relative path
if rg -n "from ['\"].*packages/(core|cli|providers)" packages/auth/src --glob '*.ts' 2>/dev/null; then
  echo "FAIL: relative import to sibling package from auth"; exit 1
fi
```

## Package Metadata Anti-Cycle Checks

Per `analysis/package-metadata-constraints.md`. Core package metadata and core tsconfig must not create a cycle through auth. Auth package metadata must not depend on core.

## Package Manager Reconciliation

The root `package.json` declares `"packageManager": "pnpm@10.17.0+sha512..."` while a `pnpm-lock.yaml` and `package-lock.json` both exist at repo root alongside a `packageManager` field declaring pnpm. All project scripts and CI use npm commands. This MUST be verified before plan commands modifying lockfiles. P00a and P03 Step 0 include a mandatory package manager verification gate. See design decision #18 in `plan/00-overview.md` for full details.

**Verification gate (P00a/P03):** The gate MUST inspect three signals: (1) the `packageManager` field in root `package.json`, (2) which lockfiles are present (`package-lock.json`, `pnpm-lock.yaml`, or both), and (3) what package manager commands CI workflow files actually use. If these signals conflict, the gate MUST exit non-zero and STOP the phase. The phase MUST NOT proceed with any install/lockfile commands until a strategy decision resolves the inconsistency. **Do NOT delete `package-lock.json` or `pnpm-lock.yaml`** — the gate determines which is authoritative and requires a strategy decision if they conflict.

1. Mandatory executable gate: run P03 Step 0 gate script (or equivalent from P00a). The gate MUST inspect CI workflow files and exit non-zero on inconsistency. **If CI/lockfile strategy is inconsistent, the gate MUST exit non-zero and the phase MUST STOP — do not allow both npm and pnpm paths to execute.**
2. If CI uses `npm`: `npm install`/`package-lock.json` is authoritative. The `pnpm-lock.yaml` and `packageManager` field may be stale if they contradict.
3. If CI uses `pnpm`: all `npm install`/`npm ci` commands must be replaced with `pnpm install`/`pnpm ci`, and `pnpm-lock.yaml` must be the sole authoritative lockfile. **Do NOT remove `package-lock.json`** — instead, stop and require a package-manager strategy decision. Lockfile removal is out of scope and potentially destructive.

This gate MUST pass before any install/lockfile-modifying commands run.

## Final Core Auth Directory Rule

The preferred and expected final state is zero production files under `packages/core/src/auth`. The only exception is `packages/core/src/auth-factories.ts` (DI factory functions) which is a **new file** at `packages/core/src/auth-factories.ts`, not a migrated auth file inside the `auth/` subdirectory. Core's `index.ts` re-export block replaces the old auth directory entirely.

## Accepted Deviation: packages/storage Absence

Issue #1586 references `packages/storage` as a dependency. Since `packages/storage` does not exist in the repository, the plan defines DI interfaces (`ISecureStore`, `IProviderKeyStorage`) locally in `packages/auth/src/interfaces/`. This is not a shim — these are true contracts that auth owns and core implements. When `packages/storage` is extracted, these interfaces migrate to that package from auth. No anti-shim policy is violated by this design.