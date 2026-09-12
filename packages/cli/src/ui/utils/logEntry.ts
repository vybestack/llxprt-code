/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

/** Validates external JSONL records before they enter the display store. */
export const logEntrySchema = z.object({
  timestamp: z.string(),
  type: z.enum(['request', 'response', 'tool_call']),
  provider: z.string(),
  model: z.string().optional(),
  conversationId: z.string().optional(),
  messages: z
    .array(z.object({ role: z.string(), content: z.string() }))
    .optional(),
  response: z.string().optional(),
  tokens: z
    .object({ input: z.number().optional(), output: z.number().optional() })
    .optional(),
  error: z.string().optional(),
  tool: z.string().optional(),
  duration: z.number().optional(),
  success: z.boolean().optional(),
  gitStats: z
    .object({
      linesAdded: z.number(),
      linesRemoved: z.number(),
      filesChanged: z.number(),
    })
    .optional(),
});

export type LogEntry = z.infer<typeof logEntrySchema>;
