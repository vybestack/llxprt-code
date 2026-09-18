/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared test-only serialization helpers for deterministic deep-equality
// comparisons in property-based tests. Extracted from
// neutralConverters.property.test.ts and geminiSchemaHelpers.cycles.test.ts
// to eliminate duplication.
//
// This file lives under the tests subdirectory and is excluded from the
// published package via the files field in package.json.

import { isRecord } from '@vybestack/llxprt-code-core/llm-types/index.js';

/**
 * Deterministic JSON serialization with sorted keys for stable deep-equality
 * comparisons. Handles special numeric values (NaN, ±Infinity) and undefined
 * with sentinel strings so they compare predictably.
 */
export function sortedJson(value: unknown): string {
  if (value === undefined) return '"<undefined>"';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '"<NaN>"';
    if (value === Infinity) return '"<Infinity>"';
    if (value === -Infinity) return '"<-Infinity>"';
  }
  if (!isRecord(value) && !Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(sortedJson).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ':' + sortedJson(value[k]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Deep equality via sorted-key JSON comparison. See {@link sortedJson}.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return sortedJson(a) === sortedJson(b);
}
