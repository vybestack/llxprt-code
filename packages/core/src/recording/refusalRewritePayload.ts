/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

const RewriteRoleSchema = z.enum(['human', 'ai', 'tool']);
const RewriteKindSchema = z.enum([
  'summary',
  'tool_result',
  'assistant_text',
  'user',
  'other',
]);

/**
 * Payload for the mutating `refusal_rewrite` event (issue #4036): a reviewer
 * model rewrote context that a model refused. The changed entries keep their
 * original text here, outside model history, so a person can inspect or
 * restore it later. The journal commit group carries the rewritten rows.
 */
export const RefusalRewritePayloadSchema = z.object({
  operationId: z.string().min(1),
  time: z.string(),
  /** The refused request this rewrite belongs to. */
  promptId: z.string(),
  attemptIndex: z.number().int().nonnegative(),
  reviewer: z.object({
    /** The saved profile that selected the reviewer; absent for the session model. */
    profile: z.string().optional(),
    provider: z.string(),
    model: z.string(),
  }),
  explanation: z.string().min(1),
  changes: z
    .array(
      z.object({
        id: z.string(),
        role: RewriteRoleSchema,
        kind: RewriteKindSchema,
        originalText: z.string(),
        newText: z.string(),
      }),
    )
    .min(1),
});

export type RefusalRewritePayload = z.infer<typeof RefusalRewritePayloadSchema>;
