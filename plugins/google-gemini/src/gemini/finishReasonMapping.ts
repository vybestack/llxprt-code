/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { FinishInfo } from '@vybestack/llxprt-code-core/llm-types/finishReasons.js';

const finishReasons: ReadonlyMap<string, FinishInfo['finishReason']> = new Map([
  ['STOP', 'stop'],
  ['MAX_TOKENS', 'max_tokens'],
  ['SAFETY', 'safety'],
  ['IMAGE_SAFETY', 'safety'],
  ['RECITATION', 'safety'],
  ['LANGUAGE', 'other'],
  ['BLOCKLIST', 'safety'],
  ['PROHIBITED_CONTENT', 'safety'],
  ['SPII', 'safety'],
  ['MALFORMED_FUNCTION_CALL', 'error'],
  ['UNEXPECTED_TOOL_CALL', 'error'],
  ['OTHER', 'other'],
  ['IMAGE_PROHIBITED_CONTENT', 'safety'],
  ['NO_IMAGE', 'other'],
  ['FINISH_REASON_UNSPECIFIED', 'other'],
]);

/** Maps a provider terminal reason and retains the original diagnostic string. */
export function mapCandidateFinishReason(rawStopReason: string): FinishInfo {
  return {
    finishReason: finishReasons.get(rawStopReason) ?? 'other',
    rawStopReason,
  };
}
