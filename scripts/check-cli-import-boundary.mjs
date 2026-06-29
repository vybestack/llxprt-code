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

// The agents bare root re-exports the internals barrel (./internals.js), so a
// bare import of an INTERNAL symbol from this root is a boundary violation
// (#2204). This constant names that root for the imported-symbol check.
const AGENTS_PACKAGE_ROOT = '@vybestack/llxprt-code-agents';

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
  // providers public runtime barrel
  '@vybestack/llxprt-code-providers': ['runtime.js'],
};

/**
 * Per-file allowlist of permitted deep specifiers. Keys are repo-relative
 * paths under packages/cli/src; values are arrays of permitted specifiers.
 *
 * QUARANTINE BOUNDARY (shrinks over time as the public Agent/runtime API
 * grows). Each entry is a genuine runtime-construction site that has no
 * public-API replacement yet. The intent is that this list only ever SHRINKS:
 * every future public-API promotion should remove the corresponding entry.
 *
 * Tiers:
 *   - bootstrap/config/nonInteractive: genuine runtime assembly (the CLI's
 *     one legitimate role as a thin client that wires the runtime context).
 *   - zed-integration: a separate ACP bootstrap-style client.
 *   - ui/contexts/RuntimeContext: the React bridge that binds runtime helpers
 *     to the active scope behind useRuntimeApi(); promoted to a public barrel
 *     in a future subissue.
 *   - ui/commands, ui/components, ui/hooks, ui/layouts, utils: command/UI
 *     surfaces that reach runtime accessors (token stores, provider keys,
 *     runtime settings, scheduler/confirmation-bus types) not yet exposed on
 *     the public Agent facade. These are the prime burn-down targets.
 */
const ALLOWLIST = {
  // ── bootstrap / session bootstrap ──────────────────────────────────────
  'packages/cli/src/cliBootstrap.tsx': [
    '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js',
  ],
  'packages/cli/src/cliSessionBootstrap.ts': [
    '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js',
  ],
  'packages/cli/src/cliAgentBootstrap.ts': [
    '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js',
  ],
  // ── config bootstrap / runtime application ─────────────────────────────
  'packages/cli/src/config/configBuilder.ts': [
    '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js',
  ],
  'packages/cli/src/config/postConfigRuntime.ts': [
    '@vybestack/llxprt-code-providers/runtime/runtimeAccessors.js',
    '@vybestack/llxprt-code-providers/runtime/runtimeLifecycle.js',
    '@vybestack/llxprt-code-providers/runtime/providerSwitch.js',
    '@vybestack/llxprt-code-providers/runtime/cliEphemeralSettings.js',
    '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js',
  ],
  'packages/cli/src/config/profileBootstrap.ts': [
    '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js',
    '@vybestack/llxprt-code-providers/composition.js',
    '@vybestack/llxprt-code-providers/runtime/runtimeLifecycle.js',
    '@vybestack/llxprt-code-providers/auth.js',
  ],
  'packages/cli/src/config/profileRuntimeApplication.ts': [
    '@vybestack/llxprt-code-providers/runtime/profileSnapshot.js',
  ],
  'packages/cli/src/config/providerModelResolver.ts': [
    '@vybestack/llxprt-code-providers/composition.js',
  ],
  'packages/cli/src/nonInteractiveCli.ts': [
    '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js',
  ],
  // ── zed (ACP) integration: a separate bootstrap-style client ───────────
  'packages/cli/src/zed-integration/zedIntegration.ts': [
    '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js',
  ],
  'packages/cli/src/zed-integration/zed-provider-auth.ts': [
    '@vybestack/llxprt-code-providers/runtime/providerConfigUtils.js',
    '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js',
    '@vybestack/llxprt-code-providers/composition.js',
  ],
  // ── ui/contexts: React runtime bridge behind useRuntimeApi() ───────────
  'packages/cli/src/ui/contexts/RuntimeContext.tsx': [
    '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js',
    '@vybestack/llxprt-code-providers/runtime/runtimeContextFactory.js',
  ],
  // ── ui/commands: command surfaces reaching runtime accessors ───────────
  'packages/cli/src/ui/commands/aboutCommand.ts': [
    '@vybestack/llxprt-code-providers/composition.js',
  ],
  'packages/cli/src/ui/commands/authCommand.ts': [
    '@vybestack/llxprt-code-providers/auth.js',
  ],
  'packages/cli/src/ui/commands/clearCommand.ts': [
    '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js',
  ],
  'packages/cli/src/ui/commands/dumpcontextCommand.ts': [
    '@vybestack/llxprt-code-core/services/history/IContent.js',
  ],
  'packages/cli/src/ui/commands/keyCommand.ts': [
    '@vybestack/llxprt-code-providers/auth.js',
  ],
  'packages/cli/src/ui/commands/profileLoadBalancer.ts': [
    '@vybestack/llxprt-code-providers/auth.js',
  ],
  'packages/cli/src/ui/commands/profileSchemas.ts': [
    '@vybestack/llxprt-code-providers/auth.js',
  ],
  'packages/cli/src/ui/commands/providerCommand.ts': [
    '@vybestack/llxprt-code-providers/composition.js',
  ],
  'packages/cli/src/ui/commands/setCommand.ts': [
    '@vybestack/llxprt-code-providers/runtime/ephemeralSettings.js',
  ],
  'packages/cli/src/ui/commands/setCommandSchema.ts': [
    '@vybestack/llxprt-code-providers/runtime/ephemeralSettings.js',
  ],
  'packages/cli/src/ui/commands/toolformatCommand.ts': [
    '@vybestack/llxprt-code-providers/runtime/providerMutations.js',
  ],
  'packages/cli/src/ui/commands/types.ts': [
    '@vybestack/llxprt-code-providers/auth.js',
  ],
  // ── ui/components & layouts ────────────────────────────────────────────
  'packages/cli/src/ui/components/AuthDialog.tsx': [
    '@vybestack/llxprt-code-providers/auth.js',
  ],
  'packages/cli/src/ui/layouts/DefaultAppLayoutHelpers.tsx': [
    '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js',
  ],
  // ── ui/hooks: stream/agentic-loop internals ────────────────────────────
  'packages/cli/src/ui/hooks/geminiStream/toolCompletionHandler.ts': [
    '@vybestack/llxprt-code-core/scheduler/types.js',
  ],
  'packages/cli/src/ui/hooks/geminiStream/useAgenticLoop.ts': [
    '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js',
  ],
  // ── utils: sandbox auth ────────────────────────────────────────────────
  'packages/cli/src/utils/sandbox.ts': [
    '@vybestack/llxprt-code-providers/auth.js',
  ],
  'packages/cli/src/utils/sandbox-containers.ts': [
    '@vybestack/llxprt-code-providers/auth.js',
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

/**
 * Public symbols of the agents package.
 *
 * The bare root `@vybestack/llxprt-code-agents` re-exports BOTH the curated
 * public Agent API (./api/index.js) AND the low-level internals barrel
 * (./internals.js) for non-breaking compatibility. Importing an INTERNAL
 * symbol from the bare root is a boundary violation even though the specifier
 * itself is the public root: it couples the CLI to runtime construction it
 * must not own (#2204).
 *
 * This allowlist names ONLY the symbols that are part of the curated public
 * Agent API (the ./api/index.js surface) plus the small set of genuinely
 * public value exports. Any named import from the bare root that is NOT here
 * requires a per-file entry in AGENT_INTERNAL_SYMBOL_ALLOWLIST below.
 *
 * QUARANTINE BOUNDARY (shrinks as #1595 trims the root to the public API).
 */
const PUBLIC_AGENT_SYMBOLS = new Set([
  // Public factory functions
  'createAgent',
  'fromConfig',
  'listProviders',
  'listTools',
  'mapLoopStream',
  'mapStreamEvent',
  'toConfigParameters',
  'AdapterError',
  // Curated public enum/value re-exports (api/index.ts)
  'PolicyDecision',
  'ApprovalMode',
  // Public type symbols (only matter for value imports, but listed for clarity
  // so reviewers can see the full public surface that is always allowed).
  'Agent',
  'AgentEvent',
  'AgentInput',
  'AgentMessage',
  'AgentHistoryItem',
  'AgentToolCall',
  'AgentToolResult',
  'AgentConfig',
  'FromConfigOptions',
  'ToolConfirmation',
  'ToolDecision',
  'ToolUpdate',
  'DoneReason',
  'AgentError',
  'AgentErrorCode',
  'SessionStats',
  'ProviderStatus',
  'TurnOptions',
  'HookInfo',
  'AgentTaskInfo',
  'AuthStatus',
  'Unsubscribe',
  'McpDiscoveryMode',
  'ApprovalHandler',
  'OAuthPromptHandler',
  'AgentHooks',
  'AgentModelParams',
  'AgentSchedulerHandle',
  'AgentSchedulerFactory',
  'AgentSchedulerFactoryOptions',
  'StructuredError',
  'StreamEvent',
  'StreamEventType',
  'JsonStreamEventType',
  'InvalidStreamError',
  'ChatSession',
  'ChatSessionFactory',
  'ModelInfo',
  'ChatCompressionInfo',
  // engine helpers re-exported on the public api surface (api/index.ts maps)
  'classifyCompletedTools',
  'splitPartsByRole',
  'buildToolResponses',
]);

/**
 * Per-file allowlist for INTERNAL/legacy agents symbols imported from the bare
 * root `@vybestack/llxprt-code-agents`. Each entry is a (file -> [symbols])
 * pair with a justification.
 *
 * QUARANTINE BOUNDARY THAT MUST SHRINK OVER TIME: every entry is a genuine
 * runtime-construction/legacy site with no public-API replacement yet. The
 * intent is that this list only ever SHRINKS as the public Agent/runtime API
 * grows. New entries require explicit justification.
 *
 * Tiers:
 *   - config/configBuilder.ts: the CLI's one legitimate Config-build site that
 *     still wires the legacy scheduler/client/task-registration factories.
 *   - ui/hooks/geminiStream/useAgenticLoop.ts, ui/hooks/useReactToolScheduler.ts,
 *     ui/utils/autoPromptGenerator.ts: stream/scheduler/client internals the
 *     public Agent facade has not yet absorbed.
 */
const AGENT_INTERNAL_SYMBOL_ALLOWLIST = {
  // Config-build runtime assembly (legacy factories; #1595 burn-down target).
  'packages/cli/src/config/configBuilder.ts': [
    'AgentClient',
    'CoreToolScheduler',
    'createTaskToolRegistration',
  ],
  // AgenticLoop stream drive (not yet on the public facade).
  'packages/cli/src/ui/hooks/geminiStream/useAgenticLoop.ts': [
    'AgenticLoop',
    'AgenticLoopEvent',
  ],
  // Scheduler type consumed by the React scheduler bridge.
  'packages/cli/src/ui/hooks/useReactToolScheduler.ts': ['CoreToolScheduler'],
  // Legacy client construction in the auto-prompt generator.
  'packages/cli/src/ui/utils/autoPromptGenerator.ts': ['AgentClient'],
};

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
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        // Prune entire test-infrastructure and non-source (node_modules,
        // dist, build, ...) subtrees by base-name for clarity and
        // performance, before recursing into them.
        if (PRUNED_DIR_BASE_NAMES.has(entry.name)) continue;
        if (shouldExclude(full)) continue;
        walk(full);
      } else if (shouldExclude(full)) {
        continue;
      } else if (
        entry.isFile() &&
        (extname(entry.name) === '.ts' || extname(entry.name) === '.tsx')
      ) {
        results.push(full);
      }
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
 * Is `symbol` an allowlisted internal/legacy agents symbol for `relFile`?
 * Used by the bare-root symbol check so a justified per-file entry permits
 * importing that specific internal symbol from the public root.
 */
function isInternalSymbolAllowed(relFile, symbol) {
  const allowed = AGENT_INTERNAL_SYMBOL_ALLOWLIST[relFile];
  return Boolean(allowed && allowed.includes(symbol));
}

/**
 * Extract the named import symbols from a static ImportDeclaration node.
 * Returns an array of local-occurrence symbol names (resolving `as` aliases to
 * the original exported name). Returns an empty array for namespace imports
 * (`import * as ns`) since those do not name a specific symbol — a namespace
 * import of the agents root is flagged separately as a whole-root coupling.
 *
 * Only static `import { X } from '...'` / `import type { X }` forms carry
 * named symbols; dynamic import() and vi.mock return [].
 */
function importedSymbolsOf(node) {
  if (!node || !ts.isImportDeclaration(node)) return [];
  const clause = node.importClause;
  if (!clause) return [];
  const names = [];
  // default import. The agents root has NO default export (verified: no
  // `export default` exists in packages/agents/src), so `import X from
  // '@vybestack/llxprt-code-agents'` cannot resolve at runtime. The symbol
  // 'default' is intentionally NOT in PUBLIC_AGENT_SYMBOLS, so any default
  // import from the bare root is flagged as a boundary violation — this is
  // correct and intentional. If a default export is ever added to the agents
  // root, add 'default' to PUBLIC_AGENT_SYMBOLS here.
  if (clause.name) {
    names.push('default');
  }
  const bindings = clause.namedBindings;
  if (!bindings) return names;
  if (ts.isNamespaceImport(bindings)) {
    // `import * as ns` — whole-module coupling; cannot name a symbol. Caller
    // treats a namespace import of the agents root as a violation on its own.
    names.push('*');
    return names;
  }
  if (ts.isNamedImports(bindings)) {
    for (const el of bindings.elements) {
      // propertyName is the ORIGINAL exported name (`X` in `X as Y`);
      // fall back to the local name.name when there is no alias.
      const original = el.propertyName ?? el.name;
      names.push(original.text);
    }
  }
  return names;
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
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'mock' &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'vi'
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
    // Bare agents-root symbol check: the bare root re-exports internals, so a
    // named import of an INTERNAL symbol from the public root is still a
    // boundary violation unless the (file, symbol) pair is allowlisted (#2204).
    if (
      specifier === AGENTS_PACKAGE_ROOT &&
      ts.isImportDeclaration(node) &&
      node.importClause
    ) {
      const relFile = relative(REPO_ROOT, filePath).replace(/\\/g, '/');
      const symbols = importedSymbolsOf(node);
      for (const sym of symbols) {
        // A namespace import (`import * as ns`) of the agents root couples to
        // the whole (internals-leaking) surface — flag it.
        if (sym === '*') {
          violations.push({
            line: getLine(sourceFile, node.getStart()),
            importKind: 'agents-namespace-import',
            specifier,
            symbol: sym,
          });
          continue;
        }
        if (
          !PUBLIC_AGENT_SYMBOLS.has(sym) &&
          !isInternalSymbolAllowed(relFile, sym)
        ) {
          violations.push({
            line: getLine(sourceFile, node.getStart()),
            importKind: 'agents-internal-symbol',
            specifier,
            symbol: sym,
          });
        }
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
    const key = `${v.line}|${v.importKind}|${v.specifier}|${v.symbol ?? ''}`;
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
 * Collect all named import symbols from the bare agents root in a file. Used
 * by the self-pruning allowlist guard to verify that every allowlisted
 * AGENT_INTERNAL_SYMBOL_ALLOWLIST symbol is still actually imported.
 */
function collectAgentsRootSymbols(filePath) {
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
  const symbols = new Set();
  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === AGENTS_PACKAGE_ROOT
    ) {
      for (const sym of importedSymbolsOf(node)) {
        symbols.add(sym);
      }
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return symbols;
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

function main() {
  let failed = false;

  // ── 1. Deep-import boundary scan ───────────────────────────────────────
  console.log('Checking CLI import boundary (packages/cli/src)...');
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

  const violationsByFile = {};
  let totalViolations = 0;
  for (const filePath of files) {
    const rel = relative(REPO_ROOT, filePath).replace(/\\/g, '/');
    const viols = analyzeFile(filePath);
    if (viols.length > 0) {
      violationsByFile[rel] = viols;
      totalViolations += viols.length;
    }
  }
  if (totalViolations > 0) {
    failed = true;
    console.log(`FAIL: ${totalViolations} disallowed import(s):\n`);
    for (const [file, viols] of Object.entries(violationsByFile)) {
      console.log(`  ${file}:`);
      for (const v of viols) {
        if (v.importKind === 'vi.mock-non-literal') {
          console.log(
            `    line ${v.line}: vi.mock(<non-literal>) — vi.mock specifiers must be static string literals so this guard can analyze them; a dynamic specifier could hide a deep runtime import`,
          );
        } else if (v.symbol !== undefined) {
          console.log(
            `    line ${v.line}: ${v.specifier} imports internal symbol '${v.symbol}' (${v.importKind}) — the bare root re-exports internals; use a public Agent symbol or add a justified AGENT_INTERNAL_SYMBOL_ALLOWLIST entry`,
          );
        } else {
          console.log(
            `    line ${v.line}: ${v.specifier} (${v.importKind}) — use the public package root or add a justified allowlist entry`,
          );
        }
      }
    }
    console.log('');
  } else {
    console.log('PASS: no disallowed deep runtime imports in CLI source.\n');
  }

  // ── 2. getConfig escape-hatch scan ─────────────────────────────────────
  console.log('Checking for getConfig() escape-hatch usage...');
  let getConfigHits = 0;
  const getConfigByFile = {};
  for (const filePath of files) {
    const rel = relative(REPO_ROOT, filePath).replace(/\\/g, '/');
    const hits = scanGetConfigEscapeHatch(filePath);
    if (hits.length > 0) {
      getConfigByFile[rel] = hits;
      getConfigHits += hits.length;
    }
  }
  if (getConfigHits > 0) {
    failed = true;
    console.log(
      `FAIL: ${getConfigHits} getConfig() escape-hatch usage(s) found:\n`,
    );
    for (const [file, hits] of Object.entries(getConfigByFile)) {
      console.log(`  ${file}:`);
      for (const h of hits) {
        console.log(
          `    line ${h.line}: getConfig() escape-hatch — reach Config via the public Agent surface instead (if this is a legitimate local helper, rename it to a more specific name; do NOT add an allowlist)`,
        );
      }
    }
    console.log('');
  } else {
    console.log('PASS: no getConfig() escape-hatch usage in CLI source.\n');
  }

  // ── 3. Self-pruning allowlist guard ────────────────────────────────────
  //
  // Every allowlisted file MUST exist in the scanned production source, and
  // every allowlisted specifier/symbol MUST still be imported by that file.
  // This prevents stale allowlist entries from accumulating after a refactor
  // removes the import (a stale entry is a false sense of safety: it looks
  // justified but guards nothing). This guard runs only when allowlisted
  // files actually exist in the scan (i.e., against the real repo, not
  // synthetic fixture trees used by the script's own tests).
  console.log('Checking allowlist freshness (self-pruning guard)...');
  const scannedRelFiles = new Set(
    files.map((f) => relative(REPO_ROOT, f).replace(/\\/g, '/')),
  );
  // Only run the freshness check against the real production source tree.
  // Synthetic test fixtures (CLI_BOUNDARY_ROOT set) do not contain the full
  // set of allowlisted files, so checking freshness there would report every
  // absent entry as stale (false noise).
  const isProductionRepo = !process.env.CLI_BOUNDARY_ROOT;
  let staleEntries = 0;
  const staleByFile = {};

  if (!isProductionRepo) {
    console.log('SKIP: allowlist freshness (synthetic fixture tree).\n');
  } else {
    for (const [allowFile, allowSpecs] of Object.entries(ALLOWLIST)) {
      if (!scannedRelFiles.has(allowFile)) {
        staleEntries++;
        (staleByFile[allowFile] ??= []).push({
          kind: 'missing-file',
          detail: allowFile,
        });
        continue;
      }
      const absFile = join(REPO_ROOT, allowFile);
      const actualSpecs = collectAllSpecifiers(absFile);
      for (const spec of allowSpecs) {
        if (!actualSpecs.has(spec)) {
          staleEntries++;
          (staleByFile[allowFile] ??= []).push({
            kind: 'unused-specifier',
            detail: spec,
          });
        }
      }
    }

    for (const [allowFile, allowSymbols] of Object.entries(
      AGENT_INTERNAL_SYMBOL_ALLOWLIST,
    )) {
      if (!scannedRelFiles.has(allowFile)) {
        staleEntries++;
        (staleByFile[allowFile] ??= []).push({
          kind: 'missing-file',
          detail: allowFile,
        });
        continue;
      }
      const absFile = join(REPO_ROOT, allowFile);
      const actualSymbols = collectAgentsRootSymbols(absFile);
      for (const sym of allowSymbols) {
        if (!actualSymbols.has(sym)) {
          staleEntries++;
          (staleByFile[allowFile] ??= []).push({
            kind: 'unused-symbol',
            detail: sym,
          });
        }
      }
    }

    if (staleEntries > 0) {
      failed = true;
      console.log(`FAIL: ${staleEntries} stale allowlist entr(y/ies) found:\n`);
      for (const [file, entries] of Object.entries(staleByFile)) {
        console.log(`  ${file}:`);
        for (const e of entries) {
          if (e.kind === 'missing-file') {
            console.log(
              `    allowlisted file no longer exists in production source — remove the entry`,
            );
          } else if (e.kind === 'unused-specifier') {
            console.log(
              `    allowlisted specifier '${e.detail}' is no longer imported — remove the entry`,
            );
          } else {
            console.log(
              `    allowlisted symbol '${e.detail}' is no longer imported from the bare agents root — remove the entry`,
            );
          }
        }
      }
      console.log('');
    } else {
      console.log('PASS: allowlist is fresh (no stale entries).\n');
    }
  }

  // ── 4. Thin-entry guard ────────────────────────────────────────────────
  console.log('Checking thin-entry structure...');
  // These guards only apply when the real entrypoint files exist (they are
  // absent in synthetic fixture trees used by the script's own tests). The
  // thin CLI_INDEX check and the CLI_ENTRY deep-import check are INDEPENDENT:
  // if packages/cli/index.ts is deleted but packages/cli/src/cli.tsx still
  // exists, the dedicated cli.tsx orchestrator-specific deep-import guard
  // (and its PASS/FAIL message) must still run. Nesting it inside the
  // CLI_INDEX existence check would silently skip the cli.tsx guard in that
  // scenario (#2204).
  const indexExists = existsSync(CLI_INDEX);
  if (indexExists) {
    const indexLines = countLines(CLI_INDEX);
    if (indexLines > THIN_ENTRY_MAX_LINES) {
      failed = true;
      console.log(
        `FAIL: ${CLI_INDEX} is ${indexLines} lines (threshold ${THIN_ENTRY_MAX_LINES}). ` +
          'The real entrypoint must stay thin: shebang + top-level error handling + main() invocation only.',
      );
    } else {
      console.log(
        `PASS: ${CLI_INDEX} is ${indexLines} lines (<= ${THIN_ENTRY_MAX_LINES}).`,
      );
    }
  } else {
    console.log(`SKIP: thin CLI_INDEX guard (${CLI_INDEX} absent).`);
  }

  // Verify main() in cli.tsx does not directly import runtime-construction
  // deep paths (the orchestrator must delegate to bootstrap modules).
  // Reuse the analysis from step 1 (CLI_ENTRY is under CLI_SRC_DIR and was
  // already scanned) instead of re-analyzing the file. This check runs
  // independently of the CLI_INDEX existence check above.
  if (existsSync(CLI_ENTRY)) {
    const entryRel = relative(REPO_ROOT, CLI_ENTRY).replace(/\\/g, '/');
    const entryViolations = violationsByFile[entryRel] ?? [];
    if (entryViolations.length > 0) {
      failed = true;
      console.log(
        `\nFAIL: ${entryRel} directly imports runtime-construction deep paths:`,
      );
      for (const v of entryViolations) {
        console.log(`    line ${v.line}: ${v.specifier} (${v.importKind})`);
      }
    } else {
      console.log(
        `PASS: ${CLI_ENTRY} does not directly import runtime-construction deep paths.`,
      );
    }
  } else if (indexExists) {
    console.log(`SKIP: CLI_ENTRY deep-import guard (${CLI_ENTRY} absent).`);
  } else {
    console.log('SKIP: thin-entry guard (entrypoint files absent).');
  }

  if (failed) {
    console.log('\nCLI import boundary check FAILED.');
    process.exit(1);
  }
  console.log('\nCLI import boundary check PASSED.');
  process.exit(0);
}

main();
