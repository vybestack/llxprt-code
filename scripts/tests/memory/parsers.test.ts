/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fail-fast parsing tests for the request CLI and the heap analyzer
 * (issue #3230): unknown options, missing values, flag-shaped values, and
 * nonfinite/nonpositive numbers must all be rejected with a clear error
 * rather than silently falling back to a default.
 */

import { describe, expect, it } from 'bun:test';
import {
  RequestCliParseError,
  parseRequestArgs,
} from '../../memory/request-cli.ts';
import {
  AnalyzerParseError,
  DEFAULT_ANALYZE_OPTIONS,
  parseAnalyzeArgs,
} from '../../memory/heapanalyze.ts';

describe('parseRequestArgs — recognized options', () => {
  it('defaults to a sample request', () => {
    expect(parseRequestArgs([])).toEqual({ kind: 'sample', dir: undefined });
  });

  it('parses --heap as a snapshot request', () => {
    expect(parseRequestArgs(['--heap'])).toEqual({
      kind: 'snapshot',
      dir: undefined,
    });
  });

  it('parses --dir with a value', () => {
    expect(parseRequestArgs(['--dir', '/runs/run-1'])).toEqual({
      kind: 'sample',
      dir: '/runs/run-1',
    });
  });

  it('parses both options together', () => {
    expect(parseRequestArgs(['--heap', '--dir', 'C:\\runs\\run-2'])).toEqual({
      kind: 'snapshot',
      dir: 'C:\\runs\\run-2',
    });
  });
});

describe('parseRequestArgs — fail fast', () => {
  it('rejects an unknown option', () => {
    expect(() => parseRequestArgs(['--verbose'])).toThrow(RequestCliParseError);
    expect(() => parseRequestArgs(['--verbose'])).toThrow(
      /unknown option: --verbose/,
    );
  });

  it('rejects a positional argument', () => {
    expect(() => parseRequestArgs(['extra'])).toThrow(/unknown option/);
  });

  it('rejects a missing --dir value', () => {
    expect(() => parseRequestArgs(['--dir'])).toThrow(
      /missing value for --dir/,
    );
  });

  it('rejects a flag-shaped --dir value', () => {
    expect(() => parseRequestArgs(['--dir', '--heap'])).toThrow(
      /invalid value for --dir/,
    );
  });

  it('rejects -- (nothing to pass through)', () => {
    expect(() => parseRequestArgs(['--', 'x'])).toThrow(
      /no positional arguments/,
    );
  });
});

describe('parseAnalyzeArgs — recognized options', () => {
  it('parses a bare file with defaults', () => {
    const options = parseAnalyzeArgs(['snap.heapsnapshot']);
    expect(options.file).toBe('snap.heapsnapshot');
    expect(options.top).toBe(DEFAULT_ANALYZE_OPTIONS.top);
    expect(options.minBytes).toBe(0.5 * 1024 * 1024);
  });

  it('parses --top and --min-mb', () => {
    const options = parseAnalyzeArgs([
      'snap.heapsnapshot',
      '--top',
      '5',
      '--min-mb',
      '2',
    ]);
    expect(options.file).toBe('snap.heapsnapshot');
    expect(options.top).toBe(5);
    expect(options.minBytes).toBe(2 * 1024 * 1024);
  });

  it('accepts a fractional --min-mb', () => {
    const options = parseAnalyzeArgs(['s.heapsnapshot', '--min-mb', '0.25']);
    expect(options.minBytes).toBe(0.25 * 1024 * 1024);
  });
});

describe('parseAnalyzeArgs — fail fast', () => {
  it('rejects a missing file argument', () => {
    expect(() => parseAnalyzeArgs([])).toThrow(AnalyzerParseError);
    expect(() => parseAnalyzeArgs([])).toThrow(/missing snapshot file/);
  });

  it('rejects two positional file arguments', () => {
    expect(() =>
      parseAnalyzeArgs(['a.heapsnapshot', 'b.heapsnapshot']),
    ).toThrow(/unexpected extra argument/);
  });

  it('rejects an unknown option', () => {
    expect(() => parseAnalyzeArgs(['a.heapsnapshot', '--depth', '4'])).toThrow(
      /unknown option: --depth/,
    );
  });

  it('rejects a missing --top value', () => {
    expect(() => parseAnalyzeArgs(['a.heapsnapshot', '--top'])).toThrow(
      /missing value for --top/,
    );
  });

  it('rejects a flag-shaped --top value', () => {
    expect(() =>
      parseAnalyzeArgs(['a.heapsnapshot', '--top', '--min-mb']),
    ).toThrow(/invalid value for --top/);
  });

  it('rejects a nonpositive --top', () => {
    expect(() => parseAnalyzeArgs(['a.heapsnapshot', '--top', '0'])).toThrow(
      /invalid value for --top/,
    );
  });

  it('rejects a nonfinite --top', () => {
    expect(() =>
      parseAnalyzeArgs(['a.heapsnapshot', '--top', 'Infinity']),
    ).toThrow(/invalid value for --top/);
    expect(() => parseAnalyzeArgs(['a.heapsnapshot', '--top', 'NaN'])).toThrow(
      /invalid value for --top/,
    );
  });

  it('rejects a non-integer --top', () => {
    expect(() => parseAnalyzeArgs(['a.heapsnapshot', '--top', '2.5'])).toThrow(
      /invalid value for --top/,
    );
  });

  it('rejects a nonpositive --min-mb', () => {
    expect(() =>
      parseAnalyzeArgs(['a.heapsnapshot', '--min-mb', '-1']),
    ).toThrow(/invalid value for --min-mb/);
  });

  it('rejects a non-numeric --min-mb', () => {
    expect(() =>
      parseAnalyzeArgs(['a.heapsnapshot', '--min-mb', 'large']),
    ).toThrow(/invalid value for --min-mb/);
  });
});
