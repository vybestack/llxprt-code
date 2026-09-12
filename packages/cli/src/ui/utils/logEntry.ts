/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

const metadataSchema = z.object({
  conversationId: z.string().optional(),
  duration: z.number().optional(),
  success: z.boolean().optional(),
  error: z.string().optional(),
});

/** Validates the ConversationFileWriter JSONL format before display. */
export const logEntrySchema = z
  .object({
    timestamp: z.string(),
    type: z.enum(['request', 'response', 'tool_call']),
    provider: z.string(),
    model: z.string().optional(),
    conversationId: z.string().optional(),
    messages: z
      .array(
        z.union([
          z.object({
            speaker: z.string(),
            blocks: z.array(
              z
                .object({ type: z.string(), text: z.string().optional() })
                .passthrough(),
            ),
          }),
          z.object({ role: z.string(), content: z.string() }),
        ]),
      )
      .optional(),
    response: z.string().optional(),
    tokens: z
      .object({ input: z.number().optional(), output: z.number().optional() })
      .optional(),
    error: z.string().optional(),
    tool: z.string().optional(),
    duration: z.number().optional(),
    success: z.boolean().optional(),
    context: metadataSchema.optional(),
    metadata: metadataSchema.optional(),
    gitStats: z
      .object({
        linesAdded: z.number(),
        linesRemoved: z.number(),
        filesChanged: z.number(),
      })
      .nullish(),
  })
  .transform(({ context, metadata, ...entry }) => ({
    ...context,
    ...metadata,
    ...entry,
  }));

export type LogEntry = z.infer<typeof logEntrySchema>;

/** Parses external records independently so a damaged line cannot hide valid logs. */
export function parseLogEntries(entries: readonly unknown[]): LogEntry[] {
  return entries.flatMap((entry) => {
    const result = logEntrySchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}
