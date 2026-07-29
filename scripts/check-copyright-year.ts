#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * check-copyright-year.ts
 *
 * Issue #2820 — diff-based guard that enforces the current calendar year in
 * copyright headers of **newly added** files.
 *
 * The repo's files overwhelmingly carry `Copyright 2025 ...` because the
 * project began in 2025. AI agents (the primary authors of new files) copy
 * the year from a sibling file, producing a ~93% error rate on files added
 * in 2026. This guard catches stale years at CI time.
 *
 * Design (low-weight, diff-based):
 *   - **New files only.** Only files that are *added* in the diff are
 *     inspected. Modified/renamed files are untouched — we do not force-update
 *     historical years in bulk.
 *   - **Only files that already have a header.** The guard does NOT require
 *     every file to have a copyright header. It only checks the year on files
 *     that *do* have one.
 *   - **Year correctness only.** For any added file whose header matches
 *     `Copyright <YYYY> (Vybestack|Google) LLC`, the `<YYYY>` must equal the
 *     current calendar year.
 *
 * Reuses the git diff plumbing from `scripts/eslint-guard/git.mjs` to obtain
 * the diff, then parses it for added files and reads each file's header.
 *
 * Usage:
 *   bun scripts/check-copyright-year.ts [--base REF] [--head REF]
 *   npm run lint:copyright-year
 *
 * Env vars (CI wiring):
 *   COPYRIGHT_GUARD_BASE — the base ref (defaults to origin/main)
 *   COPYRIGHT_GUARD_HEAD — the head ref (defaults to HEAD)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { diffFromGit } from './eslint-guard/git.mjs';

const HEADER_SCAN_LINES = 10;

// Matches `Copyright <YYYY> Vybestack LLC` or `Copyright <YYYY> Google LLC`.
// The year is captured as group 1.
const COPYRIGHT_YEAR_PATTERN =
  /Copyright\s+(\d{4})\s+(?:Vybestack|Google)\s+LLC/;

// Binary file extensions — skipped to avoid garbled reads and false positives.
const BINARY_EXTENSIONS = new Set([
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.webp',
  '.zip',
]);

const EXIT_PASS = 0;
const EXIT_FAIL = 1;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CopyrightViolation {
  readonly file: string;
  readonly year: number;
  readonly expectedYear: number;
}

export interface FileContent {
  readonly path: string;
  readonly content: string;
}

// ─── Pure logic (exported for unit tests) ───────────────────────────────────

/**
 * Extract the copyright year from file content.
 *
 * Scans only the first {@link HEADER_SCAN_LINES} lines (the copyright header
 * always lives at the top of the file). Returns the 4-digit year if a matching
 * `Copyright <YYYY> (Vybestack|Google) LLC` header is found, or `null` if the
 * file has no such header.
 */
export function extractCopyrightYear(content: string): number | null {
  const lines = content.split('\n').slice(0, HEADER_SCAN_LINES);
  for (const line of lines) {
    const match = COPYRIGHT_YEAR_PATTERN.exec(line);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

/**
 * Parse a unified diff and return the repo-relative paths of newly **added**
 * files.
 *
 * A file is considered "added" when the diff shows it as a new file —
 * indicated by a `new file mode` line or a `--- /dev/null` source marker.
 * Modified, renamed, or deleted files are excluded.
 */
export function parseAddedFilesFromDiff(diff: string): string[] {
  const added: string[] = [];
  const lines = diff.split('\n');
  let currentFile: string | null = null;
  let isNewFile = false;

  for (const line of lines) {
    const headerMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (headerMatch) {
      if (currentFile !== null && isNewFile) {
        added.push(currentFile);
      }
      currentFile = headerMatch[2];
      isNewFile = false;
      continue;
    }
    if (/^new file mode/.test(line) || line === '--- /dev/null') {
      isNewFile = true;
    }
  }
  if (currentFile !== null && isNewFile) {
    added.push(currentFile);
  }
  return added;
}

/**
 * Check a set of files for copyright-year violations against the expected
 * (current) year.
 *
 * Files without a copyright header are ignored. Returns violations sorted by
 * file path for deterministic output.
 */
export function checkCopyrightYears(
  files: readonly FileContent[],
  currentYear: number,
): CopyrightViolation[] {
  const violations: CopyrightViolation[] = [];
  for (const file of files) {
    const year = extractCopyrightYear(file.content);
    if (year !== null && year !== currentYear) {
      violations.push({
        file: file.path,
        year,
        expectedYear: currentYear,
      });
    }
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file, 'en'));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isBinaryFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) {
    return false;
  }
  return BINARY_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

const DEFAULT_BASE = process.env.GITHUB_BASE_REF
  ? 'origin/' + process.env.GITHUB_BASE_REF
  : 'origin/main';

function parseArgs(argv: readonly string[]): { base: string; head: string } {
  let base = process.env.COPYRIGHT_GUARD_BASE || DEFAULT_BASE;
  let head = process.env.COPYRIGHT_GUARD_HEAD || 'HEAD';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('--base requires a value');
      }
      base = argv[++i];
    } else if (arg === '--head') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('--head requires a value');
      }
      head = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: bun scripts/check-copyright-year.ts [--base REF] [--head REF]',
      );
      process.exit(EXIT_PASS);
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }
  return { base, head };
}

function formatViolations(violations: readonly CopyrightViolation[]): string {
  return violations
    .map((v) => `  ${v.file}: Copyright ${v.year} (expected ${v.expectedYear})`)
    .join('\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const diff = diffFromGit(args.base, args.head);
  const addedFiles = parseAddedFilesFromDiff(diff);
  const currentYear = new Date().getUTCFullYear();

  const filesToCheck: FileContent[] = [];
  for (const filePath of addedFiles) {
    if (isBinaryFile(filePath)) {
      continue;
    }
    try {
      const content = readFileSync(filePath, 'utf8');
      filesToCheck.push({ path: filePath, content });
    } catch {
      // File may have been deleted between diff generation and read, or may
      // be unreadable. Skip it rather than crashing the guard.
    }
  }

  const violations = checkCopyrightYears(filesToCheck, currentYear);

  if (violations.length === 0) {
    const checked = filesToCheck.length;
    const withHeader = filesToCheck.filter(
      (f) => extractCopyrightYear(f.content) !== null,
    ).length;
    console.log(
      `copyright-year guard passed: ${checked} added file(s) checked, ` +
        `${withHeader} with copyright header, all using ${currentYear}.`,
    );
    return;
  }

  console.error(
    `copyright-year guard FAILED: ${violations.length} added file(s) ` +
      `with stale copyright year (expected ${currentYear}):\n`,
  );
  console.error(formatViolations(violations));
  console.error(
    '\nNew files with a copyright header must use the current calendar year ' +
      `(${currentYear}). See issue #2820.`,
  );
  process.exit(EXIT_FAIL);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`copyright-year guard FAILED: ${msg}`);
    process.exit(EXIT_FAIL);
  }
}
