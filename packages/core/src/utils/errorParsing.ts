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
  type ApiError,
} from './quotaErrorDetection.js';
import type { StructuredError } from '../core/turn.js';
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
const GEMINI_RATE_LIMIT_MESSAGE =
  '\nRate limit exceeded. Please wait a moment and retry, or use /model to switch to a different model.';

const getRateLimitErrorMessageAnthropicFree = () =>
  '\nAnthropic rate limit exceeded. LLxprt Code retries rate-limited requests with backoff when possible. Please wait before retrying manually.';

const getRateLimitErrorMessageAnthropicPaid = () =>
  '\nAnthropic rate limit exceeded. LLxprt Code retries rate-limited requests with backoff when possible. Please wait before retrying manually or check your Anthropic plan limits.';

const getRateLimitErrorMessageGeneric = () =>
  '\nRate limit exceeded. LLxprt Code retries rate-limited requests with backoff when possible. Please wait before retrying manually.';

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

    const nestedCode = extractNestedCodeAsString(error);
    if (nestedCode !== undefined) {
      return nestedCode;
    }
  }
  return undefined;
}

function extractNestedCodeAsString(error: object): string | undefined {
  if (!('error' in error)) {
    return undefined;
  }
  const inner = (error as { error?: unknown }).error;
  if (
    typeof inner === 'object' &&
    inner !== null &&
    'code' in inner &&
    typeof (inner as { code?: unknown }).code === 'string'
  ) {
    return (inner as { code: string }).code;
  }
  return undefined;
}

function extractMessageString(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return undefined;
}

function normalizeProviderName(providerName?: string): string | undefined {
  const trimmedProviderName = providerName?.trim().toLowerCase();
  return trimmedProviderName === '' ? undefined : trimmedProviderName;
}

function getProviderFamily(
  providerName?: string,
  currentModel?: string,
): string | undefined {
  const normalizedProviderName = normalizeProviderName(providerName);
  if (normalizedProviderName === undefined) {
    return undefined;
  }

  if (normalizedProviderName === 'gemini') {
    return normalizedProviderName;
  }

  const normalizedModelName = currentModel?.trim().toLowerCase() ?? '';
  if (
    normalizedProviderName.includes('anthropic') ||
    normalizedModelName.startsWith('anthropic:') ||
    normalizedModelName.startsWith('claude')
  ) {
    return 'anthropic';
  }

  return normalizedProviderName;
}

function getRateLimitMessage(
  error?: unknown,
  userTier?: UserTierId,
  currentModel?: string,
  providerName?: string,
): string {
  // Determine if user is on a paid tier (Legacy or Standard) - default to FREE if not specified
  const isPaidTier =
    userTier === UserTierId.LEGACY || userTier === UserTierId.STANDARD;
  const providerFamily = getProviderFamily(providerName, currentModel);

  if (providerFamily === 'anthropic') {
    return isPaidTier
      ? getRateLimitErrorMessageAnthropicPaid()
      : getRateLimitErrorMessageAnthropicFree();
  }

  if (providerFamily !== undefined && providerFamily !== 'gemini') {
    return getRateLimitErrorMessageGeneric();
  }

  const effectiveModel =
    currentModel === undefined || currentModel === ''
      ? DEFAULT_GEMINI_MODEL
      : currentModel;

  if (isProQuotaExceededError(error)) {
    return isPaidTier
      ? getRateLimitErrorMessageGoogleProQuotaPaid(effectiveModel)
      : getRateLimitErrorMessageGoogleProQuotaFree(effectiveModel);
  }

  if (isGenericQuotaExceededError(error)) {
    return isPaidTier
      ? getRateLimitErrorMessageGoogleGenericQuotaPaid(effectiveModel)
      : getRateLimitErrorMessageGoogleGenericQuotaFree();
  }

  return GEMINI_RATE_LIMIT_MESSAGE;
}

function formatStreamInterruptedError(error: unknown): string {
  const baseMessage =
    extractMessageString(error) ??
    'Streaming parse error: model response contained malformed data.';
  const formattedMessage = formatErrorMessageWithStatus(
    baseMessage,
    undefined,
    'STREAM_INTERRUPTED',
  );
  return `[API Error: ${formattedMessage}]\nStreaming data from the provider became invalid before the response completed. Please retry.`;
}

function formatStructuredApiError(
  error: StructuredError,
  userTier?: UserTierId,
  currentModel?: string,
  providerName?: string,
): string {
  const status = getErrorStatus(error);
  let text = `[API Error: ${formatErrorMessageWithStatus(error.message, status)}]`;
  if (status === 429) {
    text += getRateLimitMessage(error, userTier, currentModel, providerName);
  }
  return text;
}

function formatStringApiError(
  error: string,
  userTier?: UserTierId,
  currentModel?: string,
  providerName?: string,
): string {
  const jsonStart = error.indexOf('{');
  if (jsonStart === -1) {
    return `[API Error: ${error}]`;
  }

  const parsedMessage = formatEmbeddedJsonApiError(
    error.substring(jsonStart),
    userTier,
    currentModel,
    providerName,
  );
  return parsedMessage ?? `[API Error: ${error}]`;
}

function formatEmbeddedJsonApiError(
  jsonString: string,
  userTier?: UserTierId,
  currentModel?: string,
  providerName?: string,
): string | undefined {
  const parsedError = parseApiErrorJson(jsonString);
  if (parsedError === undefined) {
    return undefined;
  }

  const finalMessage = extractNestedApiErrorMessage(parsedError.error.message);
  const statusSuffix = buildStatusSuffix(
    typeof parsedError.error.code === 'number'
      ? parsedError.error.code
      : undefined,
    typeof parsedError.error.status === 'string'
      ? parsedError.error.status
      : undefined,
  );
  let text = `[API Error: ${finalMessage}${statusSuffix}]`;
  if (isRateLimitApiError(parsedError)) {
    text += getRateLimitMessage(
      parsedError,
      userTier,
      currentModel,
      providerName,
    );
  }
  return text;
}

function isRateLimitApiError(error: ApiError): boolean {
  if (error.error.code === 429) {
    return true;
  }

  if (
    error.error.status === 'RESOURCE_EXHAUSTED' ||
    error.error.status === 'rate_limit_error'
  ) {
    return true;
  }

  return 'type' in error.error && error.error.type === 'rate_limit_error';
}

function parseApiErrorJson(jsonString: string): ApiError | undefined {
  try {
    const parsedError = JSON.parse(jsonString) as unknown;
    return isApiError(parsedError) ? parsedError : undefined;
  } catch {
    return undefined;
  }
}

function extractNestedApiErrorMessage(message: string): string {
  try {
    const nestedError = JSON.parse(message) as unknown;
    return isApiError(nestedError) ? nestedError.error.message : message;
  } catch {
    return message;
  }
}

export function parseAndFormatApiError(
  error: unknown,
  userTier?: UserTierId,
  currentModel?: string,
  providerName?: string,
): string {
  const errorCode = getErrorCodeFromUnknown(error);
  if (errorCode === STREAM_INTERRUPTED_ERROR_CODE) {
    return formatStreamInterruptedError(error);
  }

  if (isStructuredError(error)) {
    return formatStructuredApiError(
      error,
      userTier,
      currentModel,
      providerName,
    );
  }

  if (typeof error === 'string') {
    return formatStringApiError(error, userTier, currentModel, providerName);
  }

  const fallbackStatus = getErrorStatus(error);
  const fallbackStatusSuffix = buildStatusSuffix(fallbackStatus);
  if (fallbackStatusSuffix) {
    let text = `[API Error: An unknown error occurred.${fallbackStatusSuffix}]`;
    if (fallbackStatus === 429) {
      text += getRateLimitMessage(error, userTier, currentModel, providerName);
    }
    return text;
  }

  return '[API Error: An unknown error occurred.]';
}
