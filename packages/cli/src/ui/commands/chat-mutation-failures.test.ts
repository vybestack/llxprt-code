/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { withBatchFixture } from '@vybestack/llxprt-code-core/services/history/addbatch-stream-test-helpers.js';
import {
  publicChat,
  publicCommandContext,
} from '../../test-utils/public-history-cursor.js';
import { chatCommand } from './chatCommand.js';
import { withChatMutationFixture } from './chat-mutation-test-fixture.js';

const clear = chatCommand.subCommands?.find(
  (command) => command.name === 'clear',
);

function chatFailureCase0(): void {
  describe('rejects an invalid pending prefix before touching persistence or changing live history', () => {
    it('rejects an invalid pending prefix before touching persistence or changing live history', async () => {
      await withBatchFixture(
        async ({
          history,
          recorder,
          pauseWriter,
          waitForPausedWrite,
          releaseWriter,
        }) => {
          const chat = publicChat(history);
          const context = publicCommandContext(chat);
          if (context.services.config === null)
            throw new Error('Missing config');
          Object.assign(context.services.config, {
            getLocalMediaStore: () => undefined,
          });
          context.recordingSwapCallbacks = {
            getCurrentRecording: () => recorder,
            getCurrentIntegration: () => null,
            getCurrentLockHandle: () => null,
            setRecording: () => {},
          };
          pauseWriter();
          const pending = {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'initial question' }],
          } satisfies import('@vybestack/llxprt-code-core').IContent;
          history.add(pending);
          pending.blocks = [];
          history.add({
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'initial answer' }],
          });
          history.add({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'next turn' }],
          });
          await waitForPausedWrite;
          const failure = spyOn(recorder, 'flush').mockRejectedValue(
            new Error('persistence reached before validation'),
          );
          let cleared = false;
          context.ui.clear = () => {
            cleared = true;
          };
          try {
            const result = await clear?.action?.(context, '');
            expect(result).toMatchObject({
              messageType: 'error',
              content: expect.stringContaining('content has no blocks'),
            });
            let count = 0;
            for await (const _row of chat.getHistory()) count++;
            expect({ count, cleared }).toStrictEqual({
              count: 3,
              cleared: false,
            });
          } finally {
            failure.mockRestore();
            releaseWriter();
          }
        },
      );
    });
  });
}

function chatFailureCase1(): void {
  describe('keeps live history and UI unchanged when recording persistence fails', () => {
    it('keeps live history and UI unchanged when recording persistence fails', async () => {
      await withChatMutationFixture(
        512,
        async ({ context, history, recording, reader }) => {
          const failure = spyOn(recording, 'flush').mockRejectedValue(
            new Error('rewind I/O failure'),
          );
          let cleared = false;
          context.ui.clear = () => {
            cleared = true;
          };
          try {
            expect(await clear?.action?.(context, '')).toMatchObject({
              messageType: 'error',
              content: expect.stringContaining('rewind I/O failure'),
            });
            let count = 0;
            for await (const _row of history.streamRawHistory()) count++;
            expect({
              count,
              cleared,
              held: reader.snapshot().liveRows,
            }).toStrictEqual({ count: 512, cleared: false, held: 0 });
          } finally {
            failure.mockRestore();
          }
        },
      );
    }, 180_000);
  });
}

describe('chat disk mutation failure boundaries', () => {
  chatFailureCase0();
  chatFailureCase1();
});
