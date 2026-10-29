/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  JournalSession,
  NativeJournalPageReader,
} from '@vybestack/llxprt-code-core';
import { ToolCallStatus } from '../../types.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import { JournalDisplayWriter } from '@vybestack/llxprt-code-core/journal/display-recording.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { persistToolPresentations } from '../../../../../agents/src/core/agenticLoop/toolPresentationRecording.js';
import { NativeJournalCursor } from './native-journal-cursor.js';

function cancelledCall(): CompletedToolCall {
  const tool = new MockTool({ name: 'lookup', displayName: 'Lookup' });
  return {
    status: 'cancelled',
    request: {
      callId: 'cancelled-call',
      name: 'lookup',
      args: {},
      isClientInitiated: false,
      prompt_id: 'cancelled',
      journalIdentity: { transcriptId: '0', attemptId: '' },
    },
    tool,
    invocation: tool.build({}),
    response: {
      callId: 'cancelled-call',
      responseParts: [],
      resultDisplay: undefined,
      error: undefined,
      errorType: undefined,
      agentId: 'primary',
    },
  };
}

describe('cancelled tool presentation', () => {
  const directory = useTempDir('journal-cancelled-display-');
  it('preserves the tool label and cancellation result without a display override', async () => {
    const path = join(directory(), 'cancelled.llxj');
    const session = await JournalSession.create(path);
    try {
      await session.append([
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'cancelled-call',
              name: 'lookup',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'cancelled-call',
              toolName: 'lookup',
              result: { error: 'denied by user' },
            },
          ],
        },
      ]);
      const writer = new JournalDisplayWriter(session.store);
      await persistToolPresentations([cancelledCall()], {
        appendDisplay: (descriptor, source) =>
          writer.append(descriptor, source),
      });
      const cursor = await NativeJournalCursor.open(path, {}, 16);
      try {
        const entries = (await cursor.pageBack(16)).entries;
        const tools = entries.flatMap((entry) =>
          entry.kind === 'projected' && entry.item.type === 'tool_group'
            ? entry.item.tools
            : [],
        );
        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe('Lookup');
        expect(tools[0].description).toContain('lookup');
        expect(JSON.stringify(tools[0].resultDisplay)).toContain(
          'denied by user',
        );
      } finally {
        await cursor.close();
      }
    } finally {
      await session.close();
    }
  });
  it.each(['awaiting_approval', 'scheduled', 'cancelled', 'modifying'])(
    'keeps a %s approval pending until its tool result arrives',
    async (status) => {
      const path = join(directory(), 'scheduled.llxj');
      const session = await JournalSession.create(path);
      try {
        await session.append([
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'scheduled-call',
                name: 'lookup',
                parameters: {},
              },
            ],
          },
        ]);
        const reader = await NativeJournalPageReader.open(path);
        const transcriptId = (await reader.entryAt(0)).transcriptId.toString();
        await reader.close();
        await new JournalDisplayWriter(session.store).append(
          {
            type: 'tool-approval',
            attemptId: '',
            callId: 'scheduled-call',
            format: 'json',
          },
          JSON.stringify({
            request: { journalIdentity: { transcriptId, attemptId: '' } },
            status,
          }),
        );
        const cursor = await NativeJournalCursor.open(
          path,
          { orphanBeforeTranscriptId: 0n },
          16,
        );
        try {
          const entries = (await cursor.pageBack(16)).entries;
          const tools = entries.flatMap((entry) =>
            entry.kind === 'projected' && entry.item.type === 'tool_group'
              ? entry.item.tools
              : [],
          );
          expect(tools).toHaveLength(1);
          expect(tools[0].status).toBe(ToolCallStatus.Pending);
        } finally {
          await cursor.close();
        }
      } finally {
        await session.close();
      }
    },
  );
});
