/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

/**
 * Payload for the `refusal` event: an audit-only record that a provider
 * attempt ended with the canonical finish reason `refusal` (issue #4036).
 * It never enters model history and replay only validates it.
 */
export const RefusalPayloadSchema = z.object({
  time: z.string(),
  provider: z.string(),
  model: z.string(),
  promptId: z.string(),
  turnId: z.string().nullable(),
  attemptIndex: z.number().int().nonnegative(),
  finishReason: z.literal('refusal'),
  rawStopReason: z.string().optional(),
  refusal_category: z.string().nullable().optional(),
  refusal_explanation: z.string().nullable().optional(),
  recommended_model: z.string().optional(),
  request_id: z.string().nullable().optional(),
  dump_base_id: z.string().optional(),
  partial_output: z
    .object({
      items: z.array(
        z.discriminatedUnion('type', [
          z.object({
            type: z.enum(['text', 'thinking']),
            text: z.string(),
            original_bytes: z.number().int().nonnegative(),
            truncated: z.boolean(),
          }),
          z.object({
            type: z.literal('tool_input'),
            id: z.string(),
            name: z.string(),
            input: z.string(),
            complete: z.boolean(),
            original_bytes: z.number().int().nonnegative(),
            truncated: z.boolean(),
          }),
        ]),
      ),
      truncated: z.boolean(),
      original_bytes: z.number().int().nonnegative(),
      preview_bytes: z.number().int().nonnegative(),
    })
    .optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  first_byte_to_refusal_ms: z.number().nonnegative().nullable().optional(),
  context_fingerprint: z
    .object({
      baseline_available: z.boolean(),
      baseline_prompt_id: z.string().nullable(),
      baseline_attempt_index: z.number().int().nullable(),
      baseline_time: z.string().nullable(),
      added_entries: z.array(z.unknown()),
      added_entry_count: z.number().int().nonnegative(),
      omitted_entry_count: z.number().int().nonnegative(),
      pending_entries: z.array(z.unknown()),
      compression_count: z.number().int().nonnegative(),
      last_compression_time: z.string().nullable(),
      summary_author_model: z.string().nullable(),
      summary_author_provider: z.string().nullable(),
      compression_strategy: z.string().nullable(),
      digest: z.string(),
      prompt_tokens: z.number().nullable(),
      cache_read_tokens: z.number().nullable(),
    })
    .optional(),
  usage: z
    .object({
      promptTokens: z.number(),
      completionTokens: z.number(),
      totalTokens: z.number(),
    })
    .optional(),
  action: z.enum(['stop', 'retry', 'review']),
  /** Backoff requested before the resend; present only when `action` is `retry`. */
  delayMs: z.number().int().nonnegative().optional(),
});

export type RefusalPayload = z.infer<typeof RefusalPayloadSchema>;
