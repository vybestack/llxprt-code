# Phase 19: Full Verification Suite

Plan ID: PLAN-20260608-ISSUE1586.P19

## Prerequisites
- Required: Phase 18a completed
- All cleanup verified

## Requirements Implemented

### REQ-TEST-001: Full behavioral verification
### REQ-CLEAN-001.3: Full verification suite per project memory MUST pass

## Phase Tasks

Run the exact verification commands from project memory:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamaglm51 "write me a haiku and nothing else"
```

Additionally run:

**CAUTION: `npm run format` is destructive — review diffs before committing.** Format changes can alter whitespace in ways that affect reviewability. Investigate any unexpected diffs before proceeding.

```bash
# Package boundary verification
npm run test --workspace @vybestack/llxprt-code-auth
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run build --workspace @vybestack/llxprt-code-auth

# Dependency direction verification — canonical scan from analysis/anti-shim-policy.md
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

# Relative import boundary check
if rg -n "from ['\"].*\.\./\.\./" packages/auth/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' 2>/dev/null; then
  echo "FAIL: relative import escape from auth/src"; exit 1
fi

# Consumer import verification — use shared verifier (canonical script at scripts/verify-auth-extraction-gate.js)
node project-plans/issue1586/scripts/verify-auth-extraction-gate.js

# Core auth directory gone
if find packages/core/src/auth -type f 2>/dev/null | grep -q .; then
  echo "FAIL: files remain under packages/core/src/auth/"; exit 1
fi

# auth-factories.ts at correct location
test -f packages/core/src/auth-factories.ts || { echo "FAIL: auth-factories.ts missing from core/src/"; exit 1; }

# Core auth subpath exports removed — exit only if ./auth/precedence.js or ./auth/types.js still present
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

# V2/New/Compat/Copy auth file scan (anti-shim policy requirement — delegated to shared verifier)
node project-plans/issue1586/scripts/verify-auth-extraction-gate.js


# OAuthProvider in CLI
if ! rg -n "export interface OAuthProvider" packages/cli/src/auth/types.ts 2>/dev/null; then
  echo "FAIL: OAuthProvider not found in CLI"; exit 1
fi

# OAuthManager interface in auth
if ! rg -n "export interface OAuthManager" packages/auth/src/precedence.ts 2>/dev/null; then
  echo "FAIL: OAuthManager not found in auth"; exit 1
fi

# flushRuntimeAuthScope exported from auth main entry (canonical export resolution)
node -e "
const fs = require('fs');
const path = require('path');

function parseModuleExports(content) {
  const declared = new Set();
  const patterns = [
    /export\s+class\s+(\w+)/g,
    /export\s+default\s+class\s+(\w+)/g,
    /export\s+function\s+(\w+)/g,
    /export\s+default\s+function\s+(\w+)/g,
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+interface\s+(\w+)/g,
    /export\s+type\s+(\w+)\s*=/g,
    /export\s+enum\s+(\w+)/g,
  ];
  for (const re of patterns) { const r = new RegExp(re.source, re.flags); let m; while ((m = r.exec(content)) !== null) { if (m[1]) declared.add(m[1]); } }
  const localRe = /export\s+(?:type\s+)?\{([^}]+)\}(?!\s*from\s)/g; let m;
  while ((m = localRe.exec(content)) !== null) { m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean).forEach(n => declared.add(n)); }
  const defRe = /export\s+default\s+(\w+)/g;
  while ((m = defRe.exec(content)) !== null) { declared.add(m[1]); }
  const reExports = [];
  const namedRe = /export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = namedRe.exec(content)) !== null) { reExports.push({ names: m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean), source: m[2] }); }
  const starSources = [];
  const starRe = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = starRe.exec(content)) !== null) { starSources.push(m[1]); }
  return { declared, reExports, starSources };
}

function resolveModulePath(fromFilePath, importSpecifier) {
  if (!importSpecifier.startsWith('.')) return null;
  const dir = path.dirname(fromFilePath);
  const basePath = path.resolve(dir, importSpecifier);
  for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.js', '']) { const candidate = basePath + ext; if (fs.existsSync(candidate)) return candidate; }
  return null;
}

function isSymbolExportedFromModule(modulePath, symbolName, visited) {
  visited = visited || new Set();
  if (visited.has(modulePath)) return false;
  visited.add(modulePath);
  if (!fs.existsSync(modulePath)) return false;
  const content = fs.readFileSync(modulePath, 'utf8');
  const { declared, reExports, starSources } = parseModuleExports(content);
  if (declared.has(symbolName)) return true;
  for (const re of reExports) { if (re.names.includes(symbolName)) return true; }
  for (const source of starSources) { const resolvedPath = resolveModulePath(modulePath, source); if (resolvedPath && isSymbolExportedFromModule(resolvedPath, symbolName, visited)) return true; }
  return false;
}

const idxPath = path.resolve('packages/auth/src/index.ts');
if (!isSymbolExportedFromModule(idxPath, 'flushRuntimeAuthScope')) {
  console.error('FAIL: flushRuntimeAuthScope not publicly exported from auth main entry (canonical export resolution)');
  process.exit(1);
}
console.log('OK: flushRuntimeAuthScope publicly exported from auth main entry (canonical export resolution)');
"

# AuthPrecedenceResolver exported from auth main entry (canonical export resolution)
node -e "
const fs = require('fs');
const path = require('path');

function parseModuleExports(content) {
  const declared = new Set();
  const patterns = [
    /export\s+class\s+(\w+)/g,
    /export\s+default\s+class\s+(\w+)/g,
    /export\s+function\s+(\w+)/g,
    /export\s+default\s+function\s+(\w+)/g,
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+interface\s+(\w+)/g,
    /export\s+type\s+(\w+)\s*=/g,
    /export\s+enum\s+(\w+)/g,
  ];
  for (const re of patterns) { const r = new RegExp(re.source, re.flags); let m; while ((m = r.exec(content)) !== null) { if (m[1]) declared.add(m[1]); } }
  const localRe = /export\s+(?:type\s+)?\{([^}]+)\}(?!\s*from\s)/g; let m;
  while ((m = localRe.exec(content)) !== null) { m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean).forEach(n => declared.add(n)); }
  const defRe = /export\s+default\s+(\w+)/g;
  while ((m = defRe.exec(content)) !== null) { declared.add(m[1]); }
  const reExports = [];
  const namedRe = /export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = namedRe.exec(content)) !== null) { reExports.push({ names: m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean), source: m[2] }); }
  const starSources = [];
  const starRe = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = starRe.exec(content)) !== null) { starSources.push(m[1]); }
  return { declared, reExports, starSources };
}

function resolveModulePath(fromFilePath, importSpecifier) {
  if (!importSpecifier.startsWith('.')) return null;
  const dir = path.dirname(fromFilePath);
  const basePath = path.resolve(dir, importSpecifier);
  for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.js', '']) { const candidate = basePath + ext; if (fs.existsSync(candidate)) return candidate; }
  return null;
}

function isSymbolExportedFromModule(modulePath, symbolName, visited) {
  visited = visited || new Set();
  if (visited.has(modulePath)) return false;
  visited.add(modulePath);
  if (!fs.existsSync(modulePath)) return false;
  const content = fs.readFileSync(modulePath, 'utf8');
  const { declared, reExports, starSources } = parseModuleExports(content);
  if (declared.has(symbolName)) return true;
  for (const re of reExports) { if (re.names.includes(symbolName)) return true; }
  for (const source of starSources) { const resolvedPath = resolveModulePath(modulePath, source); if (resolvedPath && isSymbolExportedFromModule(resolvedPath, symbolName, visited)) return true; }
  return false;
}

const idxPath = path.resolve('packages/auth/src/index.ts');
if (!isSymbolExportedFromModule(idxPath, 'AuthPrecedenceResolver')) {
  console.error('FAIL: AuthPrecedenceResolver not publicly exported from auth main entry (canonical export resolution)');
  process.exit(1);
}
console.log('OK: AuthPrecedenceResolver publicly exported from auth main entry (canonical export resolution)');
"

# Verify Old precedence.js deep-path consumers have migrated to @vybestack/llxprt-code-auth main entry — use shared verifier
node project-plans/issue1586/scripts/verify-auth-extraction-gate.js

# Compile/public import tests for AuthPrecedenceResolver, flushRuntimeAuthScope, and core factory exports
# AuthPrecedenceResolver is defined ONLY in auth-precedence-resolver.ts and re-exported from index.ts
# (not defined in precedence.ts which contains OAuthManager interface and cache primitives)
node -e "
const fs = require('fs');
const path = require('path');

function parseModuleExports(content) {
  const declared = new Set();
  const patterns = [
    /export\s+class\s+(\w+)/g,
    /export\s+default\s+class\s+(\w+)/g,
    /export\s+function\s+(\w+)/g,
    /export\s+default\s+function\s+(\w+)/g,
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+interface\s+(\w+)/g,
    /export\s+type\s+(\w+)\s*=/g,
    /export\s+enum\s+(\w+)/g,
  ];
  for (const re of patterns) { const r = new RegExp(re.source, re.flags); let m; while ((m = r.exec(content)) !== null) { if (m[1]) declared.add(m[1]); } }
  const localRe = /export\s+(?:type\s+)?\{([^}]+)\}(?!\s*from\s)/g; let m;
  while ((m = localRe.exec(content)) !== null) { m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean).forEach(n => declared.add(n)); }
  const defRe = /export\s+default\s+(\w+)/g;
  while ((m = defRe.exec(content)) !== null) { declared.add(m[1]); }
  const reExports = [];
  const namedRe = /export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['\"]([^'\"]+)['\"]/g;
  while ((m = namedRe.exec(content)) !== null) { reExports.push({ names: m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean), source: m[2] }); }
  const starSources = [];
  const starRe = /export\s+\*\s+from\s+['\"]([^'\"]+)['\"]/g;
  while ((m = starRe.exec(content)) !== null) { starSources.push(m[1]); }
  return { declared, reExports, starSources };
}

function resolveModulePath(fromFilePath, importSpecifier) {
  if (!importSpecifier.startsWith('.')) return null;
  const dir = path.dirname(fromFilePath);
  const basePath = path.resolve(dir, importSpecifier);
  for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.js', '']) { const candidate = basePath + ext; if (fs.existsSync(candidate)) return candidate; }
  return null;
}

function isSymbolExportedFromModule(modulePath, symbolName, visited) {
  visited = visited || new Set();
  if (visited.has(modulePath)) return false;
  visited.add(modulePath);
  if (!fs.existsSync(modulePath)) return false;
  const content = fs.readFileSync(modulePath, 'utf8');
  const { declared, reExports, starSources } = parseModuleExports(content);
  if (declared.has(symbolName)) return true;
  for (const re of reExports) { if (re.names.includes(symbolName)) return true; }
  for (const source of starSources) { const resolvedPath = resolveModulePath(modulePath, source); if (resolvedPath && isSymbolExportedFromModule(resolvedPath, symbolName, visited)) return true; }
  return false;
}

// 1. AuthPrecedenceResolver defined in auth-precedence-resolver.ts (canonical source — class-declared/exported)
const aprPath = 'packages/auth/src/auth-precedence-resolver.ts';
if (!fs.existsSync(aprPath)) { console.error('FAIL: auth-precedence-resolver.ts not found'); process.exit(1); }
const apr = fs.readFileSync(aprPath, 'utf8');
const aprExports = parseModuleExports(apr);
if (!aprExports.declared.has('AuthPrecedenceResolver')) {
  console.error('FAIL: AuthPrecedenceResolver not class-declared/exported in auth-precedence-resolver.ts (canonical export parse)');
  process.exit(1);
}
console.log('OK: AuthPrecedenceResolver class-declared/exported in canonical file auth-precedence-resolver.ts');

// 2. AuthPrecedenceResolver NOT defined in precedence.ts (precedence.ts contains cache primitives + OAuthManager)
const precPath = 'packages/auth/src/precedence.ts';
if (fs.existsSync(precPath)) {
  const prec = fs.readFileSync(precPath, 'utf8');
  // Check that precedence.ts does NOT export the AuthPrecedenceResolver class definition
  // It may import/re-export it from auth-precedence-resolver.ts, but the class MUST NOT be defined there
  if (/export\s+class\s+AuthPrecedenceResolver/.test(prec)) {
    console.error('FAIL: AuthPrecedenceResolver class definition found in precedence.ts — must be in auth-precedence-resolver.ts only');
    process.exit(1);
  }
  console.log('OK: precedence.ts does not define AuthPrecedenceResolver class');
} else {
  console.log('OK: precedence.ts not found (pre-move)');
}

// 3. AuthPrecedenceResolver publicly exported from index.ts (canonical export resolution)
if (fs.existsSync('packages/auth/src/index.ts')) {
  const idxPath = path.resolve('packages/auth/src/index.ts');
  if (!isSymbolExportedFromModule(idxPath, 'AuthPrecedenceResolver')) {
    console.error('FAIL: AuthPrecedenceResolver not publicly exported from auth main entry (canonical export resolution)');
    process.exit(1);
  }
  console.log('OK: AuthPrecedenceResolver publicly exported from auth main entry (canonical export resolution)');
}

// 4. flushRuntimeAuthScope publicly exported from auth main entry (canonical export resolution)
if (fs.existsSync('packages/auth/src/index.ts')) {
  const idxPath = path.resolve('packages/auth/src/index.ts');
  if (!isSymbolExportedFromModule(idxPath, 'flushRuntimeAuthScope')) {
    console.error('FAIL: flushRuntimeAuthScope not publicly exported from auth main entry (canonical export resolution)');
    process.exit(1);
  }
  console.log('OK: flushRuntimeAuthScope publicly exported from auth main entry (canonical export resolution)');
}

// 5. Core factory exports available (deferred until P17 — just check structure at P19)
if (fs.existsSync('packages/core/src/auth-factories.ts')) {
  const f = fs.readFileSync('packages/core/src/auth-factories.ts', 'utf8');
  if (!f.includes('createKeyringTokenStore') || !f.includes('createAuthPrecedenceResolver')) {
    console.error('FAIL: auth-factories.ts missing required factory exports');
    process.exit(1);
  }
  console.log('OK: auth-factories.ts has required factory exports');
} else {
  console.log('INFO: auth-factories.ts not found (pre-P17)');
}
"

# ISecureStore includes all 5 methods (get, set, delete, list, has) plus error types
node -e "
const fs = require('fs');
const ss = fs.readFileSync('packages/auth/src/interfaces/secure-store.ts', 'utf8');
const required = ['get', 'set', 'delete', 'list', 'has'];
const missing = required.filter(m => !ss.includes(m));
if (missing.length > 0) { console.error('FAIL: ISecureStore missing methods:', missing); process.exit(1); }
console.log('OK: ISecureStore includes all 5 methods');
if (!ss.includes('ISecureStoreError')) { console.error('FAIL: ISecureStoreError missing'); process.exit(1); }
if (!ss.includes('SecureStoreErrorCode')) { console.error('FAIL: SecureStoreErrorCode missing'); process.exit(1); }
console.log('OK: ISecureStoreError and SecureStoreErrorCode present');
"
```
## Package Cycle Verification

Cycle prevention is central to this plan. The final verification MUST include an explicit package-cycle proof. The expected DAG is:

```
packages/auth       ⊥  (zero sibling package dependencies in both dependencies and devDependencies)
packages/core       →  packages/auth
packages/providers  →  packages/auth, packages/core
packages/cli        →  packages/auth, packages/core
```

### Cycle Check Script

Run this self-contained Node script over workspace package metadata:

```bash
# P18/P19 cycle check: self-contained Node script over workspace package metadata
# Checks both dependencies AND devDependencies for cycle risk
node -e "
const fs = require('fs');
const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const workspaceDirs = root.workspaces || [];
const pkgs = {};
for (const dir of workspaceDirs) {
  try {
    const p = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8'));
    const name = p.name;
    const deps = Object.keys({...p.dependencies, ...p.devDependencies}).filter(d => d.startsWith('@vybestack/llxprt-code'));
    pkgs[name] = deps;
  } catch(e) {}
}
// Check: auth has zero vybestack deps (both prod and dev)
if (pkgs['@vybestack/llxprt-code-auth'] && pkgs['@vybestack/llxprt-code-auth'].length > 0) {
  console.error('CYCLE RISK: auth depends on:', pkgs['@vybestack/llxprt-code-auth']);
  process.exit(1);
}
// Check: DAG (simple cycle detection)
const visited = new Set();
const path = new Set();
function check(name) {
  if (path.has(name)) { console.error('CYCLE:', name); process.exit(1); }
  if (visited.has(name)) return;
  visited.add(name); path.add(name);
  for (const dep of (pkgs[name] || [])) check(dep);
  path.delete(name);
}
for (const name of Object.keys(pkgs)) check(name);
console.log('OK: No package cycles detected. DAG verified.');
"

# Verify specific DAG edges
node -e "const p=require('./packages/core/package.json'); if(!Object.keys(p.dependencies||{}).includes('@vybestack/llxprt-code-auth')){console.error('MISSING: core→auth');process.exit(1)}"
node -e "const p=require('./packages/providers/package.json'); const d=Object.keys(p.dependencies||{}); if(!d.includes('@vybestack/llxprt-code-auth')){console.error('MISSING: providers→auth');process.exit(1)} if(!d.includes('@vybestack/llxprt-code-core')){console.error('MISSING: providers→core');process.exit(1)}"
node -e "const p=require('./packages/cli/package.json'); const d=Object.keys(p.dependencies||{}); if(!d.includes('@vybestack/llxprt-code-auth')){console.error('MISSING: cli→auth');process.exit(1)} if(!d.includes('@vybestack/llxprt-code-core')){console.error('MISSING: cli→core');process.exit(1)}"
```

### DAG Verification Criteria

1. `@vybestack/llxprt-code-auth` has zero `@vybestack/*` production dependencies — confirmed by package.json scan.
2. No circular dependency path exists in the workspace graph — confirmed by cycle detection script.
3. Each consumer package declares both expected direct dependencies:
   - `@vybestack/llxprt-code-core` → `@vybestack/llxprt-code-auth`
   - `@vybestack/llxprt-code-providers` → `@vybestack/llxprt-code-auth` AND `@vybestack/llxprt-code-core`
   - `@vybestack/llxprt-code-cli` → `@vybestack/llxprt-code-auth` AND `@vybestack/llxprt-code-core`
4. This cycle check is a required gate for P18/P19 completion.

## Success Criteria

- All `npm run test` passes across entire monorepo
- All `npm run lint` passes
- All `npm run typecheck` passes
- All `npm run format` passes (or already formatted); **review format diffs before committing — `npm run format` is destructive**
- All `npm run build` succeeds for every package in dependency order
- Smoke test `node scripts/start.js --profile-load ollamaglm51 "write me a haiku and nothing else"` completes without error
- Zero auth→core/cli/providers import violations
- Zero relative import escapes from packages/auth/src
- Zero core/src/auth/ files remaining
- Zero old core auth import paths (`@vybestack/llxprt-code-core/auth`) anywhere in repo
- Zero old core auth subpath exports (`./auth/precedence.js`, `./auth/types.js`) in core package.json
- Zero V2/New/Compat/Copy auth files (verified by filename scan)
- `auth-factories.ts` at correct path (`packages/core/src/auth-factories.ts`, NOT inside `auth/`)
- `flushRuntimeAuthScope` exported from `packages/auth/src/index.ts` main entry (verified by index.ts content check, not by source file export regex)
- OAuthManager interface in auth, OAuthProvider in CLI (consistent ownership)
- Package metadata constraints satisfied
- Providers depends on both `@vybestack/llxprt-code-auth` AND `@vybestack/llxprt-code-core` (acyclic DAG verified)
- AuthPrecedenceResolver constructor accepts `ISettingsService`; providers passes `SettingsService` directly (structural typing verified at compile time)
- `AuthPrecedenceResolver` defined in `auth-precedence-resolver.ts` (canonical source file) and exported from `packages/auth/src/index.ts` main entry. `precedence.ts` contains low-level cache primitives and `OAuthManager` interface — the class is in `auth-precedence-resolver.ts`, NOT in `precedence.ts`
- Old `precedence.js` deep-path consumers have migrated to `@vybestack/llxprt-code-auth` main entry (no `@vybestack/llxprt-code-core/auth/precedence.js` or `@vybestack/llxprt-code-core/auth/types.js` import paths remain)
- `ISecureStore` interface includes all 5 methods (get, set, delete, list, has) and error types (`ISecureStoreError`, `SecureStoreErrorCode`)
- `BaseTokenStore` confirmed absent from auth package (MCP subsystem, not auth domain — documented in specification and P00a preflight)