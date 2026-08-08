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
 *   - a triple-slash `/// <reference types="vitest..." />` directive;
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

import { readFileSync, readdirSync, writeFileSync, type Dirent } from 'node:fs';
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
 * Detects a triple-slash `/// <reference types="vitest..." />` directive
 * referencing the `vitest` specifier or any `vitest/*` subpath. This is a
 * genuine Vitest dependency (it loads Vitest's ambient type declarations)
 * and must fail the guard even though it is neither an import/require nor a
 * manifest entry. Issue #2970: nine files hid behind
 * `/// <reference types="vitest/globals" />` that the import scan missed.
 *
 * Precise enough to NOT match the bare word "vitest" in prose: it requires
 * the `///` triple-slash prefix and the `<reference types="..." />` shape.
 */
const VITEST_TRIPLE_SLASH_REFERENCE =
  /^\/\/\/\s*<reference\s+types=["']vitest(?:\/[^"']*)?["']\s*\/?>/m;

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
  // Package runner + vitest, including `run`/`exec`/`--bun` subcommands:
  //   `npx vitest`, `pnpm vitest`, `yarn vitest`, `bunx vitest`,
  //   `npm run vitest`, `pnpm exec vitest`, `yarn exec vitest`,
  //   `yarn run vitest`, `bun run vitest`, `bunx --bun vitest`
  // (issue #2970, finding B).
  /(?:npx|pnpm|yarn|bunx|bun|npm)\s+(?:(?:run|exec|--bun)\s+)?vitest\b/,
  // vitest as a direct command with a subcommand: `vitest run`, `vitest watch`
  /(?<![.-])\bvitest\s+(?:run|watch|dev|ui|bench|report|list|--)/,
  // vitest as a standalone command without a known subcommand: bare
  // `vitest` at line start, after a shell separator (|, &, ;, >), after a
  // Makefile tab, or after `run:` in YAML. Catches forms like `\tvitest`
  // in a Makefile or `- run: vitest` in a workflow that the subcommand
  // pattern above misses. The lookahead requires whitespace or end-of-line
  // after `vitest` so file-path references like `vitest.config.ts` are not
  // matched. Comment lines are skipped beforehand by scanShellLikeFile.
  /(?:^|[|&;>]|\brun:)\s*vitest(?=\s|$)/,
  // Path-qualified binary: `.bin/vitest`
  /\.bin\/vitest\b/,
];

/**
 * Detects vitest-related file references in TOML configuration files.
 * Matches a `vitest`-prefixed filename with a code extension
 * (e.g. `preload = ["./vitest-shim.ts"]`) OR a bare path reference with no
 * extension (e.g. `preload = ["./vitest"]`). The leading word boundary and
 * path-character lookbehind avoid flagging unrelated names like
 * `avitest-shim.ts` or `myvitest-helper.ts` (issue #2970, findings C1 & C2).
 */
const VITEST_TOML_PATTERN =
  /\bvitest[\w.-]*\.(?:ts|mts|cts|js|mjs|cjs)\b|(?<=[/.])vitest\b/;

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

/**
 * Find the 1-based line number of a JSON manifest key (`"key":`) in the raw
 * text. Falls back to line 1 if the key cannot be located (e.g. unusual
 * formatting). This preserves the doc-promised `file:line:match` precision
 * that JSON.parse discards.
 */
function findManifestKeyLine(content: string, key: string): number {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`"${escaped}"\\s*:`).exec(content);
  return match?.index !== undefined ? lineOfOffset(content, match.index) : 1;
}

// ─── Lexical masking (issue #2970, finding A) ───────────────────────────────
//
// VITEST_IMPORT_PATTERN is applied to raw file content, so the literal text
// `import { it } from 'vitest'` inside a comment or string literal would be a
// false positive. To suppress those without losing accurate `file:line:match`
// precision, we compute the character spans occupied by comments and
// string/template-literal *text* (excluding the real code inside `${...}`
// template interpolations), then skip any import match whose start offset
// falls inside such a span. The triple-slash reference scan deliberately does
// NOT use this masking — that directive is a comment by syntax but is a real
// dependency and must keep failing.

interface MaskedSpan {
  readonly start: number;
  readonly end: number;
}

type LexFrame =
  | { readonly kind: 'code' }
  | { readonly kind: 'lineComment' }
  | { readonly kind: 'blockComment' }
  | { readonly kind: 'string'; readonly quote: string }
  | { readonly kind: 'template' }
  | { kind: 'templateExpr'; depth: number };

/**
 * Single-pass lexical scanner that records the spans of comments and
 * string/template text so import/require matches inside them can be skipped.
 * Implemented as a class so each per-context step is a small, low-complexity
 * method (the lint rules cap per-function complexity).
 */
class CodeMasker {
  private readonly content: string;
  private readonly len: number;
  private readonly spans: MaskedSpan[] = [];
  private readonly stack: LexFrame[] = [{ kind: 'code' }];
  private i = 0;
  private maskStart = -1;

  constructor(content: string) {
    this.content = content;
    this.len = content.length;
  }

  compute(): MaskedSpan[] {
    while (this.i < this.len) {
      const frame = this.stack[this.stack.length - 1];
      if (frame.kind === 'code' || frame.kind === 'templateExpr') {
        this.scanCodeLike(frame);
      } else if (frame.kind === 'lineComment') {
        this.scanLineComment();
      } else if (frame.kind === 'blockComment') {
        this.scanBlockComment();
      } else if (frame.kind === 'string') {
        this.scanString(frame);
      } else if (frame.kind === 'template') {
        this.scanTemplate();
      } else {
        this.i += 1;
      }
    }
    return this.spans;
  }

  private scanCodeLike(frame: LexFrame): void {
    const ch = this.content[this.i];
    const next = this.i + 1 < this.len ? this.content[this.i + 1] : '';

    if (frame.kind === 'templateExpr') {
      if (ch === '{') {
        frame.depth += 1;
        this.i += 1;
        return;
      }
      if (ch === '}') {
        this.closeTemplateExpr(frame);
        return;
      }
    }

    if (ch === '/' && next === '/') {
      this.maskStart = this.i;
      this.stack.push({ kind: 'lineComment' });
      this.i += 2;
    } else if (ch === '/' && next === '*') {
      this.maskStart = this.i;
      this.stack.push({ kind: 'blockComment' });
      this.i += 2;
    } else if (ch === '"' || ch === "'") {
      this.maskStart = this.i;
      this.stack.push({ kind: 'string', quote: ch });
      this.i += 1;
    } else if (ch === '`') {
      this.maskStart = this.i;
      this.stack.push({ kind: 'template' });
      this.i += 1;
    } else {
      this.i += 1;
    }
  }

  private closeTemplateExpr(frame: {
    kind: 'templateExpr';
    depth: number;
  }): void {
    this.i += 1;
    if (frame.depth === 0) {
      // Closing brace of `${...}`: resume masking the template's static text.
      this.stack.pop();
      this.maskStart = this.i;
    } else {
      frame.depth -= 1;
    }
  }

  private scanLineComment(): void {
    if (this.content[this.i] === '\n') {
      this.flushMask();
      this.stack.pop();
    }
    this.i += 1;
  }

  private scanBlockComment(): void {
    const ch = this.content[this.i];
    const next = this.i + 1 < this.len ? this.content[this.i + 1] : '';
    if (ch === '*' && next === '/') {
      this.i += 2;
      this.flushMask();
      this.stack.pop();
    } else {
      this.i += 1;
    }
  }

  private scanString(frame: LexFrame): void {
    const ch = this.content[this.i];
    if (ch === '\\') {
      this.i += 2;
    } else if (frame.kind === 'string' && ch === frame.quote) {
      this.i += 1;
      this.flushMask();
      this.stack.pop();
    } else {
      this.i += 1;
    }
  }

  private scanTemplate(): void {
    const ch = this.content[this.i];
    const next = this.i + 1 < this.len ? this.content[this.i + 1] : '';
    if (ch === '\\') {
      this.i += 2;
    } else if (ch === '`') {
      this.i += 1;
      this.flushMask();
      this.stack.pop();
    } else if (ch === '$' && next === '{') {
      // End the static-text mask; the interpolation is real code.
      this.flushMask();
      this.i += 2;
      this.stack.push({ kind: 'templateExpr', depth: 0 });
    } else {
      this.i += 1;
    }
  }

  private flushMask(): void {
    if (this.maskStart >= 0 && this.i > this.maskStart) {
      this.spans.push({ start: this.maskStart, end: this.i });
    }
    this.maskStart = -1;
  }
}

function computeMaskedSpans(content: string): MaskedSpan[] {
  return new CodeMasker(content).compute();
}

/** True when `offset` lies inside a comment or string/template span. */
function isOffsetMasked(offset: number, spans: readonly MaskedSpan[]): boolean {
  for (const span of spans) {
    if (offset >= span.start && offset < span.end) return true;
  }
  return false;
}

function scanCodeFile(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  // Compute comment/string spans once so import matches that fall inside a
  // comment or string/template literal are treated as prose, not real
  // dependencies (issue #2970, finding A). Triple-slash references below are
  // intentionally NOT masked.
  const maskedSpans = computeMaskedSpans(content);
  const globalPattern = new RegExp(VITEST_IMPORT_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = globalPattern.exec(content)) !== null) {
    if (!isOffsetMasked(match.index, maskedSpans)) {
      violations.push({
        file: relRepo(filePath),
        line: lineOfOffset(content, match.index),
        match: match[0].trim().replace(/\s+/g, ' '),
        kind: 'import/require of vitest specifier',
      });
    }
    if (match.index === globalPattern.lastIndex) {
      globalPattern.lastIndex++;
    }
  }

  // Triple-slash `/// <reference types="vitest..." />` directives (issue
  // #2970). These load Vitest's ambient declarations and are a real
  // dependency, but they are not import/require statements, so the scan
  // above does not catch them.
  const refPattern = new RegExp(VITEST_TRIPLE_SLASH_REFERENCE.source, 'gm');
  while ((match = refPattern.exec(content)) !== null) {
    violations.push({
      file: relRepo(filePath),
      line: lineOfOffset(content, match.index),
      match: match[0].trim().replace(/\s+/g, ' '),
      kind: 'triple-slash reference to vitest types',
    });
    if (match.index === refPattern.lastIndex) {
      refPattern.lastIndex++;
    }
  }
  return violations;
}

function scanShellLikeFile(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment lines whose first non-whitespace character is `#` (YAML,
    // shell). This prevents false positives on prose mentions like
    // `# Run vitest run for local testing`, mirroring scanTomlFile's behaviour.
    if (line.trimStart().startsWith('#')) continue;
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
  // JSON.parse throws on syntactically invalid manifests; scanManifest routes
  // that through the operational-error path so the guard fails closed rather
  // than silently skipping a malformed manifest (issue #2970, finding D).
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed === 'object' && parsed !== null) {
    return parsed as ManifestData;
  }
  return undefined;
}

function scanManifest(
  filePath: string,
  content: string,
  errors: string[],
): Violation[] {
  const violations: Violation[] = [];
  let manifest: ManifestData | undefined;
  try {
    manifest = parseManifest(content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Cannot parse manifest ${relRepo(filePath)}: ${msg}`);
    return violations;
  }
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
          line: findManifestKeyLine(content, key),
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
          line: findManifestKeyLine(content, name),
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

/**
 * Build the violation/error report as a string. Separated from output so
 * the caller can write to both stdout and an output file.
 */
function buildReport(violations: Violation[], errors: string[]): string {
  const lines: string[] = [];
  if (errors.length > 0) {
    lines.push(
      `\nno-vitest guard: ${errors.length} operational error(s) (fail-closed):`,
    );
    for (const error of errors) lines.push(`  ${error}`);
  }
  if (violations.length > 0) {
    lines.push(
      `\nno-vitest guard FAILED: ${violations.length} violation(s):\n`,
    );
    for (const v of violations) lines.push(formatViolation(v));
    lines.push(
      '\nTo fix: remove the Vitest reference. The repository uses bun:test\n' +
        'exclusively. See dev-docs/bun.md for the canonical test command.\n' +
        'If you genuinely need this reference, it must NOT be reintroduced —\n' +
        'file a follow-up issue instead.',
    );
  }
  return lines.join('\n');
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
    return content !== undefined ? scanManifest(filePath, content, errors) : [];
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

  const header = `no-vitest guard: scanning ${files.length} files...`;
  console.log(header);

  const violations: Violation[] = [];

  for (const filePath of files) {
    violations.push(...scanFileEntry(filePath, errors));
  }

  const report = buildReport(violations, errors);
  if (report) console.log(report);

  const failed = errors.length > 0 || violations.length > 0;
  const footer = failed
    ? '\nno-vitest guard FAILED.'
    : '\nno-vitest guard PASSED.';
  console.log(footer);

  // Issue #2970: write complete output to a file for the test harness.
  // Bun's spawnSync/execFile cannot reliably capture child stdout under
  // bun:test, so the harness sets NO_VITEST_OUTPUT_FILE and reads from it
  // instead. writeFileSync is synchronous, so the data is committed to disk
  // before process.exit() runs.
  const outputFile = process.env.NO_VITEST_OUTPUT_FILE;
  if (outputFile) {
    const fullOutput =
      [header, report, footer].filter(Boolean).join('\n') + '\n';
    try {
      writeFileSync(outputFile, fullOutput);
    } catch {
      // Best-effort — stdout is the primary output channel.
    }
  }

  if (failed) {
    process.exit(EXIT_FAIL);
  }
  process.exit(EXIT_PASS);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
