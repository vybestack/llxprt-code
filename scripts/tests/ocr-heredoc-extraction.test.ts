/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { extractHeredocBody } from './ocr-review-workflow-helpers.ts';

describe('extractHeredocBody — robust heredoc extraction (P4)', () => {
  it('extracts the body from a single-quoted heredoc', () => {
    const source = [
      "node <<'NODE'",
      'const x = 1;',
      'const y = 2;',
      'NODE',
    ].join('\n');
    expect(extractHeredocBody(source, 'test-step')).toBe(
      'const x = 1;\nconst y = 2;\n',
    );
  });

  it('extracts the body from a double-quoted heredoc', () => {
    const source = ['node <<"EOF"', 'echo hello', 'EOF'].join('\n');
    expect(extractHeredocBody(source, 'test-step')).toBe('echo hello\n');
  });

  it('extracts the body from a bare (unquoted) heredoc', () => {
    const source = ['node <<SCRIPT', 'const a = 1;', 'SCRIPT'].join('\n');
    expect(extractHeredocBody(source, 'test-step')).toBe('const a = 1;\n');
  });

  it('tolerates variable whitespace between << and the delimiter', () => {
    const source = ["node <<  'NODE'", 'const x = 1;', 'NODE'].join('\n');
    expect(extractHeredocBody(source, 'test-step')).toBe('const x = 1;\n');
  });

  it('handles the <<- (strip-leading-tabs) operator with tab-indented terminator', () => {
    const source = ['node <<-HEREDOC', '\tconst x = 1;', '\tHEREDOC'].join(
      '\n',
    );
    // Q3: the dash form strips leading tabs from the body, matching
    // bash <<- semantics.
    expect(extractHeredocBody(source, 'test-step')).toBe('const x = 1;\n');
  });

  it('Q3: plain form does NOT terminate on a space-indented body line equal to the delimiter', () => {
    // Bash plain heredoc (<<) requires the terminator at column 0.
    // A space-indented body line that happens to equal the delimiter
    // must NOT terminate early.
    const source = [
      "node <<'NODE'",
      'const x = 1;',
      '  NODE',
      'const y = 2;',
      'NODE',
    ].join('\n');
    expect(extractHeredocBody(source, 'test-step')).toBe(
      'const x = 1;\n  NODE\nconst y = 2;\n',
    );
  });

  it('Q3: dash form accepts a tab-indented terminator and strips tabs from body', () => {
    const source = ['node <<-EOF', '\tline one', '\t\tline two', '\tEOF'].join(
      '\n',
    );
    // Q3: the dash form strips ALL leading tabs from each body line,
    // matching bash <<- semantics. `\t\tline two` → `line two`.
    expect(extractHeredocBody(source, 'test-step')).toBe(
      'line one\nline two\n',
    );
  });

  it('Q3: dash form does NOT terminate on a space-indented delimiter line', () => {
    // Bash <<- allows only TAB-indented terminators, not space-indented.
    const source = [
      'node <<-EOF',
      '\tconst x = 1;',
      '    EOF',
      '\tconst y = 2;',
      '\tEOF',
    ].join('\n');
    // The space-indented EOF must not terminate; only \tEOF does.
    expect(extractHeredocBody(source, 'test-step')).toBe(
      'const x = 1;\n    EOF\nconst y = 2;\n',
    );
  });

  it('preserves a trailing blank body line (full fidelity)', () => {
    // In bash the body is every line between the opener and the terminator,
    // each including its newline. Trimming the final newline would silently
    // drop a trailing blank line from the extracted body.
    const source = ["node <<'NODE'", 'line1', '', 'NODE'].join('\n');
    expect(extractHeredocBody(source, 'test-step')).toBe('line1\n\n');
  });

  it('returns a lone newline for a heredoc whose only body line is blank', () => {
    const source = ["node <<'NODE'", '', 'NODE'].join('\n');
    expect(extractHeredocBody(source, 'test-step')).toBe('\n');
  });

  it('throws a clear error when no heredoc is found', () => {
    expect(() => extractHeredocBody('echo hello', 'no-heredoc-step')).toThrow(
      /expected exactly 1 heredoc in step "no-heredoc-step", found 0/,
    );
  });

  it('throws a clear error when multiple heredocs are found', () => {
    const source = [
      "node <<'NODE'",
      'const x = 1;',
      'NODE',
      "node <<'NODE2'",
      'const y = 2;',
      'NODE2',
    ].join('\n');
    expect(() => extractHeredocBody(source, 'multi-step')).toThrow(
      /expected exactly 1 heredoc in step "multi-step", found 2/,
    );
  });
});
