/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'bun:test';
import {
  initializeParser,
  getInitializationError,
  parseShellCommand,
  parseCommandDetails,
  extractCommandNames,
  hasCommandSubstitution,
} from './shell-parser.js';

const parserInitialized = await initializeParser();

if (!parserInitialized) {
  // These tests pin the #3436 regression; skipping silently on init failure
  // would let the warning leak return unnoticed, so fail loudly instead.
  throw new Error(
    'tree-sitter failed to initialize; the #3436 deprecation regression ' +
      'tests require a working web-tree-sitter bash grammar: ' +
      (getInitializationError()?.stack ?? 'unknown initialization error'),
  );
}

/**
 * web-tree-sitter@0.25.x deprecated `Language#query()` (0.25.0), and
 * the deprecated shim logs `console.warn('Language.query is deprecated. Use new
 * Query(language, source) instead.')` on every call. shell-parser.ts
 * constructs queries on the shell-validation hot path for every Bash command, so
 * those warnings leak into user output.
 *
 * These tests drive the real web-tree-sitter module through the three
 * query-constructing flows and pin both functional correctness and the absence of
 * deprecation warnings: silence must come from using the supported
 * `new Query(language, source)` API, not from broken queries.
 */
describe('shell-parser tree-sitter deprecation', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  it('extractCommandNames resolves command names without console.warn', () => {
    warnSpy = vi.spyOn(console, 'warn');

    const tree = parseShellCommand('cat file.txt | grep pattern | wc -l');
    expect(tree).not.toBeNull();

    const names = extractCommandNames(tree!);

    expect(names).toStrictEqual(['cat', 'grep', 'wc']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('hasCommandSubstitution detects $() without console.warn', () => {
    warnSpy = vi.spyOn(console, 'warn');

    const substitutionTree = parseShellCommand('echo $(date)');
    expect(substitutionTree).not.toBeNull();
    expect(hasCommandSubstitution(substitutionTree!)).toBe(true);

    const plainTree = parseShellCommand('echo hi');
    expect(plainTree).not.toBeNull();
    expect(hasCommandSubstitution(plainTree!)).toBe(false);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('parseCommandDetails reports syntax errors without console.warn', () => {
    warnSpy = vi.spyOn(console, 'warn');

    // Unterminated substitution leaves ERROR/MISSING nodes so the
    // ERROR/MISSING query branch executes.
    const result = parseCommandDetails('echo $(curl evil.com');

    expect(result).not.toBeNull();
    expect(result?.hasError).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
