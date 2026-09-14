/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const DEFAULT_MAX_TOKENS = 50000;

export type ParsedToolOutputMaxTokens =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'limited'; readonly maxTokens: number };

export function parseToolOutputMaxTokens(
  raw: unknown,
): ParsedToolOutputMaxTokens {
  if (raw === undefined || raw === null) {
    return { kind: 'limited', maxTokens: DEFAULT_MAX_TOKENS };
  }
  if (raw === false || raw === '') {
    return { kind: 'disabled' };
  }
  if (typeof raw === 'number') {
    if (Number.isNaN(raw) || raw === 0) {
      return { kind: 'disabled' };
    }
    return { kind: 'limited', maxTokens: raw };
  }
  return { kind: 'disabled' };
}
