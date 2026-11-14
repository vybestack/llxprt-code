/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { z } from 'zod';
import type {
  NativeJournalEntry,
  NativeJournalPageReader,
} from '@vybestack/llxprt-code-core';
import { ToolCallStatus, type IndividualToolCallDisplay } from '../../types.js';

const persistedApproval = z.object({
  request: z.object({
    journalIdentity: z.object({
      transcriptId: z.string(),
      attemptId: z.string(),
    }),
  }),
  status: z.enum(['awaiting_approval', 'scheduled', 'cancelled', 'modifying']),
});

export async function withPersistedApproval(
  reader: NativeJournalPageReader,
  row: NativeJournalEntry,
  tool: IndividualToolCallDisplay,
  orphaned: boolean,
): Promise<IndividualToolCallDisplay> {
  const record = await reader.toolApproval(row, tool.callId);
  if (record === undefined) return tool;
  const text = record.content.blocks
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
  const approval = persistedApproval.parse(JSON.parse(text));
  if (
    approval.request.journalIdentity.transcriptId !==
    row.transcriptId.toString()
  )
    throw new Error('Mismatched approval transcript identity');
  if (tool.status === ToolCallStatus.Pending)
    return orphaned ? { ...tool, status: ToolCallStatus.Canceled } : tool;
  return approval.status === 'cancelled'
    ? { ...tool, status: ToolCallStatus.Canceled }
    : tool;
}
