/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview
 * This file contains types and functions for parsing structured Google API errors.
 */

/**
 * Based on google/rpc/error_details.proto
 */

export interface ErrorInfo {
  '@type': 'type.googleapis.com/google.rpc.ErrorInfo';
  reason: string;
  domain: string;
  metadata: { [key: string]: string };
}

export interface RetryInfo {
  '@type': 'type.googleapis.com/google.rpc.RetryInfo';
  retryDelay: string; // e.g. "51820.638305887s"
}

export interface DebugInfo {
  '@type': 'type.googleapis.com/google.rpc.DebugInfo';
  stackEntries: string[];
  detail: string;
}

export interface QuotaFailure {
  '@type': 'type.googleapis.com/google.rpc.QuotaFailure';
  violations: Array<{
    subject?: string;
    description?: string;
    apiService?: string;
    quotaMetric?: string;
    quotaId?: string;
    quotaDimensions?: { [key: string]: string };
    quotaValue?: string | number;
    futureQuotaValue?: number;
  }>;
}

export interface PreconditionFailure {
  '@type': 'type.googleapis.com/google.rpc.PreconditionFailure';
  violations: Array<{
    type: string;
    subject: string;
    description: string;
  }>;
}

export interface LocalizedMessage {
  '@type': 'type.googleapis.com/google.rpc.LocalizedMessage';
  locale: string;
  message: string;
}

export interface BadRequest {
  '@type': 'type.googleapis.com/google.rpc.BadRequest';
  fieldViolations: Array<{
    field: string;
    description: string;
    reason?: string;
    localizedMessage?: LocalizedMessage;
  }>;
}

export interface RequestInfo {
  '@type': 'type.googleapis.com/google.rpc.RequestInfo';
  requestId: string;
  servingData: string;
}

export interface ResourceInfo {
  '@type': 'type.googleapis.com/google.rpc.ResourceInfo';
  resourceType: string;
  resourceName: string;
  owner: string;
  description: string;
}

export interface Help {
  '@type': 'type.googleapis.com/google.rpc.Help';
  links: Array<{
    description: string;
    url: string;
  }>;
}

export type GoogleApiErrorDetail =
  | ErrorInfo
  | RetryInfo
  | DebugInfo
  | QuotaFailure
  | PreconditionFailure
  | BadRequest
  | RequestInfo
  | ResourceInfo
  | Help
  | LocalizedMessage;

export interface GoogleApiError {
  code: number;
  message: string;
  details: GoogleApiErrorDetail[];
}

type ErrorShape = {
  message?: string;
  details?: unknown[];
  code?: number;
};

/**
 * Parses an error object to check if it's a structured Google API error
 * and extracts all details.
 *
 * This function can handle two formats:
 * 1. Standard Google API errors where `details` is a top-level field.
 * 2. Errors where the entire structured error object is stringified inside
 *    the `message` field of a wrapper error.
 *
 * @param error The error object to inspect.
 * @returns A GoogleApiError object if the error matches, otherwise null.
 */
export function parseGoogleApiError(error: unknown): GoogleApiError | null {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions -- Preserve original falsy short-circuit for malformed error inputs.
  if (!error) {
    return null;
  }

  let errorObj: unknown = error;

  // If error is a string, try to parse it.
  if (typeof errorObj === 'string') {
    try {
      errorObj = JSON.parse(errorObj);
    } catch {
      // Not a JSON string, can't parse.
      return null;
    }
  }

  if (Array.isArray(errorObj) && errorObj.length > 0) {
    errorObj = errorObj[0];
  }

  if (typeof errorObj !== 'object' || errorObj === null) {
    return null;
  }

  const currentError = resolveNestedError(
    fromGaxiosError(errorObj) ?? fromApiError(errorObj),
  );

  return buildGoogleApiError(currentError);
}

function parseNestedMessage(message: string): ErrorShape | undefined {
  try {
    const parsedMessage = JSON.parse(
      message.replace(/\u00A0/g, '').replace(/\n/g, ' '),
    );
    if (
      // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      typeof parsedMessage === 'object' &&
      parsedMessage !== null &&
      'error' in parsedMessage &&
      parsedMessage.error !== undefined &&
      parsedMessage.error !== null
    ) {
      return parsedMessage.error as ErrorShape;
    }
  } catch {
    // Not a JSON string; drilling complete.
  }
  return undefined;
}

function resolveNestedError(
  initialError: ErrorShape | undefined,
): ErrorShape | undefined {
  let currentError = initialError;
  let depth = 0;
  const maxDepth = 10;

  while (
    currentError !== undefined &&
    typeof currentError.message === 'string' &&
    depth < maxDepth
  ) {
    const parsedError = parseNestedMessage(currentError.message);
    if (parsedError === undefined) {
      return currentError;
    }
    currentError = parsedError;
    depth++;
  }

  return currentError;
}

function normalizeGoogleApiDetail(
  detail: unknown,
): GoogleApiErrorDetail | undefined {
  if (detail === null || detail === undefined || typeof detail !== 'object') {
    return undefined;
  }

  const detailObj = detail as Record<string, unknown>;
  const typeKey = Object.keys(detailObj).find((key) => key.trim() === '@type');
  if (typeKey === undefined) {
    return undefined;
  }

  if (typeKey !== '@type') {
    detailObj['@type'] = detailObj[typeKey];
    delete detailObj[typeKey];
  }
  // We can just cast it; the consumer will have to switch on @type
  return detailObj as unknown as GoogleApiErrorDetail;
}

function normalizeGoogleApiDetails(
  errorDetails: unknown[] | undefined,
): GoogleApiErrorDetail[] {
  if (!Array.isArray(errorDetails)) {
    return [];
  }

  return errorDetails.flatMap((detail) => {
    const normalizedDetail = normalizeGoogleApiDetail(detail);
    return normalizedDetail === undefined ? [] : [normalizedDetail];
  });
}

function buildGoogleApiError(
  currentError: ErrorShape | undefined,
): GoogleApiError | null {
  if (currentError === undefined) {
    return null;
  }

  const { code, message, details: errorDetails } = currentError;
  if (
    typeof code !== 'number' ||
    Number.isNaN(code) ||
    typeof message !== 'string' ||
    message === ''
  ) {
    return null;
  }

  return {
    code,
    message,
    details: normalizeGoogleApiDetails(errorDetails),
  };
}

function fromGaxiosError(errorObj: object): ErrorShape | undefined {
  const gaxiosError = errorObj as {
    response?: {
      status?: number;
      data?:
        | {
            error?: ErrorShape;
          }
        | string;
    };
    error?: ErrorShape;
    code?: number;
  };

  let outerError: ErrorShape | undefined;
  // External data boundary: gaxios error response data from Google API may have unexpected shapes at runtime
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions -- Preserve original falsy fallback for external response data.
  if (gaxiosError.response?.data) {
    let data = gaxiosError.response.data;

    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        // Not a JSON string, can't parse.
      }
    }

    if (Array.isArray(data) && data.length > 0) {
      data = data[0];
    }

    if (typeof data === 'object' && 'error' in data) {
      outerError = (data as { error?: ErrorShape }).error;
    }
  }

  // External data boundary: outerError may be undefined after parsing attempts, and gaxiosError.error comes from external API
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (outerError === undefined || outerError === null) {
    // If the gaxios structure isn't there, check for a top-level `error` property.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (gaxiosError.error !== undefined && gaxiosError.error !== null) {
      outerError = gaxiosError.error;
    } else {
      return undefined;
    }
  }
  return outerError;
}

function fromApiError(errorObj: object): ErrorShape | undefined {
  const apiError = errorObj as {
    message?:
      | {
          error?: ErrorShape;
        }
      | string;
    code?: number;
  };

  let outerError: ErrorShape | undefined;
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions -- Preserve original falsy fallback for external API error messages.
  if (apiError.message) {
    let data = apiError.message;

    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        // Not a JSON string, can't parse.
        const stringData = String(data);

        // Try one more fallback: look for the first '{' and last '}'
        const firstBrace = stringData.indexOf('{');
        const lastBrace = stringData.lastIndexOf('}');
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          try {
            data = JSON.parse(stringData.substring(firstBrace, lastBrace + 1));
          } catch {
            // Substring also not valid JSON.
          }
        }
      }
    }

    if (Array.isArray(data) && data.length > 0) {
      data = data[0];
    }

    if (typeof data === 'object' && 'error' in data) {
      outerError = (data as { error?: ErrorShape }).error;
    }
  }
  return outerError;
}
