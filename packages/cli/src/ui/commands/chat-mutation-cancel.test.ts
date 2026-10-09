/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { chatCommand } from './chatCommand.js';
import { withChatMutationFixture } from './chat-mutation-test-helpers.js';

const image =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';

for (const name of ['clear', 'restore']) {
  describe(`chat ${name} cancellation`, () => {
    it('closes capture and media reservations without persisting or changing UI when aborted after a reservation', async () => {
      await withChatMutationFixture(
        4,
        async ({ context, history, client, recording }) => {
          await client.setHistory([
            { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] },
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'media',
                  encoding: 'base64',
                  mimeType: 'image/png',
                  data: image,
                },
              ],
            },
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'next question' }],
            },
          ]);
          await history.waitForCommit();
          const cursor = client.getChat().getHistory();
          await cursor.next();
          const media = await cursor.next();
          await cursor.return();
          if (media.done === true) throw new Error('Missing media');
          const reference = media.value.blocks.find(
            (block) => block.type === 'media',
          );
          if (reference?.type !== 'media' || reference.encoding !== 'reference')
            throw new Error('Missing reference');
          const store = context.services.config?.getLocalMediaStore();
          if (store === undefined) throw new Error('Missing store');
          const path = recording.getFilePath();
          if (path === null) throw new Error('Missing journal');
          const before = await readFile(path, 'utf8');
          const controller = new AbortController();
          context.signal = controller.signal;
          let cleared = false;
          context.ui.clear = () => {
            cleared = true;
          };
          const reserve = store.reserve.bind(store);
          const fault = spyOn(store, 'reserve').mockImplementation(
            async (row, owner) => {
              await reserve(row, owner);
              if (owner.startsWith('chat-mutation:'))
                controller.abort(new Error('capture cancelled'));
            },
          );
          try {
            await expect(
              chatCommand.subCommands
                ?.find((command) => command.name === name)
                ?.action?.(context, name === 'restore' ? '1' : ''),
            ).rejects.toThrow('capture cancelled');
            let count = 0;
            for await (const _row of client.getChat().getHistory()) count++;
            expect({
              count,
              cleared,
              journal: await readFile(path, 'utf8'),
            }).toStrictEqual({ count: 3, cleared: false, journal: before });
            expect(await store.hasReservations(reference.contentId)).toBe(true);
            await client.dispose();
            expect(await store.hasReservations(reference.contentId)).toBe(
              false,
            );
          } finally {
            fault.mockRestore();
          }
        },
      );
    }, 180_000);
  });
}
