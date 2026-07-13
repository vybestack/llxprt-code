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
  GENAI_PACKAGE,
  getGenaiDependencyWorkspaceDirs,
  getAllowedGenaiVersion,
} from './genai-enclave/config.ts';
import {
  scanGenaiImports,
  scanGeminiExports,
  parseSourceFile,
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
  return /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/.test(fileName);
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

interface PackageJsonMetadata {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

interface ManifestViolation {
  readonly workspaceDir: string;
  readonly dependencyType: string;
  readonly message: string;
}

/**
 * Read and parse a package.json file. Throws on read or parse failure so
 * that manifest scanning fails closed on malformed/unreadable manifests
 * instead of silently skipping them (which could hide a genai dep).
 */
function readPackageJson(filePath: string): PackageJsonMetadata {
  const content = readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('package.json must contain a JSON object');
  }
  return parsed as PackageJsonMetadata;
}

function getManifestViolation(
  workspaceDir: string,
  path: string,
  dependencyType: string,
  version: string,
  allowedDirs: ReadonlySet<string>,
): ManifestViolation | null {
  if (!allowedDirs.has(workspaceDir)) {
    return {
      workspaceDir,
      dependencyType,
      message:
        `${relRepo(path)}: ${GENAI_PACKAGE} found in "${dependencyType}" ` +
        `(${version}) — not in the sanctioned workspace allowlist ` +
        `(${Array.from(allowedDirs).join(', ')}). Remove it.`,
    };
  }

  const allowedVersion = getAllowedGenaiVersion(workspaceDir);
  if (allowedVersion !== undefined && version !== allowedVersion) {
    return {
      workspaceDir,
      dependencyType,
      message:
        `${relRepo(path)}: ${GENAI_PACKAGE} version "${version}" ` +
        `in "${dependencyType}" does not match the required exact version ` +
        `"${allowedVersion}".`,
    };
  }
  return null;
}

function checkManifest(
  workspaceDir: string,
  path: string,
  allowedDirs: ReadonlySet<string>,
): {
  violations: ManifestViolation[];
  errors: OperationalError[];
} {
  let pkg: PackageJsonMetadata;
  try {
    pkg = readPackageJson(path);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // ENOENT (no package.json) is acceptable: a missing manifest cannot
    // declare a genai dependency. All other errors (malformed JSON, EACCES,
    // etc.) fail closed.
    if (
      e instanceof Error &&
      'code' in e &&
      (e as { code?: string }).code === 'ENOENT'
    ) {
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

  const depTypes: Array<{
    key: keyof PackageJsonMetadata;
    label: string;
  }> = [
    { key: 'dependencies', label: 'dependencies' },
    { key: 'devDependencies', label: 'devDependencies' },
    { key: 'peerDependencies', label: 'peerDependencies' },
    { key: 'optionalDependencies', label: 'optionalDependencies' },
  ];
  const violations: ManifestViolation[] = [];
  for (const { key, label } of depTypes) {
    const version = pkg[key]?.[GENAI_PACKAGE];
    const violation =
      version === undefined
        ? null
        : getManifestViolation(workspaceDir, path, label, version, allowedDirs);
    violations.push(...(violation === null ? [] : [violation]));
  }
  return { violations, errors: [] };
}

/**
 * Check all package.json manifests (root + packages/*) for @google/genai
 * dependency declarations. The SDK must appear ONLY in the exact sanctioned
 * workspaces at the exact allowed version. Any other occurrence is a violation.
 */
function checkManifests(): {
  violations: ManifestViolation[];
  errors: OperationalError[];
} {
  const violations: ManifestViolation[] = [];
  const errors: OperationalError[] = [];
  const allowedDirs = new Set(getGenaiDependencyWorkspaceDirs());

  // ── Collect all manifest paths: root + packages/*/ ─────────────────
  const manifestPaths: Array<{ workspaceDir: string; path: string }> = [];

  // Root package.json
  manifestPaths.push({
    workspaceDir: '.',
    path: join(REPO_ROOT, 'package.json'),
  });

  // packages/*/package.json
  let pkgEntries: Dirent[];
  try {
    pkgEntries = readdirSync(PACKAGES_DIR, { withFileTypes: true });
  } catch (e) {
    const err = e as { code?: string };
    // ENOENT means no packages/ directory — acceptable (e.g. a temp fixture
    // testing only root package.json). Fall through with an empty list so the
    // root manifest is still checked. All other errors fail closed.
    if (err.code !== 'ENOENT') {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({
        message:
          `Cannot read packages directory (${PACKAGES_DIR}): ${msg} — ` +
          'fail-closed.',
      });
      return { violations, errors };
    }
    pkgEntries = [];
  }
  for (const entry of pkgEntries) {
    if (entry.isDirectory() && !PRUNE_DIRS.has(entry.name)) {
      manifestPaths.push({
        workspaceDir: `packages/${entry.name}`,
        path: join(PACKAGES_DIR, entry.name, 'package.json'),
      });
    }
  }

  for (const { workspaceDir, path } of manifestPaths) {
    const result = checkManifest(workspaceDir, path, allowedDirs);
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

function formatManifestViolation(v: ManifestViolation): string {
  return `  ${v.message}`;
}

function collectGeminiExportViolations(
  sourceFile: ReturnType<typeof parseSourceFile>,
  relPath: string,
): Violation[] {
  if (isInGeminiNameEnclave(relPath) || isTestFile(relPath)) {
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
  return scanGenaiImports(sourceFile, relPath).filter(
    (violation) => violation.kind !== 'computed-import' || !isTestFile(relPath),
  );
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

  if (sourceFile.parseDiagnostics.length > 0) {
    const diags = sourceFile.parseDiagnostics
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
