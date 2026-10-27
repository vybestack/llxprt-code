/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { NativeJournalPageReader } from '@vybestack/llxprt-code-core/journal/native-journal-page-reader.js';
import { NativeJournalCursor } from './native-journal-cursor.js';
import { ToolCallStatus } from '../../types.js';

async function requestIdentity(
  path: string,
): Promise<{ transcriptId: string; attemptId: string }> {
  const reader = await NativeJournalPageReader.open(path);
  try {
    for await (const entry of reader.entries()) {
      if (entry.toolCallBlocks > 0)
        return await reader.toolRequestIdentity(entry);
    }
    throw new Error('Missing tool request');
  } finally {
    await reader.close();
  }
}

describe('persisted approval replay', () => {
  const directory = useTempDir('approval-replay-');
  ['cancelled', 'awaiting_approval', 'scheduled'].forEach((status) => {
    it(`reopens ${status} without a pending callback or separate JSON row`, async () => {
      const recording = createSessionRecorder({
        sessionId: 'replay',
        projectHash: 'replay',
        chatsDir: directory(),
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
      });
      const history = new HistoryService();
      await history.attachJournal(recording, true);
      try {
        const arrival = await history.openResponseArrival({
          id: 'attempt',
          submissionId: 'submission',
        });
        await arrival.append({
          type: 'tool_call',
          id: 'call',
          name: 'lookup',
          parameters: {},
        });
        await arrival.seal({});
        const path = history.journalPath();
        if (path === null) throw new Error('Missing journal');
        const identity = await requestIdentity(path);
        await history.appendDisplay(
          {
            type: 'tool-approval',
            attemptId: 'attempt',
            callId: 'call',
            format: 'json',
          },
          JSON.stringify({ request: { journalIdentity: identity }, status }),
        );
        await history.dispose();
        await recording.dispose();
        const cursor = await NativeJournalCursor.open(path, {}, 16);
        try {
          const entries = (await cursor.pageBack(16)).entries;
          const items = entries.flatMap((entry) =>
            entry.kind === 'projected' ? [entry.item] : [],
          );
          const displayItems = items.filter(
            (item) =>
              item.type !== 'gemini' ||
              !item.text.startsWith('[context changed:'),
          );
          expect(displayItems).toHaveLength(1);
          const group = displayItems[0];
          if (group.type !== 'tool_group')
            throw new Error('Missing request card');
          expect(group.tools).toHaveLength(1);
          expect(group.tools[0].status).toBe(ToolCallStatus.Canceled);
          expect(group.tools[0].confirmationDetails).toBeUndefined();
          expect(group.tools[0].journalIdentity).toStrictEqual(identity);
        } finally {
          await cursor.close();
        }
      } finally {
        await history.dispose();
        await recording.dispose();
      }
    });
  });
});
