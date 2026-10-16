/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { chatCommand } from './chatCommand.js';
import { withChatMutationFixture } from './chat-mutation-test-helpers.js';

for (const name of ['clear', 'restore']) {
  describe(`chat ${name} cache anchor`, () => {
    it('resets the provider head anchor after successful disk-prefix publication', async () => {
      await withChatMutationFixture(6, async ({ context, history }) => {
        history.setCacheAnchorSeq(1);
        const result = await chatCommand.subCommands
          ?.find((command) => command.name === name)
          ?.action?.(context, name === 'restore' ? '1' : '');
        expect({ result, anchor: history.getCacheAnchorSeq() }).toStrictEqual({
          result: undefined,
          anchor: 0,
        });
      });
    });
  });
}
