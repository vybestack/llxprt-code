/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Types and configuration constants for the CLI import boundary checker.
 *
 * Enforces the public API boundary for packages/cli/src (#2204, parent #1595).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ImportViolation {
  line: number;
  importKind: string;
  specifier: string;
}

export interface GetConfigHit {
  line: number;
}

/**
 * A banned runtime-assembly symbol/pattern hit in production CLI source
 * (#2378). `symbol` is the offending identifier or pattern label; `kind`
 * distinguishes an import specifier from an in-code usage / literal pattern.
 */
export interface BannedSymbolHit {
  line: number;
  symbol: string;
  kind: 'import' | 'usage' | 'pattern';
}

export interface StaleEntry {
  kind: 'missing-file' | 'unused-specifier';
  detail: string;
}

export interface ScanResult {
  failed: boolean;
  violationsByFile: Record<string, ImportViolation[]>;
}

// ─── Configuration ──────────────────────────────────────────────────────────

// Deep sub-paths of these runtime packages are violations unless allowlisted.
// The bare package roots (@vybestack/llxprt-code-core etc.) are PUBLIC and
// always allowed; only the `/<deep>` forms are constrained.
export const RUNTIME_PACKAGES: readonly string[] = [
  '@vybestack/llxprt-code-core',
  '@vybestack/llxprt-code-providers',
  '@vybestack/llxprt-code-agents',
  '@vybestack/llxprt-code-settings',
  '@vybestack/llxprt-code-mcp',
];

/**
 * Runtime-assembly symbols the CLI must NEVER import or use in production
 * source (#2378). These are construction primitives that belong to the
 * core/providers/agents packages: the CLI must consume the public
 * agent-bootstrap / provider-composition surface instead of assembling the
 * runtime (MessageBus, runtime state/context, provider activation) itself.
 *
 * Detection is AST-based (import specifiers + in-code identifier references),
 * so occurrences of these names inside COMMENTS or STRING LITERALS do not
 * trip the guard — only real imports and usages do.
 *
 * This set only ever GROWS as new assembly seams are promoted behind public
 * APIs; removing an entry re-opens a runtime-construction back-door.
 */
export const BANNED_RUNTIME_ASSEMBLY_SYMBOLS: ReadonlySet<string> = new Set([
  'createSessionMessageBus',
  'createAgentRuntimeState',
  'createRuntimeStateFromConfig',
  'createProviderRuntimeContext',
  'createAgentRuntimeContext',
  'activateSettingsRuntimeContext',
  'executeProviderActivation',
]);

// Public subpaths that are NOT deep/internal — they are documented public
// entrypoints and always allowed (do not require an allowlist entry).
//
// Scoped PER PACKAGE: a subpath that is public for one runtime package may be
// internal for another. For example, `runtime.js` is a public barrel of the
// providers package, but treating it as package-agnostic would also allow
// `@vybestack/llxprt-code-core/runtime.js`, `…settings/runtime.js`, etc.,
// masking real boundary violations. Each key is a RUNTIME_PACKAGES entry;
// the value is the list of public subpaths for that package.
export const PUBLIC_SUBPATHS_BY_PACKAGE: {
  [K in (typeof RUNTIME_PACKAGES)[number]]: readonly string[];
} = {
  // providers public barrels / curated subpath entrypoints. Each is a declared
  // package.json `exports` entry with its own barrel index.ts and a documented
  // public API (#2204). They are NOT deep/internal imports.
  '@vybestack/llxprt-code-providers': [
    'runtime.js',
    'auth.js',
    'composition.js',
  ],
  '@vybestack/llxprt-code-core': [],
  '@vybestack/llxprt-code-agents': [],
  '@vybestack/llxprt-code-settings': [],
  '@vybestack/llxprt-code-mcp': [],
};

/**
 * Per-file allowlist of permitted deep specifiers. Keys are repo-relative
 * paths under packages/cli/src; values are arrays of permitted specifiers.
 *
 * QUARANTINE BOUNDARY (shrinks over time as the public Agent/runtime API
 * grows). Each entry is a genuine runtime-construction/bootstrap site that
 * has no public-API replacement yet.
 *
 * After #2204 burn-down, this list contains ONLY genuine bootstrap/config
 * composition boundaries.
 */
export const ALLOWLIST: Record<string, readonly string[]> = {
  // All former deep-import allowlist entries have been eliminated (#2378).
  // The CLI must import only from public root barrels. This object is kept
  // empty on purpose — any new entry is a regression that CI should reject.
};

// Paths under packages/cli/src that are test infrastructure (excluded from the
// import scan — tests may freely mock/import internals). The import-boundary
// rule governs PRODUCTION source only.
export const TEST_DIR_GLOBS: readonly string[] = [
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/test-utils/**',
  '**/*-test-helpers*',
  '**/*test-helper*',
  '**/integration-tests/**',
];

/**
 * Bare directory base-names that are test infrastructure. When walkDir
 * encounters a directory whose name matches one of these, it prunes the
 * entire subtree early.
 */
export const TEST_DIR_BASE_NAMES = new Set([
  '__tests__',
  'test-utils',
  'integration-tests',
]);

/**
 * Bare directory base-names that are third-party or build outputs.
 */
export const NON_SOURCE_DIR_BASE_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  '.turbo',
  'coverage',
]);

/**
 * All base-names whose subtrees walkDir prunes (test infra + non-source).
 */
export const PRUNED_DIR_BASE_NAMES: Set<string> = new Set([
  ...TEST_DIR_BASE_NAMES,
  ...NON_SOURCE_DIR_BASE_NAMES,
]);

// Real entry/bootstrap files must stay thin (under-200-line spirit of #1595).
export const THIN_ENTRY_MAX_LINES = 200;
