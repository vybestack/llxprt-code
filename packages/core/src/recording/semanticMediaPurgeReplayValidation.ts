/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '../services/history/IContent.js';

export function isSemanticMediaPurgeFrontierWithinHistory(
  history: readonly IContent[],
  frontier: { readonly contentIndex: number; readonly blockIndex: number },
): boolean {
  if (history.length === 0) {
    return frontier.contentIndex === 0 && frontier.blockIndex === 0;
  }
  const content = history.find(
    (_entry, index) => index === frontier.contentIndex,
  );
  return content !== undefined && frontier.blockIndex < content.blocks.length;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isRecordWithNonNegativeIntegerPair(
  value: unknown,
): value is { readonly contentIndex: number; readonly blockIndex: number } {
  if (typeof value !== 'object' || value === null) return false;
  if (!('contentIndex' in value) || !('blockIndex' in value)) return false;
  return (
    isNonNegativeInteger(value.contentIndex) &&
    isNonNegativeInteger(value.blockIndex)
  );
}
