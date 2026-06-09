# Phase 18: Deprecation Cleanup & No Shims

Plan ID: PLAN-20260608-ISSUE1586.P18

> **Phase framing:** This phase performs final cleanup — removing old core/src/auth/ directory, running anti-shim scans, and verifying no old paths remain. All import rewrites were done in P15; factory implementations in P17; subpath export removal in P15. P18 is cleanup-only. No new implementation, no new factory functions, no new import rewrites.

## Prerequisites
- Required: Phase 17a completed
- All consumer migrations verified

## Requirements Implemented

### REQ-CLEAN-001.1: Old auth source files removed from core
### REQ-CLEAN-001.2: No V2/New/Compat/parallel files
### REQ-API-001.2: Core must not re-export auth as compatibility shims

## Phase Tasks

1. Remove `packages/core/src/auth/` directory entirely — by this phase, **zero files** must remain under `core/src/auth/`. All 20 test files moved to `packages/auth` in P09/P10 (after DI refactoring). No test files remain inside `core/src/auth/` at this point.
2. Verify core index.ts re-exports come from `@vybestack/llxprt-code-auth`, not from `./auth/...`.
3. Verify `packages/core/src/auth-factories.ts` exists at the correct path (core/src/ not core/src/auth/).
4. Verify no V2/New/Compat/Copy auth files anywhere in any package.
5. Verify no wrapper files under `packages/core/src/auth/`.
6. Run anti-shim scan commands from `analysis/anti-shim-policy.md` (canonical scans).
7. Run package metadata checks from `analysis/package-metadata-constraints.md`.

## Verification Commands

```bash
# Core auth directory must be empty/removed
if find packages/core/src/auth -type f 2>/dev/null | grep -q .; then
  echo "FAIL: files remain under packages/core/src/auth/"; exit 1
fi

# auth-factories.ts is at correct location (NOT in core/src/auth/)
test -f packages/core/src/auth-factories.ts || { echo "FAIL: auth-factories.ts missing from core/src/"; exit 1; }
test ! -f packages/core/src/auth/auth-factories.ts || { echo "FAIL: auth-factories.ts found inside auth dir"; exit 1; }

# No V2/Compat auth files (canonical scan — single instance, referenced by P19)
node -e "
const { execSync } = require('child_process');
const files = execSync('find packages -type f -name \"*.ts\" 2>/dev/null', {encoding:'utf8'}).trim().split('\\n').filter(f => f);
const bad = files.filter(f => /(?:V2|New|Copy|Compat)[Aa]uth|[Aa]uth(?:V2|New|Copy|Compat)/.test(f));
if (bad.length > 0) { console.error('FAIL: V2/Compat/New/Copy auth files found:'); bad.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('OK: no V2/Compat/New/Copy auth files');
"

# Auth package forbidden import check (canonical scan — single instance, referenced by P19)
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

# No relative import escape
if rg -n "from ['\"].*\.\./\.\./" packages/auth/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' 2>/dev/null; then
  echo "FAIL: relative import escape from auth/src"; exit 1
fi

# Old core auth path imports (repo-wide) — canonical scan (single instance, referenced by P19)
node -e "
const fs = require('fs');
const { execSync } = require('child_process');
const forbidden = ['@vybestack/llxprt-code-core/auth', 'core/src/auth'];
const dirs = ['packages/core/src/core', 'packages/cli/src', 'packages/providers/src'];
let violations = [];
for (const dir of dirs) {
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

# Core auth subpath exports removed — Node.js verifier exits only if exports still present
node -e "const p=require('./packages/core/package.json'); const e=p.exports||{}; const remaining=Object.keys(e).filter(k=>k==='./auth/precedence.js'||k==='./auth/types.js');if(remaining.length>0){console.error('FAIL: core still has auth subpath exports:',remaining);process.exit(1)}console.log('OK: no auth subpath exports')"

# AuthPrecedenceResolver ownership and entry path verification
node -e "
const fs = require('fs');
const path = require('path');

// Canonical export parsing helpers
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
  // Named local exports: export { X, Y } (no from clause)
  const localRe = /export\s+(?:type\s+)?\{([^}]+)\}(?!\s*from\s)/g; let m;
  while ((m = localRe.exec(content)) !== null) { m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean).forEach(n => declared.add(n)); }
  // Default exports
  const defRe = /export\s+default\s+(\w+)/g;
  while ((m = defRe.exec(content)) !== null) { declared.add(m[1]); }
  // Named re-exports: export { X } from 'source'
  const reExports = [];
  const namedRe = /export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = namedRe.exec(content)) !== null) { reExports.push({ names: m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean), source: m[2] }); }
  // Star re-exports: export * from 'source'
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

// 1. auth-precedence-resolver.ts exists and class-declares/exports AuthPrecedenceResolver (canonical export parse)
const aprPath = 'packages/auth/src/auth-precedence-resolver.ts';
const exists = fs.existsSync(aprPath);
if (!exists) { console.error('FAIL: auth-precedence-resolver.ts not found in packages/auth/src/'); process.exit(1); }
const aprContent = fs.readFileSync(aprPath, 'utf8');
const aprExports = parseModuleExports(aprContent);
if (!aprExports.declared.has('AuthPrecedenceResolver')) {
  console.error('FAIL: AuthPrecedenceResolver not class-declared/exported in auth-precedence-resolver.ts (canonical export parse)');
  process.exit(1);
}
// 2. index.ts publicly exports AuthPrecedenceResolver (canonical export resolution)
const idxPath = path.resolve('packages/auth/src/index.ts');
if (!isSymbolExportedFromModule(idxPath, 'AuthPrecedenceResolver')) {
  console.error('FAIL: AuthPrecedenceResolver not publicly exported from auth main entry (canonical export resolution)');
  process.exit(1);
}
console.log('OK: AuthPrecedenceResolver defined in canonical file and publicly exported from main entry');
"

# Package metadata
node -e "const p=require('./packages/auth/package.json'); const deps=Object.keys(p.dependencies||{}); if(deps.some(d=>d.includes('vybestack'))) { console.error('FORBIDDEN'); process.exit(1) }"

npm run typecheck --workspace @vybestack/llxprt-code-core
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run typecheck --workspace @vybestack/llxprt-code
npm run build --workspace @vybestack/llxprt-code-core
npm run build --workspace @vybestack/llxprt-code-auth
npm run build --workspace @vybestack/llxprt-code
```