/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { z } from 'zod';
import type {
  IContent,
  NativeJournalPageReader,
  NativeJournalEntry,
  ToolResultDisplay,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../../types.js';

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
const toolDisplay = z.union([
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

export async function withToolPresentations(
  reader: NativeJournalPageReader,
  row: NativeJournalEntry,
  items: HistoryItem[],
): Promise<HistoryItem[]> {
  const result: HistoryItem[] = [];
  for (const item of items) {
    if (item.type !== 'tool_group') {
      result.push(item);
      continue;
    }
    const tools = [];
    for (const tool of item.tools) {
      const presentation = await reader.toolPresentation(row, tool.callId);
      if (presentation === undefined) {
        tools.push(tool);
        continue;
      }
      const text = displayText(presentation.content);
      const resultDisplay: ToolResultDisplay =
        presentation.descriptor.format === 'text'
          ? text
          : toolDisplay.parse(JSON.parse(text));
      tools.push({ ...tool, resultDisplay, retention: undefined });
    }
    result.push({ ...item, tools });
  }
  return result;
}
