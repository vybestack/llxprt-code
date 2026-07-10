/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  summarizeAstValidation,
  computeLineDelta,
  findEditStartLine,
  extractErrorLineNumber,
  formatValidationLineLabel,
} from '../validation-categorizer.js';

describe('summarizeAstValidation', () => {
  it('reports PASSED when both pre- and post-edit are valid', () => {
    const summary = summarizeAstValidation(
      { valid: true, errors: [] },
      { valid: true, errors: [] },
    );
    expect(summary.status).toBe('PASSED');
    expect(summary.preExisting).toBe(false);
    expect(summary.newlyIntroduced).toBe(false);
    expect(summary.label).toBe('PASSED');
  });

  it('reports PASSED with note when edit resolves a pre-existing error', () => {
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 173, column 5'] },
      { valid: true, errors: [] },
    );
    expect(summary.status).toBe('PASSED');
    expect(summary.label).toContain('resolved pre-existing error');
    expect(summary.label).toContain('line 173');
  });

  it('reports FAILED with newly-introduced when pre-edit was clean', () => {
    const summary = summarizeAstValidation(
      { valid: true, errors: [] },
      { valid: false, errors: ['Syntax error at line 10, column 1'] },
    );
    expect(summary.status).toBe('FAILED');
    expect(summary.newlyIntroduced).toBe(true);
    expect(summary.label).toContain('new error introduced');
  });

  it('reports FAILED with newly-introduced when pre-edit is undefined (new file)', () => {
    const summary = summarizeAstValidation(undefined, {
      valid: false,
      errors: ['Syntax error at line 5, column 1'],
    });
    expect(summary.status).toBe('FAILED');
    expect(summary.newlyIntroduced).toBe(true);
    expect(summary.label).toContain('new error introduced');
  });

  it('categorizes same-location error as pre-existing (no shift)', () => {
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 173, column 5'] },
      { valid: false, errors: ['Syntax error at line 173, column 5'] },
      0,
    );
    expect(summary.status).toBe('FAILED');
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(false);
    expect(summary.label).toContain('pre-existing');
    expect(summary.label).toContain('line 173');
  });

  it('categorizes shifted-location error as pre-existing', () => {
    // Edit inserted 10 lines above the original error (line 173 -> 183).
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 173, column 5'] },
      { valid: false, errors: ['Syntax error at line 183, column 5'] },
      10,
    );
    expect(summary.status).toBe('FAILED');
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(false);
    expect(summary.label).toContain('pre-existing');
  });

  it('flags mixed errors when post-edit location does not match pre-edit', () => {
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 173, column 5'] },
      { valid: false, errors: ['Syntax error at line 4977, column 1'] },
      0,
    );
    expect(summary.status).toBe('FAILED');
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(true);
    expect(summary.label).toContain('pre-existing errors');
  });

  it('returns SKIPPED when post-edit is undefined', () => {
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 173'] },
      undefined,
    );
    expect(summary.status).toBe('SKIPPED');
    expect(summary.label).toContain('SKIPPED');
    expect(summary.preExisting).toBe(false);
  });

  it('matches pre-existing error within LINE_MATCH_TOLERANCE (3 lines off)', () => {
    // Post-edit error is 3 lines off from the exact shifted position — matches.
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 173, column 5'] },
      { valid: false, errors: ['Syntax error at line 186, column 5'] },
      10,
    );
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(false);
  });

  it('flags as mixed when post-edit error exceeds tolerance (4 lines off)', () => {
    // Post-edit error is 4 lines off from the exact shifted position — no match.
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 173, column 5'] },
      { valid: false, errors: ['Syntax error at line 187, column 5'] },
      10,
    );
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(true);
  });

  it('uses editStartLine to avoid false-positive when lineDelta shifts a far error', () => {
    // Pre-existing error at line 50, edit starts at line 1 and adds 10 lines.
    // A new error at line 53 should NOT match the pre-existing line 50 via the
    // no-shift case, because the error is below the edit and must have shifted.
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 50, column 5'] },
      { valid: false, errors: ['Syntax error at line 53, column 5'] },
      10,
      1,
    );
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(true);
  });

  it('matches pre-existing error below edit using editStartLine + lineDelta', () => {
    // Pre-existing error at line 100, edit starts at line 50 and adds 10 lines.
    // The error shifts from 100 to 110 in post-edit content.
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 100, column 5'] },
      { valid: false, errors: ['Syntax error at line 110, column 5'] },
      10,
      50,
    );
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(false);
  });

  it('matches pre-existing error above edit (no shift) using editStartLine', () => {
    // Pre-existing error at line 10, edit starts at line 50 (below the error).
    // The error stays at line 10 regardless of lineDelta.
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 10, column 5'] },
      { valid: false, errors: ['Syntax error at line 10, column 5'] },
      10,
      50,
    );
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(false);
  });

  it('matches multiple pre-existing errors when all shift correctly', () => {
    const summary = summarizeAstValidation(
      {
        valid: false,
        errors: [
          'Syntax error at line 10, column 1',
          'Syntax error at line 100, column 1',
        ],
      },
      {
        valid: false,
        errors: [
          'Syntax error at line 20, column 1',
          'Syntax error at line 110, column 1',
        ],
      },
      10,
      5,
    );
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(false);
    expect(summary.label).toContain('pre-existing');
  });

  it('flags as mixed when one of multiple post-edit errors does not match', () => {
    const summary = summarizeAstValidation(
      {
        valid: false,
        errors: ['Syntax error at line 100, column 1'],
      },
      {
        valid: false,
        errors: [
          'Syntax error at line 110, column 1',
          'Syntax error at line 500, column 1',
        ],
      },
      10,
      50,
    );
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(true);
  });

  it('flags as mixed when a post-edit error below the edit aligns numerically with a pre-edit error above the edit', () => {
    // Pre-edit error at line 5 (above edit at line 10), edit adds 10 lines,
    // new error at line 15. linesMatch must NOT match these: the pre-edit
    // error above the edit stayed at line 5 and line 15 is a different error.
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 5, column 1'] },
      { valid: false, errors: ['Syntax error at line 15, column 1'] },
      10,
      10,
    );
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(true);
  });

  it('flags as mixed when a post-edit error lacks a parseable line number', () => {
    // A post-edit error without a line number cannot be verified against the
    // pre-edit baseline and must be conservatively treated as possibly new.
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 173, column 5'] },
      {
        valid: false,
        errors: ['Syntax error at line 173, column 5', 'unknown parse failure'],
      },
      0,
    );
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(true);
  });
});

describe('computeLineDelta', () => {
  it('returns 0 for same-length strings', () => {
    expect(computeLineDelta('a\nb\nc', 'x\ny\nz')).toBe(0);
  });

  it('returns positive delta when adding lines', () => {
    expect(computeLineDelta('a', 'a\nb\nc')).toBe(2);
  });

  it('returns negative delta when removing lines', () => {
    expect(computeLineDelta('a\nb\nc', 'a')).toBe(-2);
  });

  it('handles undefined inputs', () => {
    expect(computeLineDelta(undefined, 'a\nb')).toBe(2);
    expect(computeLineDelta('a\nb', undefined)).toBe(-2);
  });

  it('handles empty string inputs', () => {
    // Empty string counts as 0 lines (falsy guard), so delta from '' to 'a\nb' is 2.
    expect(computeLineDelta('', 'a\nb')).toBe(2);
    expect(computeLineDelta('', '')).toBe(0);
  });

  it('does not inflate delta for trailing newlines', () => {
    // A trailing newline terminates a line; 'abc\n' is 1 line, not 2.
    expect(computeLineDelta('abc\n', 'abc\n')).toBe(0);
    expect(computeLineDelta('abc', 'abc\n')).toBe(0);
    expect(computeLineDelta('abc\n', 'abc')).toBe(0);
  });
});

describe('findEditStartLine', () => {
  it('returns the 1-based line number where old_string begins', () => {
    const content = 'line1\nline2\nline3\nline4';
    expect(findEditStartLine(content, 'line3')).toBe(3);
  });

  it('returns 1 when old_string is at the start', () => {
    expect(findEditStartLine('abc\ndef', 'abc')).toBe(1);
  });

  it('returns null when old_string is not found', () => {
    expect(findEditStartLine('abc\ndef', 'xyz')).toBeNull();
  });

  it('returns null for null content or empty old_string', () => {
    expect(findEditStartLine(null, 'abc')).toBeNull();
    expect(findEditStartLine('abc', '')).toBeNull();
  });
  it('returns null when old_string appears multiple times (ambiguous)', () => {
    // When old_string is not unique, indexOf would return the first match,
    // but the actual edit could target a different occurrence. Returning null
    // causes the categorizer to fall back to safer lineDelta-based matching.
    const NL = String.fromCharCode(10);
    const content = ['foo', 'bar', 'foo', 'baz'].join(NL);
    expect(findEditStartLine(content, 'foo')).toBeNull();
  });
});

describe('extractErrorLineNumber', () => {
  it('extracts the line number from an error message', () => {
    expect(extractErrorLineNumber('Syntax error at line 173, column 5')).toBe(
      173,
    );
  });

  it('returns null when no line number is present', () => {
    expect(extractErrorLineNumber('some other error')).toBeNull();
  });

  it('extracts line number from alternative parser error formats', () => {
    expect(extractErrorLineNumber('Error on line 42')).toBe(42);
    expect(extractErrorLineNumber('Parse error at line 99')).toBe(99);
  });
});

describe('formatValidationLineLabel', () => {
  it('formats a single line number', () => {
    expect(
      formatValidationLineLabel(['Syntax error at line 42, column 1']),
    ).toBe(' at line 42');
  });

  it('formats multiple line numbers', () => {
    expect(
      formatValidationLineLabel([
        'Syntax error at line 10, column 1',
        'Syntax error at line 20, column 1',
      ]),
    ).toBe(' at lines 10, 20');
  });

  it('returns empty string when no line numbers', () => {
    expect(formatValidationLineLabel(['unknown error'])).toBe('');
  });
});
