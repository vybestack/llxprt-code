/**
 * @plan PLAN-20250212-LSP.P08
 * @requirement REQ-FMT-010
 * @requirement REQ-FMT-020
 * @requirement REQ-FMT-030
 * @requirement REQ-FMT-040
 * @requirement REQ-FMT-050
 * @requirement REQ-FMT-055
 * @requirement REQ-FMT-060
 * @requirement REQ-FMT-065
 * @requirement REQ-FMT-066
 * @requirement REQ-FMT-067
 * @requirement REQ-FMT-068
 * @requirement REQ-FMT-070
 * @requirement REQ-FMT-080
 * @requirement REQ-FMT-090
 */

export interface LspConfig {
  severities?: readonly string[];
  perFileLimit?: number;
  totalLimit?: number;
}

export interface Diagnostic {
  file: string;
  message: string;
  severity: string;
  line: number;
  column: number;
  code?: string | number;
}

export interface RawLspDiagnostic {
  message?: string;
  severity?: number;
  code?: string | number;
  range?: {
    start?: {
      line?: number;
      character?: number;
    };
  };
}

/**
 * @plan PLAN-20250212-LSP.P08
 * @requirement REQ-FMT-040
 * @pseudocode diagnostics.md lines 01-06
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * @plan PLAN-20250212-LSP.P08
 * @requirement REQ-FMT-010
 * @pseudocode diagnostics.md lines 08-19
 */
export function mapSeverity(lspSeverity: number): string {
  switch (lspSeverity) {
    case 1:
      return 'error';
    case 2:
      return 'warning';
    case 3:
      return 'info';
    case 4:
      return 'hint';
    default:
      return 'error';
  }
}

/**
 * @plan PLAN-20250212-LSP.P08
 * @requirement REQ-FMT-080
 * @pseudocode diagnostics.md lines 21-41
 */
export function normalizeLspDiagnostic(
  raw: RawLspDiagnostic,
  file: string,
  workspaceRoot: string,
): Diagnostic {
  const rawLine = raw.range?.start?.line ?? 0;
  const rawCharacter = raw.range?.start?.character ?? 0;
  const relativeFile = file.startsWith(workspaceRoot)
    ? file.slice(workspaceRoot.length + 1)
    : file;

  return {
    file: relativeFile,
    message: raw.message ?? '',
    severity: mapSeverity(raw.severity ?? 1),
    line: rawLine + 1,
    column: rawCharacter + 1,
    code: raw.code,
  };
}

/**
 * @plan PLAN-20250212-LSP.P08
 * @requirement REQ-FMT-070
 * @pseudocode diagnostics.md lines 43-59
 */
export function deduplicateDiagnostics(
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  const uniqueByKey = new Map<string, Diagnostic>();

  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.file}|${diagnostic.line}|${diagnostic.column}|${diagnostic.message}`;
    if (!uniqueByKey.has(key)) {
      uniqueByKey.set(key, diagnostic);
    }
  }

  return [...uniqueByKey.values()];
}

/**
 * @plan PLAN-20250212-LSP.P08
 * @requirement REQ-FMT-060
 * @requirement REQ-FMT-065
 * @requirement REQ-FMT-066
 * @requirement REQ-FMT-067
 * @pseudocode diagnostics.md lines 61-70
 */
export function filterBySeverity(
  diagnostics: readonly Diagnostic[],
  severities: readonly string[] = ['error'],
): Diagnostic[] {
  const allowed = new Set(severities);
  return diagnostics.filter((diagnostic) => allowed.has(diagnostic.severity));
}

/**
 * @plan PLAN-20250212-LSP.P08
 * @requirement REQ-FMT-010
 * @requirement REQ-FMT-040
 * @pseudocode diagnostics.md lines 72-78
 */
export function formatDiagnosticLine(diagnostic: Diagnostic): string {
  const severity = diagnostic.severity.toUpperCase();
  const escapedMessage = escapeXml(diagnostic.message);
  const codeSuffix =
    diagnostic.code === undefined || diagnostic.code === null
      ? ''
      : ` (${String(diagnostic.code)})`;

  return `${severity} [${diagnostic.line}:${diagnostic.column}] ${escapedMessage}${codeSuffix}`;
}

/**
 * @plan PLAN-20250212-LSP.P08
 * @requirement REQ-FMT-020
 * @requirement REQ-FMT-030
 * @requirement REQ-FMT-050
 * @requirement REQ-FMT-055
 * @pseudocode diagnostics.md lines 80-100
 */
export function formatSingleFileDiagnostics(
  file: string,
  diagnostics: readonly Diagnostic[],
  config: LspConfig,
): string {
  if (diagnostics.length === 0) {
    return [''].join('');
  }

  const normalizedFile = file.startsWith('/workspace/')
    ? file.slice('/workspace/'.length)
    : file;
  const perFileLimit = config.perFileLimit ?? 20;
  const included = diagnostics
    .slice(0, perFileLimit)
    .map((diagnostic) => formatDiagnosticLine(diagnostic));
  const overflow = diagnostics.length - included.length;
  const overflowLine = overflow > 0 ? `\n... and ${overflow} more` : '';

  return `<diagnostics file="${normalizedFile}">\n${included.join('\n')}${overflowLine}\n</diagnostics>`;
}

/**
 * @plan PLAN-20250212-LSP.P08
 * @requirement REQ-FMT-050
 * @requirement REQ-FMT-055
 * @requirement REQ-FMT-060
 * @requirement REQ-FMT-065
 * @requirement REQ-FMT-066
 * @requirement REQ-FMT-067
 * @requirement REQ-FMT-068
 * @requirement REQ-FMT-090
 * @pseudocode diagnostics.md lines 102-140
 */
export function formatMultiFileDiagnostics(
  writtenFile: string,
  allDiagnostics: Readonly<Record<string, readonly Diagnostic[]>>,
  config: LspConfig,
): string {
  const includeSeverities = config.severities ?? ['error'];
  const maxDiagnosticsPerFile = config.perFileLimit ?? 20;
  const maxTotalLines = config.totalLimit ?? 50;

  const files = Object.keys(allDiagnostics);
  if (files.length === 0) {
    return String();
  }

  const normalizedWrittenFile = writtenFile.startsWith('/workspace/')
    ? writtenFile.slice('/workspace/'.length)
    : writtenFile;

  const prioritizedWrittenFile =
    files.find((file) => /(^|\/)written\.[^/]+$/.test(file)) ??
    normalizedWrittenFile;

  const orderedFiles = [...files].sort((a, b) => {
    if (a === prioritizedWrittenFile && b !== prioritizedWrittenFile) return -1;
    if (b === prioritizedWrittenFile && a !== prioritizedWrittenFile) return 1;
    return a.localeCompare(b);
  });

  const blocks: string[] = [];
  let totalLines = 0;

  for (const file of orderedFiles) {
    if (totalLines >= maxTotalLines) {
      break;
    }

    const filtered = filterBySeverity(
      allDiagnostics[file] ?? [],
      includeSeverities,
    );
    const deduped = deduplicateDiagnostics(filtered);
    const sorted = [...deduped].sort((a, b) => {
      if (a.line !== b.line) {
        return a.line - b.line;
      }
      return a.column - b.column;
    });

    if (sorted.length === 0) {
      continue;
    }

    const remainingTotal = maxTotalLines - totalLines;
    const includeCount = Math.min(
      maxDiagnosticsPerFile,
      remainingTotal,
      sorted.length,
    );
    const included = sorted.slice(0, includeCount);

    blocks.push(`<diagnostics file="${file}">`);
    for (const diagnostic of included) {
      blocks.push(formatDiagnosticLine(diagnostic));
    }

    const overflow = sorted.length - includeCount;
    if (overflow > 0) {
      const lastHiddenDiagnostic = sorted[sorted.length - 1];
      blocks.push(
        `... and ${overflow} more (last: ${formatDiagnosticLine(lastHiddenDiagnostic)})`,
      );
    }

    blocks.push('</diagnostics>');
    totalLines += included.length;
  }

  return blocks.join('\n');
}
