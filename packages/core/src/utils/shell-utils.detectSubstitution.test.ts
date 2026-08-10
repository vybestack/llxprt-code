/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, describe, it, beforeAll, afterAll } from 'bun:test';

/**
 * Tests for detectCommandSubstitution through the REGEX FALLBACK path.
 *
 * The parser singleton is reset so isParserAvailable() returns false,
 * forcing detectCommandSubstitution to use detectCommandSubstitutionRegex.
 * All cases exercise Bash syntax and pass 'bash' explicitly (#3181).
 *
 * resetParser/initializeParser are used instead of vi.mock to avoid
 * cross-file mock leakage in bun:test.
 */

import { detectCommandSubstitution } from './shell-utils.js';
import { resetParser, initializeParser } from './shell-parser.js';

/** Bash-specific substitution detection (#3181). */
const detect = (cmd: string): boolean => detectCommandSubstitution(cmd, 'bash');

describe('detectCommandSubstitution regex fallback', () => {
  beforeAll(() => {
    resetParser();
  });

  afterAll(async () => {
    await initializeParser();
  });

  it('should detect unterminated backtick substitution', () => {
    expect(detect('echo `date')).toBe(true);
  });

  it('should detect properly paired backtick substitution', () => {
    expect(detect('echo `date`')).toBe(true);
  });

  it('should detect backtick substitution inside double quotes', () => {
    expect(detect('echo "`date`"')).toBe(true);
  });

  it('should NOT detect backtick substitution inside single quotes', () => {
    expect(detect("echo '`date`'")).toBe(false);
  });

  it('should NOT detect escaped backticks', () => {
    expect(detect('echo \\`date\\`')).toBe(false);
  });

  it('should detect unterminated $() substitution', () => {
    expect(detect('echo $(date')).toBe(true);
  });

  it('should detect $() substitution', () => {
    expect(detect('echo $(date)')).toBe(true);
  });

  it('should detect <() process substitution', () => {
    expect(detect('diff <(ls dir1) <(ls dir2)')).toBe(true);
  });

  it('should detect >() process substitution', () => {
    expect(detect('tee >(wc -l)')).toBe(true);
  });

  it('should NOT detect substitution-like text in single quotes', () => {
    expect(detect("echo '$(date)'")).toBe(false);
  });

  it('should return false for simple commands with no substitution', () => {
    expect(detect('ls -la /tmp')).toBe(false);
  });

  it('should detect $() inside double quotes', () => {
    expect(detect('echo "Today is $(date)"')).toBe(true);
  });

  it('should NOT detect <() inside double quotes (process sub is unquoted only)', () => {
    expect(detect('echo "<(cmd)"')).toBe(false);
  });

  it('should flag $((1+2)) arithmetic expansion via regex (conservative fallback)', () => {
    // The regex fallback sees '$(' and flags it as command substitution.
    // Tree-sitter correctly identifies $((...)) as arithmetic expansion (NOT
    // command substitution), so the two paths differ. The regex fallback is
    // intentionally more conservative — false positives are safer than false
    // negatives in a security-sensitive fallback.
    expect(detect('echo $((1+2))')).toBe(true);
  });
});
