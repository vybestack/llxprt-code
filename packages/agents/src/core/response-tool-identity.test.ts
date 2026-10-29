/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { NativeJournalPageReader } from '@vybestack/llxprt-code-core/journal/native-journal-page-reader.js';
import type { ResponseJournalIdentity } from '@vybestack/llxprt-code-core/services/history/history-response-arrival.js';
import type { ToolCallBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  appendResponseChunk,
  responseToolIdentity,
} from './responseArrival.js';
import { toolRequestFromBlock } from './turnChunkEvents.js';

async function assertPresentation(
  history: HistoryService,
  identity: ResponseJournalIdentity,
): Promise<void> {
  await history.appendDisplay(
    {
      type: 'tool-result',
      attemptId: identity.attemptId,
      callId: 'reused-call',
      format: 'text',
    },
    'display from exact retry',
  );
  const path = history.journalPath();
  if (path === null) throw new Error('Missing journal path');
  const reader = await NativeJournalPageReader.open(path);
  try {
    for await (const row of reader.entries()) {
      if (row.transcriptId.toString() !== identity.transcriptId) continue;
      const display = await reader.toolPresentation(row, 'reused-call');
      expect(display?.content.blocks).toStrictEqual([
        { type: 'text', text: 'display from exact retry' },
      ]);
      return;
    }
    throw new Error('Missing persisted request');
  } finally {
    await reader.close();
  }
}

describe('journal tool request identity', () => {
  const directory = useTempDir('tool-identity-');
  async function withHistory(
    run: (history: HistoryService) => Promise<void>,
  ): Promise<void> {
    const recording = createSessionRecorder({
      sessionId: 'identity',
      projectHash: 'identity',
      chatsDir: directory(),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    const history = new HistoryService();
    await history.attachJournal(recording, true);
    try {
      await run(history);
    } finally {
      await history.dispose();
      await recording.dispose();
    }
  }

  it('binds each tool to the persisted attempt across provider retries', async () => {
    await withHistory(async (history) => {
      const arrival = await history.openResponseArrival({
        id: 'journal-attempt',
        submissionId: 'submission',
      });
      const first: ToolCallBlock = {
        type: 'tool_call',
        id: 'reused-call',
        name: 'lookup',
        parameters: {},
      };
      const retry: ToolCallBlock = { ...first, parameters: { retry: true } };
      await appendResponseChunk(
        arrival,
        {
          content: {
            speaker: 'ai',
            responseAttemptId: 'provider-first',
            blocks: [first],
          },
        },
        true,
      );
      const original = responseToolIdentity(first);
      expect(original?.attemptId).toBe('journal-attempt');
      await appendResponseChunk(
        arrival,
        {
          content: {
            speaker: 'ai',
            responseAttemptId: 'provider-retry',
            blocks: [retry],
          },
        },
        true,
      );
      await arrival.seal({});
      const identity = responseToolIdentity(retry);
      expect(identity?.attemptId).toBe('provider-retry');
      expect(identity?.transcriptId).not.toBe(original?.transcriptId);
      expect(responseToolIdentity(first)?.attemptId).toBe('journal-attempt');
      expect(
        toolRequestFromBlock(retry, 0, 'submission', 'primary').journalIdentity,
      ).toStrictEqual(identity);
      if (identity === undefined) throw new Error('Missing journal identity');
      await assertPresentation(history, identity);
    });
  });

  it('binds the completed tool block when the arguments were recorded incrementally', async () => {
    await withHistory(async (history) => {
      const arrival = await history.openResponseArrival({
        id: 'incremental-attempt',
        submissionId: 'submission',
      });
      const block: ToolCallBlock = {
        type: 'tool_call',
        id: 'reused-call',
        name: 'lookup',
        parameters: { x: 1 },
      };
      await appendResponseChunk(
        arrival,
        {
          content: {
            speaker: 'ai',
            blocks: [block],
            toolArgumentDelta: {
              sourceId: 'source',
              id: block.id,
              name: block.name,
              arguments: '{"x":1}',
              complete: true,
            },
          },
        },
        true,
      );
      await arrival.seal({});
      const identity = responseToolIdentity(block);
      if (identity === undefined)
        throw new Error('Missing incremental identity');
      expect(identity.attemptId).toBe('incremental-attempt');
      const rows = await Array.fromAsync(history.streamRawHistory());
      expect(rows[0].blocks).toStrictEqual([block]);
      await assertPresentation(history, identity);
    });
  });
});
