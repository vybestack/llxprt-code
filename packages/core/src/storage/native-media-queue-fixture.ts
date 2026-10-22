/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { JournalSession } from '../services/history/journalSession.js';
import { JournalProviderRequestSnapshot } from '../services/history/journal-provider-request.js';
import { LocalMediaStore } from './local-media-store.js';
import { HistoryMediaOwnership } from './history-media-ownership.js';
import { RequestMediaResolver } from './request-media-resolver.js';

export async function deferredMediaFixture(directory: string) {
  const session = await JournalSession.create(join(directory, 'history.llxj'));
  const media = new LocalMediaStore({
    rootDirectory: join(directory, 'media'),
    quotaBytes: 1024,
  });
  const bytes = new Uint8Array([13, 21, 34]);
  const reference = await media.admit({
    bytes,
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  const row = {
    speaker: 'human',
    blocks: [reference],
  } satisfies import('../services/history/IContent.js').IContent;
  await session.append([row]);
  const owner = new HistoryMediaOwnership(media);
  owner.adopt([row]);
  await owner.bindNativeMedia(session.store);
  const request = await JournalProviderRequestSnapshot.create(
    await session.store.snapshot(),
    [],
    {},
    undefined,
    undefined,
    undefined,
    media,
  );
  await session.store.commit([{ kind: 'clear' }]);
  await owner.reconcile([row], () => []);
  return { session, media, reference, row, owner, request, bytes };
}

if (import.meta.main) {
  const directory = process.argv[2];
  if (directory === undefined) throw new Error('Missing fixture directory');
  const fixture = await deferredMediaFixture(directory);
  const protectedObjects = await fixture.media.reclaimUnreferenced(
    new Set(),
    Number.MAX_SAFE_INTEGER,
  );
  const resolved = await new RequestMediaResolver(fixture.media).resolve({
    contents: [await fixture.request.readAt(0)],
    requestId: 'crash-reader',
    turnId: 'crash-turn',
    aggregateBudgetBytes: 1024,
    lease: fixture.request.native.mediaLease,
  });
  const blocks = resolved.withContents((rows) => rows[0].blocks);
  await resolved.release();
  assert.equal(protectedObjects.objectsRemoved, 0);
  assert.deepEqual(blocks, [
    {
      type: 'media',
      encoding: 'base64',
      data: 'DRUi',
      mimeType: 'image/png',
      semanticMetadata: {},
    },
  ]);
  assert.notEqual(fixture.session.store.mediaPins.oldestVersion, undefined);
  process.exit(77);
}
