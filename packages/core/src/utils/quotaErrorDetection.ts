/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type StructuredError } from '../core/turn.js';

export interface ApiError {
  error: {
    code: number;
    message: string;
    status: string;
    details: unknown[];
  };
}

export function isApiError(error: unknown): error is ApiError {
  return (
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof (error as ApiError).error === 'object' &&
    'message' in (error as ApiError).error
  );
}

export function isStructuredError(error: unknown): error is StructuredError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as StructuredError).message === 'string'
  );
}

export function isProQuotaExceededError(error: unknown): boolean {
  // Check for Pro quota exceeded errors by looking for the specific pattern
  // This will match patterns like:
  // - "Quota exceeded for quota metric 'Gemini 2.5 Pro Requests'"
  // - "Quota exceeded for quota metric 'Gemini 2.5-preview Pro Requests'"
  // We use string methods instead of regex to avoid ReDoS vulnerabilities

  const checkMessage = (message: string): boolean =>
    message.includes("Quota exceeded for quota metric 'Gemini") &&
    message.includes("Pro Requests'");

  if (typeof error === 'string') {
    return checkMessage(error);
  }

  if (isStructuredError(error)) {
    return checkMessage(error.message);
  }

  if (isApiError(error)) {
    return checkMessage(error.error.message);
  }

  // Check if it's a Gaxios error with response data
  if (
    error !== null &&
    error !== undefined &&
    typeof error === 'object' &&
    'response' in error
  ) {
    const gaxiosError = error as {
      response?: {
        data?: unknown;
      };
    };
    const responseData = gaxiosError.response?.data;
    if (responseData !== undefined && responseData !== null) {
      if (typeof responseData === 'string') {
        return checkMessage(responseData);
      }
      if (typeof responseData === 'object' && 'error' in responseData) {
        const errorData = responseData as {
          error?: { message?: string };
        };
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: error message may be empty string, should still check
        return checkMessage(errorData.error?.message || '');
      }
    }
  }
  return false;
}

export function isGenericQuotaExceededError(error: unknown): boolean {
  if (typeof error === 'string') {
    return error.includes('Quota exceeded for quota metric');
  }

  if (isStructuredError(error)) {
    return error.message.includes('Quota exceeded for quota metric');
  }

  if (isApiError(error)) {
    return error.error.message.includes('Quota exceeded for quota metric');
  }

  return false;
}
