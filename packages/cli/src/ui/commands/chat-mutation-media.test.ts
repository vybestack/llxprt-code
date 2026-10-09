/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { createHash } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
import type {
  IContent,
  AgentClientContract,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core';
import { foldDurableRows } from '@vybestack/llxprt-code-core/recording/durableRowFold.js';
import { chatCommand } from './chatCommand.js';
import { withChatMutationFixture } from './chat-mutation-test-helpers.js';

const image =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const source: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'media reasoning',
        signature: 'signature-854',
      },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: image,
        caption: 'answer image',
      },
    ],
    metadata: {
      model: 'historical-model',
      cacheAnchor: true,
      providerMetadata: { opaque: 'provider-bytes' },
    },
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'next question' }] },
  { speaker: 'ai', blocks: [{ type: 'text', text: 'next answer' }] },
];

async function digest(rows: AsyncIterable<IContent>): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of rows) hash.update(JSON.stringify(row));
  return hash.digest('hex');
}

async function durableDigest(file: string): Promise<string> {
  const fold = await foldDurableRows({
    filePath: file,
    maxBytes: (await stat(file)).size,
  });
  const hash = createHash('sha256');
  try {
    for (let index = 0; index < fold.length; index++)
      hash.update(JSON.stringify(await fold.readRow(index)));
    return hash.digest('hex');
  } finally {
    await fold.close();
  }
}

async function mediaReference(
  client: AgentClientContract,
): Promise<MediaReferenceBlock> {
  const cursor = client.getChat().getHistory();
  await cursor.next();
  const row = await cursor.next();
  await cursor.return();
  if (row.done === true) throw new Error('Missing media row');
  const reference = row.value.blocks.find((block) => block.type === 'media');
  if (reference?.type !== 'media' || reference.encoding !== 'reference')
    throw new Error('Missing media reference');
  return reference;
}

for (const name of ['clear', 'restore']) {
  describe(`chat ${name} media rollback`, () => {
    it('restores original bytes, chronology, tokens and media ownership after admission failure following the durable rewind', async () => {
      await withChatMutationFixture(
        4,
        async ({ context, history, client, recording }) => {
          await client.setHistory(source);
          await history.waitForCommit();
          const before = await digest(client.getChat().getHistory());
          const tokens = history.getTotalTokens();
          history.setCacheAnchorSeq(1);
          const store = context.services.config?.getLocalMediaStore();
          if (store === undefined) throw new Error('Missing media store');
          const recordingPath = recording.getFilePath();
          if (recordingPath === null) throw new Error('Missing recording');
          const rewindFrontier = (await stat(recordingPath)).size;
          const reserve = store.reserveAndReadVerified.bind(store);
          let failNextAdmission = true;
          const fault = spyOn(
            store,
            'reserveAndReadVerified',
          ).mockImplementation(async (reference, owner) => {
            if (
              failNextAdmission &&
              owner.startsWith('history:') &&
              (await readFile(recordingPath))
                .subarray(rewindFrontier)
                .includes('"type":"rewind"')
            ) {
              failNextAdmission = false;
              throw new Error('media reservation I/O failure');
            }
            return reserve(reference, owner);
          });
          try {
            const result = await chatCommand.subCommands
              ?.find((command) => command.name === name)
              ?.action?.(context, name === 'restore' ? '1' : '');
            expect(result).toMatchObject({
              messageType: 'error',
              content: expect.stringContaining('source=deferred-source:'),
            });
            await recording.flush();
            const file = recording.getFilePath();
            if (file === null) throw new Error('Missing recording');
            expect({
              live: await digest(client.getChat().getHistory()),
              durable: await durableDigest(file),
              tokens: history.getTotalTokens(),
              anchor: history.getCacheAnchorSeq(),
            }).toStrictEqual({
              live: before,
              durable: before,
              tokens,
              anchor: 1,
            });
            const reference = await mediaReference(client);
            expect(
              Buffer.from(await store.readVerified(reference)).toString(
                'base64',
              ),
            ).toBe(image);
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
