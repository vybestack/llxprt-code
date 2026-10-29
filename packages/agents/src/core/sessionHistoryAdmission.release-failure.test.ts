/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isMediaReferenceBlock,
  type IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { admitSessionHistory } from './sessionHistoryAdmission.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';

const imageRow: IContent = {
  speaker: 'human',
  blocks: [
    {
      type: 'media',
      mimeType: 'image/png',
      encoding: 'base64',
      data: PNG_BASE64,
    },
  ],
  metadata: { turnId: 'turn-1' },
};

function mediaIndexDirectories(): string[] {
  return readdirSync(getScratchRoot()).filter((name) =>
    name.startsWith('history-media-index-'),
  );
}

describe('session history admission release', () => {
  let directory = '';
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'session-admission-release-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('removes the media index scratch after retrying a failed reservation release', async () => {
    const store = new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 1024,
    });
    const admission = new MediaAdmissionService(store);
    const admitted = admitSessionHistory([imageRow], admission, 'scope-1');
    let contentId = '';
    for await (const row of admitted.rows) {
      expect(row.blocks).toHaveLength(1);
      const block = row.blocks[0];
      if (!isMediaReferenceBlock(block))
        throw new Error('Expected an admitted media reference');
      contentId = block.contentId;
    }
    expect(await store.hasReservations(contentId)).toBe(true);
    expect(mediaIndexDirectories()).toHaveLength(1);

    const releaseReference = admission.releaseReference.bind(admission);
    admission.releaseReference = (): Promise<void> =>
      Promise.reject(new Error('release failed'));

    await expect(admitted.release()).rejects.toThrow('release failed');
    expect(mediaIndexDirectories()).toHaveLength(1);
    admission.releaseReference = releaseReference;
    await admitted.release();
    expect(mediaIndexDirectories()).toStrictEqual([]);
    expect(await store.hasReservations(contentId)).toBe(false);
  });
});
