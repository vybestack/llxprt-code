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
 *    The root packaging bridge and the core/providers enclaves are required;
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
      'Gemini provider implementation — needs the SDK for API calls.',
  },
  {
    prefix: 'packages/core/src/code_assist/',
    justification:
      'Code-Assist back-end — needs the SDK for OAuth + API calls.',
  },
];

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
  /** Workspace directory relative to repo root (e.g. 'packages/core'). */
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
  [
    {
      workspaceDir: '.',
      version: SANCTIONED_GENAI_VERSION,
      justification:
        'The published root artifact ships core/provider source, so npm must ' +
        'install the SDK even though root source may not import it.',
    },
    {
      workspaceDir: 'packages/core',
      version: SANCTIONED_GENAI_VERSION,
      justification:
        'Code-Assist back-end (packages/core/src/code_assist/) requires the ' +
        'SDK at runtime for OAuth and API calls.',
    },
    {
      workspaceDir: 'packages/providers',
      version: SANCTIONED_GENAI_VERSION,
      justification:
        'Gemini provider implementation (packages/providers/src/gemini/) ' +
        'requires the SDK at runtime for API calls.',
    },
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
      path: 'packages/core/index.ts',
      name: 'DEFAULT_GEMINI_MODEL',
      justification:
        'Default Gemini model ID constant exported from core index.',
    },
    {
      path: 'packages/core/index.ts',
      name: 'DEFAULT_GEMINI_FLASH_MODEL',
      justification:
        'Default Gemini Flash model ID constant exported from core index.',
    },
    {
      path: 'packages/core/index.ts',
      name: 'DEFAULT_GEMINI_FLASH_LITE_MODEL',
      justification:
        'Default Gemini Flash-Lite model ID constant exported from core index.',
    },
    {
      path: 'packages/core/index.ts',
      name: 'DEFAULT_GEMINI_EMBEDDING_MODEL',
      justification:
        'Default Gemini embedding model ID constant exported from core index.',
    },
    {
      path: 'packages/core/src/config/models.ts',
      name: 'DEFAULT_GEMINI_MODEL',
      justification: 'Default Gemini model ID constant in core config/models.',
    },
    {
      path: 'packages/core/src/config/models.ts',
      name: 'DEFAULT_GEMINI_FLASH_MODEL',
      justification:
        'Default Gemini Flash model ID constant in core config/models.',
    },
    {
      path: 'packages/core/src/config/models.ts',
      name: 'DEFAULT_GEMINI_FLASH_LITE_MODEL',
      justification:
        'Default Gemini Flash-Lite model ID constant in core config/models.',
    },
    {
      path: 'packages/core/src/config/models.ts',
      name: 'DEFAULT_GEMINI_EMBEDDING_MODEL',
      justification:
        'Default Gemini embedding model ID constant in core config/models.',
    },
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
    {
      path: 'packages/core/src/config/config.ts',
      name: 'DEFAULT_GEMINI_FLASH_MODEL',
      justification: 'Default Gemini Flash model ID re-exported from config.',
    },
    {
      path: 'packages/core/src/config/index.ts',
      name: 'DEFAULT_GEMINI_FLASH_MODEL',
      justification:
        'Default Gemini Flash model ID re-exported from config index.',
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
 * Config files (vitest.config.ts, vite.worker.config.mjs, etc.) are exempt
 * from the Gemini-name export check because their exports are build-time
 * configuration, not runtime API surface.
 */
export function isRuntimeExportSurface(relPath: string): boolean {
  const fileName = relPath.slice(relPath.lastIndexOf('/') + 1);
  return !CONFIG_FILE_PATTERN.test(fileName);
}
