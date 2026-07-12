/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, describe, it } from 'bun:test';
import { detectCommandSubstitutionFallback } from './shell-utils.js';

/**
 * Tests for detectCommandSubstitution through the REGEX FALLBACK path.
 *
 * These tests mock shell-parser.js so isParserAvailable() returns false,
 * forcing detectCommandSubstitution to use detectCommandSubstitutionRegex.
 */
describe('detectCommandSubstitution regex fallback', () => {
  // Extended timeout: the first dynamic import after vi.doMock re-transforms
  // the shell-utils module graph, which can exceed the default 5s timeout
  // under coverage instrumentation. Subsequent imports hit the module cache.
  it('should detect unterminated backtick substitution', async () => {
    // BUG CASE: opening backtick without closing backtick
    expect(detectCommandSubstitutionFallback('echo `date')).toBe(true);
  });

  it('should detect properly paired backtick substitution', async () => {
    expect(detectCommandSubstitutionFallback('echo `date`')).toBe(true);
  });

  it('should detect backtick substitution inside double quotes', async () => {
    expect(detectCommandSubstitutionFallback('echo "`date`"')).toBe(true);
  });

  it('should NOT detect backtick substitution inside single quotes', async () => {
    expect(detectCommandSubstitutionFallback("echo '`date`'")).toBe(false);
  });

  it('should NOT detect escaped backticks', async () => {
    expect(detectCommandSubstitutionFallback('echo \\`date\\`')).toBe(false);
  });

  it('should detect unterminated $() substitution', async () => {
    expect(detectCommandSubstitutionFallback('echo $(date')).toBe(true);
  });

  it('should detect $() substitution', async () => {
    expect(detectCommandSubstitutionFallback('echo $(date)')).toBe(true);
  });

  it('should detect <() process substitution', async () => {
    expect(
      detectCommandSubstitutionFallback('diff <(ls dir1) <(ls dir2)'),
    ).toBe(true);
  });

  it('should detect >() process substitution', async () => {
    expect(detectCommandSubstitutionFallback('tee >(wc -l)')).toBe(true);
  });

  it('should NOT detect substitution-like text in single quotes', async () => {
    expect(detectCommandSubstitutionFallback("echo '$(date)'")).toBe(false);
  });

  it('should return false for simple commands with no substitution', async () => {
    expect(detectCommandSubstitutionFallback('ls -la /tmp')).toBe(false);
  });

  it('should detect $() inside double quotes', async () => {
    expect(detectCommandSubstitutionFallback('echo "Today is $(date)"')).toBe(
      true,
    );
  });

  it('should NOT detect <() inside double quotes (process sub is unquoted only)', async () => {
    expect(detectCommandSubstitutionFallback('echo "<(cmd)"')).toBe(false);
  });

  it('should flag $((1+2)) arithmetic expansion via regex (conservative fallback)', async () => {
    // The regex fallback sees '$(' and flags it as command substitution.
    // Tree-sitter correctly identifies $((...)) as arithmetic expansion (NOT
    // command substitution), so the two paths differ. The regex fallback is
    // intentionally more conservative — false positives are safer than false
    // negatives in a security-sensitive fallback.
    expect(detectCommandSubstitutionFallback('echo $((1+2))')).toBe(true);
  });
});
