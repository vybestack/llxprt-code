/**
 * @license
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { assertInstanceOf } from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent, MediaReferenceBlock } from './IContent.js';
import { HistoryService } from './HistoryService.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { MediaAdmissionService } from '../../storage/media-admission-service.js';
import { historyOwnerIdFor } from '../../storage/media-admission-service.js';
import type { DensityResult } from '../../core/compression/types.js';
import { HistoryMediaOwnership } from '../../storage/history-media-ownership.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const SECOND_IMAGE_BASE64 = 'AQIDBAUGBwg=';

function inlineImageContent(data = PNG_BASE64): IContent {
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'inspect' },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data,
      },
    ],
  };
}

function referenceBlockOf(content: IContent): MediaReferenceBlock {
  const block = content.blocks.find((candidate) => candidate.type === 'media');
  if (block?.type !== 'media' || block.encoding !== 'reference') {
    throw new Error('Expected admitted media reference');
  }
  return block;
}

function reservations(
  admitted: readonly IContent[],
): ReadonlyArray<{ readonly contentId: string; readonly ownerId: string }> {
  return admitted
    .flatMap((content) => content.blocks)
    .filter(
      (block): block is MediaReferenceBlock =>
        block.type === 'media' && block.encoding === 'reference',
    )
    .map((block) => ({
      contentId: block.contentId,
      ownerId: historyOwnerIdFor(block.contentId),
    }));
}

function leafMessages(error: unknown): string[] {
  return error instanceof AggregateError
    ? error.errors.flatMap(leafMessages)
    : [error instanceof Error ? error.message : String(error)];
}

class FailOnceReleaseStore extends LocalMediaStore {
  private releaseFailures = 0;

  failEach(releaseFailures: number): void {
    this.releaseFailures = releaseFailures;
  }

  override async release(contentId: string, ownerId: string): Promise<void> {
    if (this.releaseFailures > 0) {
      this.releaseFailures -= 1;
      throw new Error('induced history release failure');
    }
    await super.release(contentId, ownerId);
  }
}

class FailOnceReserveStore extends LocalMediaStore {
  private shouldFail = false;

  failNextReserve(): void {
    this.shouldFail = true;
  }

  override async reserve(
    reference: MediaReferenceBlock,
    ownerId: string,
  ): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error('induced history reserve failure');
    }
    await super.reserve(reference, ownerId);
  }
}

describe('HistoryService local-media ownership lifecycle', () => {
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(
      join(tmpdir(), 'llxprt-history-media-ownership-'),
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function storeOf(): LocalMediaStore {
    return new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 1024 * 1024,
    });
  }

  function serviceOf(store: LocalMediaStore): HistoryService {
    const service = new HistoryService();
    service.registerMediaOwner(new HistoryMediaOwnership(store));
    return service;
  }

  async function admitted(
    store: LocalMediaStore,
    contents: readonly IContent[],
  ): Promise<readonly IContent[]> {
    return new MediaAdmissionService(store).admitContents(contents, {
      turnId: 'test-turn',
      source: 'user-input',
    });
  }

  it('adopts the durable reservation exactly once for content entering live history via addBatch', async () => {
    const store = storeOf();
    const service = serviceOf(store);
    const first = await admitted(store, [inlineImageContent(PNG_BASE64)]);

    await service.addBatch(first, undefined, {
      adoptedOwners: reservations(first),
    });
    await service.waitForOwnershipSettlement();

    const block = referenceBlockOf(first[0]);
    expect(await store.hasReservations(block.contentId)).toBe(true);
  });

  it('retries canonical ownership settlement after an initial reserve failure', async () => {
    const store = new FailOnceReserveStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 1024 * 1024,
    });
    const initial = await admitted(store, [inlineImageContent()]);
    const block = referenceBlockOf(initial[0]);
    const admissionContext = {
      turnId: 'test-turn',
      source: 'user-input',
    };
    const service = new HistoryService();
    service.addAll(initial);
    service.registerMediaOwner(new HistoryMediaOwnership(store));
    store.failNextReserve();

    await expect(service.settleMediaOwnership()).rejects.toThrow(
      'induced history reserve failure',
    );
    await new MediaAdmissionService(store).releaseContents(
      initial,
      admissionContext,
    );
    expect(await store.hasReservations(block.contentId)).toBe(false);

    await service.settleMediaOwnership();
    expect(await store.hasReservations(block.contentId)).toBe(true);

    service.clear();
    await service.waitForOwnershipSettlement();
    expect(await store.hasReservations(block.contentId)).toBeFalsy();
  });

  it('keeps overlapping references and releases only content that leaves on replaceBatch then clear', async () => {
    const store = storeOf();
    const service = serviceOf(store);
    const first = await admitted(store, [inlineImageContent(PNG_BASE64)]);
    await service.addBatch(first, undefined, {
      adoptedOwners: reservations(first),
    });
    const retained = referenceBlockOf(first[0]);

    const second = await admitted(store, [
      inlineImageContent(PNG_BASE64),
      inlineImageContent(SECOND_IMAGE_BASE64),
    ]);
    const removed = referenceBlockOf(second[1]);
    await service.replaceBatch(second, undefined, {
      adoptedOwners: reservations(second),
    });

    const afterReplace = {
      retained: await store.hasReservations(retained.contentId),
      removed: await store.hasReservations(removed.contentId),
    };

    service.clear();
    await service.waitForOwnershipSettlement();

    expect({
      afterReplace,
      retainedAfterClear: await store.hasReservations(retained.contentId),
      removedAfterClear: await store.hasReservations(removed.contentId),
    }).toStrictEqual({
      afterReplace: { retained: true, removed: true },
      retainedAfterClear: false,
      removedAfterClear: false,
    });
  });

  it('releases every reservation on clear and dispose with nothing left behind', async () => {
    const store = storeOf();
    const service = serviceOf(store);
    const content = await admitted(store, [inlineImageContent(PNG_BASE64)]);
    await service.addBatch(content, undefined, {
      adoptedOwners: reservations(content),
    });
    const block = referenceBlockOf(content[0]);

    service.clear();
    await service.waitForOwnershipSettlement();
    const afterClear = await store.hasReservations(block.contentId);

    const second = await admitted(store, [
      inlineImageContent(SECOND_IMAGE_BASE64),
    ]);
    await service.addBatch(second, undefined, {
      adoptedOwners: reservations(second),
    });
    const secondBlock = referenceBlockOf(second[0]);
    service.dispose();
    await service.waitForOwnershipSettlement();

    expect({
      afterClear,
      afterDispose: await store.hasReservations(secondBlock.contentId),
    }).toStrictEqual({ afterClear: false, afterDispose: false });
  });

  it('keeps retained references and releases compression-removed references through replaceAll and transformAll', async () => {
    const store = storeOf();
    const service = serviceOf(store);
    const first = await admitted(store, [inlineImageContent(PNG_BASE64)]);
    await service.addBatch(first, undefined, {
      adoptedOwners: reservations(first),
    });
    const retained = referenceBlockOf(first[0]);
    const introduced = await admitted(store, [
      inlineImageContent(SECOND_IMAGE_BASE64),
    ]);
    const introducedBlock = referenceBlockOf(introduced[0]);

    await service.replaceAll([...first, ...introduced]);
    const afterReplace = {
      retained: await store.hasReservations(retained.contentId),
      introduced: await store.hasReservations(introducedBlock.contentId),
    };

    await service.replaceAll([introduced[0]]);
    const afterPurge = {
      retained: await store.hasReservations(retained.contentId),
      introduced: await store.hasReservations(introducedBlock.contentId),
    };

    expect({ afterReplace, afterPurge }).toStrictEqual({
      afterReplace: { retained: true, introduced: true },
      afterPurge: { retained: false, introduced: true },
    });
  });

  it('releases media removed by a density mutation while retaining surviving ownership', async () => {
    const store = storeOf();
    const service = serviceOf(store);
    const contents = await admitted(store, [
      inlineImageContent(PNG_BASE64),
      inlineImageContent(SECOND_IMAGE_BASE64),
    ]);
    await service.addBatch(contents, undefined, {
      adoptedOwners: reservations(contents),
    });
    const removed = referenceBlockOf(contents[0]);
    const retained = referenceBlockOf(contents[1]);
    const densityResult: DensityResult = {
      removals: [0],
      replacements: new Map(),
      metadata: {
        readWritePairsPruned: 0,
        fileDeduplicationsPruned: 0,
        recencyPruned: 1,
      },
    };

    await service.applyDensityResult(densityResult);

    expect({
      history: service.getAll(),
      removed: await store.hasReservations(removed.contentId),
      retained: await store.hasReservations(retained.contentId),
    }).toStrictEqual({
      history: [contents[1]],
      removed: false,
      retained: true,
    });
  });

  it('restores ownership and history together when a batch listener fails', async () => {
    const store = storeOf();
    const service = serviceOf(store);
    const previous = await admitted(store, [inlineImageContent(PNG_BASE64)]);
    await service.addBatch(previous, undefined, {
      adoptedOwners: reservations(previous),
    });
    const previousBlock = referenceBlockOf(previous[0]);
    const replacement = await admitted(store, [
      inlineImageContent(SECOND_IMAGE_BASE64),
    ]);
    service.on('contentBatchAdded', () => {
      throw new Error('batch listener failed');
    });

    await expect(
      service.addBatch(replacement, undefined, {
        adoptedOwners: reservations(replacement),
      }),
    ).rejects.toThrow('batch listener failed');

    const restored = service.getAll()[0];
    const restoredBlock = referenceBlockOf(restored);
    expect(restoredBlock.contentId).toBe(previousBlock.contentId);
    expect(await store.hasReservations(previousBlock.contentId)).toBe(true);
    expect(
      await store.hasReservations(referenceBlockOf(replacement[0]).contentId),
    ).toBe(false);
  });

  it('aggregates the primary mutation failure with an ownership cleanup failure', async () => {
    const store = new FailOnceReleaseStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 1024 * 1024,
    });
    const service = serviceOf(store);
    store.failEach(1);
    const replacement = await admitted(store, [inlineImageContent(PNG_BASE64)]);
    service.on('contentBatchAdded', () => {
      throw new Error('primary batch failure');
    });

    let failure: unknown;
    try {
      await service.addBatch(replacement, undefined, {
        adoptedOwners: reservations(replacement),
      });
    } catch (error: unknown) {
      failure = error;
    }
    assertInstanceOf(failure, AggregateError, 'Expected aggregated failure');
    expect(leafMessages(failure)).toContain('primary batch failure');
    expect(leafMessages(failure)).toContain('induced history release failure');
  });

  it('keeps legacy inline and URL media compatible without ownership changes', async () => {
    const store = storeOf();
    const service = serviceOf(store);
    const legacy: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/svg+xml',
            encoding: 'base64',
            data: 'PHN2Zy8+',
          },
        ],
      },
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'url',
            data: 'https://example.test/image.png',
          },
        ],
      },
    ];

    await service.addBatch(legacy);
    const before = service.getAll().map((content) => content.blocks[0].type);

    service.clear();
    await service.waitForOwnershipSettlement();

    expect({ before, after: service.getAll() }).toStrictEqual({
      before: ['media', 'media'],
      after: [],
    });
  });

  it('does not lose a concurrent add while earlier ownership settles', async () => {
    const store = storeOf();
    const service = serviceOf(store);
    const first = await admitted(store, [inlineImageContent(PNG_BASE64)]);

    await service.addBatch(first, undefined, {
      adoptedOwners: reservations(first),
    });
    await service.addBatch([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'after' }] },
    ]);
    await service.waitForOwnershipSettlement();

    const texts = service
      .getAll()
      .map((content) =>
        content.blocks
          .filter((block) => block.type === 'text')
          .map((block) => block.text),
      )
      .flat();
    expect(texts).toStrictEqual(['inspect', 'after']);
    expect(
      await store.hasReservations(referenceBlockOf(first[0]).contentId),
    ).toBe(true);
  });
});
