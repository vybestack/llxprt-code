/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { escapeRegex, buildArgsPatterns } from './utils.js';

describe('escapeRegex', () => {
  it('should escape all special regex characters', () => {
    const special = '.*+?^${}()|[]\\';
    const escaped = escapeRegex(special);
    expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });

  it('should not modify normal characters', () => {
    const normal = 'abcABC123_-';
    const escaped = escapeRegex(normal);
    expect(escaped).toBe(normal);
  });

  it('should handle empty string', () => {
    expect(escapeRegex('')).toBe('');
  });

  it('should handle mixed content', () => {
    const mixed = 'git log --oneline';
    const escaped = escapeRegex(mixed);
    expect(escaped).toBe('git log --oneline');
  });

  it('should escape dots in file patterns', () => {
    const pattern = '*.txt';
    const escaped = escapeRegex(pattern);
    expect(escaped).toBe('\\*\\.txt');
  });
});

describe('buildArgsPatterns', () => {
  it('should create one pattern for string commandPrefix', () => {
    const patterns = buildArgsPatterns(undefined, 'git');
    expect(patterns).toHaveLength(1);
    expect(patterns[0].test('"command":"git status"')).toBe(true);
    expect(patterns[0].test('"command":"git"')).toBe(true);
  });

  it('should create multiple patterns for array commandPrefix', () => {
    const patterns = buildArgsPatterns(undefined, ['echo', 'ls']);
    expect(patterns).toHaveLength(2);
    expect(patterns[0].test('"command":"echo hello"')).toBe(true);
    expect(patterns[1].test('"command":"ls -la"')).toBe(true);
  });

  it('should escape quotes in command text', () => {
    const patterns = buildArgsPatterns(undefined, 'echo "hello"');
    expect(patterns).toHaveLength(1);
    // Regex should match the escaped quotes in JSON
    expect(patterns[0].test('"command":"echo \\"hello\\""')).toBe(true);
  });

  it('should add word boundaries to prevent partial matches', () => {
    const patterns = buildArgsPatterns(undefined, 'git');
    expect(patterns).toHaveLength(1);
    // Should match "git status"
    expect(patterns[0].test('"command":"git status"')).toBe(true);
    // Should NOT match "github clone"
    expect(patterns[0].test('"command":"github clone"')).toBe(false);
  });

  it('should combine commandPrefix and argsPattern', () => {
    // eslint-disable-next-line sonarjs/regular-expr -- Static test regex reviewed for lint hardening; behavior preserved.
    const argsPattern = new RegExp('"dir_path":".*test.*"');
    const patterns = buildArgsPatterns(argsPattern, 'npm');
    expect(patterns).toHaveLength(2);
    expect(patterns[0].test('"command":"npm test"')).toBe(true);
    expect(patterns[1].test('"dir_path":"./test"')).toBe(true);
  });

  it('should handle commandRegex', () => {
    const patterns = buildArgsPatterns(undefined, undefined, 'git.*');
    expect(patterns).toHaveLength(1);
    expect(patterns[0].test('"command":"git status"')).toBe(true);
    expect(patterns[0].test('"command":"git log"')).toBe(true);
  });

  it('should combine all pattern types', () => {
    const argsPattern = new RegExp('"timeout":\\d+');
    const patterns = buildArgsPatterns(argsPattern, ['git', 'npm'], 'echo.*');
    expect(patterns).toHaveLength(4);
    // commandPrefix patterns
    expect(patterns[0].test('"command":"git status"')).toBe(true);
    expect(patterns[1].test('"command":"npm test"')).toBe(true);
    // commandRegex pattern
    expect(patterns[2].test('"command":"echo hello"')).toBe(true);
    // argsPattern
    expect(patterns[3].test('"timeout":30"')).toBe(true);
  });

  it('should return empty array when no patterns provided', () => {
    const patterns = buildArgsPatterns();
    expect(patterns).toHaveLength(0);
  });

  it('should handle special characters in commandPrefix', () => {
    const patterns = buildArgsPatterns(undefined, 'git log --pretty=%H');
    expect(patterns).toHaveLength(1);
    // Should match the exact command
    expect(patterns[0].test('"command":"git log --pretty=%H"')).toBe(true);
  });
});
