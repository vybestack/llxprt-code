/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import {
  isMediaReferenceBlock,
  type IContent,
  type MediaReferenceBlock,
} from '@vybestack/llxprt-code-core';
import {
  useStreamMediaFixtures,
  type StreamMediaFixture,
} from '../../../../__tests__/stream-media-fixture.js';

const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function imageHistory(bytes: Uint8Array): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          mimeType: 'image/png',
          data: Buffer.from(bytes).toString('base64'),
          encoding: 'base64',
        },
      ],
    },
  ];
}

async function readImage(
  fixture: StreamMediaFixture,
): Promise<MediaReferenceBlock> {
  const history = await fixture.agent.getHistory();
  const reference = history
    .flatMap((message) => message.blocks)
    .find(isMediaReferenceBlock);
  if (reference === undefined)
    throw new Error('Runtime did not retain native media');
  return reference;
}

describe('stream runtime test fixture isolation', () => {
  const createFixture = useStreamMediaFixtures();

  it('gives each runtime its own fallback media store', async () => {
    const first = await createFixture();
    const second = await createFixture();

    const firstStore = first.media;
    const secondStore = second.media;

    expect(firstStore).not.toBe(secondStore);
    expect(firstStore.rootDirectory).not.toBe(secondStore.rootDirectory);
    expect(first.runtime.session.getSessionId()).toBe(
      second.runtime.session.getSessionId(),
    );
    expect(first.runtime.projectTempDir).toBe(second.runtime.projectTempDir);

    await first.agent.setHistory(imageHistory(imageBytes));
    const reference = await readImage(first);
    expect(await firstStore.readVerified(reference)).toStrictEqual(imageBytes);
    expect(first.historyReceiver.mediaStore).toBe(firstStore);
    expect(reference.contentId).toBe(
      `sha256:${createHash('sha256').update(imageBytes).digest('hex')}`,
    );
    expect(await second.agent.getHistory()).toStrictEqual([]);
    await expect(secondStore.readVerified(reference)).rejects.toThrow('ENOENT');

    await second.agent.setHistory(imageHistory(imageBytes));
    const secondReference = await readImage(second);
    expect(secondReference).toStrictEqual(reference);
    expect(second.historyReceiver.mediaStore).toBe(secondStore);
    expect(await secondStore.readVerified(secondReference)).toStrictEqual(
      imageBytes,
    );

    await first.dispose();
    await expect(access(firstStore.rootDirectory)).rejects.toThrow('ENOENT');
    await expect(firstStore.readVerified(reference)).rejects.toThrow(
      'Local media store is closed',
    );
    expect(
      await secondStore.readObjectVerified(secondReference.selectedObject),
    ).toStrictEqual(imageBytes);
    const survivingHistory = await second.agent.getHistory();
    expect(survivingHistory[0]?.blocks[0]).toBe(secondReference);
  });

  it('closing a borrowed stream peer preserves its owner media and native history', async () => {
    const fixture = await createFixture();
    await fixture.agent.setHistory(imageHistory(imageBytes));
    const reference = await readImage(fixture);
    const peer = await fixture.borrow();
    const history = await peer.getHistory();
    const borrowedReference = history
      .flatMap((message) => message.blocks)
      .find(isMediaReferenceBlock);
    expect(borrowedReference).toBe(reference);
    expect(fixture.historyReceiver.mediaStore).toBe(fixture.media);
    expect(await fixture.media.readVerified(reference)).toStrictEqual(
      imageBytes,
    );

    await peer.dispose();
    const ownerHistory = await fixture.agent.getHistory();
    expect(ownerHistory[0]?.blocks[0]).toBe(reference);
    expect(
      await fixture.media.readObjectVerified(reference.selectedObject),
    ).toStrictEqual(imageBytes);
    await fixture.dispose();
    await expect(access(fixture.media.rootDirectory)).rejects.toThrow('ENOENT');
  });
});
