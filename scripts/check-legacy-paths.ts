#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * check-legacy-paths.ts
 *
 * Issue #2606, Phase 10 / AD10 — repo-wide guard against ACTIVE
 * HOME-anchored LLxprt legacy defaults/guidance.
 *
 * Detects newly added occurrences of home-anchored legacy path constructions
 * (`~/.llxprt`, `$HOME/.llxprt`, `${HOME}/.llxprt`, `homedir()` joined with
 * `.llxprt`/`LLXPRT_DIR`, Windows `%USERPROFILE%\.llxprt`) in active surfaces
 * (production source, scripts, docs, schemas), while allowing intentional
 * references via a narrow path+pattern allowlist.
 *
 * Design principles:
 *   - **Semantics matter, not raw strings.** Workspace-relative `.llxprt`
 *     (e.g. `<workspace>/.llxprt/settings.json`) NEVER matches because it is
 *     not home-anchored. Only constructions that anchor to the user's home
 *     directory as a global default/guidance are flagged.
 *   - **Detection, not counting.** The guard reports each offending
 *     file:line:match. Adding a new occurrence fails; removing one and
 *     adding a different one fails. It does NOT compare against a baseline
 *     count.
 *   - **Narrow allowlist.** Each allowlist entry narrows to a `path` and
 *     optional `pattern` (regex). A new stale reference in an allowlisted
 *     file still fails unless it matches the pattern. Whole-directory or
 *     whole-file allowlists are avoided where a narrower pattern is possible.
 *
 * Exclusions (never scanned):
 *   - Historical trees: `docs/plans/`, `docs/release-notes/`,
 *     `docs/merge-notes/`, `project-plans/`, `research/`,
 *     `packages/core/analysis/`.
 *   - Tests/specs in production source (T1–T7 rewrites own test hygiene).
 *   - `node_modules`, `dist`, `bundle`, `.git`, `CHANGELOG.md`.
 *
 * Allowlist: `scripts/legacy-path-allowlist.json`.
 *
 * Usage:
 *   scripts/check-legacy-paths.ts
 *   scripts/check-legacy-paths.ts --self-test   # RED/GREEN self-test
 *
 * For test fixtures, set LEGACY_PATHS_ROOT=<dir> to scan a temp tree.
 */

import { readFileSync, readdirSync, existsSync, type Dirent } from 'node:fs';
import { join, relative, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEGACY_PATTERNS,
  SCANNED_TREES,
  TEST_EXCLUDE_SUFFIXES,
  HARD_EXCLUDE_PREFIXES,
  HARD_EXCLUDE_FILES,
  PRUNE_DIRS,
  validateScannedTrees,
  type AllowlistEntry,
  type CompiledAllowlist,
  type LegacyPattern,
} from './legacy-paths/config.ts';
import { scanFileAst } from './legacy-paths/ast-scanner.ts';

const REPO_ROOT = process.env.LEGACY_PATHS_ROOT
  ? resolve(process.env.LEGACY_PATHS_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWLIST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'legacy-path-allowlist.json',
);

const EXIT_PASS = 0;
const EXIT_FAIL = 1;

// ─── Types ──────────────────────────────────────────────────────────────────

interface Match {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly patternId: string;
  readonly patternDescription: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function relRepo(filePath: string): string {
  return relative(REPO_ROOT, filePath).replace(/\\/g, '/');
}

const SCANNABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.sh',
  '.md',
  '.json',
  '.sb',
]);

function isScannableFile(fileName: string): boolean {
  return SCANNABLE_EXTENSIONS.has(extname(fileName).toLowerCase());
}

/**
 * File extensions eligible for the AST-based dataflow scan (TypeScript and
 * JavaScript variants only). Markdown, shell, and config files are covered by
 * the regex scanner alone.
 */
const AST_SCANNABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

function isAstScannableExt(ext: string): boolean {
  return AST_SCANNABLE_EXTENSIONS.has(ext);
}

function isTestFile(relPath: string): boolean {
  return TEST_EXCLUDE_SUFFIXES.some((suffix) =>
    suffix.startsWith('/')
      ? relPath.includes(suffix)
      : relPath.endsWith(suffix),
  );
}

function isHardExcluded(relPath: string): boolean {
  if (HARD_EXCLUDE_FILES.includes(relPath)) return true;
  return HARD_EXCLUDE_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

/**
 * Whether a repo-relative path falls within the configured scanned trees.
 * Production packages are limited to packages/<pkg>/src/ (test/fixtures live
 * elsewhere and are filtered by isTestFile).
 */
function isInScannedTree(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  const rootDocs = ['README.md', 'CONTRIBUTING.md'];
  if (rootDocs.includes(normalized)) return true;
  if (normalized.startsWith('packages/')) {
    return /^packages\/[^/]+\/src\//.test(normalized);
  }
  const scannedRoots = [
    'scripts/',
    'shell-scripts/',
    'docs/',
    'dev-docs/',
    'schemas/',
  ];
  return scannedRoots.some((root) => normalized.startsWith(root));
}

// ─── Allowlist loading ──────────────────────────────────────────────────────

interface CompiledEntry {
  readonly patterns: readonly RegExp[];
  readonly reason: string;
}

function loadAllowlist(): {
  allowlist: CompiledAllowlist;
  errors: string[];
} {
  const errors: string[] = [];
  let raw: string;
  try {
    raw = readFileSync(ALLOWLIST_PATH, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Cannot read allowlist ${ALLOWLIST_PATH}: ${msg}`);
    return { allowlist: new Map(), errors };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Cannot parse allowlist JSON: ${msg}`);
    return { allowlist: new Map(), errors };
  }
  if (!Array.isArray(parsed)) {
    errors.push('Allowlist must be a JSON array of entries.');
    return { allowlist: new Map(), errors };
  }
  const map = new Map<string, CompiledEntry[]>();
  parsed.forEach((entry: unknown, i: number) => {
    const e = entry as AllowlistEntry;
    if (
      typeof e !== 'object' ||
      e === null ||
      typeof e.path !== 'string' ||
      typeof e.reason !== 'string'
    ) {
      errors.push(
        `Allowlist entry ${i}: must be an object with string 'path' and 'reason'.`,
      );
      return;
    }
    let patterns: RegExp[] = [];
    if (e.pattern !== undefined) {
      if (typeof e.pattern !== 'string') {
        errors.push(
          `Allowlist entry ${i} (${e.path}): 'pattern' must be a string.`,
        );
        return;
      }
      try {
        patterns = [new RegExp(e.pattern)];
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(
          `Allowlist entry ${i} (${e.path}): invalid regex '${e.pattern}': ${msg}`,
        );
        return;
      }
    }
    const existing = map.get(e.path) ?? [];
    existing.push({ patterns, reason: e.reason });
    map.set(e.path, existing);
  });
  return { allowlist: map, errors };
}

/**
 * Whether a specific match is suppressed by the allowlist, and the reason.
 * Suppressed when the file has an allowlist entry AND either the entry has
 * no `pattern` (whole-file) OR the entry's regex matches the offending text.
 */
function checkSuppression(
  match: Match,
  allowlist: CompiledAllowlist,
): { suppressed: boolean; reason: string } {
  const entries = allowlist.get(match.file);
  if (entries === undefined) {
    return { suppressed: false, reason: '' };
  }
  for (const entry of entries) {
    if (entry.patterns.length === 0) {
      return { suppressed: true, reason: entry.reason };
    }
    for (const pattern of entry.patterns) {
      if (pattern.test(match.text)) {
        return { suppressed: true, reason: entry.reason };
      }
    }
  }
  return { suppressed: false, reason: '' };
}

// ─── File discovery ─────────────────────────────────────────────────────────

function walkDir(dir: string, errors: string[]): string[] {
  const results: string[] = [];
  const absDir = resolve(dir);

  function walk(d: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch (e) {
      // Fail-closed: record a path-qualified traversal error instead of
      // silently skipping an unreadable directory.
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Cannot traverse ${relRepo(d) || d}: ${msg}`);
      return;
    }
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (PRUNE_DIRS.includes(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && isScannableFile(entry.name)) {
        results.push(full);
      }
    }
  }

  walk(absDir);
  return results;
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[\\^$.|?*+(){}[\]]/g, (ch) => '\\' + ch);
  const body = escaped
    .replace(/\\\*\\\*\//g, '(?:.*/)?')
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*');
  return new RegExp('^' + body + '$');
}

/**
 * For a glob tree, split off the non-wildcard leading directory prefix and
 * return { baseDir, globSuffix, prefixParts }.
 */
function splitGlobTree(tree: string): {
  baseDir: string;
  globSuffix: string;
  prefixParts: readonly string[];
} {
  const parts = tree.split('/');
  let base = REPO_ROOT;
  let i = 0;
  while (i < parts.length && !parts[i].includes('*')) {
    base = join(base, parts[i]);
    i++;
  }
  return {
    baseDir: base,
    globSuffix: parts.slice(i).join('/'),
    prefixParts: parts.slice(0, i),
  };
}

function collectFromGlobTree(
  tree: string,
  collected: Set<string>,
  errors: string[],
): void {
  const { baseDir, globSuffix, prefixParts } = splitGlobTree(tree);
  if (!existsSync(baseDir)) return;
  const globRegex = globToRegex(globSuffix);
  const prefix = prefixParts.join('/');
  for (const f of walkDir(baseDir, errors)) {
    const rel = relRepo(f);
    const relToBase = relFromBase(rel, prefix);
    if (globRegex.test(relToBase)) {
      collected.add(f);
    }
  }
}

function collectFromFixedTree(
  tree: string,
  collected: Set<string>,
  errors: string[],
): void {
  const absTree = join(REPO_ROOT, tree);
  if (!existsSync(absTree)) return;
  let isDir = true;
  try {
    readdirSync(absTree, { withFileTypes: true });
  } catch (e) {
    const code =
      typeof e === 'object' && e !== null && 'code' in e
        ? String((e as { code: unknown }).code)
        : '';
    if (code === 'ENOTDIR') {
      isDir = false;
    } else {
      // Genuine read error (not ENOTDIR): fail-closed with a path-qualified
      // error rather than silently treating it as a file or skipping it.
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Cannot stat ${relRepo(absTree) || tree}: ${msg}`);
      return;
    }
  }
  if (isDir) {
    for (const f of walkDir(absTree, errors)) {
      collected.add(f);
    }
  } else if (isScannableFile(tree)) {
    collected.add(absTree);
  }
}

/**
 * Collect candidate files (pre-filter). Final filtering applies
 * `isInScannedTree` / `isHardExcluded` / `isTestFile`.
 */
function collectCandidates(errors: string[]): Set<string> {
  const collected = new Set<string>();
  for (const tree of SCANNED_TREES) {
    if (tree.includes('*')) {
      collectFromGlobTree(tree, collected, errors);
    } else {
      collectFromFixedTree(tree, collected, errors);
    }
  }
  return collected;
}

function relFromBase(relPath: string, base: string): string {
  if (base === '') return relPath;
  if (relPath.startsWith(base + '/')) {
    return relPath.slice(base.length + 1);
  }
  return relPath;
}

function shouldIncludeFile(rel: string): boolean {
  return isInScannedTree(rel) && !isHardExcluded(rel) && !isTestFile(rel);
}

function discoverFiles(): { files: string[]; errors: string[] } {
  const errors: string[] = [];
  const files: string[] = [];
  const candidates = collectCandidates(errors);
  for (const f of candidates) {
    const rel = relRepo(f);
    if (shouldIncludeFile(rel)) {
      files.push(f);
    }
  }
  return { files, errors };
}

// ─── Scanning ───────────────────────────────────────────────────────────────

/**
 * Maintained-text control-byte guard. Maintained docs/source must never
 * contain a NUL byte or other disallowed C0 control bytes — their presence
 * indicates truncated/corrupted prose (e.g. editor or transfer corruption
 * that pads with NULs). The only control bytes permitted in text files are
 * tab (	=0x09), line feed (
=0x0A), carriage return (
=0x0D), and form
 * feed (\f=0x0C).
 *
 * Returns the byte offset of the first disallowed control byte, or -1 when
 * the buffer is clean. Operates on the raw buffer so NUL bytes (which UTF-8
 * decode preserves as U+0000) are reliably detected regardless of decoding.
 */
export function findDisallowedControlByte(buf: Buffer): number {
  // C0 control bytes permitted in text files: TAB(0x09), LF(0x0A),
  // FF(0x0C), CR(0x0D). All others below 0x20 are disallowed.
  const ALLOWED_CONTROL_BYTES = new Set([0x09, 0x0a, 0x0c, 0x0d]);
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if (byte < 0x20 && !ALLOWED_CONTROL_BYTES.has(byte)) {
      return i;
    }
  }
  return -1;
}

function scanFile(
  filePath: string,
  patterns: readonly LegacyPattern[],
): { matches: Match[]; errors: string[] } {
  const errors: string[] = [];
  const buf = readFileSyncSafe(filePath, errors);
  if (buf === undefined) {
    return { matches: [], errors };
  }
  const matches: Match[] = [];

  // Control-byte guard: detect NUL/corruption before decoding. Produces a
  // violation so maintained text can never silently contain truncation.
  const ctrlOffset = findDisallowedControlByte(buf);
  if (ctrlOffset >= 0) {
    const { line, column } = byteOffsetToLineColumn(buf, ctrlOffset);
    matches.push({
      file: relRepo(filePath),
      line,
      column,
      text: `<disallowed control byte 0x${buf[ctrlOffset].toString(16).padStart(2, '0')} in maintained text>`,
      patternId: 'control-byte',
      patternDescription: 'NUL/disallowed control byte in maintained text',
    });
  }

  const content = buf.toString('utf8');
  const lines = content.split('\n');
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    for (const pattern of patterns) {
      const m = pattern.regex.exec(line);
      if (m) {
        matches.push({
          file: relRepo(filePath),
          line: lineIdx + 1,
          column: m.index + 1,
          text: line.trim(),
          patternId: pattern.id,
          patternDescription: pattern.description,
        });
      }
    }
  }
  return { matches, errors };
}

/**
 * Reads a file, returning undefined on failure and pushing a path-qualified
 * error so the guard fails closed instead of silently passing.
 */
function readFileSyncSafe(
  filePath: string,
  errors: string[],
): Buffer | undefined {
  try {
    return readFileSync(filePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Cannot read ${relRepo(filePath)}: ${msg}`);
    return undefined;
  }
}

/** Converts a byte offset into a 1-based line/column over a UTF-8 buffer. */
function byteOffsetToLineColumn(
  buf: Buffer,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

// ─── Reporting ──────────────────────────────────────────────────────────────

function formatMatch(m: Match, suppressionReason?: string): string {
  const suffix =
    suppressionReason !== undefined && suppressionReason !== ''
      ? `  [ALLOWLISTED: ${suppressionReason}]`
      : '';
  return `  ${m.file}:${m.line}:${m.column}: ${m.patternDescription}${suffix}\n    ${m.text}`;
}

interface SuppressedMatch extends Match {
  readonly reason: string;
}

function reportResults(
  violations: Match[],
  suppressed: SuppressedMatch[],
  errors: string[],
): void {
  if (suppressed.length > 0) {
    console.log(
      `\nlegacy-paths guard: ${suppressed.length} suppressed (allowlisted):`,
    );
    for (const m of suppressed) {
      console.log(formatMatch(m, m.reason));
    }
  }
  if (errors.length > 0) {
    console.log(
      `\nlegacy-paths guard: ${errors.length} operational error(s) (fail-closed):`,
    );
    for (const error of errors) console.log(`  ${error}`);
  }
  if (violations.length > 0) {
    console.log(
      `\nlegacy-paths guard FAILED: ${violations.length} active legacy-path violation(s):\n`,
    );
    for (const m of violations) console.log(formatMatch(m));
    console.log(
      '\nTo fix: replace HOME-anchored legacy paths with canonical Storage helpers\n' +
        '(Storage.getGlobalConfigDir/DataDir/etc.) or category-aware phrasing.\n' +
        'If the reference is an intentional legacy explanation/migration input,\n' +
        'add a narrow path+pattern entry to scripts/legacy-path-allowlist.json\n' +
        'with a reason identifying why it is intentional.',
    );
  }
}

// ─── Self-test (--self-test) ────────────────────────────────────────────────

interface SelfTestResult {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

interface RedCase {
  readonly name: string;
  readonly sample: string;
  readonly expectPattern: string;
}

interface GreenCase {
  readonly name: string;
  readonly sample: string;
}

const RED_CASES: readonly RedCase[] = [
  {
    name: 'literal ~/.llxprt/settings.json',
    sample: "const f = '~/.llxprt/settings.json';",
    expectPattern: 'tilde-slash',
  },
  {
    name: 'literal ~/.llxprt (end of line)',
    sample: 'copied from ~/.llxprt',
    expectPattern: 'tilde-slash',
  },
  {
    name: '$HOME/.llxprt shell expansion',
    sample: 'cp "$HOME/.llxprt/settings.json" .',
    expectPattern: 'dollar-home',
  },
  {
    name: '${HOME}/.llxprt brace expansion',
    sample: 'mkdir -p "${HOME}/.llxprt/oauth"',
    expectPattern: 'brace-home',
  },
  {
    name: 'Windows %USERPROFILE%\\.llxprt',
    sample: 'set CONFIG=%USERPROFILE%\\.llxprt\\settings.json',
    expectPattern: 'windows-userprofile',
  },
  {
    name: "homedir() join '.llxprt'",
    sample: "const f = path.join(os.homedir(), '.llxprt', 'settings.json');",
    expectPattern: 'homedir-dotllxprt',
  },
  {
    name: 'homedir() join LLXPRT_DIR',
    sample: 'const d = path.join(homedir(), LLXPRT_DIR);',
    expectPattern: 'homedir-llxprt-dir',
  },
  {
    name: 'reverse order: .llxprt then homedir()',
    sample: "const f = path.join('.llxprt', os.homedir());",
    expectPattern: 'homedir-dotllxprt',
  },
  {
    name: 'placeholder <home>/.llxprt in docs',
    sample: 'Save settings under <home>/.llxprt/settings.json.',
    expectPattern: 'placeholder-home',
  },
  {
    name: 'placeholder <home>/LLXPRT_DIR in docs',
    sample: 'The legacy root is <home>/LLXPRT_DIR.',
    expectPattern: 'placeholder-home',
  },
  {
    name: 'hand-rolled XDG_DATA_HOME + llxprt-code algorithm',
    sample:
      "const dataDir = path.join(process.env.XDG_DATA_HOME || '.', 'llxprt-code');",
    expectPattern: 'platform-alg-xdg-data',
  },
  {
    name: 'hand-rolled LOCALAPPDATA + llxprt-code algorithm',
    sample:
      "const winDir = path.join(process.env.LOCALAPPDATA, 'llxprt-code', 'Data');",
    expectPattern: 'platform-alg-localappdata',
  },
  {
    name: 'hand-rolled Library Application Support + llxprt-code',
    sample:
      "const macDir = path.join(home, 'Library', 'Application Support', 'llxprt-code');",
    expectPattern: 'platform-alg-app-support',
  },
  {
    name: 'deprecated system-settings env alias outside Storage',
    sample:
      "const p = process.env['LLXPRT_CODE_SYSTEM_SETTINGS_PATH'] || '/etc/llxprt-code/settings.json';",
    expectPattern: 'legacy-sys-settings-env',
  },
  {
    name: 'deprecated system-defaults env alias outside Storage',
    sample:
      "const p = process.env['LLXPRT_CODE_SYSTEM_DEFAULTS_PATH'] || defaultPath;",
    expectPattern: 'legacy-sys-defaults-env',
  },
  {
    name: 'Seatbelt .sb profile string-append HOME_DIR/.llxprt write grant',
    sample:
      '(allow file-write* (subpath (string-append (param "HOME_DIR") "/.llxprt")))',
    expectPattern: 'seatbelt-home-llxprt',
  },
];

const GREEN_CASES: readonly GreenCase[] = [
  {
    name: 'workspace-relative .llxprt/settings.json',
    sample: "const f = path.join(workspaceDir, '.llxprt', 'settings.json');",
  },
  {
    name: 'workspace-local ./.llxprt',
    sample: 'readFileSync("./.llxprt/settings.json")',
  },
  {
    name: 'project-local <workspace>/.llxprt',
    sample: '<workspace>/.llxprt/LLXPRT.md',
  },
  {
    name: 'canonical <config> category shorthand',
    sample: 'Settings live under <config>/settings.json.',
  },
  {
    name: 'Storage canonical helper',
    sample: 'const dir = Storage.getGlobalConfigDir();',
  },
  {
    name: 'LLXPRT_CONFIG_HOME override',
    sample: 'process.env.LLXPRT_CONFIG_HOME',
  },
  {
    name: 'env-paths resolution',
    sample:
      "const p = require('env-paths')('llxprt-code', { suffix: '' }).config;",
  },
  {
    name: '.gemini compatibility root',
    sample: "const root = path.join(os.homedir(), '.gemini', 'extensions');",
  },
  {
    name: 'application-directories doc link',
    sample: 'see docs/reference/application-directories.md',
  },
  {
    name: 'canonical system-settings env var',
    sample: "const p = process.env['LLXPRT_SYSTEM_SETTINGS_PATH'];",
  },
  {
    name: 'canonical system-defaults env var',
    sample: "const p = process.env['LLXPRT_SYSTEM_DEFAULTS_PATH'];",
  },
  {
    name: 'VS Code Application Support path (external app)',
    sample:
      "const codeDir = path.join(home, 'Library', 'Application Support', 'Code', 'User');",
  },
  {
    name: 'Git XDG_CONFIG_HOME (external app)',
    sample: "const gitConfig = path.join(process.env.XDG_CONFIG_HOME, 'git');",
  },
  {
    name: 'APPDATA for external app (not llxprt-code)',
    sample: "const dir = path.join(process.env.APPDATA, 'npm');",
  },
  {
    name: 'non-standard <home>/LLXPRT_DIR-backup identifier (not a placeholder)',
    sample: 'The backup root is <home>/LLXPRT_DIR-backup.',
  },
];

function matchesAny(s: string): LegacyPattern[] {
  return LEGACY_PATTERNS.filter((p) => p.regex.test(s));
}

function evalRedCase(tc: RedCase): SelfTestResult {
  const matched = matchesAny(tc.sample);
  const matchedIds = matched.map((m) => m.id);
  const passed = matched.length > 0 && matchedIds.includes(tc.expectPattern);
  return {
    name: `RED: ${tc.name}`,
    passed,
    detail: passed
      ? `detected by [${matchedIds.join(', ')}]`
      : `expected pattern '${tc.expectPattern}' but got [${matchedIds.join(', ')}]`,
  };
}

function evalGreenCase(tc: GreenCase): SelfTestResult {
  const matched = matchesAny(tc.sample);
  const passed = matched.length === 0;
  return {
    name: `GREEN: ${tc.name}`,
    passed,
    detail: passed
      ? 'not detected (correct)'
      : `falsely flagged by [${matched.map((m) => m.id).join(', ')}]`,
  };
}

function reportSelfTest(results: readonly SelfTestResult[]): void {
  for (const r of results) {
    const marker = r.passed ? 'PASS' : 'FAIL';
    console.log(`  [${marker}] ${r.name} — ${r.detail}`);
  }
  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    console.log(
      `\nSelf-test FAILED: ${failures.length} of ${results.length} cases failed.`,
    );
    process.exit(EXIT_FAIL);
  }
  console.log(`\nSelf-test PASSED: ${results.length} cases verified.`);
  process.exit(EXIT_PASS);
}

/**
 * RED/GREEN self-test: proves the guard's patterns detect forbidden active
 * references and pass allowed (workspace-relative) cases. Runs entirely
 * against synthetic in-memory strings (no temp fixtures needed for pattern
 * validation).
 */
function runSelfTest(): void {
  const results: SelfTestResult[] = [
    ...RED_CASES.map(evalRedCase),
    ...GREEN_CASES.map(evalGreenCase),
    ...evalControlByteCases(),
  ];
  reportSelfTest(results);
}

// ─── Control-byte self-test cases ───────────────────────────────────────────

interface ControlByteCase {
  readonly name: string;
  readonly sample: Buffer;
  readonly expectFound: boolean;
}

const CONTROL_BYTE_CASES: readonly ControlByteCase[] = [
  {
    name: 'NUL byte in maintained text',
    // Build with explicit byte 0x00 to avoid the \x00 escape being treated as
    // a string terminator by the source parser.
    sample: Buffer.concat([
      Buffer.from('clean prose', 'utf8'),
      Buffer.from([0x00, 0x00, 0x00]),
      Buffer.from('\n', 'utf8'),
    ]),
    expectFound: true,
  },
  {
    name: 'clean text without control bytes',
    sample: Buffer.from('clean prose with newlines\nand tabs\t.\n', 'utf8'),
    expectFound: false,
  },
];

function evalControlByteCases(): SelfTestResult[] {
  return CONTROL_BYTE_CASES.map((tc) => {
    const offset = findDisallowedControlByte(tc.sample);
    const found = offset >= 0;
    const passed = found === tc.expectFound;
    let detail: string;
    if (!passed) {
      detail = tc.expectFound
        ? 'expected a control byte but none found'
        : `falsely flagged at byte ${offset}`;
    } else if (tc.expectFound) {
      detail = `detected at byte ${offset}`;
    } else {
      detail = 'not detected (correct)';
    }
    return {
      name: `${tc.expectFound ? 'RED' : 'GREEN'}: ${tc.name}`,
      passed,
      detail,
    };
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * Runs the AST-based dataflow scan for a single file and aggregates matches
 * and errors into the caller's accumulator arrays. Scan failures are captured
 * as operational errors (fail-closed) without aborting the remaining scan.
 */
function collectAstMatches(
  filePath: string,
  allowlist: CompiledAllowlist,
  matches: Match[],
  errors: string[],
): void {
  try {
    const astResult = scanFileAst(filePath, REPO_ROOT, allowlist);
    for (const m of astResult.matches) {
      matches.push({
        file: m.file,
        line: m.line,
        column: m.column,
        text: m.text,
        patternId: m.patternId,
        patternDescription: m.patternDescription,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`AST scan failed for ${relRepo(filePath)}: ${msg}`);
  }
}

function main(): void {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const { allowlist, errors: allowlistErrors } = loadAllowlist();
  const allErrors = [...allowlistErrors];

  // Fail fast on malformed/unsupported SCANNED_TREES syntax before scanning,
  // so a silently-mishandled glob cannot exclude active surfaces.
  const treeErrors = validateScannedTrees(SCANNED_TREES);
  for (const err of treeErrors) {
    allErrors.push(err);
  }

  const { files, errors: discoveryErrors } = discoverFiles();
  allErrors.push(...discoveryErrors);

  if (files.length === 0) {
    allErrors.push(
      'legacy-paths guard: no scannable files found. Refusing to pass.',
    );
  }

  console.log(`legacy-paths guard: scanning ${files.length} files...`);

  const allMatches: Match[] = [];
  for (const filePath of files) {
    const { matches, errors: scanErrors } = scanFile(filePath, LEGACY_PATTERNS);
    allMatches.push(...matches);
    allErrors.push(...scanErrors);

    // AST-based dataflow scan (Finding #5): catches arbitrary local aliases
    // and multiline path.join(homedir(), '.llxprt') that the regex scanner
    // cannot detect. Only runs on TS/JS files. AST scanner errors are captured
    // as operational errors (fail-closed) without aborting the remaining scan.
    if (isAstScannableExt(extname(filePath).toLowerCase())) {
      collectAstMatches(filePath, allowlist, allMatches, allErrors);
    }
  }

  const violations: Match[] = [];
  const suppressed: SuppressedMatch[] = [];
  for (const match of allMatches) {
    const { suppressed: isSup, reason } = checkSuppression(match, allowlist);
    if (isSup) {
      suppressed.push({ ...match, reason });
    } else {
      violations.push(match);
    }
  }

  reportResults(violations, suppressed, allErrors);

  if (allErrors.length > 0 || violations.length > 0) {
    console.log('\nlegacy-paths guard FAILED.');
    process.exit(EXIT_FAIL);
  }
  console.log('\nlegacy-paths guard PASSED.');
  process.exit(EXIT_PASS);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
