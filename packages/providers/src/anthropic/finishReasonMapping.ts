/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { FinishInfo } from '@vybestack/llxprt-code-core/llm-types/finishReasons.js';

const finishReasons: ReadonlyMap<string, FinishInfo['finishReason']> = new Map([
  ['end_turn', 'stop'],
  ['max_tokens', 'max_tokens'],
  ['tool_use', 'tool_calls'],
  ['refusal', 'refusal'],
  ['stop_sequence', 'stop'],
]);

/** Maps a provider terminal reason and retains the original diagnostic string. */
export function mapStopReason(rawStopReason: string): FinishInfo {
  return {
    finishReason: finishReasons.get(rawStopReason) ?? 'other',
    rawStopReason,
  };
}
