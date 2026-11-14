/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { withChatMutationFixture } from './__tests__/support/chat-mutation-test-helpers.js';

function chatFailureCase1(): void {
  describe('keeps live history and UI unchanged when recording persistence fails', () => {
    it('keeps live history and UI unchanged when recording persistence fails', async () => {
      await withChatMutationFixture(
        512,
        async ({ chatCommand, context, history, recording, reader }) => {
          const clear = chatCommand.subCommands?.find(
            (command) => command.name === 'clear',
          );
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
  chatFailureCase1();
});
