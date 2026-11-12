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
  usage: z
    .object({
      promptTokens: z.number(),
      completionTokens: z.number(),
      totalTokens: z.number(),
    })
    .optional(),
  action: z.enum(['stop', 'retry', 'review']),
});

export type RefusalPayload = z.infer<typeof RefusalPayloadSchema>;
