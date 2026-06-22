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

export function parseErrorResponse(
  status: number,
  body: string,
  providerName: string,
): Error {
  // Try to parse JSON error response first
  try {
    const errorData = JSON.parse(body);

    const message = resolveErrorMessage(errorData);

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
    // For invalid JSON, use a consistent format
    const errorPrefix =
      status >= 500 && status < 600 ? 'Server error' : 'API Error';
    const error = new Error(
      `${errorPrefix}: ${providerName} API error: ${status}`,
    );
    (error as { status?: number }).status = status;
    return error;
  }
}
