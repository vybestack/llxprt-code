import {
  type Config,
  parseAndFormatApiError,
  OutputFormat,
  JsonFormatter,
  StreamJsonFormatter,
  JsonStreamEventType,
  writeToStderr,
} from '@vybestack/llxprt-code-core';

export function formatNonInteractiveError(error: unknown): string {
  const formatted = parseAndFormatApiError(error);
  if (formatted && !formatted.includes('[object Object]')) {
    return formatted;
  }

  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (error !== null && typeof error === 'object') {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

function normalizeErrorForJson(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(formatNonInteractiveError(error));
}

/**
 * Format and report a non-interactive error to stderr, using JSON formatters
 * when JSON output is configured. Extracted so both the auth-validation catch
 * and the run-phase catch share a single error-reporting path.
 */
export function reportNonInteractiveError(
  config: Config,
  error: unknown,
): void {
  const outputFormat = config.getOutputFormat();
  if (outputFormat === OutputFormat.JSON) {
    const formatter = new JsonFormatter();
    const normalizedError = normalizeErrorForJson(error);
    // Omit the optional error-code argument: JsonFormatter.formatError's
    // second parameter is an application error code with no documented value,
    // not a process exit status. Hardcoding 1 would conflate exit status with
    // an error code in the JSON envelope. The trailing newline is explicit so
    // the output is unambiguous newline-delimited JSON.
    writeToStderr(`${formatter.formatError(normalizedError)}\n`);
  } else if (outputFormat === OutputFormat.STREAM_JSON) {
    const streamFormatter = new StreamJsonFormatter();
    writeToStderr(
      streamFormatter.formatEvent({
        type: JsonStreamEventType.ERROR,
        timestamp: new Date().toISOString(),
        severity: 'error',
        message: formatNonInteractiveError(error),
      }),
    );
  } else {
    const printableError = formatNonInteractiveError(error);
    writeToStderr(`Non-interactive run failed: ${printableError}\n`);
  }
}
