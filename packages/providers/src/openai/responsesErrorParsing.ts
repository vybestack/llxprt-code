/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Error message and prefix resolution for OpenAI Responses API error
 * responses. Extracted from parseResponsesStream.ts to keep that module
 * within the max-lines budget.
 */

function resolveErrorMessage(errorData: unknown): string {
  if (typeof errorData === 'string' && errorData !== '') {
    return errorData;
  }
  if (typeof errorData !== 'object' || errorData === null) {
    return 'Unknown error';
  }
  const obj = errorData as {
    error?: { message?: unknown; description?: unknown };
    message?: unknown;
    description?: unknown;
  };
  if (typeof obj.error?.message === 'string' && obj.error.message !== '') {
    return obj.error.message;
  }
  if (
    typeof obj.error?.description === 'string' &&
    obj.error.description !== ''
  ) {
    return obj.error.description;
  }
  if (typeof obj.message === 'string' && obj.message !== '') {
    return obj.message;
  }
  if (typeof obj.description === 'string' && obj.description !== '') {
    return obj.description;
  }
  return 'Unknown error';
}

function resolveErrorPrefix(status: number): string {
  switch (status) {
    case 409:
      return 'Conflict';
    case 410:
      return 'Gone';
    case 429:
      return 'Rate limit exceeded';
    default:
      if (status >= 400 && status < 500) {
        return 'Client error';
      }
      if (status >= 500 && status < 600) {
        return 'Server error';
      }
      return 'API Error';
  }
}

/**
 * Maximum number of characters from the raw response body included in
 * diagnostic error messages for unstructured / unknown errors.
 */
const MAX_BODY_SNIPPET_LENGTH = 200;

/**
 * Builds a diagnostic message for cases where structured error extraction
 * failed (empty body, empty JSON object, or a body with no recognizable
 * error fields).  This ensures the caller gets a message that includes the
 * HTTP status and a safe body snippet instead of a bare "Unknown error".
 */
function buildDiagnosticMessage(status: number, body: string): string {
  const trimmed = body.trim();
  if (trimmed === '') {
    return `Unknown error (Status: ${status}, empty response body)`;
  }
  const snippet = trimmed.slice(0, MAX_BODY_SNIPPET_LENGTH);
  const ellipsis = trimmed.length > MAX_BODY_SNIPPET_LENGTH ? '...' : '';
  return `Unknown error (Status: ${status}, body: ${snippet}${ellipsis})`;
}

export function parseErrorResponse(
  status: number,
  body: string,
  providerName: string,
): Error {
  // Try to parse JSON error response first
  try {
    const errorData = JSON.parse(body);

    const resolvedMessage = resolveErrorMessage(errorData);
    // When structured extraction fails, enrich the "Unknown error" with
    // status and a safe body snippet so diagnostics are actionable
    // (e.g. issue #2137's bare "Client error: Unknown error").
    const message =
      resolvedMessage === 'Unknown error'
        ? buildDiagnosticMessage(status, body)
        : resolvedMessage;

    // 418 I'm a teapot: return message without prefix
    if (status === 418) {
      const teapotError = new Error(message);
      (teapotError as { status?: number }).status = status;
      (teapotError as { code?: string }).code =
        errorData.error?.code ?? errorData.code;
      return teapotError;
    }

    const errorPrefix = resolveErrorPrefix(status);
    const error = new Error(`${errorPrefix}: ${message}`);
    (error as { status?: number }).status = status;
    (error as { code?: string }).code = errorData.error?.code ?? errorData.code;
    return error;
  } catch {
    // For invalid JSON / empty body, include diagnostic body snippet.
    const errorPrefix =
      status >= 500 && status < 600 ? 'Server error' : 'API Error';
    const detail = buildDiagnosticMessage(status, body);
    const error = new Error(`${errorPrefix}: ${providerName} - ${detail}`);
    (error as { status?: number }).status = status;
    return error;
  }
}
