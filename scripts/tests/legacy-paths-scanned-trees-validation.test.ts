/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for SCANNED_TREES fail-fast validation.
 *
 * The guard's file discovery iterates SCANNED_TREES and supports a deliberately
 * LIMITED glob vocabulary (`*` and `**`). Unsupported glob metacharacters
 * (`?`, `[abc]`, `{a,b}`, `\\`) are silently dropped by globToRegex, which
 * means a malformed entry can silently exclude active surfaces from scanning.
 * These tests prove the guard fails fast on malformed/unsupported syntax so a
 * silent mismatch cannot ship.
 */

import { describe, expect, it } from 'vitest';
import { SCANNED_TREES, validateScannedTrees } from '../legacy-paths/config.ts';

describe('validateScannedTrees', () => {
  it('accepts the real SCANNED_TREES shipped in config', () => {
    // The production config must be valid — this is a regression guard.
    expect(validateScannedTrees(SCANNED_TREES)).toEqual([]);
  });

  it('accepts a fixed tree (no glob metacharacters)', () => {
    expect(validateScannedTrees(['docs/**', 'README.md'])).toEqual([]);
  });

  it('accepts single-star and double-star globs', () => {
    expect(
      validateScannedTrees(['packages/*/src/**/*.ts', 'scripts/**']),
    ).toEqual([]);
  });

  it('rejects a question-mark glob (unsupported)', () => {
    const errors = validateScannedTrees(['docs/?eadme.md']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('docs/?eadme.md');
    expect(errors[0].toLowerCase()).toContain('unsupported');
  });

  it('rejects a character class glob (unsupported)', () => {
    const errors = validateScannedTrees(['docs/[abc].md']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('docs/[abc].md');
  });

  it('rejects a brace-expansion glob (unsupported)', () => {
    const errors = validateScannedTrees(['docs/{a,b}.md']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('docs/{a,b}.md');
  });

  it('rejects a backslash in a tree (non-POSIX separator)', () => {
    const errors = validateScannedTrees(['docs\\sub.md']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('docs\\sub.md');
  });

  it('rejects an empty string entry', () => {
    const errors = validateScannedTrees(['']);
    expect(errors).toHaveLength(1);
    expect(errors[0].toLowerCase()).toContain('empty');
  });

  it('rejects an absolute path entry (must be repo-relative)', () => {
    const errors = validateScannedTrees(['/etc/passwd']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('/etc/passwd');
    expect(errors[0].toLowerCase()).toContain('absolute');
  });

  it('rejects a tree with a leading slash', () => {
    const errors = validateScannedTrees(['/docs/**']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('/docs/**');
    expect(errors[0].toLowerCase()).toContain('absolute');
  });

  it('rejects a tree with parent-directory traversal (..)', () => {
    const errors = validateScannedTrees(['../outside/**']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('..');
  });

  it('collects multiple errors (does not stop at first)', () => {
    const errors = validateScannedTrees([
      'docs/?eadme.md',
      'valid/**',
      '[abc].md',
    ]);
    expect(errors).toHaveLength(2);
  });
});
