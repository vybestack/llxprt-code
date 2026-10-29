import { collectResumeRows } from '../../../../__tests__/resumeRows.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isMediaReferenceBlock,
  type IContent,
  type MediaReferenceBlock,
} from '@vybestack/llxprt-code-core';
import {
  useStreamMediaAgentFixtures,
  type StreamMediaAgentFixture,
} from '../../../../__tests__/stream-media-agent-fixture.js';

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
  fixture: StreamMediaAgentFixture,
): Promise<MediaReferenceBlock> {
  const history = await collectResumeRows(fixture.agent.streamHistory());
  const reference = history
    .flatMap((message) => message.blocks)
    .find(isMediaReferenceBlock);
  if (reference === undefined)
    throw new Error('Runtime did not retain native media');
  return reference;
}

/**
 * Agents with one session id share a project directory; each agent's live
 * media store is its own directory under `<projectTempDir>/media-live`, made
 * when the agent first retains media and removed when the agent is disposed.
 */
async function liveMediaStores(
  fixture: StreamMediaAgentFixture,
): Promise<string[]> {
  const root = join(fixture.config.projectTempDir, 'media-live');
  try {
    return (await readdir(root)).sort().map((name) => join(root, name));
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return [];
    throw error;
  }
}

async function addedMediaStore(
  fixture: StreamMediaAgentFixture,
  known: readonly string[],
): Promise<string> {
  const added = (await liveMediaStores(fixture)).filter(
    (directory) => !known.includes(directory),
  );
  if (added.length !== 1)
    throw new Error(`Expected one new live media store, found ${added.length}`);
  return added[0];
}

async function storedObject(
  storeDirectory: string,
  reference: MediaReferenceBlock,
): Promise<Uint8Array> {
  const digest = reference.contentId.replace(/^sha256:/, '');
  return new Uint8Array(
    await readFile(join(storeDirectory, 'objects', 'sha256', digest)),
  );
}

describe('stream runtime test fixture isolation', () => {
  const createFixture = useStreamMediaAgentFixtures();

  it('gives each runtime its own fallback media store', async () => {
    const first = await createFixture();
    const second = await createFixture();

    expect(first.runtime.session.getSessionId()).toBe(
      second.runtime.session.getSessionId(),
    );
    expect(first.runtime.projectTempDir).toBe(second.runtime.projectTempDir);
    expect(await liveMediaStores(first)).toStrictEqual([]);

    await first.agent.setHistory(imageHistory(imageBytes));
    const reference = await readImage(first);
    const firstStore = await addedMediaStore(first, []);
    expect(await storedObject(firstStore, reference)).toStrictEqual(imageBytes);
    expect(reference.contentId).toBe(
      `sha256:${createHash('sha256').update(imageBytes).digest('hex')}`,
    );
    expect(await collectResumeRows(second.agent.streamHistory())).toStrictEqual(
      [],
    );
    expect(await liveMediaStores(second)).toStrictEqual([firstStore]);

    await second.agent.setHistory(imageHistory(imageBytes));
    const secondReference = await readImage(second);
    expect(secondReference).toStrictEqual(reference);
    const secondStore = await addedMediaStore(second, [firstStore]);
    expect(secondStore).not.toBe(firstStore);
    expect(await storedObject(secondStore, secondReference)).toStrictEqual(
      imageBytes,
    );

    await first.dispose();
    await expect(access(firstStore)).rejects.toThrow('ENOENT');
    expect(await storedObject(secondStore, secondReference)).toStrictEqual(
      imageBytes,
    );
    const survivingHistory = await collectResumeRows(
      second.agent.streamHistory(),
    );
    expect(survivingHistory[0]?.blocks[0]).toStrictEqual(secondReference);
    expect(survivingHistory[0]?.blocks[0]).not.toBe(secondReference);
  });

  it('closing an independent stream peer preserves its sibling media and native history', async () => {
    const fixture = await createFixture();
    await fixture.agent.setHistory(imageHistory(imageBytes));
    const reference = await readImage(fixture);
    const ownerStore = await addedMediaStore(fixture, []);
    expect(await storedObject(ownerStore, reference)).toStrictEqual(imageBytes);

    const peer = await createFixture();
    expect(await collectResumeRows(peer.agent.streamHistory())).toStrictEqual(
      [],
    );
    await peer.agent.setHistory(imageHistory(imageBytes));
    const peerReference = await readImage(peer);
    const peerStore = await addedMediaStore(peer, [ownerStore]);
    expect(peerReference).toStrictEqual(reference);
    expect(await storedObject(peerStore, peerReference)).toStrictEqual(
      imageBytes,
    );

    await peer.dispose();
    await expect(access(peerStore)).rejects.toThrow('ENOENT');
    const ownerHistory = await collectResumeRows(fixture.agent.streamHistory());
    expect(ownerHistory[0]?.blocks[0]).toStrictEqual(reference);
    expect(ownerHistory[0]?.blocks[0]).not.toBe(reference);
    expect(await storedObject(ownerStore, reference)).toStrictEqual(imageBytes);
    await fixture.dispose();
    await expect(access(ownerStore)).rejects.toThrow('ENOENT');
  });
});
