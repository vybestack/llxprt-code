/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared shaping helpers for the GitHub broker op registry.
 *
 * Extracted from github-broker-ops.ts so per-op modules can reuse
 * defensive parsing of external data without code duplication.
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 101-126
 */

import { mapGraphQLErrorType } from './github-broker-errors.js';

/**
 * The shaped comment in the issue.view / pr.view contract.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 101-103
 */
export interface ShapedComment {
  readonly author: string;
  readonly createdAt: string;
  readonly body: string;
}

/**
 * Maximum bytes for a shaped body before truncation kicks in.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 125-126
 */
export const TRUNCATION_LIMIT_BYTES = 64 * 1024;

/**
 * Marker appended to a truncated field so the caller knows data was cut.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 125-126
 */
export const TRUNCATION_MARKER = '\n...[truncated]';

/**
 * Extracts a number from an unknown value, defaulting to 0.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 */
export function extractNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/**
 * Extracts a string from an unknown value, returning a default.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 */
export function extractString(value: unknown, def: string): string {
  return typeof value === 'string' ? value : def;
}

/**
 * Extracts the author login from a gh author object (defensive).
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 */
export function extractAuthor(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.login === 'string') return obj.login;
  }
  return '';
}

/**
 * Extracts label names from a gh labels array (defensive).
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 */
export function extractLabels(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((label): string => {
      if (typeof label === 'string') return label;
      if (typeof label === 'object' && label !== null) {
        const obj = label as Record<string, unknown>;
        if (typeof obj.name === 'string') return obj.name;
      }
      return '';
    })
    .filter((name) => name.length > 0);
}

/**
 * Extracts shaped comments from a gh comments array (defensive). Returns
 * null when there is no comments array, so the caller can distinguish
 * "not requested" from "zero comments".
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 101-103
 */
export function extractComments(
  value: unknown,
): readonly ShapedComment[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((comment): ShapedComment => {
    const obj = (comment ?? {}) as Record<string, unknown>;
    return {
      author: extractAuthor(obj.author),
      createdAt: extractString(obj.createdAt, ''),
      body: extractString(obj.body, ''),
    };
  });
}

/**
 * Throws a structured error if the raw JSON contains both data and errors
 * (GraphQL partial success). This is defensive parsing of a GitHub API
 * response, which is genuinely external input.
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P10
 * @requirement REQ-004
 * @pseudocode 003-github-broker.md lines 75-76
 */
export function assertNotPartialSuccess(rawJson: unknown): void {
  if (rawJson === null || typeof rawJson !== 'object') return;
  const raw = rawJson as Record<string, unknown>;
  if (
    raw.data !== undefined &&
    Array.isArray(raw.errors) &&
    raw.errors.length > 0
  ) {
    const first = raw.errors[0] as Record<string, unknown>;
    const type = typeof first.type === 'string' ? first.type : undefined;
    const message =
      typeof first.message === 'string' ? first.message : 'GraphQL error';
    throw new Error(`${mapGraphQLErrorType(type)}: ${message}`);
  }
}

/**
 * Truncates a string field if it exceeds the byte budget. Returns the
 * (possibly truncated) string and an optional truncation metadata object
 * for the caller to attach to the response.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 125-126
 */
export function truncateWithMarker(
  value: string,
  field: string,
  limit: number = TRUNCATION_LIMIT_BYTES,
): {
  value: string;
  truncated: { field: string; originalBytes: number } | null;
} {
  const originalBytes = Buffer.byteLength(value, 'utf8');
  if (originalBytes <= limit) {
    return { value, truncated: null };
  }
  // The budget is measured in UTF-8 bytes, so the cut must be too. Slicing
  // by UTF-16 code units would under-cut multi-byte text (leaving the result
  // over budget) and can split a surrogate pair, producing a replacement
  // character. Cutting the encoded buffer and decoding with a stream-aware
  // decoder drops any partial trailing sequence cleanly instead.
  const budget = Math.max(0, limit - Buffer.byteLength(TRUNCATION_MARKER));
  // `stream: true` makes the decoder hold back an incomplete trailing
  // sequence instead of emitting U+FFFD for it. Without it the replacement
  // character both corrupts the text and costs three bytes we did not
  // budget for, pushing the result back over the limit.
  const cut = new TextDecoder('utf-8').decode(
    Buffer.from(value, 'utf8').subarray(0, budget),
    { stream: true },
  );
  return {
    value: cut + TRUNCATION_MARKER,
    truncated: { field, originalBytes },
  };
}
