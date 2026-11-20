/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { z } from 'zod';
import type {
  IContent,
  NativeJournalPageReader,
  NativeJournalEntry,
  ToolResultDisplay,
} from '@vybestack/llxprt-code-core';
import { ToolCallStatus, type HistoryItem } from '../../types.js';
import { withPersistedApproval } from './journal-approval-projection.js';

const metadata = z.record(z.unknown()).optional();
const fileRead = z.object({
  content: z.string(),
  fileName: z.string(),
  filePath: z.string(),
  metadata,
});
const fileDiff = z.object({
  fileDiff: z.string(),
  fileName: z.string(),
  filePath: z.string().optional(),
  originalContent: z.string().nullable(),
  newContent: z.string(),
  metadata,
  applied: z.boolean().optional(),
  isNewFile: z.boolean().optional(),
  diffStat: z
    .object({
      ai_removed_lines: z.number(),
      ai_added_lines: z.number(),
      user_added_lines: z.number(),
      user_removed_lines: z.number(),
    })
    .optional(),
});
const ansiToken = z.object({
  text: z.string(),
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  dim: z.boolean(),
  inverse: z.boolean(),
  fg: z.string(),
  bg: z.string(),
});
export const toolDisplay = z.union([
  z.string(),
  fileRead,
  fileDiff,
  z.array(z.array(ansiToken)),
]);

export function displayText(content: IContent): string {
  return content.blocks
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
}

function presentationResult(
  format: 'none' | 'text' | 'json',
  text: string,
  original: ToolResultDisplay | undefined,
): ToolResultDisplay | undefined {
  if (format === 'none') return original;
  if (format === 'text') return text;
  return toolDisplay.parse(JSON.parse(text));
}

function presentationStatus(
  status: string | undefined,
  original: ToolCallStatus,
): ToolCallStatus {
  switch (status) {
    case 'success':
      return ToolCallStatus.Success;
    case 'error':
      return ToolCallStatus.Error;
    case 'cancelled':
      return ToolCallStatus.Canceled;
    default:
      return original;
  }
}

export async function withToolPresentations(
  reader: NativeJournalPageReader,
  row: NativeJournalEntry,
  items: HistoryItem[],
  orphanedApproval = false,
): Promise<HistoryItem[]> {
  const result: HistoryItem[] = [];
  for (const item of items) {
    if (item.type !== 'tool_group') {
      result.push(item);
      continue;
    }
    const tools = [];
    const journalIdentity = await reader.toolRequestIdentity(row);
    for (const original of item.tools) {
      const tool = await withPersistedApproval(
        reader,
        row,
        original,
        orphanedApproval,
      );
      const presentation = await reader.toolPresentation(row, tool.callId);
      if (presentation === undefined) {
        tools.push({ ...tool, journalIdentity });
        continue;
      }
      const text = displayText(presentation.content);
      const resultDisplay = presentationResult(
        presentation.descriptor.format,
        text,
        tool.resultDisplay,
      );
      tools.push({
        ...tool,
        journalIdentity,
        status: presentationStatus(presentation.descriptor.status, tool.status),
        resultDisplay,
        name: presentation.descriptor.displayName ?? tool.name,
        description: presentation.descriptor.description ?? tool.description,
        renderOutputAsMarkdown: presentation.descriptor.renderOutputAsMarkdown,
        retention: undefined,
      });
    }
    result.push({ ...item, tools });
  }
  return result;
}
