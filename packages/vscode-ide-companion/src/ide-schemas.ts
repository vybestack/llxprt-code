/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

/**
 * Zod schema for validating a file context from the IDE.
 */
export const FileSchema = z.object({
  path: z.string(),
  timestamp: z.number(),
  isActive: z.boolean().optional(),
  selectedText: z.string().optional(),
  cursor: z
    .object({
      line: z.number(),
      character: z.number(),
    })
    .optional(),
});
export type File = z.infer<typeof FileSchema>;

export const IdeContextSchema = z.object({
  workspaceState: z
    .object({
      openFiles: z.array(FileSchema).optional(),
      isTrusted: z.boolean().optional(),
    })
    .optional(),
});
export type IdeContext = z.infer<typeof IdeContextSchema>;

/**
 * Zod schema for validating the 'ide/contextUpdate' notification from the IDE.
 */
export const IdeContextNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('ide/contextUpdate'),
  params: IdeContextSchema,
});

export const IdeDiffAcceptedNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('ide/diffAccepted'),
  params: z.object({
    filePath: z.string(),
    content: z.string(),
  }),
});

export const IdeDiffClosedNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('ide/diffClosed'),
  params: z.object({
    filePath: z.string(),
    content: z.string().optional(),
  }),
});
