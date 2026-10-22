/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { JournalSession } from '../services/history/journalSession.js';
import { JournalProviderRequestSnapshot } from '../services/history/journal-provider-request.js';
import { LocalMediaStore } from './local-media-store.js';
import { HistoryMediaOwnership } from './history-media-ownership.js';
import { RequestMediaResolver } from './request-media-resolver.js';
import { encodeSessionFact } from '../recording/sessionMetaKeys.js';

import type {
  IContent,
  MediaReferenceBlock,
} from '../services/history/IContent.js';

interface DeferredMediaFixture {
  readonly session: JournalSession;
  readonly media: LocalMediaStore;
  readonly reference: MediaReferenceBlock;
  readonly row: IContent;
  readonly owner: HistoryMediaOwnership;
  readonly request: JournalProviderRequestSnapshot;
  readonly bytes: Uint8Array;
}

export async function deferredMediaFixture(
  directory: string,
  retainCheckpoint = false,
): Promise<DeferredMediaFixture> {
  const session = await JournalSession.create(join(directory, 'history.llxj'));
  await session.store.commit([
    {
      kind: 'setState',
      key: 'session:id',
      value: encodeSessionFact('queue-lifecycle'),
    },
    {
      kind: 'setState',
      key: 'session:start',
      value: encodeSessionFact({
        startTime: '2026-10-22T00:00:00Z',
        projectHash: 'queue',
        workspaceDirs: [],
        kind: 'main',
      }),
    },
    {
      kind: 'setState',
      key: 'session:provider',
      value: encodeSessionFact({ provider: 'openai', model: 'fixture' }),
    },
  ]);
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
  const row: IContent = { speaker: 'human', blocks: [reference] };
  await session.append([row]);
  if (retainCheckpoint)
    await session.store.commit([
      { kind: 'checkpoint', id: 'media', name: 'media', createdAtMs: 1 },
    ]);
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
  const directory = process.argv.slice(2).shift();
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
  process.kill(process.pid, 'SIGKILL');
}
