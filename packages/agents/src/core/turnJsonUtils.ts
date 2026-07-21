/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getErrorMessage } from '@vybestack/llxprt-code-core/utils/errors.js';
import type {
  StructuredError,
  StructuredErrorCategory,
  StructuredErrorReason,
} from '@vybestack/llxprt-code-core/core/turn.js';

const STRUCTURED_ERROR_CATEGORIES: ReadonlySet<string> = new Set([
  'rate_limit',
  'quota',
  'authentication',
  'server_error',
  'network',
  'client_error',
]);

function isStructuredErrorCategory(
  value: unknown,
): value is StructuredErrorCategory {
  return typeof value === 'string' && STRUCTURED_ERROR_CATEGORIES.has(value);
}

function isStructuredErrorReason(
  value: unknown,
): value is StructuredErrorReason {
  return value === 'retries_exhausted' || value === 'all_buckets_exhausted';
}

export function buildStructuredError(error: unknown): StructuredError {
  if (typeof error !== 'object' || error === null) {
    return { message: getErrorMessage(error) };
  }

  const status =
    'status' in error && typeof error.status === 'number'
      ? error.status
      : undefined;
  const category =
    'category' in error && isStructuredErrorCategory(error.category)
      ? error.category
      : undefined;
  const reason =
    'reason' in error && isStructuredErrorReason(error.reason)
      ? error.reason
      : undefined;

  return {
    message: getErrorMessage(error),
    ...(status !== undefined ? { status } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

export function createSafeJsonReplacer(): (
  key: string,
  value: unknown,
) => unknown {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (typeof value !== 'object' || value === null) {
      return value;
    }

    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = record[key];
        return sorted;
      }, {});
  };
}

export function safeJsonStringify(value: unknown, space?: number): string {
  // JSON.stringify returns undefined for top-level undefined/functions/symbols.
  // The contract is "always return string", so handle those cases explicitly.
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    return 'undefined';
  }
  try {
    return JSON.stringify(value, createSafeJsonReplacer(), space);
  } catch (error) {
    return `[Unserializable request: ${getErrorMessage(error)}]`;
  }
}

export function isAbortSignalActive(signal: unknown): boolean {
  if (signal === null || signal === undefined) return false;
  if (typeof signal !== 'object') return false;
  if ('aborted' in signal) {
    return signal.aborted === true;
  }
  return false;
}
