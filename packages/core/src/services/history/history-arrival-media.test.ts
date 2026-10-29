/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { HistoryService } from './HistoryService.js';

describe('arrival media publication ownership', () => {
  let directory: string;
  let media: LocalMediaStore;
  let history: HistoryService;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arrival-media-'));
    media = new LocalMediaStore({ rootDirectory: directory, quotaBytes: 4096 });
    history = new HistoryService();
    await history.registerRuntimeMediaOwner(media);
  });
  afterEach(async () => {
    await history.dispose();
    await media.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('retains accepted media after its producer reservation is released', async () => {
    const reference = await media.admit({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    await media.reserve(reference, 'producer');
    const arrival = await history.openResponseArrival({
      id: 'media',
      submissionId: 'prompt',
    });
    await arrival.append(reference);
    await arrival.seal({}, undefined, async () => {
      await media.release(reference.contentId, 'producer');
    });
    expect(await media.hasReservations(reference.contentId)).toBe(true);
    expect(
      (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
    ).toBe(0);
    expect(await media.readVerified(reference)).toStrictEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
  it('releases publication ownership when the sealed consumer rejects', async () => {
    const reference = await media.admit({
      bytes: new Uint8Array([4, 5, 6]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const arrival = await history.openResponseArrival({
      id: 'rejected-media',
      submissionId: 'prompt',
    });
    await arrival.append(reference);
    await expect(
      arrival.seal({}, undefined, async () => {
        throw new Error('rejected publication');
      }),
    ).rejects.toThrow('rejected publication');
    await history.waitForCommit();
    expect(history.length()).toBe(0);
    expect(await media.hasReservations(reference.contentId)).toBe(false);
  });
});
