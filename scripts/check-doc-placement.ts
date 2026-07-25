#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * check-doc-placement.ts (issue #2654)
 *
 * Fails if docs/ contains an internal-only directory (architecture/,
 * plans/, merge-notes/), or if any docs/ page carries plan/requirement
 * bookkeeping markers (@plan:, @requirement:, PLAN-, REQ-) OUTSIDE
 * fenced code blocks. Same markers are permitted under dev-docs/ and
 * inside fences.
 *
 * Usage: scripts/check-doc-placement.ts
 * Test override: set DOC_GUARD_ROOT=<dir> to scan a temp tree instead.
 */

import { statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCodeTokens } from './doc-links/markdown-links.ts';
import {
  collectMarkdownFiles,
  readFileText,
  RootMissingError,
} from './doc-links/file-scanner.ts';

const EXIT_PASS = 0;
const EXIT_FAIL = 1;

const FORBIDDEN_DIRS = ['architecture', 'plans', 'merge-notes'];
// Marker patterns for plan/requirement bookkeeping metadata.
// @plan: / @requirement: are matched case-insensitively (catches @Plan:, @PLAN:).
// PLAN- / PLAN_ / REQ- / REQ_ are matched case-sensitively as prefixes
// followed by an alphanumeric character (bookkeeping identifiers like
// PLAN-20251018-... or PLAN_123), not as substrings of lowercase prose.
const AT_MARKER_PATTERNS: readonly string[] = ['@plan:', '@requirement:'];
const PREFIX_MARKER_DISPLAYS: readonly string[] = [
  'PLAN-',
  'PLAN_',
  'REQ-',
  'REQ_',
];

interface Violation {
  readonly file: string;
  readonly reason: string;
}

function getRoot(): string {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  return process.env.DOC_GUARD_ROOT
    ? resolve(process.env.DOC_GUARD_ROOT)
    : resolve(scriptDir, '..');
}

function relPath(root: string, abs: string): string {
  return relative(root, abs).replace(/\\/g, '/');
}

/**
 * Strip fenced code blocks from content using the shared, correct
 * implementation from markdown-links.ts (which uses marked's lexer).
 * No second buggy local implementation.
 */
function stripFences(content: string): string {
  const lines = content.split('\n');
  const nonFenced = stripCodeTokens(lines);
  return nonFenced.join('\n');
}

function findMarkerViolations(
  content: string,
): ReadonlyArray<{ marker: string }> {
  const stripped = stripFences(content);
  const found: Array<{ marker: string }> = [];
  const lowerContent = stripped.toLowerCase();
  for (const pattern of AT_MARKER_PATTERNS) {
    if (lowerContent.includes(pattern.toLowerCase())) {
      found.push({ marker: pattern });
    }
  }
  for (const display of PREFIX_MARKER_DISPLAYS) {
    if (hasBookkeepingPrefix(stripped, display)) {
      found.push({ marker: display });
    }
  }
  return found;
}

/**
 * Check if content contains a PREFIX marker (PLAN-/PLAN_/REQ-/REQ_)
 * followed by at least one alphanumeric character. Avoids false positives
 * on lowercase prose.
 */
function hasBookkeepingPrefix(content: string, prefix: string): boolean {
  let idx = 0;
  while (idx !== -1) {
    idx = content.indexOf(prefix, idx);
    if (idx === -1) return false;
    const after = idx + prefix.length;
    if (after < content.length && /[A-Za-z0-9]/.test(content[after])) {
      return true;
    }
    idx = after;
  }
  return false;
}

function checkDirectory(root: string): readonly Violation[] {
  const violations: Violation[] = [];
  const docsDir = join(root, 'docs');
  for (const dir of FORBIDDEN_DIRS) {
    if (dirExists(join(docsDir, dir))) {
      violations.push({
        file: `docs/${dir}/`,
        reason: `internal-only directory '${dir}' must not exist under docs/`,
      });
    }
  }
  return violations;
}

function dirExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function checkMarkers(root: string): readonly Violation[] {
  const docsDir = join(root, 'docs');
  const files = collectMarkdownFiles([docsDir]);
  const violations: Violation[] = [];
  for (const file of files) {
    const content = readFileText(file);
    const markers = findMarkerViolations(content);
    for (const { marker } of markers) {
      violations.push({
        file: relPath(root, file),
        reason: `bookkeeping marker '${marker}' is not allowed in docs/ (move to dev-docs/ or put inside a code fence)`,
      });
    }
  }
  return violations;
}

function main(): number {
  const root = getRoot();
  let violations: Violation[];
  try {
    violations = [...checkDirectory(root), ...checkMarkers(root)];
  } catch (error) {
    if (error instanceof RootMissingError) {
      console.error(`doc-placement guard FATAL: ${error.message}`);
      return EXIT_FAIL;
    }
    throw error;
  }
  if (violations.length === 0) {
    console.log('doc-placement guard PASSED');
    return EXIT_PASS;
  }
  console.log(`doc-placement guard FAILED: ${violations.length} violation(s)`);
  for (const v of violations) {
    console.log(`  ${v.file}: ${v.reason}`);
  }
  return EXIT_FAIL;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  process.exit(main());
}
