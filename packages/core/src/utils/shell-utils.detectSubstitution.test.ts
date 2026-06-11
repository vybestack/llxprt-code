/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * Tests for detectCommandSubstitution through the REGEX FALLBACK path.
 *
 * These tests mock shell-parser.js so isParserAvailable() returns false,
 * forcing detectCommandSubstitution to use detectCommandSubstitutionRegex.
 */
describe('detectCommandSubstitution regex fallback', () => {
  beforeEach(() => {
    vi.doMock('./shell-parser.js', () => ({
      isParserAvailable: () => false,
      parseShellCommand: () => null,
      extractCommandNames: () => [],
      hasCommandSubstitution: () => false,
      splitCommandsWithTree: () => [],
      parseCommandDetails: () => null,
    }));
  });

  afterEach(() => {
    vi.doUnmock('./shell-parser.js');
  });

  it('should detect unterminated backtick substitution', async () => {
    // BUG CASE: opening backtick without closing backtick
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution('echo `date')).toBe(true);
  }, 15000);

  it('should detect properly paired backtick substitution', async () => {
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution('echo `date`')).toBe(true);
  });

  it('should detect backtick substitution inside double quotes', async () => {
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution('echo "`date`"')).toBe(true);
  });

  it('should NOT detect backtick substitution inside single quotes', async () => {
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution("echo '`date`'")).toBe(false);
  });

  it('should NOT detect escaped backticks', async () => {
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution('echo \\`date\\`')).toBe(false);
  });

  it('should detect unterminated $() substitution', async () => {
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution('echo $(date')).toBe(true);
  });

  it('should detect $() substitution', async () => {
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution('echo $(date)')).toBe(true);
  });

  it('should detect <() process substitution', async () => {
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution('diff <(ls dir1) <(ls dir2)')).toBe(true);
  });

  it('should detect >() process substitution', async () => {
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution('tee >(wc -l)')).toBe(true);
  });

  it('should NOT detect substitution-like text in single quotes', async () => {
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution("echo '$(date)'")).toBe(false);
  });

  it('should return false for simple commands with no substitution', async () => {
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution('ls -la /tmp')).toBe(false);
  });

  it('should detect $() inside double quotes', async () => {
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution('echo "Today is $(date)"')).toBe(true);
  });

  it('should NOT detect <() inside double quotes (process sub is unquoted only)', async () => {
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution('echo "<(cmd)"')).toBe(false);
  });

  it('should flag $((1+2)) arithmetic expansion via regex (conservative fallback)', async () => {
    // The regex fallback sees '$(' and flags it as command substitution.
    // Tree-sitter correctly identifies $((...)) as arithmetic expansion (NOT
    // command substitution), so the two paths differ. The regex fallback is
    // intentionally more conservative — false positives are safer than false
    // negatives in a security-sensitive fallback.
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution('echo $((1+2))')).toBe(true);
  });

  it('should detect tee >(wc -l) process substitution', async () => {
    const { detectCommandSubstitution } = await import('./shell-utils.js');
    expect(detectCommandSubstitution('tee >(wc -l)')).toBe(true);
  });
});
