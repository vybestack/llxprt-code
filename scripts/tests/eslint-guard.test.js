/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  checkCliSourcePolicy,
  checkDiff,
  formatViolations,
} from '../check-eslint-guard.js';

function diffFor(file, addedLine) {
  return [
    'diff --git a/' + file + ' b/' + file,
    'index 0000000..1111111 100644',
    '--- a/' + file,
    '+++ b/' + file,
    '@@ -1,0 +1,1 @@',
    '+' + addedLine,
  ].join('\n');
}

describe('check-eslint-guard', () => {
  it('rejects newly added inline ESLint disable directives', () => {
    const violations = checkDiff(
      diffFor(
        'packages/core/src/example.ts',
        '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
      ),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain(
      'Inline ESLint disable/enable directives are forbidden',
    );
  });

  it('rejects new eslint config off entries without explicit policy marker', () => {
    const violations = checkDiff(
      diffFor('eslint.config.js', "      'complexity': 'off',"),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('eslint-policy-allow-off');
  });

  it('allows explicitly documented eslint config off entries', () => {
    const violations = checkDiff(
      diffFor(
        'eslint.config.js',
        "      'sonarjs/os-command': 'off', // eslint-policy-allow-off: #2079",
      ),
    );

    expect(violations).toEqual([]);
  });

  it('rejects removing the inline-disable ban', () => {
    const diff = [
      'diff --git a/eslint.config.js b/eslint.config.js',
      'index 0000000..1111111 100644',
      '--- a/eslint.config.js',
      '+++ b/eslint.config.js',
      '@@ -1,1 +0,0 @@',
      "-      'eslint-comments/no-use': 'error',",
    ].join('\n');

    const violations = checkDiff(diff);

    expect(violations).toHaveLength(1);
    expect(formatViolations(violations)).toContain('inline-disable ban');
  });

  it('rejects removing max-warnings zero from lint ci', () => {
    const diff = [
      'diff --git a/package.json b/package.json',
      'index 0000000..1111111 100644',
      '--- a/package.json',
      '+++ b/package.json',
      '@@ -1,1 +0,0 @@',
      '-    "lint:ci": "eslint . --max-warnings 0",',
    ].join('\n');

    const violations = checkDiff(diff);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('--max-warnings 0');
  });

  it('allows moving the inline-disable ban without weakening it', () => {
    const diff = [
      'diff --git a/eslint.config.js b/eslint.config.js',
      'index 0000000..1111111 100644',
      '--- a/eslint.config.js',
      '+++ b/eslint.config.js',
      '@@ -1,1 +1,1 @@',
      "-      'eslint-comments/no-use': ['error'],",
      "+      'eslint-comments/no-use': ['error'],",
    ].join('\n');

    expect(checkDiff(diff)).toEqual([]);
  });

  it('allows moving max-warnings zero without removing it', () => {
    const diff = [
      'diff --git a/package.json b/package.json',
      'index 0000000..1111111 100644',
      '--- a/package.json',
      '+++ b/package.json',
      '@@ -1,1 +1,1 @@',
      '-    "lint:ci": "eslint . --max-warnings 0",',
      '+    "lint:ci": "cross-env eslint . --max-warnings 0",',
    ].join('\n');

    expect(checkDiff(diff)).toEqual([]);
  });

  it('rejects inline ESLint disables in scripts', () => {
    const violations = checkDiff(
      diffFor('scripts/example.js', '// eslint-disable-line no-console'),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe('scripts/example.js');
  });

  it('rejects inline ESLint enable directives', () => {
    const violations = checkDiff(
      diffFor('packages/core/src/example.ts', '/* eslint-enable no-console */'),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('disable/enable');
  });

  it('rejects packages/cli entries added to eslint config', () => {
    const violations = checkDiff(
      diffFor('eslint.config.js', "  'packages/cli/src/**/*.{ts,tsx}',"),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain(
      'packages/cli directive cleanup scopes',
    );
  });

  it('allows packages/cli/src references inside config comments', () => {
    const violations = checkDiff(
      diffFor(
        'eslint.config.js',
        '      // Project-level assertion wrappers (see packages/cli/src/test-utils)',
      ),
    );

    expect(violations).toHaveLength(0);
  });

  it('keeps the checked-in cli source policy clean', () => {
    expect(checkCliSourcePolicy()).toEqual([]);
  });
});
