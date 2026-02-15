import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import {
  deduplicateDiagnostics,
  escapeXml,
  filterBySeverity,
  formatDiagnosticLine,
  formatMultiFileDiagnostics,
  formatSingleFileDiagnostics,
  mapSeverity,
  normalizeLspDiagnostic,
  type Diagnostic,
  type LspConfig,
  type RawLspDiagnostic,
} from '../src/service/diagnostics';

const DEFAULT_CONFIG: LspConfig = {
  severities: ['error'],
  perFileLimit: 20,
  totalLimit: 50,
};

function createDiagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    file: 'src/file.ts',
    message: 'message',
    severity: 'error',
    line: 1,
    column: 1,
    ...overrides,
  };
}

/**
 * @plan:PLAN-20250212-LSP.P07
 * @requirement:REQ-FMT-040
 * @scenario:XML escaping edge cases
 * @given:Diagnostic message with special XML characters
 * @when:escapeXml is called
 * @then:Characters are properly escaped
 */
describe('escapeXml', () => {
  it('returns unchanged text when no XML special characters exist', () => {
    expect(escapeXml('Type mismatch in assignment')).toBe(
      'Type mismatch in assignment',
    );
  });

  it('escapes less-than characters', () => {
    expect(escapeXml('a < b')).toBe('a &lt; b');
  });

  it('escapes greater-than characters', () => {
    expect(escapeXml('a > b')).toBe('a &gt; b');
  });

  it('escapes ampersands', () => {
    expect(escapeXml('A & B')).toBe('A &amp; B');
  });

  it('escapes multiple occurrences in one message', () => {
    expect(escapeXml('<a>&<b>')).toBe('&lt;a&gt;&amp;&lt;b&gt;');
  });

  it('returns empty string for empty input', () => {
    expect(escapeXml('')).toBe('');
  });

  it('double-escapes already escaped entities', () => {
    expect(escapeXml('A &amp; B')).toBe('A &amp;amp; B');
  });

  it(`is identity over strings that contain no XML-special characters`, () => {
    fc.assert(
      fc.property(
        fc.string().filter((value) => !/[<>&"']/.test(value)),
        (safeText) => {
          expect(escapeXml(safeText)).toBe(safeText);
        },
      ),
    );
  });

  it('produces no raw < or > characters in output', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const escaped = escapeXml(text);
        expect(escaped.includes('<')).toBe(false);
        expect(escaped.includes('>')).toBe(false);
      }),
    );
  });

  it('never shortens output length', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(escapeXml(text).length).toBeGreaterThanOrEqual(text.length);
      }),
    );
  });
});

/**
 * @plan:PLAN-20250212-LSP.P07
 * @requirement:REQ-FMT-045
 * @scenario:LSP numeric severities mapped to formatter strings
 * @given:LSP diagnostic severity values
 * @when:mapSeverity is called
 * @then:Known values map to expected labels and unknown values default safely
 */
describe('mapSeverity', () => {
  it('maps LSP severity 1 to error', () => {
    expect(mapSeverity(1)).toBe('error');
  });

  it('maps LSP severity 2 to warning', () => {
    expect(mapSeverity(2)).toBe('warning');
  });

  it('maps LSP severity 3 to info', () => {
    expect(mapSeverity(3)).toBe('info');
  });

  it('maps LSP severity 4 to hint', () => {
    expect(mapSeverity(4)).toBe('hint');
  });

  it('maps unknown positive severity to error', () => {
    expect(mapSeverity(99)).toBe('error');
  });

  it('maps zero severity to error', () => {
    expect(mapSeverity(0)).toBe('error');
  });
});

/**
 * @plan:PLAN-20250212-LSP.P07
 * @requirement:REQ-FMT-080
 * @scenario:Diagnostic normalization from LSP payload
 * @given:Raw LSP diagnostics with optional fields and 0-based positions
 * @when:normalizeLspDiagnostic is called
 * @then:Output is normalized with required defaults and 1-based positions
 */
describe('normalizeLspDiagnostic', () => {
  it('converts 0-based line and character to 1-based values', () => {
    const normalized = normalizeLspDiagnostic(
      {
        message: 'x',
        severity: 1,
        range: { start: { line: 0, character: 0 } },
      },
      '/workspace/src/main.ts',
      '/workspace',
    );

    expect(normalized.line).toBe(1);
    expect(normalized.column).toBe(1);
  });

  it('strips workspace root from absolute file path', () => {
    const normalized = normalizeLspDiagnostic(
      {
        message: 'x',
        severity: 1,
        range: { start: { line: 1, character: 1 } },
      },
      '/workspace/src/main.ts',
      '/workspace',
    );

    expect(normalized.file).toBe('src/main.ts');
  });

  it('keeps non-workspace file path unchanged', () => {
    const normalized = normalizeLspDiagnostic(
      {
        message: 'x',
        severity: 1,
        range: { start: { line: 1, character: 1 } },
      },
      'src/relative.ts',
      '/workspace',
    );

    expect(normalized.file).toBe('src/relative.ts');
  });

  it('defaults missing message to empty string', () => {
    const normalized = normalizeLspDiagnostic(
      { severity: 1, range: { start: { line: 2, character: 2 } } },
      'src/a.ts',
      '/workspace',
    );

    expect(normalized.message).toBe('');
  });

  it('defaults missing severity to error', () => {
    const normalized = normalizeLspDiagnostic(
      { message: 'x', range: { start: { line: 2, character: 2 } } },
      'src/a.ts',
      '/workspace',
    );

    expect(normalized.severity).toBe('error');
  });

  it('defaults missing range to line 1 column 1', () => {
    const normalized = normalizeLspDiagnostic(
      { message: 'x', severity: 1 },
      'src/a.ts',
      '/workspace',
    );

    expect(normalized.line).toBe(1);
    expect(normalized.column).toBe(1);
  });

  it('always produces line and column greater than or equal to 1 for non-negative source coordinates', () => {
    const rawArbitrary = fc.record({
      message: fc.option(fc.string(), { nil: undefined }),
      severity: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
      range: fc.option(
        fc.record({
          start: fc.option(
            fc.record({
              line: fc.option(fc.integer({ min: 0, max: 5000 }), {
                nil: undefined,
              }),
              character: fc.option(fc.integer({ min: 0, max: 1000 }), {
                nil: undefined,
              }),
            }),
            { nil: undefined },
          ),
        }),
        { nil: undefined },
      ),
    }) as fc.Arbitrary<RawLspDiagnostic>;

    fc.assert(
      fc.property(rawArbitrary, (raw) => {
        const normalized = normalizeLspDiagnostic(
          raw,
          '/workspace/src/a.ts',
          '/workspace',
        );
        expect(normalized.line).toBeGreaterThanOrEqual(1);
        expect(normalized.column).toBeGreaterThanOrEqual(1);
      }),
    );
  });

  it('maps severity result to supported labels only', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), (severity) => {
        const normalized = normalizeLspDiagnostic(
          {
            message: 'x',
            severity,
            range: { start: { line: 0, character: 0 } },
          },
          '/workspace/src/a.ts',
          '/workspace',
        );

        expect(['error', 'warning', 'info', 'hint']).toContain(
          normalized.severity,
        );
      }),
    );
  });
});

/**
 * @plan:PLAN-20250212-LSP.P07
 * @requirement:REQ-FMT-070
 * @scenario:Deduplication across diagnostics with same file/range/message
 * @given:Potentially repeated diagnostics from multiple servers
 * @when:deduplicateDiagnostics is called
 * @then:Exact duplicates are removed while unique diagnostics remain
 */
describe('deduplicateDiagnostics', () => {
  it('removes exact duplicates with same file line column and message', () => {
    const diagnostics = [
      createDiagnostic({ message: 'same', line: 1, column: 1 }),
      createDiagnostic({ message: 'same', line: 1, column: 1 }),
    ];

    expect(deduplicateDiagnostics(diagnostics)).toEqual([diagnostics[0]]);
  });

  it('keeps diagnostics with same range but different message', () => {
    const diagnostics = [
      createDiagnostic({ message: 'one', line: 1, column: 1 }),
      createDiagnostic({ message: 'two', line: 1, column: 1 }),
    ];

    expect(deduplicateDiagnostics(diagnostics)).toHaveLength(2);
  });

  it('keeps diagnostics with same message but different line', () => {
    const diagnostics = [
      createDiagnostic({ message: 'same', line: 1, column: 1 }),
      createDiagnostic({ message: 'same', line: 2, column: 1 }),
    ];

    expect(deduplicateDiagnostics(diagnostics)).toHaveLength(2);
  });

  it('returns empty output when input is empty', () => {
    expect(deduplicateDiagnostics([])).toEqual([]);
  });

  it('never returns more diagnostics than input', () => {
    const diagnosticsArbitrary = fc.array(
      fc.record({
        file: fc.constant('src/file.ts'),
        message: fc.string(),
        severity: fc.constantFrom('error', 'warning', 'info', 'hint'),
        line: fc.integer({ min: 1, max: 100 }),
        column: fc.integer({ min: 1, max: 100 }),
      }) as fc.Arbitrary<Diagnostic>,
    );

    fc.assert(
      fc.property(diagnosticsArbitrary, (diagnostics) => {
        expect(deduplicateDiagnostics(diagnostics).length).toBeLessThanOrEqual(
          diagnostics.length,
        );
      }),
    );
  });

  it('is idempotent under repeated application', () => {
    const diagnosticsArbitrary = fc.array(
      fc.record({
        file: fc.constant('src/file.ts'),
        message: fc.string(),
        severity: fc.constantFrom('error', 'warning', 'info', 'hint'),
        line: fc.integer({ min: 1, max: 100 }),
        column: fc.integer({ min: 1, max: 100 }),
      }) as fc.Arbitrary<Diagnostic>,
    );

    fc.assert(
      fc.property(diagnosticsArbitrary, (diagnostics) => {
        const once = deduplicateDiagnostics(diagnostics);
        const twice = deduplicateDiagnostics(once);
        expect(twice).toEqual(once);
      }),
    );
  });
});

/**
 * @plan:PLAN-20250212-LSP.P07
 * @requirement:REQ-FMT-065
 * @scenario:Severity filtering semantics and cap ordering
 * @given:Diagnostics with mixed severities and configured include list
 * @when:filterBySeverity is called and then formatted
 * @then:Include list replaces defaults and formatting caps apply after filtering
 */
describe('filterBySeverity', () => {
  it('returns only error diagnostics when include severities is error', () => {
    const diagnostics = [
      createDiagnostic({ message: 'e', severity: 'error' }),
      createDiagnostic({ message: 'w', severity: 'warning' }),
    ];

    const filtered = filterBySeverity(diagnostics, ['error']);
    expect(filtered).toEqual([diagnostics[0]]);
  });

  it('returns error and warning diagnostics when both severities are included', () => {
    const diagnostics = [
      createDiagnostic({ severity: 'error' }),
      createDiagnostic({ severity: 'warning' }),
      createDiagnostic({ severity: 'info' }),
    ];

    expect(filterBySeverity(diagnostics, ['error', 'warning'])).toHaveLength(2);
  });

  it('returns all diagnostics when all severities are included', () => {
    const diagnostics = [
      createDiagnostic({ severity: 'error' }),
      createDiagnostic({ severity: 'warning' }),
      createDiagnostic({ severity: 'info' }),
      createDiagnostic({ severity: 'hint' }),
    ];

    expect(
      filterBySeverity(diagnostics, ['error', 'warning', 'info', 'hint']),
    ).toHaveLength(4);
  });

  it('returns empty diagnostics for empty include severities', () => {
    const diagnostics = [createDiagnostic({ severity: 'error' })];
    expect(filterBySeverity(diagnostics, [])).toEqual([]);
  });

  it('returns empty diagnostics when all diagnostics are excluded', () => {
    const diagnostics = [
      createDiagnostic({ severity: 'info' }),
      createDiagnostic({ severity: 'hint' }),
    ];
    expect(filterBySeverity(diagnostics, ['error'])).toEqual([]);
  });

  it('treats include severities as replacing the default behavior (REQ-FMT-065)', () => {
    const diagnostics = [createDiagnostic({ severity: 'warning' })];
    expect(filterBySeverity(diagnostics, ['warning'])).toEqual(diagnostics);
  });

  it('applies per-file cap after filter when combined with formatting (REQ-FMT-066)', () => {
    const diagnostics = [
      ...Array.from({ length: 18 }, (_, index) =>
        createDiagnostic({
          message: `e${index}`,
          severity: 'error',
          line: index + 1,
        }),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        createDiagnostic({
          message: `w${index}`,
          severity: 'warning',
          line: index + 19,
        }),
      ),
    ];

    const filtered = filterBySeverity(diagnostics, ['error', 'warning']);
    const output = formatSingleFileDiagnostics('src/order.ts', filtered, {
      severities: ['error', 'warning'],
      perFileLimit: 20,
      totalLimit: 50,
    });

    expect(output).toContain('... and 8 more');
  });

  it('never returns more diagnostics than input', () => {
    const diagnosticsArbitrary = fc.array(
      fc.record({
        file: fc.constant('src/file.ts'),
        message: fc.string(),
        severity: fc.constantFrom('error', 'warning', 'info', 'hint'),
        line: fc.integer({ min: 1, max: 100 }),
        column: fc.integer({ min: 1, max: 100 }),
      }) as fc.Arbitrary<Diagnostic>,
    );

    fc.assert(
      fc.property(
        diagnosticsArbitrary,
        fc.array(fc.constantFrom('error', 'warning', 'info', 'hint'), {
          maxLength: 4,
        }),
        (diagnostics, severities) => {
          expect(
            filterBySeverity(diagnostics, severities).length,
          ).toBeLessThanOrEqual(diagnostics.length);
        },
      ),
    );
  });
});

/**
 * @plan:PLAN-20250212-LSP.P07
 * @requirement:REQ-FMT-010
 * @scenario:Single-line diagnostic format rendering
 * @given:Normalized diagnostic records
 * @when:formatDiagnosticLine is called
 * @then:Line is formatted with uppercase severity, position, escaped message, and optional code
 */
describe('formatDiagnosticLine', () => {
  it('formats line with code suffix present in message', () => {
    const line = formatDiagnosticLine(
      createDiagnostic({
        severity: 'error',
        line: 10,
        column: 5,
        message: 'Type mismatch (ts2322)',
      }),
    );

    expect(line).toBe('ERROR [10:5] Type mismatch (ts2322)');
  });

  it('formats line without code suffix', () => {
    const line = formatDiagnosticLine(
      createDiagnostic({
        severity: 'warning',
        line: 3,
        column: 7,
        message: 'Deprecated',
      }),
    );

    expect(line).toBe('WARNING [3:7] Deprecated');
  });

  it('escapes XML characters in message text', () => {
    const line = formatDiagnosticLine(
      createDiagnostic({
        severity: 'error',
        line: 10,
        column: 5,
        message:
          "Type '<string>' is not assignable to type '&Record<K, V>' (ts2322)",
      }),
    );

    expect(line).toBe(
      'ERROR [10:5] Type &apos;&lt;string&gt;&apos; is not assignable to type &apos;&amp;Record&lt;K, V&gt;&apos; (ts2322)',
    );
  });

  it('uppercases severity label in output', () => {
    const line = formatDiagnosticLine(
      createDiagnostic({
        severity: 'info',
        line: 1,
        column: 1,
        message: 'Info msg',
      }),
    );
    expect(line.startsWith('INFO ')).toBe(true);
  });

  it('contains exactly one position segment in brackets', () => {
    const line = formatDiagnosticLine(
      createDiagnostic({ line: 12, column: 9 }),
    );
    expect(line.match(/\[12:9\]/g)?.length).toBe(1);
  });
});

/**
 * @plan:PLAN-20250212-LSP.P07
 * @requirement:REQ-FMT-050
 * @scenario:Single-file diagnostics block formatting with caps
 * @given:Diagnostics for one file with varying counts
 * @when:formatSingleFileDiagnostics is called
 * @then:Output includes tags, lines in order, and overflow suffix behavior
 */
describe('formatSingleFileDiagnostics', () => {
  it('returns empty string when diagnostics are empty', () => {
    expect(
      formatSingleFileDiagnostics('src/empty.ts', [], DEFAULT_CONFIG),
    ).toBe('');
  });

  it('renders diagnostics block under cap', () => {
    const diagnostics = [
      createDiagnostic({ file: 'src/a.ts', message: 'A', line: 1, column: 1 }),
      createDiagnostic({ file: 'src/a.ts', message: 'B', line: 2, column: 1 }),
    ];

    const output = formatSingleFileDiagnostics(
      'src/a.ts',
      diagnostics,
      DEFAULT_CONFIG,
    );
    expect(output).toContain('<diagnostics file="src/a.ts">');
    expect(output).toContain('ERROR [1:1] A');
    expect(output).toContain('ERROR [2:1] B');
    expect(output).toContain('</diagnostics>');
  });

  it('does not include overflow suffix when diagnostics equal cap', () => {
    const diagnostics = Array.from({ length: 20 }, (_, index) =>
      createDiagnostic({
        file: 'src/exact.ts',
        message: `E${index + 1}`,
        line: index + 1,
        column: 1,
      }),
    );

    const output = formatSingleFileDiagnostics(
      'src/exact.ts',
      diagnostics,
      DEFAULT_CONFIG,
    );
    expect(output).not.toContain('... and');
  });

  it('includes overflow suffix when diagnostics exceed cap', () => {
    const diagnostics = Array.from({ length: 21 }, (_, index) =>
      createDiagnostic({
        file: 'src/over.ts',
        message: `E${index + 1}`,
        line: index + 1,
        column: 1,
      }),
    );

    const output = formatSingleFileDiagnostics(
      'src/over.ts',
      diagnostics,
      DEFAULT_CONFIG,
    );
    expect(output).toContain('... and 1 more');
  });

  it('preserves input ordering of diagnostic lines', () => {
    const diagnostics = [
      createDiagnostic({
        file: 'src/order.ts',
        message: 'first',
        line: 5,
        column: 1,
      }),
      createDiagnostic({
        file: 'src/order.ts',
        message: 'second',
        line: 1,
        column: 1,
      }),
    ];

    const output = formatSingleFileDiagnostics(
      'src/order.ts',
      diagnostics,
      DEFAULT_CONFIG,
    );
    expect(output.indexOf('first')).toBeLessThan(output.indexOf('second'));
  });

  it('fixture 1: caps at 20 and reports 5 more for 25 input errors', () => {
    const diagnostics = Array.from({ length: 25 }, (_, index) =>
      createDiagnostic({
        file: 'src/big.ts',
        severity: 'error',
        line: index + 1,
        column: 1,
        message: `Error message ${index + 1} (ts${String(index + 1).padStart(4, '0')})`,
      }),
    );

    const output = formatSingleFileDiagnostics(
      'src/big.ts',
      diagnostics,
      DEFAULT_CONFIG,
    );
    expect(output).toContain('ERROR [1:1] Error message 1 (ts0001)');
    expect(output).toContain('ERROR [20:1] Error message 20 (ts0020)');
    expect(output).toContain('... and 5 more');
    expect(output).not.toContain('Error message 21');
  });

  it('fixture 2: mixed severities filtered to 8 lines and all fit under cap', () => {
    const diagnostics: Diagnostic[] = [
      createDiagnostic({
        file: 'src/mixed.ts',
        severity: 'error',
        line: 1,
        column: 1,
        message: 'Type mismatch (ts2322)',
      }),
      createDiagnostic({
        file: 'src/mixed.ts',
        severity: 'error',
        line: 5,
        column: 3,
        message: 'Missing property (ts2741)',
      }),
      createDiagnostic({
        file: 'src/mixed.ts',
        severity: 'error',
        line: 10,
        column: 1,
        message: 'Cannot find name (ts2304)',
      }),
      createDiagnostic({
        file: 'src/mixed.ts',
        severity: 'error',
        line: 15,
        column: 7,
        message: 'Unused variable (ts6133)',
      }),
      createDiagnostic({
        file: 'src/mixed.ts',
        severity: 'error',
        line: 20,
        column: 1,
        message: 'No overload matches (ts2769)',
      }),
      createDiagnostic({
        file: 'src/mixed.ts',
        severity: 'warning',
        line: 3,
        column: 1,
        message: 'Deprecated API (ts6385)',
      }),
      createDiagnostic({
        file: 'src/mixed.ts',
        severity: 'warning',
        line: 8,
        column: 5,
        message: 'Implicit any (ts7006)',
      }),
      createDiagnostic({
        file: 'src/mixed.ts',
        severity: 'warning',
        line: 25,
        column: 1,
        message: 'Unreachable code (ts7027)',
      }),
      createDiagnostic({
        file: 'src/mixed.ts',
        severity: 'info',
        line: 30,
        column: 1,
        message: 'Info extra 1',
      }),
      createDiagnostic({
        file: 'src/mixed.ts',
        severity: 'info',
        line: 31,
        column: 1,
        message: 'Info extra 2',
      }),
    ];

    const filtered = filterBySeverity(diagnostics, ['error', 'warning']);
    expect(filtered).toHaveLength(8);

    const output = formatSingleFileDiagnostics(
      'src/mixed.ts',
      filtered,
      DEFAULT_CONFIG,
    );
    expect(output).toContain('ERROR [1:1] Type mismatch (ts2322)');
    expect(output).toContain('WARNING [25:1] Unreachable code (ts7027)');
    expect(output).not.toContain('Info extra');
    expect(output).not.toContain('... and');
  });
});

/**
 * @plan:PLAN-20250212-LSP.P07
 * @requirement:REQ-FMT-068
 * @scenario:Multi-file diagnostics formatting under global cap
 * @given:Multiple files with diagnostics and per-file/global limits
 * @when:formatMultiFileDiagnostics is called
 * @then:Written file is ordered first and total diagnostic line cap is enforced
 */
describe('formatMultiFileDiagnostics', () => {
  it('returns empty string when no files have diagnostics', () => {
    expect(formatMultiFileDiagnostics('src/a.ts', {}, DEFAULT_CONFIG)).toBe('');
  });

  it('formats output for a single file', () => {
    const all = {
      'src/a.ts': [
        createDiagnostic({
          file: 'src/a.ts',
          message: 'A1',
          line: 1,
          column: 1,
        }),
      ],
    };

    const output = formatMultiFileDiagnostics('src/a.ts', all, DEFAULT_CONFIG);
    expect(output).toContain('<diagnostics file="src/a.ts">');
    expect(output).toContain('ERROR [1:1] A1');
  });

  it('formats output for multiple files', () => {
    const all = {
      'src/a.ts': [
        createDiagnostic({
          file: 'src/a.ts',
          message: 'A1',
          line: 1,
          column: 1,
        }),
      ],
      'src/b.ts': [
        createDiagnostic({
          file: 'src/b.ts',
          message: 'B1',
          line: 1,
          column: 1,
        }),
      ],
    };

    const output = formatMultiFileDiagnostics('src/a.ts', all, DEFAULT_CONFIG);
    expect(output).toContain('src/a.ts');
    expect(output).toContain('src/b.ts');
  });

  it('orders written file block before other files', () => {
    const all = {
      'src/other.ts': [
        createDiagnostic({
          file: 'src/other.ts',
          message: 'Other',
          line: 1,
          column: 1,
        }),
      ],
      'src/written.ts': [
        createDiagnostic({
          file: 'src/written.ts',
          message: 'Written',
          line: 1,
          column: 1,
        }),
      ],
    };

    const output = formatMultiFileDiagnostics(
      'src/written.ts',
      all,
      DEFAULT_CONFIG,
    );
    expect(output.indexOf('src/written.ts')).toBeLessThan(
      output.indexOf('src/other.ts'),
    );
  });

  it('enforces total cap across files', () => {
    const makeDiagnostics = (file: string, count: number): Diagnostic[] =>
      Array.from({ length: count }, (_, index) =>
        createDiagnostic({
          file,
          line: index + 1,
          column: 1,
          message: `${file}-${index + 1}`,
        }),
      );

    const all = {
      'src/a.ts': makeDiagnostics('src/a.ts', 20),
      'src/b.ts': makeDiagnostics('src/b.ts', 20),
      'src/c.ts': makeDiagnostics('src/c.ts', 20),
    };

    const output = formatMultiFileDiagnostics('src/a.ts', all, DEFAULT_CONFIG);
    expect(output).toContain('src/c.ts-10');
    expect(output).not.toContain('src/c.ts-11');
  });

  it('fixture 4: three files of 20 each under total cap 50 includes only first 10 of third file', () => {
    const makeErrors = (file: string): Diagnostic[] =>
      Array.from({ length: 20 }, (_, index) =>
        createDiagnostic({
          file,
          severity: 'error',
          line: index + 1,
          column: 1,
          message: `${file} error ${index + 1}`,
        }),
      );

    const output = formatMultiFileDiagnostics(
      'src/a.ts',
      {
        'src/a.ts': makeErrors('src/a.ts'),
        'src/b.ts': makeErrors('src/b.ts'),
        'src/c.ts': makeErrors('src/c.ts'),
      },
      { severities: ['error'], perFileLimit: 20, totalLimit: 50 },
    );

    expect(output).toContain('src/c.ts error 10');
    expect(output).not.toContain('src/c.ts error 11');
    expect(output).toContain('... and 10 more');
  });

  it('fixture 5: per-file overflow suffix lines do not consume total cap budget (REQ-FMT-068)', () => {
    const makeErrors = (file: string): Diagnostic[] =>
      Array.from({ length: 25 }, (_, index) =>
        createDiagnostic({
          file,
          severity: 'error',
          line: index + 1,
          column: 1,
          message: `${file} error ${index + 1}`,
        }),
      );

    const output = formatMultiFileDiagnostics(
      'src/a.ts',
      {
        'src/a.ts': makeErrors('src/a.ts'),
        'src/b.ts': makeErrors('src/b.ts'),
      },
      { severities: ['error'], perFileLimit: 20, totalLimit: 50 },
    );

    expect(output).toContain('... and 5 more');
    expect(output).toContain('src/b.ts error 20');
    expect(output).not.toContain('src/b.ts error 21');
  });
});

/**
 * @plan:PLAN-20250212-LSP.P07
 * @requirement:REQ-FMT-040
 * @scenario:Golden fixture XML escaping in formatted line
 * @given:Message with < > and & symbols
 * @when:escapeXml and formatDiagnosticLine are applied
 * @then:Escaped symbols appear in output exactly as specified
 */
describe('golden fixture 3', () => {
  it('escapes Type <string> and &Record<K, V> exactly in output', () => {
    const message = "Type '<string>' is not assignable to type '&Record<K, V>'";
    expect(escapeXml(message)).toBe(
      'Type &apos;&lt;string&gt;&apos; is not assignable to type &apos;&amp;Record&lt;K, V&gt;&apos;',
    );

    const line = formatDiagnosticLine(
      createDiagnostic({
        severity: 'error',
        line: 10,
        column: 5,
        message: `${message} (ts2322)`,
      }),
    );

    expect(line).toBe(
      'ERROR [10:5] Type &apos;&lt;string&gt;&apos; is not assignable to type &apos;&amp;Record&lt;K, V&gt;&apos; (ts2322)',
    );
  });
});
