/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { z } from 'zod';
import type { ToolCallRequestInfo } from '../core/turn.js';

export interface ToolCallData<HistoryType = unknown, ArgsType = unknown> {
  history?: HistoryType;
  clientHistory?: readonly IContent[];
  commitHash?: string;
  toolCall: {
    name: string;
    args: ArgsType;
  };
  messageId?: string;
}

const ContentSchema = z
  .object({
    role: z.string().optional(),
    parts: z.array(z.record(z.unknown())),
  })
  .passthrough();

export function getToolCallDataSchema(historyItemSchema?: z.ZodTypeAny) {
  const schema = historyItemSchema ?? z.unknown();

  return z
    .object({
      history: z.array(schema).optional(),
      clientHistory: z.array(ContentSchema).optional(),
      commitHash: z.string().optional(),
      toolCall: z.object({
        name: z.string(),
        args: z.record(z.unknown()),
      }),
      messageId: z.string().optional(),
    })
    .passthrough();
}

export function generateCheckpointFileName(
  toolCall: ToolCallRequestInfo,
): string | null {
  const toolArgs = toolCall.args;
  const toolFilePath = toolArgs['file_path'] as string;

  if (!toolFilePath) {
    return null;
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\./g, '_');
  const toolName = toolCall.name;
  const fileName = path.basename(toolFilePath);

  return `${timestamp}-${fileName}-${toolName}`;
}

export function formatCheckpointDisplayList(filenames: string[]): string {
  return getTruncatedCheckpointNames(filenames).join('\n');
}

export function getTruncatedCheckpointNames(filenames: string[]): string[] {
  return filenames.map((file) => {
    const components = file.split('.');
    if (components.length <= 1) {
      return file;
    }
    components.pop();
    return components.join('.');
  });
}

export interface CheckpointInfo {
  messageId: string;
  checkpoint: string;
}

export function getCheckpointInfoList(
  checkpointFiles: Map<string, string>,
): CheckpointInfo[] {
  const checkpointInfoList: CheckpointInfo[] = [];

  for (const [file, content] of checkpointFiles) {
    try {
      const toolCallData = JSON.parse(content) as ToolCallData;
      if (toolCallData.messageId) {
        checkpointInfoList.push({
          messageId: toolCallData.messageId,
          checkpoint: file.replace('.json', ''),
        });
      }
    } catch {
      // Invalid JSON file - skip
    }
  }
  return checkpointInfoList;
}
