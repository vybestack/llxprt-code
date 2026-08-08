#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * check-no-vitest.ts
 *
 * Issue #2970 — repo-wide guard against any reintroduction of Vitest.
 *
 * The repository has fully migrated to Bun's native test runner (`bun:test`).
 * Vitest is non-functional (Vite cannot resolve `bun:test`) and every trace
 * has been removed. This guard prevents regression by failing CI when any of
 * the following appear outside the guard's own source and test fixtures:
 *
 *   - an import/require of the `vitest` specifier or a `vitest/*` subpath;
 *   - a `vitest`, `@vitest/*`, `@fast-check/vitest`, or
 *     `@stryker-mutator/vitest-runner` dependency entry in any manifest
 *     (including npm-aliased values like `"npm:vitest@..."`);
 *   - a `vitest.config.*` / `vitest.*.config.*` / `vitest.workspace.*` /
 *     `vitest.setup.*` file anywhere in the tree;
 *   - a `vite.config.*` file containing a Vitest `test:` block;
 *   - a package script that invokes the `vitest` binary;
 *   - a binary invocation of vitest in non-code files (YAML, shell, Makefile);
 *   - a vitest-related file reference in TOML configuration (e.g. preloads);
 *   - a vitest package entry in lockfiles (`bun.lock`, `package-lock.json`).
 *
 * Design principles (mirroring scripts/check-legacy-paths.ts):
 *   - **Detection, not counting.** Reports each offending `file:line:match`.
 *   - **No false positives on prose.** The word "vitest" in comments or
 *     prose strings is NOT flagged — only structural code (imports/requires),
 *     manifest entries, config filenames, script invocations, and binary
 *     invocations in non-code files.
 *   - **Root override.** `NO_VITEST_ROOT=<dir>` points the guard at a temp
 *     fixture tree so behavioral tests can exercise it without the real repo.
 *
 * Usage:
 *   scripts/check-no-vitest.ts
 *
 * For test fixtures, set NO_VITEST_ROOT=<dir> to scan a temp tree.
 */

import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join, relative, resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = process.env.NO_VITEST_ROOT
  ? resolve(process.env.NO_VITEST_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');

const EXIT_PASS = 0;
const EXIT_FAIL = 1;

// ─── Types ──────────────────────────────────────────────────────────────────

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly match: string;
  readonly kind: string;
}

// ─── Configuration ──────────────────────────────────────────────────────────

/** Directories pruned during the walk (by name, at any depth). */
const PRUNE_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.stryker-tmp',
  'dist',
  'bundle',
  'project-plans',
  'research',
  'tmp',
  'reference',
  '.integration-tests',
  '.worktrees',
  '.yalc',
]);

/** Files excluded from scanning (relative to repo root). */
const SELF_EXCLUDE_FILES: ReadonlySet<string> = new Set([
  'scripts/check-no-vitest.ts',
  'scripts/tests/no-vitest-guard.test.ts',
  'scripts/tests/no-vitest-guard-helpers.ts',
]);

/** Code-file extensions eligible for the import/require scan. */
const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
]);

/**
 * Config/script extensions used to validate vitest config filenames.
 * Restricting to these prevents false positives on documentation files
 * like `vitest.config.md` (issue #2970).
 */
const CONFIG_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.json',
]);

/** Shell-like file extensions scanned for vitest binary invocations. */
const SHELL_LIKE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.sh',
  '.bash',
  '.yml',
  '.yaml',
]);

/** TOML file extensions scanned for vitest file references. */
const TOML_EXTENSIONS: ReadonlySet<string> = new Set(['.toml']);

/** Filenames without extensions treated as shell-like scripts. */
const SHELL_LIKE_FILENAMES: ReadonlySet<string> = new Set(['Makefile']);

/** Lockfile filenames scanned for vitest package entries. */
const LOCKFILE_FILENAMES: ReadonlySet<string> = new Set([
  'bun.lock',
  'package-lock.json',
]);

/**
 * Detects `vitest` or a `vitest/*` subpath used as a module specifier in an
 * import/require/from/dynamic-import context. Precise enough to NOT match the
 * bare word "vitest" in prose or comments (issue #2970 case 11). Applied to
 * the FULL file content (not per-line) so multi-line dynamic imports like
 * `await import(\n  'vitest'\n)` are caught.
 */
const VITEST_IMPORT_PATTERN =
  /\b(?:from|import|require)\W+['"]vitest(?:\/[^'"]*)?['"]/;

/**
 * Matches the `vitest` binary invoked anywhere in a package script value.
 * The negative lookbehind excludes `.` and `-` (which appear in filenames
 * like `check-no-vitest.ts`) but NOT `/` (which appears in resolved binary
 * paths like `./node_modules/.bin/vitest`).
 */
const VITEST_BINARY_IN_SCRIPT = /(?<![.-])vitest\b/;

/**
 * Patterns that detect the `vitest` binary invoked as a command in non-code
 * text files (YAML, shell, Makefile). Each pattern targets a concrete
 * invocation form so prose mentions like "# uses vitest" are NOT matched.
 */
const VITEST_BINARY_INVOCATION_PATTERNS: readonly RegExp[] = [
  // Package runner + vitest: `npx vitest`, `pnpm vitest`, `yarn vitest`, `bunx vitest`
  /(?:npx|pnpm|yarn|bunx)\s+vitest\b/,
  // vitest as a direct command with a subcommand: `vitest run`, `vitest watch`
  /(?<![.-])\bvitest\s+(?:run|watch|dev|ui|bench|report|list|--)/,
  // Path-qualified binary: `.bin/vitest`
  /\.bin\/vitest\b/,
];

/**
 * Detects vitest-related file references in TOML configuration files
 * (e.g. `preload = ["./vitest-shim.ts"]`).
 */
const VITEST_TOML_PATTERN = /vitest[\w.-]*\.(?:ts|mts|cts|js|mjs|cjs)/;

/**
 * Detects forbidden vitest package entries in lockfiles.
 * Matches vitest as a package path/key in both bun.lock ("vitest@version")
 * and package-lock.json ("node_modules/vitest") formats, including scoped
 * packages (@vitest/*, @fast-check/vitest, @stryker-mutator/vitest-runner).
 */
const LOCKFILE_VITEST_PATTERN =
  /[/"]vitest["'@/-]|[/"]@vitest\/|[/"]@fast-check\/vitest["@/-]|[/"]@stryker-mutator\/vitest-runner["@/-]/;

/**
 * Detects npm-aliased vitest dependencies in manifest version specs
 * (e.g. `"testrunner": "npm:vitest@^3.0.0"`).
 */
const NPM_ALIAS_VITEST_PATTERN =
  /^npm:(vitest|@vitest\/[^@]+|@fast-check\/vitest|@stryker-mutator\/vitest-runner)@/;

/**
 * Detects a Vitest `test:` configuration block inside a `vite.config.*` file
 * — the most common way Vitest is configured alongside Vite.
 */
const VITE_CONFIG_TEST_BLOCK = /\btest\s*:\s*\{/;

/** Vitest config filename base-name patterns (checked after extension validation). */
const VITEST_CONFIG_BASENAME =
  /^vitest\.config(?:\.|$)|^vitest\.[^.]+\.config(?:\.|$)|^vitest\.workspace(?:\.|$)|^vitest\.setup(?:\.|$)|^vitest\.env(?:\.|$)/;

/**
 * Forbidden manifest dependency keys. Matches `vitest`, any `@vitest/*`
 * scoped package, `@fast-check/vitest`, and
 * `@stryker-mutator/vitest-runner`.
 */
const FORBIDDEN_DEP_KEYS: readonly RegExp[] = [
  /^vitest$/,
  /^@vitest\/.+$/,
  /^@fast-check\/vitest$/,
  /^@stryker-mutator\/vitest-runner$/,
];

/** Manifest dependency sections scanned for forbidden entries. */
const DEP_SECTIONS: readonly string[] = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function relRepo(filePath: string): string {
  return relative(REPO_ROOT, filePath).replace(/\\/g, '/');
}

function shouldPruneDir(name: string): boolean {
  return PRUNE_DIRS.has(name);
}

function isSelfExcluded(relPath: string): boolean {
  return SELF_EXCLUDE_FILES.has(relPath);
}

function isCodeFile(fileName: string): boolean {
  return CODE_EXTENSIONS.has(extname(fileName).toLowerCase());
}

function isManifest(fileName: string): boolean {
  return basename(fileName) === 'package.json';
}

function isLockfile(fileName: string): boolean {
  return LOCKFILE_FILENAMES.has(basename(fileName));
}

function isShellLikeFile(filePath: string): boolean {
  return (
    SHELL_LIKE_EXTENSIONS.has(extname(filePath).toLowerCase()) ||
    SHELL_LIKE_FILENAMES.has(basename(filePath))
  );
}

function isTomlFile(filePath: string): boolean {
  return TOML_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function isViteConfigFile(fileName: string): boolean {
  return (
    /^vite\.config\./.test(basename(fileName)) &&
    CODE_EXTENSIONS.has(extname(fileName).toLowerCase())
  );
}

function isVitestConfigFile(fileName: string): boolean {
  const ext = extname(fileName).toLowerCase();
  if (!CONFIG_EXTENSIONS.has(ext)) return false;
  const base = basename(fileName, ext);
  return base === 'vitest' || VITEST_CONFIG_BASENAME.test(base);
}

// ─── File discovery ─────────────────────────────────────────────────────────

function walkTree(): { files: string[]; errors: string[] } {
  const errors: string[] = [];
  const files: string[] = [];

  function walk(dir: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Cannot traverse ${relRepo(dir) || dir}: ${msg}`);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldPruneDir(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        files.push(join(dir, entry.name));
      }
    }
  }

  walk(REPO_ROOT);
  return { files, errors };
}

// ─── Scanning ───────────────────────────────────────────────────────────────

function readFileSyncSafe(
  filePath: string,
  errors: string[],
): string | undefined {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Cannot read ${relRepo(filePath)}: ${msg}`);
    return undefined;
  }
}

/** Line number (1-based) of a character offset in a string. */
function lineOfOffset(content: string, offset: number): number {
  return content.slice(0, offset).split('\n').length;
}

function scanCodeFile(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const globalPattern = new RegExp(VITEST_IMPORT_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = globalPattern.exec(content)) !== null) {
    violations.push({
      file: relRepo(filePath),
      line: lineOfOffset(content, match.index),
      match: match[0].trim().replace(/\s+/g, ' '),
      kind: 'import/require of vitest specifier',
    });
    if (match.index === globalPattern.lastIndex) {
      globalPattern.lastIndex++;
    }
  }
  return violations;
}

function scanShellLikeFile(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (VITEST_BINARY_INVOCATION_PATTERNS.some((re) => re.test(line))) {
      violations.push({
        file: relRepo(filePath),
        line: i + 1,
        match: line.trim(),
        kind: 'vitest binary invocation in non-code file',
      });
    }
  }
  return violations;
}

function scanTomlFile(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment-only lines (TOML comments start with #) to avoid
    // false positives on prose mentions of vitest in comments.
    if (line.trimStart().startsWith('#')) continue;
    if (VITEST_TOML_PATTERN.test(line)) {
      violations.push({
        file: relRepo(filePath),
        line: i + 1,
        match: line.trim(),
        kind: 'vitest reference in TOML configuration',
      });
    }
  }
  return violations;
}

function scanLockfile(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (LOCKFILE_VITEST_PATTERN.test(line)) {
      violations.push({
        file: relRepo(filePath),
        line: i + 1,
        match: line.trim(),
        kind: 'vitest entry in lockfile',
      });
    }
  }
  return violations;
}

function scanViteConfigForTestBlock(
  filePath: string,
  content: string,
): Violation[] {
  const match = content.match(VITE_CONFIG_TEST_BLOCK);
  if (match?.index !== undefined) {
    return [
      {
        file: relRepo(filePath),
        line: lineOfOffset(content, match.index),
        match: 'test block in vite.config.*',
        kind: 'vitest test block in vite config',
      },
    ];
  }
  return [];
}

interface ManifestData {
  readonly [key: string]: unknown;
}

function parseManifest(content: string): ManifestData | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as ManifestData;
    }
  } catch {
    // Malformed package.json — skip; not our concern.
  }
  return undefined;
}

function scanManifest(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const manifest = parseManifest(content);
  if (manifest === undefined) return violations;
  const rel = relRepo(filePath);

  // Dependency entries (keys and npm-aliased values).
  for (const section of DEP_SECTIONS) {
    const deps = manifest[section];
    if (typeof deps !== 'object' || deps === null) continue;
    for (const [key, value] of Object.entries(
      deps as Record<string, unknown>,
    )) {
      const isForbiddenKey = FORBIDDEN_DEP_KEYS.some((re) => re.test(key));
      const isAliasedVitest =
        typeof value === 'string' && NPM_ALIAS_VITEST_PATTERN.test(value);
      if (isForbiddenKey || isAliasedVitest) {
        violations.push({
          file: rel,
          line: 1,
          match: isAliasedVitest
            ? `"${key}": "${value}" (npm alias) in ${section}`
            : `"${key}" in ${section}`,
          kind: isAliasedVitest
            ? 'forbidden vitest dependency (npm alias)'
            : 'forbidden vitest dependency',
        });
      }
    }
  }

  // Script invocations of the vitest binary.
  const scripts = manifest['scripts'];
  if (typeof scripts === 'object' && scripts !== null) {
    for (const [name, value] of Object.entries(
      scripts as Record<string, unknown>,
    )) {
      if (typeof value === 'string' && VITEST_BINARY_IN_SCRIPT.test(value)) {
        violations.push({
          file: rel,
          line: 1,
          match: `script "${name}": ${value}`,
          kind: 'package script invokes vitest binary',
        });
      }
    }
  }

  return violations;
}

// ─── Reporting ──────────────────────────────────────────────────────────────

function formatViolation(v: Violation): string {
  return `  ${v.file}:${v.line}: ${v.kind}\n    ${v.match}`;
}

function reportResults(violations: Violation[], errors: string[]): void {
  if (errors.length > 0) {
    console.log(
      `\nno-vitest guard: ${errors.length} operational error(s) (fail-closed):`,
    );
    for (const error of errors) console.log(`  ${error}`);
  }
  if (violations.length > 0) {
    console.log(
      `\nno-vitest guard FAILED: ${violations.length} violation(s):\n`,
    );
    for (const v of violations) console.log(formatViolation(v));
    console.log(
      '\nTo fix: remove the Vitest reference. The repository uses bun:test\n' +
        'exclusively. See dev-docs/bun.md for the canonical test command.\n' +
        'If you genuinely need this reference, it must NOT be reintroduced —\n' +
        'file a follow-up issue instead.',
    );
  }
}

// ─── Per-file scanning ──────────────────────────────────────────────────────

/** Process a single file entry and return any violations found. */
function scanFileEntry(filePath: string, errors: string[]): Violation[] {
  const rel = relRepo(filePath);
  if (isSelfExcluded(rel)) return [];

  const fileName = basename(filePath);

  // Config-file detection (filename, not content).
  if (isVitestConfigFile(fileName)) {
    return [
      {
        file: rel,
        line: 1,
        match: fileName,
        kind: 'vitest config file',
      },
    ];
  }

  // Manifest detection (dependencies + scripts).
  if (isManifest(filePath)) {
    const content = readFileSyncSafe(filePath, errors);
    return content !== undefined ? scanManifest(filePath, content) : [];
  }

  // Lockfile detection.
  if (isLockfile(fileName)) {
    const content = readFileSyncSafe(filePath, errors);
    return content !== undefined ? scanLockfile(filePath, content) : [];
  }

  // Code-file detection (imports/requires + vite.config test blocks).
  if (isCodeFile(filePath)) {
    const content = readFileSyncSafe(filePath, errors);
    if (content === undefined) return [];
    const violations = scanCodeFile(filePath, content);
    if (isViteConfigFile(fileName)) {
      violations.push(...scanViteConfigForTestBlock(filePath, content));
    }
    return violations;
  }

  // Shell-like file detection (YAML, shell, Makefile).
  if (isShellLikeFile(filePath)) {
    const content = readFileSyncSafe(filePath, errors);
    return content !== undefined ? scanShellLikeFile(filePath, content) : [];
  }

  // TOML file detection.
  if (isTomlFile(filePath)) {
    const content = readFileSyncSafe(filePath, errors);
    return content !== undefined ? scanTomlFile(filePath, content) : [];
  }

  return [];
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const { files, errors } = walkTree();

  if (files.length === 0) {
    errors.push('no-vitest guard: no files found. Refusing to pass.');
  }

  console.log(`no-vitest guard: scanning ${files.length} files...`);

  const violations: Violation[] = [];

  for (const filePath of files) {
    violations.push(...scanFileEntry(filePath, errors));
  }

  reportResults(violations, errors);

  if (errors.length > 0 || violations.length > 0) {
    console.log('\nno-vitest guard FAILED.');
    process.exit(EXIT_FAIL);
  }
  console.log('\nno-vitest guard PASSED.');
  process.exit(EXIT_PASS);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
