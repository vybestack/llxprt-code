import {
  type Config,
  getSafeCategory,
  getSafeReason,
  getSafeStatus,
  parseAndFormatApiError,
  OutputFormat,
  JsonFormatter,
  StreamJsonFormatter,
  JsonStreamEventType,
  writeToStderr,
} from '@vybestack/llxprt-code-core';
import {
  getActiveProviderNameForApiError,
  getErrorFallbackModel,
  type ApiErrorRuntimeInfo,
} from '../utils/apiErrorFormatting.js';
import {
  markMachineErrorReported,
  wasMachineErrorReported,
} from './machineErrorReporting.js';

/**
 * Test-injectable write function. Defaults to the real writeToStderr.
 * Tests that need to capture stderr output (without module-level mocking,
 * which is unsupported under Bun's native test runner) can replace this
 * via the exported __setWriteToStderrForTesting seam.
 */
let stderrWriter: (...args: Parameters<typeof writeToStderr>) => boolean =
  writeToStderr;

export function __setWriteToStderrForTesting(
  fn: ((...args: Parameters<typeof writeToStderr>) => boolean) | null,
): void {
  stderrWriter = fn ?? writeToStderr;
}

export function formatNonInteractiveError(
  error: unknown,
  context?: { providerName?: string; model?: string },
): string {
  const formatted = parseAndFormatApiError(
    error,
    context?.model,
    context?.providerName,
  );
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

function normalizeErrorForJson(
  error: unknown,
  context?: { providerName?: string; model?: string },
): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(formatNonInteractiveError(error, context));
}

/**
 * Format and report a non-interactive error to stderr, using JSON formatters
 * when JSON output is configured. Extracted so both the auth-validation catch
 * and the run-phase catch share a single error-reporting path.
 */
export function reportNonInteractiveError(
  config: Pick<Config, 'getOutputFormat'> & ApiErrorRuntimeInfo,
  error: unknown,
): void {
  if (wasMachineErrorReported(error)) return;
  // API-error messages interpolate the active model; the caller's runtime
  // supplies it so no Gemini-named default is needed (#2627).
  const providerName = getActiveProviderNameForApiError(config);
  const errorContext = {
    providerName,
    model: getErrorFallbackModel(config, providerName),
  };
  const outputFormat = config.getOutputFormat();
  if (outputFormat === OutputFormat.JSON) {
    const formatter = new JsonFormatter();
    const normalizedError = normalizeErrorForJson(error, errorContext);
    // Omit the optional error-code argument: JsonFormatter.formatError's
    // second parameter is an application error code with no documented value,
    // not a process exit status. Hardcoding 1 would conflate exit status with
    // an error code in the JSON envelope. The trailing newline is explicit so
    // the output is unambiguous newline-delimited JSON.
    stderrWriter(`${formatter.formatError(normalizedError)}\n`);
  } else if (outputFormat === OutputFormat.STREAM_JSON) {
    const streamFormatter = new StreamJsonFormatter();
    const category = getSafeCategory(error);
    const status = getSafeStatus(error);
    const reason = getSafeReason(error);
    stderrWriter(
      streamFormatter.formatEvent({
        type: JsonStreamEventType.ERROR,
        timestamp: new Date().toISOString(),
        severity: 'error',
        message: formatNonInteractiveError(error, errorContext),
        ...(status !== undefined ? { status } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(reason !== undefined ? { reason } : {}),
      }),
    );
  } else {
    const printableError = formatNonInteractiveError(error, errorContext);
    stderrWriter(`Non-interactive run failed: ${printableError}\n`);
  }
  if (error instanceof Error) markMachineErrorReported(error);
}
