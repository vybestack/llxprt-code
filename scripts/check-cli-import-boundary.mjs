#!/usr/bin/env node

/**
 * check-cli-import-boundary.mjs
 *
 * Enforces the public API boundary for packages/cli/src (#2204, parent #1595).
 *
 * The CLI must be ONE CLIENT of the shared Agent/runtime API — not a co-owner
 * of runtime assembly. This script classifies every import in
 * packages/cli/src production source (static imports, dynamic import(), and
 * vi.mock module specifiers) and forbids deep/internal runtime-construction
 * imports from the runtime packages, EXCEPT for a narrow per-file allowlist of
 * genuine bootstrap/quarantine modules.
 *
 * It also:
 *   - forbids the `agent.getConfig(` / `.getConfig()` escape hatch anywhere in
 *     packages/cli/src (the Config must be reached via the public Agent
 *     surface, not an opaque getConfig back-door).
 *   - asserts packages/cli/index.ts stays under a thin-entry line threshold.
 *
 * Modeled on scripts/check-storage-import-boundary.mjs (TypeScript compiler
 * API) for accurate specifier detection across all import kinds.
 *
 * The allowlist is a QUARANTINE BOUNDARY THAT MUST SHRINK OVER TIME: each entry
 * is a genuine bootstrap/runtime-construction site that has no public-API
 * replacement yet. New entries require explicit justification.
 */

import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Anchor the repo root to THIS script's location (import.meta.url) rather than
 * process.cwd(), so the boundary check is deterministic regardless of which
 * directory the script is invoked from (#2204). The script lives at
 * <repo>/scripts/check-cli-import-boundary.mjs, so the repo root is one level
 * up from the script directory.
 *
 * An override via the CLI_BOUNDARY_ROOT env var is supported for the script's
 * own synthetic-fixture test suite (scripts/tests/cli-import-boundary.test.js),
 * which builds throwaway trees under temp dirs. Production/CI invocations never
 * set this env var and always resolve against the script-anchored root.
 */
const REPO_ROOT = process.env.CLI_BOUNDARY_ROOT
  ? resolve(process.env.CLI_BOUNDARY_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CLI_SRC_DIR = join(REPO_ROOT, 'packages/cli/src');
const CLI_INDEX = join(REPO_ROOT, 'packages/cli/index.ts');
const CLI_ENTRY = join(REPO_ROOT, 'packages/cli/src/cli.tsx');

// Real entry/bootstrap files must stay thin (under-200-line spirit of #1595).
// packages/cli/index.ts is the true entrypoint: shebang + error handling only.
const THIN_ENTRY_MAX_LINES = 200;

// Deep sub-paths of these runtime packages are violations unless allowlisted.
// The bare package roots (@vybestack/llxprt-code-core etc.) are PUBLIC and
// always allowed; only the `/<deep>` forms are constrained.
const RUNTIME_PACKAGES = [
  '@vybestack/llxprt-code-core',
  '@vybestack/llxprt-code-providers',
  '@vybestack/llxprt-code-agents',
  '@vybestack/llxprt-code-settings',
  '@vybestack/llxprt-code-mcp',
];

// Public subpaths that are NOT deep/internal — they are documented public
// entrypoints and always allowed (do not require an allowlist entry).
//
// Scoped PER PACKAGE: a subpath that is public for one runtime package may be
// internal for another. For example, `runtime.js` is a public barrel of the
// providers package, but treating it as package-agnostic would also allow
// `@vybestack/llxprt-code-core/runtime.js`, `…settings/runtime.js`, etc.,
// masking real boundary violations. Each key is a RUNTIME_PACKAGES entry;
// the value is the list of public subpaths for that package.
const PUBLIC_SUBPATHS_BY_PACKAGE = {
  // providers public barrels / curated subpath entrypoints. Each is a declared
  // package.json `exports` entry with its own barrel index.ts and a documented
  // public API (#2204). They are NOT deep/internal imports.
  '@vybestack/llxprt-code-providers': [
    'runtime.js',
    'auth.js',
    'composition.js',
  ],
};

/**
 * Per-file allowlist of permitted deep specifiers. Keys are repo-relative
 * paths under packages/cli/src; values are arrays of permitted specifiers.
 *
 * QUARANTINE BOUNDARY (shrinks over time as the public Agent/runtime API
 * grows). Each entry is a genuine runtime-construction/bootstrap site that
 * has no public-API replacement yet. The intent is that this list only ever
 * SHRINKS: every future public-API promotion should remove the corresponding
 * entry.
 *
 * After #2204 burn-down, this list contains ONLY genuine bootstrap/config
 * composition boundaries — the CLI's one legitimate role as a thin client
 * that wires the runtime context. UI/commands/hooks/contexts/components/
 * layouts/utils deep imports have been eliminated by routing through the
 * public runtime.js / auth.js / composition.js barrels and the curated
 * public Agent API.
 *
 * Remaining tiers:
 *   - bootstrap/config/nonInteractive: genuine runtime assembly that wires
 *     the core settings-runtime adapter (a core-internal composition seam
 *     not yet promoted to a public core entrypoint).
 */
const ALLOWLIST = {
  // ── config bootstrap: core settings-runtime adapter ────────────────────
  // These are genuine composition-boundary sites: the core-owned
  // settingsRuntimeAdapter is the dependency-inversion seam that binds a
  // SettingsService to a runtime context. It has no public core entrypoint
  // yet (the core root does not re-export it), so these bootstrap files are
  // the ONLY allowed deep importers.
  'packages/cli/src/config/profileBootstrap.ts': [
    '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js',
  ],
  'packages/cli/src/nonInteractiveCli.ts': [
    '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js',
  ],
};

// Paths under packages/cli/src that are test infrastructure (excluded from the
// import scan — tests may freely mock/import internals). The import-boundary
// rule governs PRODUCTION source only.
const TEST_DIR_GLOBS = [
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/test-utils/**',
  '**/*-test-helpers*',
  '**/*test-helper*',
  // The integration-tests/ directory is entirely test infrastructure
  // (integration specs + their helpers/fixtures), not production source.
  '**/integration-tests/**',
];

/**
 * Bare directory base-names that are test infrastructure. When walkDir
 * encounters a directory whose name matches one of these, it prunes the
 * entire subtree early (skips recursion) for both clarity and performance —
 * the file-level TEST_DIR_GLOBS above still catch stray test files outside
 * these directories.
 */
const TEST_DIR_BASE_NAMES = new Set([
  '__tests__',
  'test-utils',
  'integration-tests',
]);

/**
 * Bare directory base-names that are third-party or build outputs. These are
 * never production CLI source, so recursing into them wastes time and can
 * surface false positives if a vendored/build artifact happens to contain a
 * deep import. walkDir prunes the entire subtree early, just like
 * TEST_DIR_BASE_NAMES.
 */
const NON_SOURCE_DIR_BASE_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  '.turbo',
  'coverage',
]);

/**
 * All base-names whose subtrees walkDir prunes (test infra + non-source).
 * Composed once so the recursion check is a single Set membership test.
 */
const PRUNED_DIR_BASE_NAMES = new Set([
  ...TEST_DIR_BASE_NAMES,
  ...NON_SOURCE_DIR_BASE_NAMES,
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

function walkDir(dir) {
  const results = [];
  const absDir = resolve(dir);

  function shouldExclude(filePath) {
    const rel = relative(REPO_ROOT, filePath).replace(/\\/g, '/');
    return TEST_DIR_GLOBS.some((glob) => matchGlob(glob, rel));
  }

  function walk(d) {
    if (shouldExclude(d)) return;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch (err) {
      // A genuinely missing directory is expected (synthetic fixture trees
      // may not contain packages/cli/src), so ENOENT is skipped silently.
      // Any OTHER failure (permissions, broken symlink, I/O error) MUST fail
      // loudly so the boundary check cannot silently pass by skipping an
      // unreadable directory full of violations.
      if (err && err.code === 'ENOENT') return;
      throw err;
    }
    function processEntry(entry) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        // Prune entire test-infrastructure and non-source (node_modules,
        // dist, build, ...) subtrees by base-name for clarity and
        // performance, before recursing into them.
        if (PRUNED_DIR_BASE_NAMES.has(entry.name)) return;
        if (shouldExclude(full)) return;
        walk(full);
      } else if (
        !shouldExclude(full) &&
        entry.isFile() &&
        (extname(entry.name) === '.ts' || extname(entry.name) === '.tsx')
      ) {
        results.push(full);
      }
    }
    for (const entry of entries) {
      processEntry(entry);
    }
  }
  walk(absDir);
  return results;
}

/**
 * Minimal glob matcher supporting `*` (single segment, non-slash) and `**`
 * (any path). Anchored to the full relative path.
 *
 * Implementation: escape ALL regex metacharacters in the glob first, then
 * convert the (now-safe) glob tokens `**` and `*` back into regex. After
 * escaping each `*` becomes the two-character sequence `\*`, so `**` is
 * `\*\*` and a lone `*` is `\*`. This escape-all-first approach guarantees no
 * literal metacharacter in a path can ever slip through unescaped. A literal
 * `/` in the glob is NOT a regex metacharacter, so it passes through
 * unescaped and is matched directly.
 */
function matchGlob(glob, relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  // 1. Escape every regex metacharacter so the glob is treated literally.
  const escaped = glob.replace(/[\\^$.|?*+(){}[\]]/g, (ch) => '\\' + ch);
  // 2. Re-introduce glob semantics on the escaped tokens.
  //    `\*\*` → `.*` (any path, including across slashes). The following
  //    literal `/` (which is never escaped) is matched by the regex directly
  //    — no optional-slash group is needed.
  //    A lone `\*` → `[^/]*` (single segment, no slash).
  //    Order matters: resolve `\*\*` before `\*`.
  const body = escaped.replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*');
  return new RegExp('^' + body + '$').test(normalized);
}

/**
 * Returns true if `specifier` is a deep sub-path of a runtime package that is
 * NOT a documented public subpath for THAT package.
 *
 * Public subpaths are scoped per package (PUBLIC_SUBPATHS_BY_PACKAGE), so a
 * subpath that is public for one package (e.g. providers/runtime.js) is still
 * treated as a violation for any other package (e.g. core/runtime.js).
 */
function isDisallowedDeepImport(specifier) {
  for (const pkg of RUNTIME_PACKAGES) {
    if (specifier === pkg) return false; // bare root is public
    if (specifier.startsWith(pkg + '/')) {
      const subPath = specifier.slice(pkg.length + 1);
      const publicForPkg = PUBLIC_SUBPATHS_BY_PACKAGE[pkg] ?? [];
      if (publicForPkg.includes(subPath)) return false;
      // any other sub-path is a deep/internal import
      return true;
    }
  }
  return false;
}

function getLine(sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function isAllowed(relFile, specifier) {
  const allowed = ALLOWLIST[relFile];
  return Boolean(allowed && allowed.includes(specifier));
}

/**
 * Predicate: is `node` a `vi.mock(...)` call expression?
 *
 * The receiver MUST be the identifier `vi` (not just any `.mock(...)` call),
 * so `somethingElse.mock('...')` is NOT a vi.mock call. This single predicate
 * is the canonical vi.mock shape detector shared by specifierOf,
 * isNonLiteralViMock, and analyzeFile's import-kind classification, so the
 * three call sites can never drift apart (#2204).
 */
function isViMockCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const expr = node.expression;
  return (
    ts.isPropertyAccessExpression(expr) &&
    expr.name.text === 'mock' &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'vi'
  );
}

/**
 * Extract the module specifier string from any import-bearing node, or null.
 *
 * Returns null for non-literal specifiers (e.g. `vi.mock(someVar)`), so the
 * caller can separately flag non-literal vi.mock calls via
 * `isNonLiteralViMock` (production vi.mock must be static per vitest's hoisting
 * rules — a dynamic specifier cannot be statically analyzed and could hide a
 * deep runtime import).
 */
function specifierOf(node) {
  if (!node) return null;
  // static import / import-equals
  if (ts.isImportDeclaration(node)) {
    const m = node.moduleSpecifier;
    return m && ts.isStringLiteral(m) ? m.text : null;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    node.moduleReference &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    const expr = node.moduleReference.expression;
    return expr && ts.isStringLiteral(expr) ? expr.text : null;
  }
  // dynamic import(...) and vi.mock(...)
  if (ts.isCallExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      return arg && ts.isStringLiteral(arg) ? arg.text : null;
    }
    if (isViMockCall(node)) {
      const arg = node.arguments[0];
      return arg && ts.isStringLiteral(arg) ? arg.text : null;
    }
  }
  return null;
}

/**
 * Detect a `vi.mock(...)` call whose first argument is NOT a string literal.
 *
 * Production vi.mock specifiers must be static (vitest hoists and statically
 * analyzes them); a dynamic/non-literal specifier cannot be inspected by this
 * boundary guard and could hide a deep runtime import. Such a call is flagged
 * as a violation so it cannot silently bypass the boundary check.
 *
 * Returns the CallExpression node when it matches `vi.mock(<non-string>)`, or
 * null otherwise.
 */
function isNonLiteralViMock(node) {
  if (!isViMockCall(node)) return null;
  const arg = node.arguments[0];
  // Flag only when there IS an argument and it is NOT a string literal.
  if (arg !== undefined && !ts.isStringLiteral(arg)) {
    return node;
  }
  return null;
}

/**
 * Analyze a single file for boundary violations. Returns a list of violation
 * objects: { line, importKind, specifier }.
 */
function analyzeFile(filePath) {
  const sourceText = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations = [];

  function visit(node) {
    const specifier = specifierOf(node);
    if (specifier !== null && isDisallowedDeepImport(specifier)) {
      const relFile = relative(REPO_ROOT, filePath).replace(/\\/g, '/');
      if (!isAllowed(relFile, specifier)) {
        let importKind = 'static-import';
        if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword
        ) {
          importKind = 'dynamic-import';
        } else if (
          // Use the shared isViMockCall predicate so the vi.mock shape stays
          // identical to the one in specifierOf / isNonLiteralViMock. The
          // receiver MUST be the identifier `vi`, not just any `.mock(...)`
          // call, so `somethingElse.mock('...')` is classified as a
          // static-import (the specifier still came from specifierOf) rather
          // than vi.mock.
          isViMockCall(node)
        ) {
          importKind = 'vi.mock';
        } else if (ts.isImportEqualsDeclaration(node)) {
          importKind = 'import-equals';
        }
        violations.push({
          line: getLine(sourceFile, node.getStart()),
          importKind,
          specifier,
        });
      }
    }
    // Non-literal vi.mock detection: a vi.mock call whose first argument is
    // not a string literal cannot be statically analyzed by this guard and
    // could hide a deep runtime import. Flag it so it cannot silently bypass
    // the boundary check (#2204).
    const nonLiteralMock = isNonLiteralViMock(node);
    if (nonLiteralMock !== null) {
      violations.push({
        line: getLine(sourceFile, nonLiteralMock.getStart()),
        importKind: 'vi.mock-non-literal',
        specifier: '<dynamic>',
      });
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);

  // Deduplicate
  const seen = new Set();
  return violations.filter((v) => {
    const key = `${v.line}|${v.importKind}|${v.specifier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Collect ALL import specifiers (static, dynamic import(), vi.mock) from a
 * file as a Set of strings. Used by the self-pruning allowlist guard to verify
 * that every allowlisted specifier is still actually imported by its file.
 * Returns an empty set for unreadable/empty files.
 */
function collectAllSpecifiers(filePath) {
  let sourceText;
  try {
    sourceText = readFileSync(filePath, 'utf-8');
  } catch {
    return new Set();
  }
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers = new Set();
  function visit(node) {
    const spec = specifierOf(node);
    if (spec !== null) {
      specifiers.add(spec);
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return specifiers;
}

/**
 * Scan for the getConfig escape hatch. Three shapes are forbidden in
 * production CLI source so the Config is never reached via an opaque
 * back-door:
 *
 *   1. Property-access call:  `agent.getConfig()` / `x.getConfig()`
 *   2. Bare identifier call:  `getConfig()` — reachable after destructuring
 *      (`const { getConfig } = agent`) or a named import. The property-access
 *      guard alone misses this form.
 *   3. Property-access extraction: `const fn = agent.getConfig` (the method
 *      reference is read WITHOUT being called). Without this guard the
 *      reference can be invoked later as `fn()`, bypassing shapes 1 and 2
 *      because the receiver is no longer named `getConfig`.
 *
 * This guard is INTENTIONALLY BROAD: it matches ANY call whose receiver or
 * identifier is named `getConfig`, and ANY read of a `.getConfig` property,
 * regardless of binding origin. This is by design — the `agent.getConfig()`
 * escape hatch lets the CLI reach the Config object via an opaque back-door,
 * bypassing the public Agent surface. The broad match ensures no variant
 * (destructured, imported, aliased, extracted) can slip through.
 *
 * False-positive resolution: if a LEGITIMATE local helper happens to be named
 * `getConfig` (e.g. a narrow settings-reader unrelated to the Config object),
 * the cleanest resolution is to RENAME the helper to a more specific name
 * (e.g. `getProviderConfig`, `resolveRuntimeConfig`) so it is no longer
 * caught by this guard. Do NOT add an allowlist for bare `getConfig` — that
 * would re-open the escape hatch. The broad guard is preferred over a narrow
 * allowlist because type-information (which binding the identifier resolves
 * to) is not available in this lightweight AST scan.
 */
function scanGetConfigEscapeHatch(filePath) {
  const sourceText = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits = [];
  // Property accesses named `getConfig` that ARE the callee of a call
  // expression are reported by Shape 1 (the call-expression visit). This set
  // records every `.getConfig` property access so the Shape 3 check can tell
  // whether a given access is the called form (already reported) or the
  // extracted form (reported here), avoiding double-reporting.
  const calledPropertyAccesses = new Set();
  function visit(node) {
    if (ts.isCallExpression(node)) {
      // Shape 1: <expr>.getConfig()
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'getConfig'
      ) {
        calledPropertyAccesses.add(node.expression);
        hits.push({ line: getLine(sourceFile, node.getStart()) });
      } else if (
        // Shape 2: bare getConfig() — the identifier is bound via
        // destructuring or a named import, so it has no property-access
        // receiver. Catching the bare identifier form closes the escape
        // hatch that destructuring/import would otherwise open.
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'getConfig'
      ) {
        hits.push({ line: getLine(sourceFile, node.getStart()) });
      }
    } else if (
      // Shape 3: `agent.getConfig` read WITHOUT being called (e.g.
      // `const fn = agent.getConfig`). The extracted reference can be invoked
      // later as `fn()`, bypassing shapes 1 and 2. Skip accesses that are the
      // callee of a call expression — those are reported by Shape 1.
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'getConfig' &&
      !calledPropertyAccesses.has(node)
    ) {
      hits.push({ line: getLine(sourceFile, node.getStart()) });
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return hits;
}

function countLines(relPath) {
  // trimEnd() before split so a trailing newline does not produce a phantom
  // empty element that inflates the count by one. 'a\nb\n' splits to 3
  // elements without trimming but represents 2 actual lines.
  return readFileSync(relPath, 'utf-8').trimEnd().split('\n').length;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function relRepo(filePath) {
  return relative(REPO_ROOT, filePath).replace(/\\/g, '/');
}

/**
 * Format a single deep-import violation for console output. Extracted from
 * the scan phase to keep reporting concerns separate from collection logic.
 */
function formatViolationLine(v) {
  if (v.importKind === 'vi.mock-non-literal') {
    return (
      `    line ${v.line}: vi.mock(<non-literal>) — vi.mock specifiers must` +
      ' be static string literals so this guard can analyze them; a dynamic' +
      ' specifier could hide a deep runtime import'
    );
  }
  if (v.symbol !== undefined) {
    return (
      `    line ${v.line}: ${v.specifier} imports internal symbol` +
      ` '${v.symbol}' (${v.importKind}) — the bare root re-exports` +
      ' internals; use a public Agent symbol instead'
    );
  }
  return (
    `    line ${v.line}: ${v.specifier} (${v.importKind}) — use the public` +
    ' package root or add a justified allowlist entry'
  );
}

/**
 * Phase 1: Deep-import boundary scan. Walks all production source files and
 * reports any disallowed deep runtime imports. Returns the per-file violation
 * map (reused by the thin-entry guard in phase 4) and whether any violations
 * were found.
 */
function runDeepImportScan(files) {
  console.log('Checking CLI import boundary (packages/cli/src)...');
  const violationsByFile = {};
  let totalViolations = 0;
  for (const filePath of files) {
    const rel = relRepo(filePath);
    const viols = analyzeFile(filePath);
    if (viols.length > 0) {
      violationsByFile[rel] = viols;
      totalViolations += viols.length;
    }
  }
  if (totalViolations > 0) {
    console.log(`FAIL: ${totalViolations} disallowed import(s):\n`);
    for (const [file, viols] of Object.entries(violationsByFile)) {
      console.log(`  ${file}:`);
      for (const v of viols) {
        console.log(formatViolationLine(v));
      }
    }
    console.log('');
  } else {
    console.log('PASS: no disallowed deep runtime imports in CLI source.\n');
  }
  return { failed: totalViolations > 0, violationsByFile };
}

/**
 * Phase 2: getConfig() escape-hatch scan. Flags any call to `getConfig(`
 * in CLI production source — the Config must be reached via the public Agent
 * surface, not an opaque getConfig back-door.
 */
function runGetConfigScan(files) {
  console.log('Checking for getConfig() escape-hatch usage...');
  let getConfigHits = 0;
  const getConfigByFile = {};
  for (const filePath of files) {
    const rel = relRepo(filePath);
    const hits = scanGetConfigEscapeHatch(filePath);
    if (hits.length > 0) {
      getConfigByFile[rel] = hits;
      getConfigHits += hits.length;
    }
  }
  if (getConfigHits > 0) {
    console.log(
      `FAIL: ${getConfigHits} getConfig() escape-hatch usage(s) found:\n`,
    );
    for (const [file, hits] of Object.entries(getConfigByFile)) {
      console.log(`  ${file}:`);
      for (const h of hits) {
        console.log(
          `    line ${h.line}: getConfig() escape-hatch — reach Config via` +
            ' the public Agent surface instead (if this is a legitimate local' +
            ' helper, rename it to a more specific name; do NOT add an' +
            ' allowlist)',
        );
      }
    }
    console.log('');
    return true;
  }
  console.log('PASS: no getConfig() escape-hatch usage in CLI source.\n');
  return false;
}

/**
 * Phase 3: Self-pruning allowlist guard. Every allowlisted file MUST exist in
 * the scanned production source, and every allowlisted specifier/symbol MUST
 * still be imported. This prevents stale allowlist entries from accumulating
 * after a refactor removes the import.
 */
function runAllowlistFreshness(scannedRelFiles) {
  console.log('Checking allowlist freshness (self-pruning guard)...');
  // Only run the freshness check against the real production source tree.
  // Synthetic test fixtures (CLI_BOUNDARY_ROOT set) do not contain the full
  // set of allowlisted files, so checking freshness there would report every
  // absent entry as stale (false noise).
  if (process.env.CLI_BOUNDARY_ROOT) {
    console.log('SKIP: allowlist freshness (synthetic fixture tree).\n');
    return false;
  }
  let staleEntries = 0;
  const staleByFile = {};
  for (const [allowFile, allowSpecs] of Object.entries(ALLOWLIST)) {
    collectStaleEntries(allowFile, allowSpecs, scannedRelFiles, staleByFile);
    staleEntries += (staleByFile[allowFile] ?? []).length;
  }
  if (staleEntries === 0) {
    console.log('PASS: allowlist is fresh (no stale entries).\n');
    return false;
  }
  console.log(`FAIL: ${staleEntries} stale allowlist entr(y/ies) found:\n`);
  for (const [file, entries] of Object.entries(staleByFile)) {
    console.log(`  ${file}:`);
    for (const e of entries) {
      console.log(formatStaleEntry(e));
    }
  }
  console.log('');
  return true;
}

function collectStaleEntries(
  allowFile,
  allowSpecs,
  scannedRelFiles,
  staleByFile,
) {
  if (!scannedRelFiles.has(allowFile)) {
    staleByFile[allowFile] = [{ kind: 'missing-file', detail: allowFile }];
    return;
  }
  const absFile = join(REPO_ROOT, allowFile);
  const actualSpecs = collectAllSpecifiers(absFile);
  const stale = [];
  for (const spec of allowSpecs) {
    if (!actualSpecs.has(spec)) {
      stale.push({ kind: 'unused-specifier', detail: spec });
    }
  }
  if (stale.length > 0) {
    staleByFile[allowFile] = stale;
  }
}

function formatStaleEntry(e) {
  if (e.kind === 'missing-file') {
    return '    allowlisted file no longer exists in production source — remove the entry';
  }
  return `    allowlisted specifier '${e.detail}' is no longer imported — remove the entry`;
}

/**
 * Phase 4: Thin-entry guard. Asserts packages/cli/index.ts stays under the
 * thin-entry line threshold and that cli.tsx does not directly import
 * runtime-construction deep paths.
 */
function runThinEntryGuard(violationsByFile) {
  console.log('Checking thin-entry structure...');
  // These guards only apply when the real entrypoint files exist (they are
  // absent in synthetic fixture trees used by the script's own tests). The
  // thin CLI_INDEX check and the CLI_ENTRY deep-import check are INDEPENDENT:
  // if packages/cli/index.ts is deleted but packages/cli/src/cli.tsx still
  // exists, the dedicated cli.tsx orchestrator-specific deep-import guard
  // (and its PASS/FAIL message) must still run. Nesting it inside the
  // CLI_INDEX existence check would silently skip the cli.tsx guard in that
  // scenario (#2204).
  let failed = checkThinIndex();
  failed = checkCliEntryDeepImports(violationsByFile) || failed;
  return failed;
}

function checkThinIndex() {
  if (!existsSync(CLI_INDEX)) {
    console.log(`SKIP: thin CLI_INDEX guard (${CLI_INDEX} absent).`);
    return false;
  }
  const indexLines = countLines(CLI_INDEX);
  if (indexLines > THIN_ENTRY_MAX_LINES) {
    console.log(
      `FAIL: ${CLI_INDEX} is ${indexLines} lines (threshold ${THIN_ENTRY_MAX_LINES}). ` +
        'The real entrypoint must stay thin: shebang + top-level error handling + main() invocation only.',
    );
    return true;
  }
  console.log(
    `PASS: ${CLI_INDEX} is ${indexLines} lines (<= ${THIN_ENTRY_MAX_LINES}).`,
  );
  return false;
}

function checkCliEntryDeepImports(violationsByFile) {
  // Reuse the analysis from phase 1 (CLI_ENTRY is under CLI_SRC_DIR and was
  // already scanned) instead of re-analyzing the file.
  if (!existsSync(CLI_ENTRY)) {
    if (existsSync(CLI_INDEX)) {
      console.log(`SKIP: CLI_ENTRY deep-import guard (${CLI_ENTRY} absent).`);
    } else {
      console.log('SKIP: thin-entry guard (entrypoint files absent).');
    }
    return false;
  }
  const entryRel = relRepo(CLI_ENTRY);
  const entryViolations = violationsByFile[entryRel] ?? [];
  if (entryViolations.length > 0) {
    console.log(
      `\nFAIL: ${entryRel} directly imports runtime-construction deep paths:`,
    );
    for (const v of entryViolations) {
      console.log(`    line ${v.line}: ${v.specifier} (${v.importKind})`);
    }
    return true;
  }
  console.log(
    `PASS: ${CLI_ENTRY} does not directly import runtime-construction deep paths.`,
  );
  return false;
}

function main() {
  // ── 1. Deep-import boundary scan ───────────────────────────────────────
  const files = walkDir(CLI_SRC_DIR);
  if (files.length === 0) {
    // An empty file list means the scan directory was not found or is empty
    // — the boundary check would silently PASS without scanning anything,
    // which is a dangerous false-positive. Fail loudly instead.
    console.log(
      `FAIL: no TypeScript source files found under ${CLI_SRC_DIR}. ` +
        'The scan directory must exist and contain production source.',
    );
    process.exit(1);
  }
  console.log(`Scanning ${files.length} production source files...\n`);
  const scanResult = runDeepImportScan(files);
  let failed = scanResult.failed;

  // ── 2. getConfig escape-hatch scan ─────────────────────────────────────
  failed = runGetConfigScan(files) || failed;

  // ── 3. Self-pruning allowlist guard ────────────────────────────────────
  const scannedRelFiles = new Set(files.map(relRepo));
  failed = runAllowlistFreshness(scannedRelFiles) || failed;

  // ── 4. Thin-entry guard ────────────────────────────────────────────────
  failed = runThinEntryGuard(scanResult.violationsByFile) || failed;

  if (failed) {
    console.log('\nCLI import boundary check FAILED.');
    process.exit(1);
  }
  console.log('\nCLI import boundary check PASSED.');
  process.exit(0);
}

main();
