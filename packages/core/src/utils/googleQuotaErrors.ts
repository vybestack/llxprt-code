/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ErrorInfo,
  GoogleApiError,
  QuotaFailure,
  RetryInfo,
} from './googleErrors.js';
import { parseGoogleApiError } from './googleErrors.js';
import { getErrorStatus, ModelNotFoundError } from './retry.js';

/**
 * A non-retryable error indicating a hard quota limit has been reached (e.g., daily limit).
 */
export class TerminalQuotaError extends Error {
  retryDelayMs?: number;
  readonly cause: GoogleApiError;

  constructor(
    message: string,
    cause: GoogleApiError,
    retryDelaySeconds?: number,
  ) {
    super(message);
    this.name = 'TerminalQuotaError';
    this.cause = cause;
    this.retryDelayMs =
      retryDelaySeconds !== undefined &&
      retryDelaySeconds !== 0 &&
      !Number.isNaN(retryDelaySeconds)
        ? retryDelaySeconds * 1000
        : undefined;
  }
}

/**
 * A retryable error indicating a temporary quota issue (e.g., per-minute limit).
 */
export class RetryableQuotaError extends Error {
  retryDelayMs?: number;
  readonly cause: GoogleApiError;

  constructor(
    message: string,
    cause: GoogleApiError,
    retryDelaySeconds?: number,
  ) {
    super(message);
    this.name = 'RetryableQuotaError';
    this.cause = cause;
    this.retryDelayMs =
      retryDelaySeconds !== undefined &&
      retryDelaySeconds !== 0 &&
      !Number.isNaN(retryDelaySeconds)
        ? retryDelaySeconds * 1000
        : undefined;
  }
}

/**
 * Parses a duration string (e.g., "34.074824224s", "60s", "900ms") and returns the time in seconds.
 * @param duration The duration string to parse.
 * @returns The duration in seconds, or null if parsing fails.
 */
function parseDurationInSeconds(duration: string): number | null {
  if (duration.endsWith('ms')) {
    const milliseconds = parseFloat(duration.slice(0, -2));
    return isNaN(milliseconds) ? null : milliseconds / 1000;
  }
  if (duration.endsWith('s')) {
    const seconds = parseFloat(duration.slice(0, -1));
    return isNaN(seconds) ? null : seconds;
  }
  return null;
}

interface QuotaContext {
  quotaFailure: QuotaFailure | undefined;
  errorInfo: ErrorInfo | undefined;
  retryInfo: RetryInfo | undefined;
}

function isValidDelay(delaySeconds: number | null): delaySeconds is number {
  return (
    delaySeconds !== null && delaySeconds !== 0 && !Number.isNaN(delaySeconds)
  );
}

function createFallbackGoogleApiError(message: string): GoogleApiError {
  return {
    code: 429,
    message,
    details: [],
  };
}

function getErrorMessage(
  error: unknown,
  googleApiError: GoogleApiError | null | undefined,
): string {
  return (
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty error message should fall through to stringified error
    googleApiError?.message ||
    (error instanceof Error ? error.message : String(error))
  );
}

function createModelNotFoundError(
  error: unknown,
  googleApiError: GoogleApiError | null | undefined,
  status: number,
): ModelNotFoundError {
  const message =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty error message should fall through to generic message
    googleApiError?.message ||
    (error instanceof Error ? error.message : 'Model not found');
  return new ModelNotFoundError(message, status);
}

function hasStructuredQuotaDetails(
  googleApiError: GoogleApiError | null | undefined,
): googleApiError is GoogleApiError {
  return (
    googleApiError !== null &&
    googleApiError !== undefined &&
    googleApiError.code === 429 &&
    googleApiError.details.length > 0
  );
}

function classifyFallbackQuotaError(
  error: unknown,
  googleApiError: GoogleApiError | null | undefined,
  status: number | undefined,
): unknown {
  const errorMessage = getErrorMessage(error, googleApiError);
  const match = errorMessage.match(/Please retry in ([0-9.]+(?:ms|s))/);
  if (match?.[1]) {
    const retryDelaySeconds = parseDurationInSeconds(match[1]);
    if (retryDelaySeconds !== null) {
      return new RetryableQuotaError(
        errorMessage,
        googleApiError ?? createFallbackGoogleApiError(errorMessage),
        retryDelaySeconds,
      );
    }
  } else if (status === 429) {
    return new RetryableQuotaError(
      errorMessage,
      googleApiError ?? createFallbackGoogleApiError(errorMessage),
    );
  }

  return error;
}

function buildQuotaContext(googleApiError: GoogleApiError): QuotaContext {
  return {
    quotaFailure: googleApiError.details.find(
      (d): d is QuotaFailure =>
        d['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure',
    ),
    errorInfo: googleApiError.details.find(
      (d): d is ErrorInfo =>
        d['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo',
    ),
    retryInfo: googleApiError.details.find(
      (d): d is RetryInfo =>
        d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo',
    ),
  };
}

function hasQuotaLimit(
  quotaFailure: QuotaFailure | undefined,
  keywords: string[],
): boolean {
  return (
    quotaFailure?.violations.some((violation) => {
      const quotaId = violation.quotaId ?? '';
      return keywords.some((keyword) => quotaId.includes(keyword));
    }) === true
  );
}

function metadataQuotaLimit(errorInfo: ErrorInfo | undefined): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Google quota errors are external provider payloads despite declared types.
  return errorInfo?.metadata?.['quota_limit'] ?? '';
}

function classifyCloudCodeQuota(
  googleApiError: GoogleApiError,
  errorInfo: ErrorInfo,
  retryInfo: RetryInfo | undefined,
): TerminalQuotaError | RetryableQuotaError | undefined {
  const validDomains = [
    'cloudcode-pa.googleapis.com',
    'staging-cloudcode-pa.googleapis.com',
    'autopush-cloudcode-pa.googleapis.com',
  ];
  if (!validDomains.includes(errorInfo.domain)) {
    return undefined;
  }

  if (errorInfo.reason === 'RATE_LIMIT_EXCEEDED') {
    const parsedDelay = retryInfo?.retryDelay
      ? parseDurationInSeconds(retryInfo.retryDelay)
      : null;
    return new RetryableQuotaError(
      `${googleApiError.message}`,
      googleApiError,
      isValidDelay(parsedDelay) ? parsedDelay : 10,
    );
  }

  if (errorInfo.reason === 'QUOTA_EXHAUSTED') {
    return new TerminalQuotaError(`${googleApiError.message}`, googleApiError);
  }

  return undefined;
}

function classifyLongTermQuota(
  googleApiError: GoogleApiError,
  context: QuotaContext,
): TerminalQuotaError | RetryableQuotaError | undefined {
  if (hasQuotaLimit(context.quotaFailure, ['PerDay', 'Daily'])) {
    return new TerminalQuotaError(
      `You have exhausted your daily quota on this model.`,
      googleApiError,
    );
  }

  if (context.errorInfo !== undefined) {
    const cloudCodeQuota = classifyCloudCodeQuota(
      googleApiError,
      context.errorInfo,
      context.retryInfo,
    );
    if (cloudCodeQuota !== undefined) {
      return cloudCodeQuota;
    }
    const quotaLimit = metadataQuotaLimit(context.errorInfo);
    if (quotaLimit.includes('PerDay') || quotaLimit.includes('Daily')) {
      return new TerminalQuotaError(
        `You have exhausted your daily quota on this model.`,
        googleApiError,
      );
    }
  }

  return undefined;
}

function classifyRetryDelayQuota(
  googleApiError: GoogleApiError,
  retryInfo: RetryInfo | undefined,
): TerminalQuotaError | RetryableQuotaError | undefined {
  if (retryInfo?.retryDelay === undefined) {
    return undefined;
  }

  const delaySeconds = parseDurationInSeconds(retryInfo.retryDelay);
  if (!isValidDelay(delaySeconds)) {
    return undefined;
  }

  const message = `${googleApiError.message}\nSuggested retry after ${retryInfo.retryDelay}.`;
  return delaySeconds > 120
    ? new TerminalQuotaError(message, googleApiError)
    : new RetryableQuotaError(message, googleApiError, delaySeconds);
}

function classifyShortTermQuota(
  googleApiError: GoogleApiError,
  context: QuotaContext,
): RetryableQuotaError | undefined {
  if (hasQuotaLimit(context.quotaFailure, ['PerMinute'])) {
    return new RetryableQuotaError(
      `${googleApiError.message}\nSuggested retry after 60s.`,
      googleApiError,
      60,
    );
  }

  const quotaLimit = metadataQuotaLimit(context.errorInfo);
  if (quotaLimit.includes('PerMinute')) {
    return new RetryableQuotaError(
      `${context.errorInfo?.reason}\nSuggested retry after 60s.`,
      googleApiError,
      60,
    );
  }

  return undefined;
}

function createDefaultRetryableQuota(
  error: unknown,
  googleApiError: GoogleApiError,
  status: number,
): RetryableQuotaError | unknown {
  if (status !== 429) {
    return error;
  }

  const errorMessage = getErrorMessage(error, googleApiError);
  return new RetryableQuotaError(errorMessage, googleApiError);
}

/**
 * Analyzes a caught error and classifies it as a specific quota-related error if applicable.
 *
 * It decides whether an error is a `TerminalQuotaError` or a `RetryableQuotaError` based on
 * the following logic:
 * - If the error indicates a daily limit, it's a `TerminalQuotaError`.
 * - If the error suggests a retry delay of more than 2 minutes, it's a `TerminalQuotaError`.
 * - If the error suggests a retry delay of 2 minutes or less, it's a `RetryableQuotaError`.
 * - If the error indicates a per-minute limit, it's a `RetryableQuotaError`.
 * - If the error message contains the phrase "Please retry in X[s|ms]", it's a `RetryableQuotaError`.
 *
 * @param error The error to classify.
 * @returns A `TerminalQuotaError`, `RetryableQuotaError`, or the original `unknown` error.
 */
export function classifyGoogleError(error: unknown): unknown {
  const googleApiError = parseGoogleApiError(error);
  const status = googleApiError?.code ?? getErrorStatus(error);

  if (status === undefined) {
    return classifyFallbackQuotaError(error, googleApiError, status);
  }

  if (status === 404) {
    return createModelNotFoundError(error, googleApiError, status);
  }

  if (!hasStructuredQuotaDetails(googleApiError)) {
    return classifyFallbackQuotaError(error, googleApiError, status);
  }

  const context = buildQuotaContext(googleApiError);
  return (
    classifyLongTermQuota(googleApiError, context) ??
    classifyRetryDelayQuota(googleApiError, context.retryInfo) ??
    classifyShortTermQuota(googleApiError, context) ??
    createDefaultRetryableQuota(error, googleApiError, status)
  );
}
