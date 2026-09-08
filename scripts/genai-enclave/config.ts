/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Authoritative configuration for the genai-enclave boundary guard (#2352).
 *
 * This module is the SINGLE source of truth for all boundary decisions:
 *
 * 1. **Import-prefix enclaves** — path prefixes where `@google/genai` imports
 *    are permanently allowed, each with a human-readable justification.
 *
 * 2. **Dependency-manifest allowlist** — the exact workspace directories and
 *    version specifiers that may declare `@google/genai` as a dependency.
 *    The root packaging bridge and the providers enclave are required;
 *    every other workspace is forbidden.
 *
 * 3. **Gemini-name export allowlist** — exported identifiers containing
 *    "Gemini" sanctioned outside the name enclaves, each scoped to an exact
 *    `path::name` pair with a justification.
 *
 * The rest of the guard is AST-precise (TypeScript compiler API); this config
 * is path-prefix / manifest based and deterministic.
 */

// ─── 1. Import-prefix enclaves ──────────────────────────────────────────────

/**
 * A path prefix where `@google/genai` imports (and Gemini-named exports) are
 * permanently allowed. The trailing slash prevents sibling-prefix matches
 * (e.g. `gemini-backup/` must NOT match `gemini/`).
 */
export interface ImportEnclave {
  readonly prefix: string;
  readonly justification: string;
}

/**
 * The authoritative list of import-prefix enclaves. A file is inside an
 * enclave if its repo-relative path starts with one of these prefixes.
 */
export const GENAI_IMPORT_ENCLAVES: readonly ImportEnclave[] = [
  {
    prefix: 'packages/providers/src/gemini/',
    justification:
      'Gemini provider implementation — owns the Gemini wire types and the ' +
      'Gemini-named exports. No longer imports an SDK; the dependency ' +
      'allowlist below is empty.',
  },
];

// ─── 1b. Sanctioned dynamic module loaders ──────────────────────────────────

/**
 * A file permitted to call `import()` with a specifier that is only known at
 * runtime.
 *
 * The computed-specifier ban exists so a genai import cannot hide behind a
 * value the scanner cannot read. A module loader that resolves a
 * user-installed package is the one legitimate case: the specifier is a
 * parameter by definition, so no formulation of it can be a literal.
 *
 * This is NOT an enclave. A file listed here is still scanned for genai
 * imports in full, and the guard additionally verifies it contains no
 * `@google/` reference of any kind (see `assertLoaderIsGenaiFree`). The entry
 * waives only the "I cannot read this specifier" complaint; it grants no
 * permission to touch genai. An entry whose file stops satisfying those
 * properties fails the guard.
 */
export interface DynamicModuleLoader {
  readonly path: string;
  readonly justification: string;
}

/**
 * Exact repo-relative paths (not prefixes) permitted to perform a computed
 * import. Kept exact so a sanctioned loader cannot silently extend its
 * permission to sibling files.
 */
export const DYNAMIC_MODULE_LOADERS: readonly DynamicModuleLoader[] = [
  {
    path: 'packages/providers/src/composition/runtimePlugins/loadRuntimePlugins.ts',
    justification:
      'Resolves provider packages the user installed. The specifier is a ' +
      'runtime value, so it can never be a literal. The file itself is ' +
      'genai-free and narrows the imported module through Zod validation ' +
      'before it reaches any other code.',
  },
];

const DYNAMIC_MODULE_LOADER_PATHS: ReadonlySet<string> = new Set(
  DYNAMIC_MODULE_LOADERS.map((loader) => loader.path),
);

/**
 * Determine if `relPath` is a sanctioned dynamic module loader.
 */
export function isSanctionedDynamicLoader(relPath: string): boolean {
  return DYNAMIC_MODULE_LOADER_PATHS.has(relPath);
}

/**
 * Convenience: the raw prefix strings.
 */
const IMPORT_ENCLAVE_PREFIXES: readonly string[] = GENAI_IMPORT_ENCLAVES.map(
  (e) => e.prefix,
);

/**
 * The same enclaves govern Gemini-named exports.
 */
const GEMINI_NAME_ENCLAVE_PREFIXES: readonly string[] = IMPORT_ENCLAVE_PREFIXES;

// ─── 2. Dependency-manifest allowlist ───────────────────────────────────────

/**
 * A sanctioned dependency-manifest entry: a workspace directory may declare
 * `@google/genai` at exactly the specified version.
 */
export interface DependencyManifestAllowlistEntry {
  /** Workspace directory relative to repo root (e.g. 'packages/providers'). */
  readonly workspaceDir: string;
  /** Exact version specifier that must appear in the manifest. */
  readonly version: string;
  readonly justification: string;
}

/**
 * The authoritative dependency-manifest allowlist. Only these workspace
 * directories may declare `@google/genai`, and only at the exact version
 * shown. The root declaration is a packaging bridge for the root artifact;
 * source imports remain confined to the implementation enclaves.
 */
export const SANCTIONED_GENAI_VERSION = '1.30.0';

export const GENAI_DEPENDENCY_MANIFESTS: readonly DependencyManifestAllowlistEntry[] =
  [];

/**
 * Workspaces whose package.json must exist and be readable.
 *
 * This is deliberately independent of the dependency allowlist above. That
 * list is now empty because no workspace may declare the SDK, but the guard
 * still has to be able to READ these manifests to prove the absence. Deriving
 * the required set from an empty allowlist would mean a deleted manifest
 * silently passed.
 */
export const REQUIRED_MANIFEST_WORKSPACE_DIRS: readonly string[] = [
  '.',
  'packages/providers',
];

/** The exact package name the guard checks for. */
export const GENAI_PACKAGE = '@google/genai';

/**
 * Map of workspaceDir → allowed version, derived from the manifest allowlist.
 */
const DEPENDENCY_MANIFEST_MAP: ReadonlyMap<string, string> = new Map(
  GENAI_DEPENDENCY_MANIFESTS.map((e) => [e.workspaceDir, e.version]),
);

// ─── 3. Gemini-name export allowlist ───────────────────────────────────────

/**
 * A sanctioned Gemini-named export outside the name enclaves. Each entry is
 * scoped to an exact `path::name` pair.
 */
export interface GeminiNameAllowlistEntry {
  /** Repo-relative path of the file that declares the export. */
  readonly path: string;
  /** Exact exported identifier (case-sensitive). */
  readonly name: string;
  readonly justification: string;
}

/**
 * The authoritative Gemini-name export allowlist. Each entry must include a
 * path, name, and justification.
 */
export const GEMINI_NAME_EXPLICIT_ALLOWLIST: readonly GeminiNameAllowlistEntry[] =
  [
    // ── Provider classes exported from the providers package ──────────
    {
      path: 'packages/providers/src/index.ts',
      name: 'GeminiProvider',
      justification:
        'Public Gemini provider class exported from the providers package index.',
    },
    {
      path: 'packages/providers/src/index.ts',
      name: 'buildGeminiDumpContents',
      justification:
        'Provider dump utility exported from the providers package index.',
    },
    {
      path: 'packages/providers/src/utils/providerRequestConversion.ts',
      name: 'buildGeminiDumpContents',
      justification: 'Provider dump utility implementation in providers utils.',
    },
    {
      path: 'packages/providers/src/composition/aliasProviderFactory.ts',
      name: 'createGeminiAliasProvider',
      justification:
        'Provider factory for the Gemini alias registration in providers composition.',
    },
    {
      path: 'packages/providers/src/composition/index.ts',
      name: 'createGeminiAliasProvider',
      justification:
        'Provider factory re-exported from providers composition index.',
    },
    // ── Model-ID constants (genuine env-var / default model IDs) ───────
    {
      path: 'packages/core/src/config/models.ts',
      name: 'isGemini2Model',
      justification: 'Model-ID predicate in core config/models.',
    },
    {
      path: 'packages/core/src/config/models.ts',
      name: 'isGemini3Model',
      justification: 'Model-ID predicate in core config/models.',
    },
    // ── Finish-reason mapping (genuine converter/boundary module) ─────
    {
      path: 'packages/core/src/llm-types/finishReasons.ts',
      name: 'GEMINI_FINISH_MAP',
      justification:
        'Gemini finish-reason mapping table in core llm-types/finishReasons.',
    },
    {
      path: 'packages/core/src/llm-types/finishReasons.ts',
      name: 'mapGeminiFinishReason',
      justification:
        'Gemini finish-reason mapper in core llm-types/finishReasons.',
    },
    // ── Neutral structural Gemini-content types (llm-types layer) ─────
    {
      path: 'packages/core/src/llm-types/geminiContent.ts',
      name: 'GeminiFunctionCall',
      justification:
        'Neutral structural Gemini FunctionCall type in core llm-types/geminiContent.',
    },
    {
      path: 'packages/core/src/llm-types/geminiContent.ts',
      name: 'GeminiFunctionResponse',
      justification:
        'Neutral structural Gemini FunctionResponse type in core llm-types/geminiContent.',
    },
    {
      path: 'packages/core/src/llm-types/geminiContent.ts',
      name: 'GeminiInlineData',
      justification:
        'Neutral structural Gemini Blob/InlineData type in core llm-types/geminiContent.',
    },
    {
      path: 'packages/core/src/llm-types/geminiContent.ts',
      name: 'GeminiPartExtension',
      justification:
        'Neutral structural Gemini part-extension type in core llm-types/geminiContent.',
    },
    {
      path: 'packages/core/src/llm-types/geminiContent.ts',
      name: 'GeminiContentPart',
      justification:
        'Neutral structural Gemini ContentPart type in core llm-types/geminiContent.',
    },
    {
      path: 'packages/core/src/llm-types/geminiContent.ts',
      name: 'GeminiContent',
      justification:
        'Neutral structural Gemini Content type in core llm-types/geminiContent.',
    },
    // ── Privacy notice UI component ───────────────────────────────────
    {
      path: 'packages/cli/src/ui/privacy/GeminiPrivacyNotice.tsx',
      name: 'GeminiPrivacyNotice',
      justification:
        'Gemini privacy-notice UI component exported from cli (gemini-cli compat surface).',
    },
    {
      path: 'packages/core/test/models/__fixtures__/mock-data.ts',
      name: 'geminiModel',
      justification:
        'Test fixture data exported from core test models fixtures (shared test infrastructure).',
    },
  ];

/**
 * Lookup set of `path::name` for O(1) membership checks.
 */
const GEMINI_NAME_ALLOWED_KEYS: ReadonlySet<string> = new Set(
  GEMINI_NAME_EXPLICIT_ALLOWLIST.map((e) => `${e.path}::${e.name}`),
);

// ─── Predicate functions ────────────────────────────────────────────────────

/**
 * Determine if `path` is inside a genai-import enclave.
 */
export function isInGenaiImportEnclave(relPath: string): boolean {
  return IMPORT_ENCLAVE_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

/**
 * Determine if `path` is inside a Gemini-name enclave.
 */
export function isInGeminiNameEnclave(relPath: string): boolean {
  return GEMINI_NAME_ENCLAVE_PREFIXES.some((prefix) =>
    relPath.startsWith(prefix),
  );
}

/**
 * Determine if `name` at `relPath` is an explicitly allowlisted Gemini-named
 * export. The match is exact on both path and name (case-sensitive).
 */
export function isExplicitlyAllowedGeminiName(
  relPath: string,
  name: string,
): boolean {
  return GEMINI_NAME_ALLOWED_KEYS.has(`${relPath}::${name}`);
}

/**
 * Case-insensitive check: does `name` contain "gemini"?
 */
export function containsGemini(name: string): boolean {
  return name.toLowerCase().includes('gemini');
}

/**
 * Returns the allowed `@google/genai` version for a workspace directory, or
 * `undefined` if the workspace is not in the dependency-manifest allowlist.
 */
export function getAllowedGenaiVersion(
  workspaceDir: string,
): string | undefined {
  return DEPENDENCY_MANIFEST_MAP.get(workspaceDir);
}

/**
 * Returns the set of workspace directories sanctioned to declare
 * `@google/genai` as a dependency.
 */
export function getGenaiDependencyWorkspaceDirs(): readonly string[] {
  return GENAI_DEPENDENCY_MANIFESTS.map((e) => e.workspaceDir);
}

// ─── Test-file detection ────────────────────────────────────────────────────

const TEST_FILE_PATTERNS = [
  /\.test\.[cm]?ts$/,
  /\.test\.tsx$/,
  /\.spec\.[cm]?ts$/,
  /\.spec\.tsx$/,
  /\.test\.[cm]?js$/,
  /\.test\.jsx$/,
  /\.spec\.[cm]?js$/,
  /\.spec\.jsx$/,
];

/**
 * Determine if `path` is a test file (by filename) or inside a test directory.
 * Test files are exempt from the Gemini-name check (test fixtures may use
 * Gemini-named data), but NOT from the @google/genai import check.
 */
export function isTestFile(relPath: string): boolean {
  if (relPath.includes('/__tests__/') || relPath.includes('/__fixtures__/')) {
    return true;
  }
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(relPath));
}

// ─── Config-file detection ──────────────────────────────────────────────────

const CONFIG_FILE_PATTERN =
  /^(?:eslint|vitest|vite|webpack|rollup|jest)(?:[\w.-]*?)\.config\.[cm]?[jt]s$/;

/**
 * Determine if `path` is a runtime export surface (not a config file).
 * Config files (eslint.config.js, vite.worker.config.mjs, etc.) are exempt
 * from the Gemini-name export check because their exports are build-time
 * configuration, not runtime API surface.
 */
export function isRuntimeExportSurface(relPath: string): boolean {
  const fileName = relPath.slice(relPath.lastIndexOf('/') + 1);
  return !CONFIG_FILE_PATTERN.test(fileName);
}
