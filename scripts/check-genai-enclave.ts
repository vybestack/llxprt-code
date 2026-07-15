#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * check-genai-enclave.ts
 *
 * Issue #2352 — repo-wide AST-precise hard guard against `@google/genai`
 * imports and Gemini-named exports outside explicitly justified enclaves.
 *
 * Scans ALL source files under packages/ — TypeScript (.ts/.tsx/.mts/.cts)
 * AND JavaScript (.js/.jsx/.mjs/.cjs) — so a genai import cannot be smuggled
 * past the guard by using a JS extension.
 *
 * This guard detects ALL import forms via the TypeScript compiler API:
 *   - static import declarations (including type-only)
 *   - dynamic import() expressions
 *   - import-equals with ExternalModuleReference (require)
 *   - export ... from re-exports
 *   - export * from re-exports
 *   - import() in type position
 *
 * It also detects **computed** dynamic import()/require() calls (non-string
 * specifiers) outside enclaves, since these could smuggle `@google/genai` at
 * runtime.
 *
 * Additionally, it detects new exported identifiers containing "Gemini"
 * (case-insensitive) outside the documented allowlist.
 *
 * Manifest enforcement: inspects root and all packages-level manifests to ensure
 * `@google/genai` appears ONLY in the exact sanctioned workspaces
 * (packages/core, packages/providers) at exactly the allowed version, and
 * nowhere else (root, all other packages). Scans dependencies,
 * devDependencies, peerDependencies, AND optionalDependencies. Fails closed
 * on malformed/unreadable manifests or packages-dir discovery failure.
 *
 * The guard **fails closed**: discovery errors, read errors, parse errors,
 * source parse diagnostics, or zero-files-found are all hard failures.
 * Untracked (non-ignored) package source files are included via `git status`
 * to prevent smuggling a new import past CI by leaving it untracked.
 *
 * Enclaves:
 *   - packages/providers/src/gemini/** — Gemini provider implementation
 *   - packages/core/src/code_assist/** — code_assist (needs the SDK)
 *
 * Usage:
 *   scripts/check-genai-enclave.ts
 *
 * For test fixtures, set GENAI_ENCLAVE_ROOT=<dir> to scan a temp tree.
 */

import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import {
  isInGenaiImportEnclave,
  isInGeminiNameEnclave,
  isExplicitlyAllowedGeminiName,
  isTestFile,
  isRuntimeExportSurface,
  getGenaiDependencyWorkspaceDirs,
} from './genai-enclave/config.ts';
import {
  scanGenaiImports,
  scanGeminiExports,
  parseSourceFile,
  getParseDiagnostics,
  type Violation,
} from './genai-enclave/scanner.ts';

const REPO_ROOT = process.env.GENAI_ENCLAVE_ROOT
  ? resolve(process.env.GENAI_ENCLAVE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGES_DIR = join(REPO_ROOT, 'packages');

const PRUNE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '__snapshots__',
]);

/** Exit codes. */
const EXIT_PASS = 0;
const EXIT_FAIL = 1;

/** Collected operational errors (discovery/read/parse failures). */
interface OperationalError {
  readonly message: string;
}

function isScannableFile(fileName: string): boolean {
  return /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/i.test(fileName);
}

function relRepo(filePath: string): string {
  return relative(REPO_ROOT, filePath).replace(/\\/g, '/');
}

function walkPackages(dir: string): {
  files: string[];
  errors: OperationalError[];
} {
  const results: string[] = [];
  const errors: OperationalError[] = [];
  const absDir = resolve(dir);

  function walk(d: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({
        message: `Cannot read directory ${relRepo(d)}: ${msg} — fail-closed.`,
      });
      return;
    }
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (PRUNE_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && isScannableFile(entry.name)) {
        results.push(full);
      }
    }
  }

  walk(absDir);
  return { files: results, errors };
}

// ─── File discovery ─────────────────────────────────────────────────────────

/**
 * Deduplicate an array of file paths, preserving first-seen order.
 * Tracked + untracked git outputs can overlap (e.g. a file that was tracked
 * and then re-added without staging), producing duplicate scan entries.
 */
function dedupePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of paths) {
    if (!seen.has(p)) {
      seen.add(p);
      result.push(p);
    }
  }
  return result;
}

/**
 * Discover TypeScript files under packages/ to scan. When running against the
 * real repo (no GENAI_ENCLAVE_ROOT), uses `git ls-files` for tracked files
 * AND `git status` for untracked non-ignored package files. For temp fixture
 * trees, falls back to a filesystem walk.
 */
function discoverFiles(): {
  files: string[];
  errors: OperationalError[];
} {
  const errors: OperationalError[] = [];

  if (process.env.GENAI_ENCLAVE_ROOT) {
    const { files, errors: walkErrors } = walkPackages(PACKAGES_DIR);
    return { files: dedupePaths(files), errors: walkErrors };
  }

  // ── Tracked files ─────────────────────────────────────────────────
  let tracked: string;
  try {
    tracked = execFileSync(
      'git',
      [
        'ls-files',
        '-z',
        'packages/**/*.ts',
        'packages/**/*.tsx',
        'packages/**/*.mts',
        'packages/**/*.cts',
        'packages/**/*.js',
        'packages/**/*.jsx',
        'packages/**/*.mjs',
        'packages/**/*.cjs',
      ],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push({
      message: `git ls-files failed: ${msg}`,
    });
    return { files: [], errors };
  }

  const trackedFiles = tracked
    .split('\0')
    .filter((path) => path.length > 0)
    .map((path) => join(REPO_ROOT, path));

  // ── Untracked non-ignored files ───────────────────────────────────
  // `git status --porcelain` with `--untracked-files=all` lists untracked
  // files with `??` prefix. We include only TypeScript files under packages/
  // that are NOT gitignored. This prevents smuggling a new @google/genai
  // import past CI by leaving it untracked.
  let untrackedFiles: string[] = [];
  try {
    const status = execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=all', '-z'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    untrackedFiles = status
      .split('\0')
      .filter((entry) => entry.length > 0)
      .filter((entry) => entry.startsWith('?? '))
      .map((entry) => entry.slice(3))
      .filter(
        (relPath) =>
          relPath.startsWith('packages/') && isScannableFile(relPath),
      )
      .map((relPath) => join(REPO_ROOT, relPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push({
      message: `git status failed — untracked files not checked: ${message}`,
    });
  }

  const allFiles = dedupePaths([...trackedFiles, ...untrackedFiles]);
  return { files: allFiles, errors };
}

// ─── Manifest checking ──────────────────────────────────────────────────────

import {
  validateManifestDependencies,
  type ManifestDependencyViolation,
  type ManifestOperationalError,
  type RawManifest,
} from './genai-enclave/manifest-enforcement.ts';

interface ManifestCheckResult {
  readonly violations: ReadonlyArray<
    ManifestDependencyViolation & {
      readonly manifestPath: string;
    }
  >;
  readonly errors: OperationalError[];
}

/**
 * Read and parse a package.json file. Throws on read or parse failure so
 * that manifest scanning fails closed on malformed/unreadable manifests
 * instead of silently skipping them (which could hide a genai dep).
 */
function readRawManifest(filePath: string): RawManifest {
  const content = readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('package.json must contain a JSON object');
  }
  return parsed as RawManifest;
}

/**
 * Check a single manifest for @google/genai dependency violations using the
 * shared enforcement module (F1, F6, F9, F10).
 */
/**
 * The set of workspace directories whose package.json MUST exist and be
 * readable. These are the sanctioned genai-dependency workspaces; their
 * absence means the guard cannot verify the dependency invariant, so it
 * must fail closed (F4).
 */
const REQUIRED_MANIFEST_DIRS: ReadonlySet<string> = new Set(
  getGenaiDependencyWorkspaceDirs(),
);

function checkManifest(
  workspaceDir: string,
  path: string,
): {
  violations: Array<
    ManifestDependencyViolation & {
      readonly manifestPath: string;
    }
  >;
  errors: OperationalError[];
} {
  let manifest: RawManifest;
  try {
    manifest = readRawManifest(path);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      e instanceof Error &&
      'code' in e &&
      (e as { code?: string }).code === 'ENOENT'
    ) {
      // F4: a required manifest (root/core/providers) being absent is an
      // operational failure — the guard cannot verify the dependency
      // invariant without it.
      if (REQUIRED_MANIFEST_DIRS.has(workspaceDir)) {
        return {
          violations: [],
          errors: [
            {
              message:
                `Required manifest ${relRepo(path)} (workspace "${workspaceDir}") ` +
                'is absent — fail-closed.',
            },
          ],
        };
      }
      return { violations: [], errors: [] };
    }
    return {
      violations: [],
      errors: [
        {
          message:
            `Cannot read or parse manifest ${relRepo(path)}: ${msg} — ` +
            'fail-closed.',
        },
      ],
    };
  }

  const result = validateManifestDependencies({ workspaceDir, manifest });
  const violations = result.violations.map((v) => ({
    ...v,
    manifestPath: relRepo(path),
  }));
  const errors = result.errors.map(
    (e: ManifestOperationalError): OperationalError => ({
      message: `${relRepo(path)}: ${e.message}`,
    }),
  );
  return { violations, errors };
}

/**
 * Check all package.json manifests (root + packages/*) for @google/genai
 * dependency declarations via the shared enforcement module.
 */
function checkManifests(): ManifestCheckResult {
  const violations: Array<
    ManifestDependencyViolation & {
      manifestPath: string;
    }
  > = [];
  const errors: OperationalError[] = [];

  const manifestPaths: Array<{ workspaceDir: string; path: string }> = [
    { workspaceDir: '.', path: join(REPO_ROOT, 'package.json') },
  ];

  function discoverManifests(dir: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === 'ENOENT' && dir === PACKAGES_DIR) {
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({
        message:
          `Cannot read package directory (${relRepo(dir)}): ${msg} — ` +
          'fail-closed.',
      });
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && !PRUNE_DIRS.has(entry.name)) {
        discoverManifests(path);
      } else if (entry.isFile() && entry.name === 'package.json') {
        manifestPaths.push({ workspaceDir: relRepo(dir), path });
      }
    }
  }

  discoverManifests(PACKAGES_DIR);

  // F4: explicitly ensure the required manifest paths are checked even if
  // they were not discovered by the filesystem walk (i.e. they are absent).
  // A required manifest's absence must be an operational failure.
  for (const wsDir of REQUIRED_MANIFEST_DIRS) {
    const manifestPath = join(REPO_ROOT, wsDir, 'package.json');
    const alreadyListed = manifestPaths.some(
      (entry) => entry.path === manifestPath,
    );
    if (!alreadyListed) {
      manifestPaths.push({ workspaceDir: wsDir, path: manifestPath });
    }
  }

  for (const { workspaceDir, path } of manifestPaths) {
    const result = checkManifest(workspaceDir, path);
    violations.push(...result.violations);
    errors.push(...result.errors);
  }
  return { violations, errors };
}

// ─── Violation formatting ───────────────────────────────────────────────────

function assertNever(value: never): never {
  throw new Error(`Unhandled violation: ${JSON.stringify(value)}`);
}

function formatViolation(v: Violation): string {
  if (v.kind === 'genai-import') {
    return (
      `  ${v.file}:${v.line}: ${v.importForm} '${v.specifier}' — ` +
      '@google/genai imports are only allowed in packages/providers/src/gemini/** ' +
      'and packages/core/src/code_assist/**'
    );
  }
  if (v.kind === 'computed-import') {
    return (
      `  ${v.file}:${v.line}: ${v.importForm} with a computed (non-string) ` +
      'specifier — dynamic import()/require() outside enclaves must use ' +
      'static string literals so the boundary guard can inspect them. ' +
      'If this import does not reference @google/genai, inline the string ' +
      'literal or move it into an enclave.'
    );
  }
  if (v.kind === 'gemini-export') {
    return (
      `  ${v.file}:${v.line}: ${v.exportForm} '${v.exportName}' — ` +
      'exported identifiers containing "Gemini" are only allowed in ' +
      'packages/providers/src/gemini/** and packages/core/src/code_assist/** ' +
      '(or the explicit allowlist in scripts/genai-enclave/config.ts)'
    );
  }
  return assertNever(v);
}

function formatManifestViolation(
  v: ManifestDependencyViolation & { readonly manifestPath: string },
): string {
  return `  ${v.manifestPath}: ${v.message}`;
}

function collectGeminiExportViolations(
  sourceFile: ReturnType<typeof parseSourceFile>,
  relPath: string,
): Violation[] {
  if (
    isInGeminiNameEnclave(relPath) ||
    isTestFile(relPath) ||
    !isRuntimeExportSurface(relPath)
  ) {
    return [];
  }
  return scanGeminiExports(sourceFile, relPath).filter(
    (violation) =>
      !isExplicitlyAllowedGeminiName(relPath, violation.exportName),
  );
}

interface FileScanResult {
  readonly violations: string[];
  readonly errors: string[];
}

function collectGenaiImportViolations(
  sourceFile: ReturnType<typeof parseSourceFile>,
  relPath: string,
): Violation[] {
  if (isInGenaiImportEnclave(relPath)) return [];
  return scanGenaiImports(sourceFile, relPath);
}

function scanFile(filePath: string): FileScanResult {
  const relPath = relRepo(filePath);
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { violations: [], errors: [`Cannot read ${relPath}: ${message}`] };
  }

  let sourceFile: ReturnType<typeof parseSourceFile>;
  try {
    sourceFile = parseSourceFile(filePath, content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { violations: [], errors: [`Cannot parse ${relPath}: ${message}`] };
  }

  const diagnostics = getParseDiagnostics(sourceFile);
  if (diagnostics.length > 0) {
    const diags = diagnostics
      .map(
        (d) =>
          `${relPath}:${
            sourceFile.getLineAndCharacterOfPosition(d.start ?? 0).line + 1
          } ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
      )
      .join('; ');
    return {
      violations: [],
      errors: [
        `Source parse diagnostics in ${relPath} (${diags}) — fail-closed.`,
      ],
    };
  }

  const violations = [
    ...collectGenaiImportViolations(sourceFile, relPath),
    ...collectGeminiExportViolations(sourceFile, relPath),
  ].map(formatViolation);
  return { violations, errors: [] };
}

function reportResults(allViolations: string[], allErrors: string[]): void {
  if (allErrors.length > 0) {
    console.log(
      `\ngenai-enclave guard: ${allErrors.length} operational error(s) ` +
        '(fail-closed):',
    );
    for (const error of allErrors) console.log(`  ${error}`);
  }

  if (allViolations.length > 0) {
    console.log(
      `\ngenai-enclave guard FAILED: ${allViolations.length} violation(s):\n`,
    );
    for (const violation of allViolations) console.log(violation);
  }
}

function exitForResults(allViolations: string[], allErrors: string[]): void {
  if (allErrors.length > 0 || allViolations.length > 0) {
    const message =
      allViolations.length === 0 && allErrors.length > 0
        ? '\ngenai-enclave guard FAILED due to operational errors.'
        : '\ngenai-enclave guard FAILED.';
    console.log(message);
    process.exit(EXIT_FAIL);
  }

  console.log('\ngenai-enclave guard PASSED.');
  process.exit(EXIT_PASS);
}

function main(): void {
  const manifestResult = checkManifests();
  const allViolations = manifestResult.violations.map(formatManifestViolation);
  const allErrors = manifestResult.errors.map((error) => error.message);
  const { files, errors: discoveryErrors } = discoverFiles();
  allErrors.push(...discoveryErrors.map((error) => error.message));

  if (files.length === 0) {
    allErrors.push(
      'genai-enclave guard: no scannable files found under packages/ ' +
        '(expected non-zero). Refusing to pass.',
    );
  }

  console.log(`genai-enclave guard: scanning ${files.length} files...`);
  for (const filePath of files) {
    const result = scanFile(filePath);
    allViolations.push(...result.violations);
    allErrors.push(...result.errors);
  }

  reportResults(allViolations, allErrors);
  exitForResults(allViolations, allErrors);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
