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
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
} from '../config/models.js';
import { UserTierId } from '../code_assist/types.js';
import { getErrorStatus, STREAM_INTERRUPTED_ERROR_CODE } from './retry.js';

// Free Tier message functions
const getRateLimitErrorMessageGoogleFree = (
  fallbackModel: string = DEFAULT_GEMINI_FLASH_MODEL,
) =>
  `\nPossible quota limitations in place or slow response times detected. Switching to the ${fallbackModel} model for the rest of this session.`;

const getRateLimitErrorMessageGoogleProQuotaFree = (
  currentModel: string = DEFAULT_GEMINI_MODEL,
  fallbackModel: string = DEFAULT_GEMINI_FLASH_MODEL,
) =>
  `\nYou have reached your daily ${currentModel} quota limit. You will be switched to the ${fallbackModel} model for the rest of this session. For more information about authentication and quota limits, see https://github.com/vybestack/llxprt-code/blob/main/docs/getting-started.md, or use /auth to switch to using a paid API key from AI Studio at https://aistudio.google.com/apikey`;

const getRateLimitErrorMessageGoogleGenericQuotaFree = () =>
  `\nYou have reached your daily quota limit. For more information about authentication and quota limits, see https://github.com/vybestack/llxprt-code/blob/main/docs/getting-started.md, or use /auth to switch to using a paid API key from AI Studio at https://aistudio.google.com/apikey`;

// Legacy/Standard Tier message functions
const getRateLimitErrorMessageGooglePaid = (
  fallbackModel: string = DEFAULT_GEMINI_FLASH_MODEL,
) =>
  `\nPossible quota limitations in place or slow response times detected. Switching to the ${fallbackModel} model for the rest of this session. We appreciate you for choosing Gemini Code Assist and the Gemini CLI.`;

const getRateLimitErrorMessageGoogleProQuotaPaid = (
  currentModel: string = DEFAULT_GEMINI_MODEL,
  fallbackModel: string = DEFAULT_GEMINI_FLASH_MODEL,
) =>
  `\nYou have reached your daily ${currentModel} quota limit. You will be switched to the ${fallbackModel} model for the rest of this session. We appreciate you for choosing Gemini Code Assist and the Gemini CLI. To continue accessing the ${currentModel} model today, consider using /auth to switch to using a paid API key from AI Studio at https://aistudio.google.com/apikey`;

const getRateLimitErrorMessageGoogleGenericQuotaPaid = (
  currentModel: string = DEFAULT_GEMINI_MODEL,
) =>
  `\nYou have reached your daily quota limit. We appreciate you for choosing Gemini Code Assist and the Gemini CLI. To continue accessing the ${currentModel} model today, consider using /auth to switch to using a paid API key from AI Studio at https://aistudio.google.com/apikey`;

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
  fallbackModel?: string,
): string {
  // Determine if user is on a paid tier (Legacy or Standard) - default to FREE if not specified
  const isPaidTier =
    userTier === UserTierId.LEGACY || userTier === UserTierId.STANDARD;

  if (isProQuotaExceededError(error)) {
    return isPaidTier
      ? getRateLimitErrorMessageGoogleProQuotaPaid(
          currentModel || DEFAULT_GEMINI_MODEL,
          fallbackModel,
        )
      : getRateLimitErrorMessageGoogleProQuotaFree(
          currentModel || DEFAULT_GEMINI_MODEL,
          fallbackModel,
        );
  }

  if (isGenericQuotaExceededError(error)) {
    return isPaidTier
      ? getRateLimitErrorMessageGoogleGenericQuotaPaid(
          currentModel || DEFAULT_GEMINI_MODEL,
        )
      : getRateLimitErrorMessageGoogleGenericQuotaFree();
  }

  return isPaidTier
    ? getRateLimitErrorMessageGooglePaid(fallbackModel)
    : getRateLimitErrorMessageGoogleFree(fallbackModel);
}

export function parseAndFormatApiError(
  error: unknown,
  userTier?: UserTierId,
  currentModel?: string,
  fallbackModel?: string,
): string {
  const errorCode = getErrorCodeFromUnknown(error);
  if (errorCode === STREAM_INTERRUPTED_ERROR_CODE) {
    const baseMessage =
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
      text += getRateLimitMessage(error, userTier, currentModel, fallbackModel);
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
        try {
          // See if the message is a stringified JSON with another error
          const nestedError = JSON.parse(finalMessage) as unknown;
          if (isApiError(nestedError)) {
            finalMessage = nestedError.error.message;
          }
        } catch (_e) {
          // It's not a nested JSON error, so we just use the message as is.
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
        if (parsedError.error.code === 429) {
          text += getRateLimitMessage(
            parsedError,
            userTier,
            currentModel,
            fallbackModel,
          );
        }
        return text;
      }
    } catch (_e) {
      // Not a valid JSON, fall through and return the original message.
    }
    return `[API Error: ${error}]`;
  }

  const fallbackStatusSuffix = buildStatusSuffix(getErrorStatus(error));
  if (fallbackStatusSuffix) {
    return `[API Error: An unknown error occurred.${fallbackStatusSuffix}]`;
  }

  return '[API Error: An unknown error occurred.]';
}
