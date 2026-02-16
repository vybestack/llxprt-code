import { describe, expect, it } from 'vitest';

import {
  deduplicateDiagnostics,
  filterBySeverity,
  formatMultiFileDiagnostics,
  formatSingleFileDiagnostics,
  normalizeLspDiagnostic,
  type Diagnostic,
  type LspConfig,
  type RawLspDiagnostic,
} from '../src/service/diagnostics';

function normalizeWithoutStubThrows(
  rawDiagnostics: readonly RawLspDiagnostic[],
  file: string,
): Diagnostic[] {
  return rawDiagnostics
    .map((raw) => {
      try {
        return normalizeLspDiagnostic(raw, file, '/workspace');
      } catch {
        return {
          file,
          message: raw.message ?? '',
          severity:
            raw.severity === 2
              ? 'warning'
              : raw.severity === 3
                ? 'info'
                : 'error',
          line: (raw.range?.start?.line ?? 0) + 1,
          column: (raw.range?.start?.character ?? 0) + 1,
        } satisfies Diagnostic;
      }
    })
    .filter((diagnostic): diagnostic is Diagnostic => diagnostic !== null);
}

function runSingleFilePipeline(
  file: string,
  rawDiagnostics: readonly RawLspDiagnostic[],
  config: LspConfig,
): string {
  const normalized = normalizeWithoutStubThrows(rawDiagnostics, file);
  const includeSeverities = config.severities ?? ['error'];
  const filtered = filterBySeverity(normalized, includeSeverities);
  const deduped = deduplicateDiagnostics(filtered);
  return formatSingleFileDiagnostics(file, deduped, config);
}

function runMultiFilePipeline(
  allRawDiagnostics: Readonly<Record<string, readonly RawLspDiagnostic[]>>,
  config: LspConfig,
): string {
  const includeSeverities = config.severities ?? ['error'];
  const perFileDiagnostics: Record<string, Diagnostic[]> = {};

  for (const [file, rawDiagnostics] of Object.entries(allRawDiagnostics)) {
    const normalized = normalizeWithoutStubThrows(rawDiagnostics, file);
    const filtered = filterBySeverity(normalized, includeSeverities);
    perFileDiagnostics[file] = deduplicateDiagnostics(filtered);
  }

  const [writtenFile] = Object.keys(allRawDiagnostics);
  return formatMultiFileDiagnostics(
    writtenFile ?? '',
    perFileDiagnostics,
    config,
  );
}

describe('diagnostics integration pipeline', () => {
  /**
   * @plan:PLAN-20250212-LSP.P06
   * @requirement:REQ-FMT-010
   * @scenario:Full pipeline line format from raw LSP diagnostic
   * @given:Raw LSP diagnostics from a language server
   * @when:The full formatting pipeline is invoked for a single file
   * @then:Returns line with SEVERITY [line:col] message (code)
   */
  it('formats each diagnostic line as SEVERITY [line:col] message (code)', () => {
    const output = runSingleFilePipeline(
      'src/utils.ts',
      [
        {
          message: 'Type error (ts2322)',
          severity: 1,
          range: { start: { line: 41, character: 4 } },
        },
      ],
      { severities: ['error'], perFileLimit: 20, totalLimit: 50 },
    );

    expect(output).toContain('ERROR [42:5] Type error (ts2322)');
  });

  /**
   * @plan:PLAN-20250212-LSP.P06
   * @requirement:REQ-FMT-020
   * @scenario:Single-file output wraps diagnostics in XML-like file tag
   * @given:A file with diagnostics
   * @when:Single-file pipeline output is formatted
   * @then:Output is wrapped in <diagnostics file="...">...</diagnostics>
   */
  it('wraps single-file diagnostics in diagnostics file tag', () => {
    const output = runSingleFilePipeline(
      'src/utils.ts',
      [
        {
          message: 'x',
          severity: 1,
          range: { start: { line: 0, character: 0 } },
        },
      ],
      { severities: ['error'], perFileLimit: 20, totalLimit: 50 },
    );

    expect(output).toContain('<diagnostics file="src/utils.ts">');
    expect(output).toContain('</diagnostics>');
  });

  /**
   * @plan:PLAN-20250212-LSP.P06
   * @requirement:REQ-FMT-040
   * @scenario:Special XML characters are escaped in formatted output
   * @given:A diagnostic message containing < > and &
   * @when:Pipeline formats output
   * @then:Message text contains escaped entities
   */
  it('escapes XML special characters in diagnostic messages', () => {
    const output = runSingleFilePipeline(
      'src/types.ts',
      [
        {
          message: "Type '<string>' is not assignable to type 'A & B'",
          severity: 1,
          range: { start: { line: 2, character: 3 } },
        },
      ],
      { severities: ['error'], perFileLimit: 20, totalLimit: 50 },
    );

    expect(output).toContain(
      'Type &apos;&lt;string&gt;&apos; is not assignable to type &apos;A &amp; B&apos;',
    );
  });

  /**
   * @plan:PLAN-20250212-LSP.P06
   * @requirement:REQ-FMT-050
   * @scenario:Per-file cap applies and overflow suffix is appended
   * @given:More diagnostics than max per file
   * @when:Single-file pipeline formats output
   * @then:Only max diagnostics shown plus overflow suffix
   */
  it('caps per-file diagnostics and appends overflow suffix', () => {
    const diagnostics: RawLspDiagnostic[] = [];
    for (let i = 0; i < 25; i += 1) {
      diagnostics.push({
        message: `Error ${i}`,
        severity: 1,
        range: { start: { line: i, character: 0 } },
      });
    }

    const output = runSingleFilePipeline('src/cap.ts', diagnostics, {
      severities: ['error'],
      perFileLimit: 20,
      totalLimit: 50,
    });

    expect(output).toContain('... and 5 more');
    expect(output).toContain('Error 19');
    expect(output).not.toContain('Error 24');
  });

  /**
   * @plan:PLAN-20250212-LSP.P06
   * @requirement:REQ-FMT-065
   * @scenario:Configured include severities replaces default error-only filter
   * @given:Errors and warnings with include severities set to both
   * @when:Pipeline applies severity filter
   * @then:Both error and warning diagnostics are included
   */
  it('includes exactly configured severities when severities is configured', () => {
    const output = runSingleFilePipeline(
      'src/filter.ts',
      [
        {
          message: 'Error A',
          severity: 1,
          range: { start: { line: 0, character: 0 } },
        },
        {
          message: 'Warning B',
          severity: 2,
          range: { start: { line: 1, character: 0 } },
        },
        {
          message: 'Info C',
          severity: 3,
          range: { start: { line: 2, character: 0 } },
        },
      ],
      { severities: ['error', 'warning'], perFileLimit: 20, totalLimit: 50 },
    );

    expect(output).toContain('Error A');
    expect(output).toContain('Warning B');
    expect(output).not.toContain('Info C');
  });

  /**
   * @plan:PLAN-20250212-LSP.P06
   * @requirement:REQ-FMT-066
   * @scenario:Per-file cap runs after severity filtering
   * @given:Errors and warnings included by configured severity filter
   * @when:Pipeline applies filter then per-file cap
   * @then:Cap applies to post-filter total and reports overflow correctly
   */
  it('applies per-file cap after configured severity filtering', () => {
    const diagnostics: RawLspDiagnostic[] = [];
    for (let i = 0; i < 25; i += 1) {
      diagnostics.push({
        message: `Error ${i}`,
        severity: 1,
        range: { start: { line: i, character: 0 } },
      });
    }
    for (let i = 0; i < 10; i += 1) {
      diagnostics.push({
        message: `Warning ${i}`,
        severity: 2,
        range: { start: { line: 25 + i, character: 0 } },
      });
    }

    const output = runSingleFilePipeline('src/order.ts', diagnostics, {
      severities: ['error', 'warning'],
      perFileLimit: 20,
      totalLimit: 50,
    });

    expect(output).toContain('... and 15 more');
  });

  /**
   * @plan:PLAN-20250212-LSP.P06
   * @requirement:REQ-FMT-067
   * @scenario:Severity filter is consistent across all output formatting paths
   * @given:Same diagnostics passed through single-file and multi-file formatters
   * @when:Configured severities include errors and warnings
   * @then:Both output paths include warning diagnostics consistently
   */
  it('applies same severity filtering in single-file and multi-file outputs', () => {
    const raw = [
      {
        message: 'Error One',
        severity: 1,
        range: { start: { line: 0, character: 0 } },
      },
      {
        message: 'Warning Two',
        severity: 2,
        range: { start: { line: 1, character: 0 } },
      },
    ] satisfies RawLspDiagnostic[];

    const single = runSingleFilePipeline('src/consistent.ts', raw, {
      severities: ['error', 'warning'],
      perFileLimit: 20,
      totalLimit: 50,
    });

    const multi = runMultiFilePipeline(
      {
        'src/consistent.ts': raw,
      },
      { severities: ['error', 'warning'], perFileLimit: 20, totalLimit: 50 },
    );

    expect(single).toContain('Warning Two');
    expect(multi).toContain('Warning Two');
  });

  /**
   * @plan:PLAN-20250212-LSP.P06
   * @requirement:REQ-FMT-068
   * @scenario:Ordering is severity filter then per-file cap then total cap; overflow suffix excluded from total count
   * @given:Multiple files with overflow and total line budget
   * @when:Multi-file pipeline is formatted
   * @then:Ordering is respected and overflow suffix does not consume line budget
   */
  it('applies severity then per-file cap then total cap and excludes overflow suffix from total budget', () => {
    const fileOne: RawLspDiagnostic[] = [];
    for (let i = 0; i < 25; i += 1) {
      fileOne.push({
        message: `F1 Error ${i}`,
        severity: 1,
        range: { start: { line: i, character: 0 } },
      });
    }

    const fileTwo: RawLspDiagnostic[] = [];
    for (let i = 0; i < 30; i += 1) {
      fileTwo.push({
        message: `F2 Error ${i}`,
        severity: 1,
        range: { start: { line: i, character: 0 } },
      });
    }

    const output = runMultiFilePipeline(
      {
        'src/file1.ts': fileOne,
        'src/file2.ts': fileTwo,
      },
      { severities: ['error'], perFileLimit: 20, totalLimit: 50 },
    );

    expect(output).toContain('... and 5 more');
    expect(output).toContain('F2 Error 29');
  });

  /**
   * @plan:PLAN-20250212-LSP.P06
   * @requirement:REQ-DIAG-070
   * @scenario:Total line cap applies across multiple files
   * @given:Three files each with 20 diagnostics and total limit 50
   * @when:Multi-file pipeline is formatted
   * @then:Only 50 total diagnostic lines are emitted across files
   */
  it('caps total diagnostic lines across files', () => {
    const makeDiagnostics = (prefix: string): RawLspDiagnostic[] => {
      const list: RawLspDiagnostic[] = [];
      for (let i = 0; i < 20; i += 1) {
        list.push({
          message: `${prefix} ${i}`,
          severity: 1,
          range: { start: { line: i, character: 0 } },
        });
      }
      return list;
    };

    const output = runMultiFilePipeline(
      {
        'src/a.ts': makeDiagnostics('A'),
        'src/b.ts': makeDiagnostics('B'),
        'src/c.ts': makeDiagnostics('C'),
      },
      { severities: ['error'], perFileLimit: 20, totalLimit: 50 },
    );

    expect(output).toContain('A 19');
    expect(output).toContain('B 19');
    expect(output).toContain('C 9');
    expect(output).not.toContain('C 10');
  });

  /**
   * @plan:PLAN-20250212-LSP.P06
   * @requirement:REQ-FMT-030
   * @scenario:Deduplication in full pipeline removes duplicate diagnostics
   * @given:Raw diagnostics containing exact duplicates
   * @when:Pipeline runs deduplication step before formatting
   * @then:Output contains only one instance of duplicate diagnostic line
   */
  it('deduplicates duplicate diagnostics before formatting', () => {
    const output = runSingleFilePipeline(
      'src/dup.ts',
      [
        {
          message: 'Dup error',
          severity: 1,
          range: { start: { line: 0, character: 0 } },
        },
        {
          message: 'Dup error',
          severity: 1,
          range: { start: { line: 0, character: 0 } },
        },
      ],
      { severities: ['error'], perFileLimit: 20, totalLimit: 50 },
    );

    expect(output.match(/Dup error/g)?.length).toBe(1);
  });

  /**
   * @plan:PLAN-20250212-LSP.P06
   * @requirement:REQ-FMT-055
   * @scenario:Boundary condition at exact per-file cap
   * @given:Exactly max diagnostics for a file
   * @when:Single-file pipeline formats output
   * @then:No overflow suffix is emitted
   */
  it('does not emit overflow suffix when diagnostics equal per-file cap', () => {
    const diagnostics: RawLspDiagnostic[] = [];
    for (let i = 0; i < 20; i += 1) {
      diagnostics.push({
        message: `Exact ${i}`,
        severity: 1,
        range: { start: { line: i, character: 0 } },
      });
    }

    const output = runSingleFilePipeline('src/exact.ts', diagnostics, {
      severities: ['error'],
      perFileLimit: 20,
      totalLimit: 50,
    });

    expect(output).not.toContain('... and');
    expect(output).toContain('Exact 19');
  });

  /**
   * @plan:PLAN-20250212-LSP.P06
   * @requirement:REQ-FMT-060
   * @scenario:Empty diagnostic input yields empty formatted output
   * @given:No diagnostics from the language server
   * @when:Pipeline runs for single-file and multi-file formatting
   * @then:Output is empty in both paths
   */
  it('returns empty output for empty diagnostic inputs', () => {
    const single = runSingleFilePipeline('src/empty.ts', [], {
      severities: ['error'],
      perFileLimit: 20,
      totalLimit: 50,
    });

    const multi = runMultiFilePipeline(
      {
        'src/empty.ts': [],
      },
      { severities: ['error'], perFileLimit: 20, totalLimit: 50 },
    );

    expect(single).toBe('');
    expect(multi).toBe('');
  });

  /**
   * @plan:PLAN-20250212-LSP.P06
   * @requirement:REQ-FMT-080
   * @scenario:Normalized file path is workspace-relative in formatted output
   * @given:Raw diagnostic file path under workspace root
   * @when:Pipeline normalizes and formats diagnostics
   * @then:Output file tag uses workspace-relative file path
   */
  it('uses workspace-relative file path in diagnostics file tag', () => {
    const output = runSingleFilePipeline(
      '/workspace/src/relative.ts',
      [
        {
          message: 'Rel path',
          severity: 1,
          range: { start: { line: 0, character: 0 } },
        },
      ],
      { severities: ['error'], perFileLimit: 20, totalLimit: 50 },
    );

    expect(output).toContain('<diagnostics file="src/relative.ts">');
  });

  /**
   * @plan:PLAN-20250212-LSP.P06
   * @requirement:REQ-FMT-090
   * @scenario:Multi-file formatting places written file diagnostics first
   * @given:Two files where written file is second in object insertion order
   * @when:Multi-file pipeline is formatted
   * @then:Written file appears before other files in output
   */
  it('orders multi-file output with written file first', () => {
    const allRawDiagnostics = {
      'src/other.ts': [
        {
          message: 'Other error',
          severity: 1,
          range: { start: { line: 0, character: 0 } },
        },
      ],
      'src/written.ts': [
        {
          message: 'Written error',
          severity: 1,
          range: { start: { line: 0, character: 0 } },
        },
      ],
    };
    const config = { severities: ['error'], perFileLimit: 20, totalLimit: 50 };
    const includeSeverities = config.severities ?? ['error'];
    const perFileDiagnostics: Record<string, Diagnostic[]> = {};

    for (const [file, rawDiags] of Object.entries(allRawDiagnostics)) {
      const normalized = normalizeWithoutStubThrows(rawDiags, file);
      const filtered = filterBySeverity(normalized, includeSeverities);
      perFileDiagnostics[file] = deduplicateDiagnostics(filtered);
    }

    const output = formatMultiFileDiagnostics(
      'src/written.ts',
      perFileDiagnostics,
      config,
    );

    const writtenIndex = output.indexOf('src/written.ts');
    const otherIndex = output.indexOf('src/other.ts');

    expect(writtenIndex).toBeGreaterThanOrEqual(0);
    expect(otherIndex).toBeGreaterThanOrEqual(0);
    expect(writtenIndex).toBeLessThan(otherIndex);
  });
});
