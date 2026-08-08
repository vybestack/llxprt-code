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

import { findTerminalQuotaCode } from '../utils/quotaExhaustion.js';

interface ErrorWithResponse extends Error {
  status?: number;
  code?: string;
  /**
   * The provider's body-level error `type`. Deliberately NOT written to a bare
   * `type` key: `isOverloadError` in core reads `type` and treats `api_error`,
   * `rate_limit_error`, and `overloaded_error` as retryable, so a plain `type`
   * would silently make a Responses 403 or 404 retryable and reverse the
   * "403 is never retried" invariant from issue #2917 (issue #3140).
   */
  providerErrorType?: string;
  response?: { status: number; headers?: Record<string, string>; body: string };
}

interface OpenAIErrorBody {
  code?: unknown;
  type?: unknown;
  error?: { code?: unknown; type?: unknown };
  detail?: { code?: unknown; type?: unknown };
}

function readStringField(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * OpenAI reports the same condition under `code` on some payloads and `type`
 * on others, at the top level, under the standard `error` envelope, or under
 * the Codex/ChatGPT-backend `detail` envelope. Both fields are lifted onto the
 * thrown error so downstream classification sees whichever the provider sent.
 */
function resolveErrorCodeAndType(errorData: unknown): {
  code: string | undefined;
  type: string | undefined;
} {
  if (typeof errorData !== 'object' || errorData === null) {
    return { code: undefined, type: undefined };
  }
  const body = errorData as OpenAIErrorBody;
  return {
    code:
      readStringField(body.error?.code) ??
      readStringField(body.detail?.code) ??
      readStringField(body.code),
    type:
      readStringField(body.error?.type) ??
      readStringField(body.detail?.type) ??
      readStringField(body.type),
  };
}

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

const QUOTA_PREFIX = 'Quota or billing limit exhausted';

/**
 * The quota prefix is chosen by error code rather than status because OpenAI
 * returns `billing_hard_limit_reached` as a 400 and `insufficient_quota` as a
 * 429; both require the same user action (issue #3140).
 */
function resolveErrorPrefix(status: number, isQuotaExhausted = false): string {
  if (isQuotaExhausted) return QUOTA_PREFIX;
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
 * Suffix appended to quota-exhaustion 429 messages so the user knows retrying
 * cannot help and that billing/quota must be resolved (issue #3140).
 */
const QUOTA_RETRY_SUFFIX =
  '. Retrying will not help — resolve your quota or billing limits';

/**
 * Attaches status, code, and the raw response envelope to an error. The
 * `response` object is the single seam that exposes Retry-After headers and
 * the raw body to the retry layers and the error-response dump (issue #3140).
 */
function attachErrorMetadata(
  error: Error,
  status: number,
  errorData: unknown,
  headers: Record<string, string> | undefined,
  body: string,
): ErrorWithResponse {
  const { code, type } = resolveErrorCodeAndType(errorData);
  const enriched = error as ErrorWithResponse;
  enriched.status = status;
  if (code !== undefined) enriched.code = code;
  if (type !== undefined) enriched.providerErrorType = type;
  enriched.response = { status, headers, body };
  return enriched;
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
  headers?: Record<string, string>,
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
      return attachErrorMetadata(
        new Error(message),
        status,
        errorData,
        headers,
        body,
      );
    }

    const isQuotaExhausted = findTerminalQuotaCode(errorData) !== undefined;
    const errorPrefix = resolveErrorPrefix(status, isQuotaExhausted);
    const quotaSuffix = isQuotaExhausted ? QUOTA_RETRY_SUFFIX : '';
    const error = new Error(`${errorPrefix}: ${message}${quotaSuffix}`);
    return attachErrorMetadata(error, status, errorData, headers, body);
  } catch {
    // For invalid JSON / empty body, include diagnostic body snippet.
    const errorPrefix = resolveErrorPrefix(status);
    const detail = buildDiagnosticMessage(status, body);
    const error = new Error(`${errorPrefix}: ${providerName} - ${detail}`);
    return attachErrorMetadata(error, status, undefined, headers, body);
  }
}
