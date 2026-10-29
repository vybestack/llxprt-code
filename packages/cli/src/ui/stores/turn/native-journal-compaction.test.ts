/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  JournalSession,
  NativeJournalPageReader,
} from '@vybestack/llxprt-code-core';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { JournalDisplayWriter } from '@vybestack/llxprt-code-core/journal/display-recording.js';
import { NativeJournalCursor } from './native-journal-cursor.js';
import { ToolCallStatus } from '../../types.js';

describe('journal compaction display positions', () => {
  const directory = useTempDir('journal-position-compaction-');
  it('keeps new tool calls live when compaction moves them before the old resume byte boundary', async () => {
    const session = await JournalSession.create(
      join(directory(), 'compaction.llxj'),
    );
    try {
      for (let index = 0; index < 40; index++) {
        await session.append([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: `old ${index}` }],
          },
        ]);
      }
      for (let index = 0; index < 20; index++) {
        await session.store.commit([
          {
            kind: 'setState',
            key: 'discarded',
            value: Buffer.from('obsolete state '.repeat(500)),
          },
        ]);
      }
      const initial = await NativeJournalCursor.open(session.path, {}, 1);
      const byteBoundary = initial.size();
      const boundary = initial.orphanBoundary();
      await initial.close();
      await session.append([
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'live-call',
              name: 'lookup',
              parameters: {},
            },
          ],
        },
      ]);
      const reader = await NativeJournalPageReader.open(session.path);
      const transcriptId = (
        await reader.entryAt(reader.rows - 1)
      ).transcriptId.toString();
      await reader.close();
      await new JournalDisplayWriter(session.store).append(
        {
          type: 'tool-approval',
          attemptId: '',
          callId: 'live-call',
          format: 'json',
        },
        JSON.stringify({
          request: { journalIdentity: { transcriptId, attemptId: '' } },
          status: 'awaiting_approval',
        }),
      );
      await session.store.compact();
      const cursor = await NativeJournalCursor.open(
        session.path,
        { orphanBeforeTranscriptId: boundary },
        1,
      );
      try {
        const entries = (await cursor.pageBack(1)).entries;
        expect(entries[0]?.offset).toBeLessThan(byteBoundary);
        const tools = entries.flatMap((entry) =>
          entry.kind === 'projected' && entry.item.type === 'tool_group'
            ? entry.item.tools
            : [],
        );
        expect(tools.map((tool) => tool.status)).toStrictEqual([
          ToolCallStatus.Pending,
        ]);
      } finally {
        await cursor.close();
      }
    } finally {
      await session.close();
    }
  });
});
