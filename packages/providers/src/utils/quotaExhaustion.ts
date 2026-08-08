/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getErrorStatus } from '@vybestack/llxprt-code-core/utils/retry.js';

/**
 * OpenAI error codes/types that indicate billing/credit exhaustion. A 429
 * carrying one of these can never succeed on retry — the user must resolve
 * their billing situation first (issue #3140).
 */
export const TERMINAL_QUOTA_CODES = new Set([
  'insufficient_quota',
  'billing_hard_limit_reached',
]);

interface CodeBearingEnvelope {
  code?: unknown;
  type?: unknown;
}

interface ErrorWithCode extends CodeBearingEnvelope {
  error?: CodeBearingEnvelope;
  detail?: CodeBearingEnvelope;
  /**
   * The provider's body-level error `type`, lifted onto a thrown Error by
   * parseErrorResponse. Deliberately NOT named `type`: `isOverloadError` in
   * core reads a bare `type` and treats `api_error` / `rate_limit_error` /
   * `overloaded_error` as retryable, so writing the provider's type to that
   * key would silently reclassify non-429 Responses errors (issue #3140).
   */
  providerErrorType?: unknown;
}

/**
 * Collects every position at which a provider may report an error code or
 * type: the top level, the standard OpenAI `error` envelope, the Codex /
 * ChatGPT-backend `detail` envelope, and the `providerErrorType` field that
 * parseErrorResponse lifts onto thrown errors.
 */
function collectCodeCandidates(errorData: unknown): unknown[] {
  if (typeof errorData !== 'object' || errorData === null) return [];
  const e = errorData as ErrorWithCode;
  return [
    e.code,
    e.type,
    e.providerErrorType,
    e.error?.code,
    e.error?.type,
    e.detail?.code,
    e.detail?.type,
  ];
}

/**
 * Checks whether any code/type field on the parsed error body is a terminal
 * quota code. Shared by {@link isQuotaExhaustionError} (status-gated) and
 * the code-aware quota message prefix in parseErrorResponse.
 */
export function findTerminalQuotaCode(errorData: unknown): string | undefined {
  return collectCodeCandidates(errorData).find(
    (value): value is string =>
      typeof value === 'string' && TERMINAL_QUOTA_CODES.has(value),
  );
}

/**
 * Returns true only when the resolved HTTP status is 429 AND a terminal-quota
 * code is found at any position {@link collectCodeCandidates} inspects.
 *
 * The 429 gate is deliberate: a terminal quota code on a 4xx that is already
 * non-retryable (OpenAI returns `billing_hard_limit_reached` as a 400) needs no
 * further classification, and a code echoed on a 5xx must stay retryable.
 *
 * Internal helper with exactly two production call sites
 * (shouldRetryOnError / shouldRetryError). Not exported from the package index.
 */
export function isQuotaExhaustionError(error: unknown): boolean {
  if (getErrorStatus(error) !== 429) return false;
  return findTerminalQuotaCode(error) !== undefined;
}
