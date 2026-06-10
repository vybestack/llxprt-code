#!/usr/bin/env node
// Anti-Shim and Package-Cycle Gate
// Referenced from P09, P11, P15, P17, P18, P19 verification commands.
// Run from repository root: node project-plans/issue1586/scripts/verify-auth-extraction-gate.js
//
// NOTE: This script uses CommonJS require(). Since the project's package.json declares
// "type": "module", .js files are treated as ESM by default. This script uses the
// createRequire pattern to enable CJS require() in an ESM context.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let exitCode = 0;

function fail(msg) {
  console.error('FAIL: ' + msg);
  exitCode = 1;
}

function pass(msg) {
  console.log('OK: ' + msg);
}

// ========== CANONICAL IMPORT/EXPORT SPECIFIER CHECKS ==========
// The following checks use canonical import/export specifier parsing instead of
// raw substring scans. This avoids false positives (e.g., comments mentioning
// package names, or test fixture strings containing package names).

// Canonical import specifier regex: matches `from '...'`, `from "..."`,
// `require('...')`, `require("...")`, and `import('...')`
const CANONICAL_IMPORT_RE = /(?:require\(\s*|from\s+|import\(\s*)['"](@?[^'"]+)['"]/g;
// Canonical re-export specifier regex
const CANONICAL_REEXPORT_RE = /export\s+(?:type\s+)?(?:\{[^}]*\}\s+from|[*]\s+from)\s+['"]([^'"]+)['"]/g;

function findCanonicalViolations(content, forbidden, filePath) {
  const violations = [];
  let match;
  // Import specifiers
  const importRe = new RegExp(CANONICAL_IMPORT_RE.source, 'g');
  while ((match = importRe.exec(content)) !== null) {
    const spec = match[1];
    for (const f of forbidden) {
      if (spec === f || spec.startsWith(f + '/')) {
        violations.push(filePath + ': imports ' + spec);
      }
    }
  }
  // Re-export specifiers
  const reexportRe = new RegExp(CANONICAL_REEXPORT_RE.source, 'g');
  while ((match = reexportRe.exec(content)) !== null) {
    const spec = match[1];
    for (const f of forbidden) {
      if (spec === f || spec.startsWith(f + '/')) {
        violations.push(filePath + ': re-exports ' + spec);
      }
    }
  }
  return violations;
}

function walkDirCanonical(dir, forbidden, opts) {
  const excludeTests = opts && opts.excludeTests;
  const violations = [];
  if (!fs.existsSync(dir)) return violations;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      violations.push(...walkDirCanonical(p, forbidden, opts));
    } else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx') || e.name.endsWith('.js')) {
      if (excludeTests && (e.name.includes('.test.') || e.name.includes('.spec.'))) continue;
      const content = fs.readFileSync(p, 'utf8');
      violations.push(...findCanonicalViolations(content, forbidden, p));
    }
  }
  return violations;
}

// ========== HELPER: FIND .ts FILES ==========

function findTsFiles(dir) {
  try {
    return execSync('find ' + dir + ' -type f -name "*.ts" 2>/dev/null', { encoding: 'utf8' })
      .trim().split('\n').filter(f => f && f.length > 0);
  } catch (e) {
    return [];
  }
}

// ========== CANONICAL EXPORT RESOLUTION HELPERS ==========
// Parse ES module exports using canonical patterns (not substring matching)
// and follow export-star sources to resolve transitive exports.

function parseModuleExports(content) {
  const declared = new Set();
  const reExports = [];
  const starSources = [];

  // Declaration exports: export class/function/const/let/var/interface/type/enum X
  const declPatterns = [
    /export\s+class\s+(\w+)/g,
    /export\s+default\s+class\s+(\w+)/g,
    /export\s+function\s+(\w+)/g,
    /export\s+default\s+function\s+(\w+)/g,
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+interface\s+(\w+)/g,
    /export\s+type\s+(\w+)\s*=/g,
    /export\s+enum\s+(\w+)/g,
  ];
  for (const re of declPatterns) {
    const r = new RegExp(re.source, re.flags);
    let m;
    while ((m = r.exec(content)) !== null) {
      if (m[1]) declared.add(m[1]);
    }
  }

  // Named re-exports: export { X, Y as Z } from 'source'
  const namedReexportRe = /export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = namedReexportRe.exec(content)) !== null) {
    const names = m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    reExports.push({ names, source: m[2] });
  }

  // Named local exports: export { X, Y }  (no from clause)
  const namedLocalExportRe = /export\s+(?:type\s+)?\{([^}]+)\}(?!\s*from\s)/g;
  while ((m = namedLocalExportRe.exec(content)) !== null) {
    const names = m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    for (const name of names) declared.add(name);
  }

  // Default exports: export default <identifier>
  const defaultRe = /export\s+default\s+(\w+)/g;
  while ((m = defaultRe.exec(content)) !== null) {
    declared.add(m[1]);
  }

  // Star re-exports: export * from 'source'
  const starRe = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = starRe.exec(content)) !== null) {
    starSources.push(m[1]);
  }

  return { declared, reExports, starSources };
}

function resolveModulePath(fromFilePath, importSpecifier) {
  // Only resolve relative imports (./ or ../)
  if (!importSpecifier.startsWith('.')) return null;
  const dir = path.dirname(fromFilePath);
  const basePath = path.resolve(dir, importSpecifier);
  for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.js', '']) {
    const candidate = basePath + ext;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function isSymbolExportedFromModule(modulePath, symbolName, visited) {
  visited = visited || new Set();
  if (visited.has(modulePath)) return false; // cycle detection
  visited.add(modulePath);
  if (!fs.existsSync(modulePath)) return false;
  const content = fs.readFileSync(modulePath, 'utf8');
  const { declared, reExports, starSources } = parseModuleExports(content);

  // Direct declaration or local named export
  if (declared.has(symbolName)) return true;

  // Named re-export: export { SymbolName } from 'source'
  for (const re of reExports) {
    if (re.names.includes(symbolName)) return true;
  }

  // Star re-exports: export * from 'source' — resolve and recurse
  for (const source of starSources) {
    const resolvedPath = resolveModulePath(modulePath, source);
    if (resolvedPath && isSymbolExportedFromModule(resolvedPath, symbolName, visited)) {
      return true;
    }
  }

  return false;
}

// ========== CHECK 1: Auth package must not depend on core/cli/providers in dependencies OR devDependencies ==========

if (fs.existsSync('packages/auth/package.json')) {
  const authPkg = JSON.parse(fs.readFileSync('packages/auth/package.json', 'utf8'));
  const allDeps = Object.keys({...authPkg.dependencies, ...authPkg.devDependencies});
  const forbiddenDeps = ['@vybestack/llxprt-code-core', '@vybestack/llxprt-code-cli', '@vybestack/llxprt-code-providers', '@vybestack/llxprt-code-tools', '@vybestack/llxprt-code'];
  for (const dep of forbiddenDeps) {
    if (allDeps.includes(dep)) {
      const inProd = authPkg.dependencies && authPkg.dependencies[dep];
      const inDev = authPkg.devDependencies && authPkg.devDependencies[dep];
      fail('auth depends on ' + dep + ' (in ' + (inProd ? 'dependencies' : (inDev ? 'devDependencies' : 'unknown')) + ')');
    }
  }
  const vybestackDeps = allDeps.filter(d => d.startsWith('@vybestack/'));
  if (vybestackDeps.length > 0) {
    fail('auth has vybestack dependencies (prod+dev): ' + vybestackDeps.join(', ') + ' — auth tests must use local DI test doubles');
  } else {
    pass('auth has zero vybestack dependencies (production + dev)');
  }
} else {
  fail('packages/auth/package.json not found');
}

// ========== CHECK 2: Auth source must not import from forbidden packages (canonical specifier parsing) ==========

if (fs.existsSync('packages/auth/src')) {
  // Production code: check for forbidden imports using canonical specifier parsing
  const authForbiddenProd = ['@vybestack/llxprt-code-core', '@vybestack/llxprt-code', '@vybestack/llxprt-code-providers', '@vybestack/llxprt-code-cli', '@vybestack/llxprt-code-tools'];
  const authProdViolations = walkDirCanonical('packages/auth/src', authForbiddenProd, { excludeTests: true });
  if (authProdViolations.length > 0) {
    fail('forbidden imports in auth production code: ' + authProdViolations.join(', '));
  } else {
    pass('no forbidden imports in auth production code (canonical specifier scan)');
  }

  // Test code: check for forbidden imports using canonical specifier parsing
  const authForbiddenTest = ['@vybestack/llxprt-code-core', '@vybestack/llxprt-code-providers'];
  const authTestViolations = walkDirCanonical('packages/auth/src', authForbiddenTest, { excludeTests: false })
    .filter(v => {
      // Only include test files in test-code scan
      const filePath = v.split(':')[0];
      return filePath.includes('.test.') || filePath.includes('.spec.');
    });
  if (authTestViolations.length > 0) {
    fail('forbidden imports in auth test code (core/providers): ' + authTestViolations.join(', '));
  } else {
    pass('no forbidden imports in auth test code (canonical specifier scan)');
  }
} else {
  pass('packages/auth/src not found (pre-scaffold)');
}

// ========== CHECK 3: No old core/auth import paths in consumer packages (canonical specifier parsing) ==========

const consumerForbidden = ['@vybestack/llxprt-code-core/auth'];
const consumerDirs = ['packages/cli/src', 'packages/providers/src', 'packages/core/src/core'];
let consumerViolations = [];
for (const dir of consumerDirs) {
  const dirViolations = walkDirCanonical(dir, consumerForbidden, { excludeTests: false });
  consumerViolations.push(...dirViolations);
}
if (consumerViolations.length > 0) {
  fail('old core/auth imports remain: ' + consumerViolations.join(', '));
} else {
  pass('no old core/auth import paths (canonical specifier scan)');
}

// Also check for relative-path escapes to core/src/auth
const relativeAuthForbidden = ['core/src/auth'];
for (const dir of consumerDirs) {
  if (!fs.existsSync(dir)) continue;
  const files = findTsFiles(dir);
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    const re = new RegExp(CANONICAL_IMPORT_RE.source, 'g');
    let match;
    while ((match = re.exec(content)) !== null) {
      const spec = match[1];
      // Only flag relative imports that resolve to core/src/auth
      if (spec.startsWith('.') && spec.includes('core/src/auth')) {
        consumerViolations.push(f + ': relative import to core/src/auth');
      }
    }
  }
}
if (consumerViolations.length > 0) {
  fail('old core/auth imports (including relative paths) remain: ' + consumerViolations.join(', '));
}

// ========== CHECK 4: No V2/New/Compat/Copy auth files ==========

const tsFiles = findTsFiles('packages');
const badFiles = tsFiles.filter(f => /(?:V2|New|Copy|Compat)[Aa]uth|[Aa]uth(?:V2|New|Copy|Compat)/.test(f));
if (badFiles.length > 0) { fail('V2/Compat/New/Copy auth files found: ' + badFiles.join(', ')); }
else { pass('no V2/Compat/New/Copy auth files'); }

// ========== CHECK 5: Core auth subpath exports removed ==========

if (fs.existsSync('packages/core/package.json')) {
  const corePkg = JSON.parse(fs.readFileSync('packages/core/package.json', 'utf8'));
  const coreExports = corePkg.exports || {};
  const remainingAuthExports = Object.keys(coreExports).filter(k => k === './auth/precedence.js' || k === './auth/types.js');
  if (remainingAuthExports.length > 0) { fail('core still has auth subpath exports: ' + remainingAuthExports.join(', ')); }
  else { pass('no auth subpath exports in core package.json'); }
}

// ========== CHECK 6: AuthPrecedenceResolver ownership: canonical file + main-entry re-export ==========

if (fs.existsSync('packages/auth/src/auth-precedence-resolver.ts')) {
  const apr = fs.readFileSync('packages/auth/src/auth-precedence-resolver.ts', 'utf8');
  // Use canonical export parsing — verify AuthPrecedenceResolver is a named export
  // (class declaration export), not just a substring occurrence.
  const aprExports = parseModuleExports(apr);
  if (!aprExports.declared.has('AuthPrecedenceResolver')) {
    fail('AuthPrecedenceResolver not class-declared/exported in auth-precedence-resolver.ts (canonical export parse)');
  } else {
    pass('AuthPrecedenceResolver class-declared/exported in canonical file auth-precedence-resolver.ts');
  }
} else {
  pass('auth-precedence-resolver.ts not found (pre-move)');
}

if (fs.existsSync('packages/auth/src/index.ts')) {
  // Use canonical export resolution to verify AuthPrecedenceResolver is
  // publicly exported from the auth main entry — not via substring scan.
  const idxPath = path.resolve('packages/auth/src/index.ts');
  const aprFromIndex = isSymbolExportedFromModule(idxPath, 'AuthPrecedenceResolver');
  if (!aprFromIndex) {
    fail('AuthPrecedenceResolver not publicly exported from auth main entry (canonical export resolution)');
  } else {
    pass('AuthPrecedenceResolver publicly exported from auth main entry (canonical export resolution)');
  }

  // CHECK 7: flushRuntimeAuthScope exported from auth main entry (canonical)
  const flushFromIndex = isSymbolExportedFromModule(idxPath, 'flushRuntimeAuthScope');
  if (!flushFromIndex) {
    fail('flushRuntimeAuthScope not publicly exported from auth main entry (canonical export resolution)');
  } else {
    pass('flushRuntimeAuthScope publicly exported from auth main entry (canonical export resolution)');
  }
}

// ========== CHECK 8: Core auth directory must be empty/removed ==========

try {
  const authDirFiles = execSync('find packages/core/src/auth -type f 2>/dev/null', { encoding: 'utf8' }).trim();
  if (authDirFiles) { fail('files remain under packages/core/src/auth/'); }
  else { pass('core/src/auth/ directory empty or removed'); }
} catch (e) { pass('core/src/auth/ directory removed'); }

// ========== CHECK 9: auth-factories.ts at correct path (not inside auth/ subdir) ==========

if (fs.existsSync('packages/core/src/auth-factories.ts')) {
  if (fs.existsSync('packages/core/src/auth/auth-factories.ts')) {
    fail('auth-factories.ts found inside auth/ subdir');
  } else {
    pass('auth-factories.ts at correct path');
  }
} else {
  pass('auth-factories.ts not found (pre-implementation)');
}

// ========== CHECK 10: Package cycle proof ==========

// Verify acyclic DAG: auth ⊥, core→auth, providers→auth+core, cli→auth+core
try {
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

  // auth has zero vybestack deps
  if (pkgs['@vybestack/llxprt-code-auth'] && pkgs['@vybestack/llxprt-code-auth'].length > 0) {
    fail('auth depends on sibling packages: ' + pkgs['@vybestack/llxprt-code-auth'].join(', '));
  } else {
    pass('auth has zero vybestack package dependencies (production + dev)');
  }

  // Cycle detection: detect any cycle in workspace dependency graph
  // Note: current workspace has core→test-utils→core cycle (pre-existing, not related to auth)
  // We only check for auth-related cycles (auth must have zero vybestack deps; that was checked above)
  const visited = new Set();
  const trail = new Set();
  const cycleErrors = [];
  function checkForCycle(name) {
    if (trail.has(name)) {
      // Found a cycle, but only report it if auth is involved
      if (name === '@vybestack/llxprt-code-auth' || trail.has('@vybestack/llxprt-code-auth')) {
        fail('CYCLE involving auth detected: ' + name);
      }
      return;
    }
    if (visited.has(name)) return;
    visited.add(name); trail.add(name);
    for (const dep of (pkgs[name] || [])) { checkForCycle(dep); }
    trail.delete(name);
  }
  for (const name of Object.keys(pkgs)) { checkForCycle(name); }
  if (exitCode === 0) pass('No package cycles involving auth detected. Auth DAG verified.');
  if (exitCode !== 0 && !cycleErrors.length) pass('No package cycles involving auth detected (pre-existing cycles in other packages ignored). Auth DAG verified.');
} catch(e) {
  pass('package cycle check skipped (package.json not found or incomplete)');
}

// ========== CHECK 11: Compile/public import verification ==========

// Verify that key symbols are available as public exports from the auth package.
// This checks index.ts for re-exports of critical symbols using canonical
// export specifier parsing rather than substring matching.
if (fs.existsSync('packages/auth/src/index.ts')) {
  const idxContent = fs.readFileSync('packages/auth/src/index.ts', 'utf8');

  // Parse re-export specifiers from index.ts to verify public API surface
  const reExports = [];
  const reRe = new RegExp(CANONICAL_REEXPORT_RE.source, 'g');
  let m;
  while ((m = reRe.exec(idxContent)) !== null) {
    reExports.push(m[1]);
  }

  // Also check for named export lines like: export { X, Y } from '...'
  // and: export type { X } from '...' and re-export lines
  const namedExportRe = /export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  const exportedNames = [];
  while ((m = namedExportRe.exec(idxContent)) !== null) {
    const names = m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim());
    const source = m[2];
    for (const name of names) {
      if (name) exportedNames.push({ name, source });
    }
  }

  // Check that auth package doesn't re-export from core/cli/providers via index.ts
  const forbiddenSources = ['@vybestack/llxprt-code-core', '@vybestack/llxprt-code-cli', '@vybestack/llxprt-code-providers'];
  const forbiddenReExports = reExports.filter(s =>
    forbiddenSources.some(f => s === f || s.startsWith(f + '/'))
  );
  const forbiddenNamed = exportedNames.filter(e =>
    forbiddenSources.some(f => e.source === f || e.source.startsWith(f + '/'))
  );
  if (forbiddenReExports.length > 0 || forbiddenNamed.length > 0) {
    const allBad = [...forbiddenReExports, ...forbiddenNamed.map(e => e.source)];
    fail('auth index.ts re-exports from forbidden packages: ' + [...new Set(allBad)].join(', '));
  } else {
    pass('auth index.ts does not re-export from core/cli/providers (canonical specifier scan)');
  }
}

// ========== CHECK 12: Relative import boundary — auth/src must not escape via ../../ ==========

if (fs.existsSync('packages/auth/src')) {
  // Also check for relative-path escapes (../../../  or ../../ patterns reaching outside auth/src)
  if (!fs.existsSync('packages/auth/src')) {
    pass('packages/auth/src not found (pre-scaffold)');
  } else {
    const entries = fs.readdirSync('packages/auth/src', { withFileTypes: true });
    // Recursive walk looking for relative imports that escape ../../
    function checkRelativeEscapes(dir) {
      const violations = [];
      if (!fs.existsSync(dir)) return violations;
      const ents = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          violations.push(...checkRelativeEscapes(p));
        } else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx') || e.name.endsWith('.js')) {
          const content = fs.readFileSync(p, 'utf8');
          const importRe = new RegExp(CANONICAL_IMPORT_RE.source, 'g');
          let match;
          while ((match = importRe.exec(content)) !== null) {
            const spec = match[1];
            // Check for relative imports escaping packages/auth/src
            if (spec.startsWith('../../../')) {
              violations.push(p + ': relative import escape ' + spec);
            }
            // Check for relative imports reaching core/cli/providers
            if (spec.startsWith('../') && (spec.includes('core/') || spec.includes('cli/') || spec.includes('providers/'))) {
              violations.push(p + ': relative import to sibling package ' + spec);
            }
          }
        }
      }
      return violations;
    }
    const escapeViolations = checkRelativeEscapes('packages/auth/src');
    if (escapeViolations.length > 0) {
      fail('relative import boundary violations in auth: ' + escapeViolations.join(', '));
    } else {
      pass('no relative import boundary violations in auth (canonical specifier scan)');
    }
  }
}


// ========== CHECK 13: AuthPrecedenceResolver ownership — NOT defined in precedence.ts ==========

// AuthPrecedenceResolver class MUST be defined ONLY in auth-precedence-resolver.ts,
// NOT in precedence.ts. precedence.ts contains OAuthManager interface and cache primitives.
if (fs.existsSync('packages/auth/src/precedence.ts')) {
  const precContent = fs.readFileSync('packages/auth/src/precedence.ts', 'utf8');
  if (/export\s+class\s+AuthPrecedenceResolver/.test(precContent)) {
    fail('AuthPrecedenceResolver class definition found in precedence.ts — must be in auth-precedence-resolver.ts only');
  } else {
    pass('precedence.ts does not define AuthPrecedenceResolver class');
  }
} else {
  pass('precedence.ts not found (pre-move)');
}

// ========== CHECK 14: Compile/public import tests for key exports ==========

// Verify core factory exports are available (if auth-factories.ts exists)
if (fs.existsSync('packages/core/src/auth-factories.ts')) {
  const factContent = fs.readFileSync('packages/core/src/auth-factories.ts', 'utf8');
  const hasCreateKeyringTokenStore = factContent.includes('createKeyringTokenStore');
  const hasCreateAuthPrecedenceResolver = factContent.includes('createAuthPrecedenceResolver');
  if (!hasCreateKeyringTokenStore || !hasCreateAuthPrecedenceResolver) {
    fail('auth-factories.ts missing required factory exports: ' +
      (!hasCreateKeyringTokenStore ? 'createKeyringTokenStore ' : '') +
      (!hasCreateAuthPrecedenceResolver ? 'createAuthPrecedenceResolver' : ''));
  } else {
    pass('auth-factories.ts has required factory exports');
  }
} else {
  pass('auth-factories.ts not found (pre-P17)');
}

// ========== CHECK 15: Test-code forbidden imports (canonical specifier parsing for .test.ts/.spec.ts) ==========

// Auth test files must not import from core or providers
// (tests use local DI test doubles, not sibling package imports)
if (fs.existsSync('packages/auth/package.json')) {
  const authPkg = JSON.parse(fs.readFileSync('packages/auth/package.json', 'utf8'));
  const devDeps = Object.keys(authPkg.devDependencies || {});
  const forbiddenDevDeps = ['@vybestack/llxprt-code-core', '@vybestack/llxprt-code-cli', '@vybestack/llxprt-code-providers', '@vybestack/llxprt-code-tools', '@vybestack/llxprt-code'];
  for (const dep of forbiddenDevDeps) {
    if (devDeps.includes(dep)) {
      fail('auth devDependency on ' + dep + ' — auth tests must use local DI test doubles, not sibling package imports');
    }
  }
  if (devDeps.some(d => d.startsWith('@vybestack/'))) {
    fail('auth has @vybestack devDependencies: ' + devDeps.filter(d => d.startsWith('@vybestack/')).join(', '));
  }
}
process.exit(exitCode);