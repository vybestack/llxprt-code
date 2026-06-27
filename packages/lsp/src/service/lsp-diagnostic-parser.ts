import {
  normalizeLspDiagnostic,
  type Diagnostic,
  type RawLspDiagnostic,
} from './diagnostics.js';

const EMPTY_DIAGNOSTICS: Diagnostic[] = [];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isRawDiagnosticCode = (value: unknown): value is string | number =>
  typeof value === 'string' || isFiniteNumber(value);

const toRawDiagnostic = (value: unknown): RawLspDiagnostic | null => {
  if (!isRecord(value) || typeof value.message !== 'string') {
    return null;
  }

  const range = value.range;
  if (!isRecord(range)) {
    return null;
  }

  const start = range.start;
  if (
    !isRecord(start) ||
    !isFiniteNumber(start.line) ||
    !isFiniteNumber(start.character)
  ) {
    return null;
  }

  const severity = isFiniteNumber(value.severity) ? value.severity : undefined;
  const code = isRawDiagnosticCode(value.code) ? value.code : undefined;

  return {
    message: value.message,
    ...(typeof severity === 'number' ? { severity } : {}),
    ...(code !== undefined ? { code } : {}),
    range: {
      start: {
        line: start.line,
        character: start.character,
      },
    },
  };
};

export const isPublishDiagnosticsParams = (
  value: unknown,
): value is { readonly uri: string; readonly diagnostics?: unknown[] } =>
  isRecord(value) &&
  typeof value.uri === 'string' &&
  (value.diagnostics === undefined || Array.isArray(value.diagnostics));

export function parsePublishDiagnostics(
  rawDiagnostics: unknown[] | undefined,
  file: string,
  workspaceRoot: string,
): Diagnostic[] {
  if (!Array.isArray(rawDiagnostics)) {
    return EMPTY_DIAGNOSTICS;
  }
  return rawDiagnostics.flatMap((raw) => {
    const diagnostic = toRawDiagnostic(raw);
    return diagnostic
      ? [normalizeLspDiagnostic(diagnostic, file, workspaceRoot)]
      : [];
  });
}
