/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  FinishInfo,
  StopDetails,
} from '@vybestack/llxprt-code-core/llm-types/finishReasons.js';
import { z } from 'zod';

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

const AnthropicStopDetailsSchema = z.object({
  type: z.string(),
  category: z.string().nullable(),
  explanation: z.string().nullable(),
  recommended_model: z.string().optional(),
});

/** Parses API stop_details at the provider boundary and maps wire names once. */
export function parseAnthropicStopDetails(
  value: unknown,
): StopDetails | undefined {
  const parsed = AnthropicStopDetailsSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const { recommended_model: recommendedModel, ...details } = parsed.data;
  return {
    ...details,
    ...(recommendedModel === undefined ? {} : { recommendedModel }),
  };
}
