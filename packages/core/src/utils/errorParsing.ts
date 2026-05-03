/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  isProQuotaExceededError,
  isGenericQuotaExceededError,
  isApiError,
  isStructuredError,
} from './quotaErrorDetection.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { UserTierId } from '../code_assist/types.js';
import { getErrorStatus, STREAM_INTERRUPTED_ERROR_CODE } from './retry.js';

// Shared quota/auth guidance strings
const AUTH_QUOTA_DOC_URL =
  'https://github.com/vybestack/llxprt-code/blob/main/docs/getting-started.md';
const AI_STUDIO_KEY_URL = 'https://aistudio.google.com/apikey';
const FREE_TIER_GUIDANCE = `For more information about authentication and quota limits, see ${AUTH_QUOTA_DOC_URL}, or use /auth to switch to using a paid API key from AI Studio at ${AI_STUDIO_KEY_URL}`;
const PAID_TIER_THANKS =
  'We appreciate you for choosing Gemini Code Assist and the Gemini CLI.';
const PAID_TIER_AUTH_HINT = `consider using /auth to switch to using a paid API key from AI Studio at ${AI_STUDIO_KEY_URL}`;

// Provider-neutral rate limit message (used when no Google-specific quota detector matches)
const GENERIC_RATE_LIMIT_MESSAGE =
  '\nRate limit exceeded. Please wait a moment and retry, or use /model to switch to a different model.';

// Google Free Tier message functions
const getRateLimitErrorMessageGoogleProQuotaFree = (
  currentModel: string = DEFAULT_GEMINI_MODEL,
) =>
  `\nYou have reached your daily ${currentModel} quota limit. ${FREE_TIER_GUIDANCE}`;

const getRateLimitErrorMessageGoogleGenericQuotaFree = () =>
  `\nYou have reached your daily quota limit. ${FREE_TIER_GUIDANCE}`;

// Google Legacy/Standard Tier message functions
const getRateLimitErrorMessageGoogleProQuotaPaid = (
  currentModel: string = DEFAULT_GEMINI_MODEL,
) =>
  `\nYou have reached your daily ${currentModel} quota limit. ${PAID_TIER_THANKS} To continue accessing the ${currentModel} model today, ${PAID_TIER_AUTH_HINT}`;

const getRateLimitErrorMessageGoogleGenericQuotaPaid = (
  currentModel: string = DEFAULT_GEMINI_MODEL,
) =>
  `\nYou have reached your daily quota limit. ${PAID_TIER_THANKS} To continue accessing the ${currentModel} model today, ${PAID_TIER_AUTH_HINT}`;

function buildStatusSuffix(status?: number, statusLabel?: string): string {
  const parts: string[] = [];

  if (typeof status === 'number' && Number.isFinite(status)) {
    parts.push(String(status));
  }

  if (typeof statusLabel === 'string') {
    const trimmed = statusLabel.trim();
    if (trimmed.length > 0 && !parts.includes(trimmed)) {
      parts.push(trimmed);
    }
  }

  if (parts.length === 0) {
    return '';
  }

  return ` (Status: ${parts.join(', ')})`;
}

function formatErrorMessageWithStatus(
  message: string,
  status?: number,
  statusLabel?: string,
): string {
  if (message.includes('(Status:')) {
    return message;
  }

  const suffix = buildStatusSuffix(status, statusLabel);
  if (!suffix) {
    return message;
  }

  return `${message}${suffix}`;
}

function getErrorCodeFromUnknown(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    if (
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
    ) {
      return (error as { code: string }).code;
    }

    if (
      // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      'error' in error &&
      typeof (error as { error?: unknown }).error === 'object' &&
      (error as { error?: unknown }).error !== null &&
      'code' in (error as { error?: { code?: unknown } }).error! &&
      typeof (
        (error as { error?: { code?: unknown } }).error as {
          code?: unknown;
        }
      ).code === 'string'
    ) {
      return (
        (error as { error?: { code?: unknown } }).error as {
          code?: string;
        }
      ).code;
    }
  }
  return undefined;
}

function getRateLimitMessage(
  error?: unknown,
  userTier?: UserTierId,
  currentModel?: string,
): string {
  // Determine if user is on a paid tier (Legacy or Standard) - default to FREE if not specified
  const isPaidTier =
    userTier === UserTierId.LEGACY || userTier === UserTierId.STANDARD;

  if (isProQuotaExceededError(error)) {
    return isPaidTier
      ? getRateLimitErrorMessageGoogleProQuotaPaid(
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: string fallback for model name
          currentModel || DEFAULT_GEMINI_MODEL,
        )
      : getRateLimitErrorMessageGoogleProQuotaFree(
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: string fallback for model name
          currentModel || DEFAULT_GEMINI_MODEL,
        );
  }

  if (isGenericQuotaExceededError(error)) {
    return isPaidTier
      ? getRateLimitErrorMessageGoogleGenericQuotaPaid(
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: string fallback for model name
          currentModel || DEFAULT_GEMINI_MODEL,
        )
      : getRateLimitErrorMessageGoogleGenericQuotaFree();
  }

  return GENERIC_RATE_LIMIT_MESSAGE;
}

export function parseAndFormatApiError(
  error: unknown,
  userTier?: UserTierId,
  currentModel?: string,
): string {
  const errorCode = getErrorCodeFromUnknown(error);
  if (errorCode === STREAM_INTERRUPTED_ERROR_CODE) {
    const baseMessage =
      // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'Streaming parse error: model response contained malformed data.';
    const formattedMessage = formatErrorMessageWithStatus(
      baseMessage,
      undefined,
      'STREAM_INTERRUPTED',
    );
    return `[API Error: ${formattedMessage}]\nStreaming data from the provider became invalid before the response completed. Please retry.`;
  }

  if (isStructuredError(error)) {
    const status = getErrorStatus(error);
    let text = `[API Error: ${formatErrorMessageWithStatus(error.message, status)}]`;
    if (status === 429) {
      text += getRateLimitMessage(error, userTier, currentModel);
    }
    return text;
  }

  // The error message might be a string containing a JSON object.
  if (typeof error === 'string') {
    const jsonStart = error.indexOf('{');
    if (jsonStart === -1) {
      return `[API Error: ${error}]`; // Not a JSON error, return as is.
    }

    const jsonString = error.substring(jsonStart);

    try {
      const parsedError = JSON.parse(jsonString) as unknown;
      if (isApiError(parsedError)) {
        let finalMessage = parsedError.error.message;
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        try {
          // See if the message is a stringified JSON with another error
          const nestedError = JSON.parse(finalMessage) as unknown;
          if (isApiError(nestedError)) {
            finalMessage = nestedError.error.message;
          }
        } catch {
          // Not nested JSON; use message as-is.
        }
        const statusSuffix = buildStatusSuffix(
          typeof parsedError.error.code === 'number'
            ? parsedError.error.code
            : undefined,
          typeof parsedError.error.status === 'string'
            ? parsedError.error.status
            : undefined,
        );
        let text = `[API Error: ${finalMessage}${statusSuffix}]`;
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (parsedError.error.code === 429) {
          text += getRateLimitMessage(parsedError, userTier, currentModel);
        }
        return text;
      }
    } catch {
      // Not valid JSON; fall through to original message.
    }
    return `[API Error: ${error}]`;
  }

  const fallbackStatusSuffix = buildStatusSuffix(getErrorStatus(error));
  if (fallbackStatusSuffix) {
    return `[API Error: An unknown error occurred.${fallbackStatusSuffix}]`;
  }

  return '[API Error: An unknown error occurred.]';
}
