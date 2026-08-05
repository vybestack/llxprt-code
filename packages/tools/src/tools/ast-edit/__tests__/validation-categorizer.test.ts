/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  summarizeAstValidation,
  computeLineDelta,
  deriveCandidateMapping,
  findEditStartLine,
  extractErrorLineNumber,
  formatValidationLineLabel,
  type CandidateMapping,
} from '../validation-categorizer.js';

/**
 * Constructs a CandidateMapping simulating a single-line edit at
 * `editStartLine` (replacing exactly one line) where everything below is
 * unchanged suffix. This mirrors the old editStartLine + lineDelta semantics
 * for unit-test scenarios.
 */
function singleLineEditMapping(
  editStartLine: number,
  lineDelta: number,
  origLineCount = 200,
): CandidateMapping {
  const prefixLines = editStartLine - 1;
  const suffixLines = origLineCount - editStartLine;
  return { prefixLines, suffixLines, origLineCount, lineDelta };
}

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
      singleLineEditMapping(1, 10),
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
    );
    expect(summary.status).toBe('FAILED');
    expect(summary.preExisting).toBe(false);
    expect(summary.newlyIntroduced).toBe(true);
    expect(summary.label).toBe(
      'FAILED (file had pre-existing error at line 173; post-edit error at line 4977 may be newly introduced)',
    );
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

  it('flags as mixed when a post-edit error is one line off the exact shifted location', () => {
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 173, column 5'] },
      { valid: false, errors: ['Syntax error at line 184, column 5'] },
      singleLineEditMapping(1, 10),
    );
    expect(summary.preExisting).toBe(false);
    expect(summary.newlyIntroduced).toBe(true);
  });

  it('flags as mixed when an error remains on the same line but moves columns', () => {
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 173, column 5'] },
      { valid: false, errors: ['Syntax error at line 173, column 9'] },
    );
    expect(summary.preExisting).toBe(false);
    expect(summary.newlyIntroduced).toBe(true);
  });

  it('uses editStartLine to avoid false-positive when lineDelta shifts a far error', () => {
    // Pre-existing error at line 50, edit starts at line 1 and adds 10 lines.
    // A new error at line 53 should NOT match the pre-existing line 50 via the
    // no-shift case, because the error is below the edit and must have shifted.
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 50, column 5'] },
      { valid: false, errors: ['Syntax error at line 53, column 5'] },
      singleLineEditMapping(1, 10, 50),
    );
    expect(summary.preExisting).toBe(false);
    expect(summary.newlyIntroduced).toBe(true);
  });

  it('matches pre-existing error below edit using editStartLine + lineDelta', () => {
    // Pre-existing error at line 100, edit starts at line 50 and adds 10 lines.
    // The error shifts from 100 to 110 in post-edit content.
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 100, column 5'] },
      { valid: false, errors: ['Syntax error at line 110, column 5'] },
      singleLineEditMapping(50, 10, 100),
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
      singleLineEditMapping(50, 10),
    );
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(false);
  });

  it('treats an error on the edit start line as unmatched', () => {
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 50, column 5'] },
      { valid: false, errors: ['Syntax error at line 60, column 5'] },
      singleLineEditMapping(50, 10, 100),
    );
    expect(summary.preExisting).toBe(false);
    expect(summary.newlyIntroduced).toBe(true);
  });

  it('does not infer shifted matches when the edit position is unknown', () => {
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 50, column 5'] },
      { valid: false, errors: ['Syntax error at line 60, column 5'] },
      // No mapping → everything is unchanged prefix → same-line-only matching.
    );
    expect(summary.preExisting).toBe(false);
    expect(summary.newlyIntroduced).toBe(true);
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
      singleLineEditMapping(5, 10),
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
      singleLineEditMapping(50, 10, 100),
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
      singleLineEditMapping(10, 10),
    );
    expect(summary.preExisting).toBe(false);
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
    );
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(true);
  });

  it('reports missing post-edit error details explicitly', () => {
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 173, column 5'] },
      { valid: false, errors: [] },
    );

    expect(summary.preExisting).toBe(false);
    expect(summary.newlyIntroduced).toBe(true);
    expect(summary.label).toBe(
      'FAILED (file had pre-existing error at line 173; post-edit validation failed without error details)',
    );
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
    expect(computeLineDelta(undefined, 'a\nb')).toBe(1);
    expect(computeLineDelta('a\nb', undefined)).toBe(-1);
  });

  it('handles empty string inputs', () => {
    expect(computeLineDelta('', 'a\nb')).toBe(1);
    expect(computeLineDelta('', '')).toBe(0);
  });

  it('counts trailing newline insertion and removal as line shifts', () => {
    expect(computeLineDelta('abc\n', 'abc\n')).toBe(0);
    expect(computeLineDelta('abc', 'abc\n')).toBe(1);
    expect(computeLineDelta('abc\n', 'abc')).toBe(-1);
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

  it('returns empty string for an empty error list', () => {
    expect(formatValidationLineLabel([])).toBe('');
  });
});

describe('summarizeAstValidation: unsupported file types (REQ-3035-5)', () => {
  it('reports SKIPPED (unsupported file type) when the post-edit file is unsupported', () => {
    const summary = summarizeAstValidation(
      { valid: true, errors: [], supported: false },
      { valid: true, errors: [], supported: false },
    );
    expect(summary.status).toBe('SKIPPED');
    expect(summary.label).toContain('unsupported file type');
    expect(summary.newlyIntroduced).toBe(false);
  });

  it('keeps unsupported files writable by not flagging a newly-introduced error', () => {
    // Even when the post-edit content is non-empty, an unsupported type never
    // becomes a syntax failure the apply gate would refuse.
    const summary = summarizeAstValidation(undefined, {
      valid: true,
      errors: [],
      supported: false,
    });
    expect(summary.status).toBe('SKIPPED');
    expect(summary.newlyIntroduced).toBe(false);
  });

  it('still validates supported files normally', () => {
    const summary = summarizeAstValidation(
      { valid: true, errors: [], supported: true },
      {
        valid: false,
        errors: ['Syntax error at line 5, column 1'],
        supported: true,
      },
    );
    expect(summary.status).toBe('FAILED');
    expect(summary.newlyIntroduced).toBe(true);
  });
});

describe('summarizeAstValidation: whole-file recovery locations (REQ-3035-3)', () => {
  const wholeRecovery = (line: number): string =>
    `Syntax error near line ${line} (whole-file recovery; location approximate)`;
  const wholeRecoveryBaseline = (line: number): string =>
    `Syntax error at line ${line}, column 1 (whole-file recovery)`;

  it('flags a whole-file recovery error as newly-introduced when the file was clean', () => {
    const summary = summarizeAstValidation(
      { valid: true, errors: [] },
      { valid: false, errors: [wholeRecovery(3)] },
    );
    expect(summary.status).toBe('FAILED');
    expect(summary.newlyIntroduced).toBe(true);
  });

  it('fails closed when a post whole-file recovery is not equivalent to a precise baseline', () => {
    // A precise baseline error (not a whole-file recovery) cannot be proven
    // equivalent to a post-edit whole-file recovery → classified as newly
    // introduced (fail closed), not blindly accepted.
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 1, column 16'] },
      { valid: false, errors: [wholeRecovery(10)] },
    );
    expect(summary.newlyIntroduced).toBe(true);
  });

  it('treats a whole-file recovery as pre-existing when the baseline was also a whole-file recovery', () => {
    // An unchanged baseline whole-file recovery that remains after a harmless
    // edit must stay writable (equivalent identity).
    const summary = summarizeAstValidation(
      { valid: false, errors: [wholeRecoveryBaseline(1)] },
      { valid: false, errors: [wholeRecovery(10)] },
    );
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(false);
  });

  it('fails closed when a baseline whole-file recovery ends in the changed middle', () => {
    const summary = summarizeAstValidation(
      {
        valid: false,
        errors: [wholeRecoveryBaseline(1)],
        diagnostics: [
          {
            line: 0,
            column: 0,
            endLine: 5,
            wholeFileRecovery: true,
            message: wholeRecoveryBaseline(1),
          },
        ],
      },
      {
        valid: false,
        errors: [wholeRecovery(4)],
        diagnostics: [
          {
            line: 0,
            column: 0,
            endLine: 6,
            wholeFileRecovery: true,
            message: wholeRecovery(4),
          },
        ],
      },
      {
        prefixLines: 2,
        suffixLines: 2,
        origLineCount: 10,
        lineDelta: 1,
      },
    );

    expect(summary.newlyIntroduced).toBe(true);
  });
});

describe('summarizeAstValidation: compares every diagnostic (Finding 1)', () => {
  it('detects a newly introduced later error even when an earlier pre-existing error matches', () => {
    // Two post-edit errors: line 2 matches the pre-existing baseline, but line
    // 10 is new. The first-match-only flaw must not mask line 10.
    const summary = summarizeAstValidation(
      { valid: false, errors: ['Syntax error at line 2, column 14'] },
      {
        valid: false,
        errors: [
          'Syntax error at line 2, column 14',
          'Syntax error at line 10, column 9',
        ],
      },
    );
    expect(summary.newlyIntroduced).toBe(true);
  });

  it('classifies all-matching post errors as pre-existing', () => {
    const summary = summarizeAstValidation(
      {
        valid: false,
        errors: [
          'Syntax error at line 2, column 14',
          'Syntax error at line 10, column 9',
        ],
      },
      {
        valid: false,
        errors: [
          'Syntax error at line 2, column 14',
          'Syntax error at line 10, column 9',
        ],
      },
    );
    expect(summary.preExisting).toBe(true);
    expect(summary.newlyIntroduced).toBe(false);
  });
});

describe('deriveCandidateMapping: original-to-candidate line diff (Finding 3)', () => {
  it('derives a shifted prefix and positive delta for an inserted line', () => {
    const mapping = deriveCandidateMapping(
      'const keep = 1;\nconst broken = @@@;\n',
      'const keep = 2;\nconst newLine = 3;\nconst broken = @@@;\n',
    );
    expect(mapping.lineDelta).toBe(1);
    expect(mapping.prefixLines).toBe(0);
  });

  it('returns full-prefix mapping and zero delta when candidate equals original', () => {
    const mapping = deriveCandidateMapping('a\nb\n', 'a\nb\n');
    expect(mapping.lineDelta).toBe(0);
    expect(mapping.prefixLines).toBe(3); // all lines are prefix
    expect(mapping.suffixLines).toBe(0);
  });

  it('handles a new file (null original) with no reliable mapping', () => {
    const mapping = deriveCandidateMapping(null, 'const x = 1;\n');
    expect(mapping.lineDelta).toBe(0);
    expect(mapping.prefixLines).toBe(Number.MAX_SAFE_INTEGER);
  });
});
