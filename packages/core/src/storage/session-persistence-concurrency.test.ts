/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  assertDefined,
  assertNotNull,
} from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import type { IContent } from '../services/history/IContent.js';
import { LocalMediaStore } from './local-media-store.js';
import { MediaAdmissionError } from './media-admission-service.js';
import {
  SessionPersistenceService,
  type SessionPersistenceServiceOptions,
} from './SessionPersistenceService.js';

function textHistory(text: string): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text }],
    },
  ];
}

function inlineImageHistory(data = 'AQ=='): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data,
        },
      ],
      metadata: { turnId: 'persistence-inline-image' },
    },
  ];
}

function contentIdFor(data: string): string {
  return `sha256:${createHash('sha256').update(data, 'base64').digest('hex')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseObject(serialized: string): Record<string, unknown> {
  const value: unknown = JSON.parse(serialized);
  if (!isRecord(value)) {
    throw new Error('Expected persisted session object');
  }
  return value;
}

function persistedMediaContentId(serialized: string): string {
  const session = parseObject(serialized);
  const history = session['history'];
  if (!Array.isArray(history)) throw new Error('Expected persisted history');
  const content = history[0];
  if (!isRecord(content)) throw new Error('Expected persisted content');
  const blocks = content['blocks'];
  if (!Array.isArray(blocks)) throw new Error('Expected persisted blocks');
  const block = blocks[0];
  if (!isRecord(block) || typeof block['contentId'] !== 'string') {
    throw new Error('Expected persisted media reference');
  }
  return block['contentId'];
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch (error: unknown) {
    if (isRecord(error) && error['code'] === 'ENOENT') return false;
    throw error;
  }
}

async function writePersistedSession(
  service: SessionPersistenceService,
  storage: Storage,
  history: readonly IContent[],
): Promise<void> {
  const session = {
    version: 1,
    sessionId: 'loaded-session',
    projectHash: createHash('sha256')
      .update(storage.getProjectRoot())
      .digest('hex'),
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    history,
  };
  await mkdir(dirname(service.getSessionFilePath()), { recursive: true });
  await writeFile(service.getSessionFilePath(), JSON.stringify(session));
}

class RollbackFailingMediaStore extends LocalMediaStore {
  override async release(contentId: string, ownerId: string): Promise<void> {
    await super.release(contentId, ownerId);
    throw new Error('load rollback unavailable');
  }
}

class FailOnceReleaseMediaStore extends LocalMediaStore {
  private releaseFailed = false;

  override async release(contentId: string, ownerId: string): Promise<void> {
    await super.release(contentId, ownerId);
    if (!this.releaseFailed) {
      this.releaseFailed = true;
      throw new Error('transient ownership release failure');
    }
  }
}

function findMediaAdmissionError(
  error: unknown,
): MediaAdmissionError | undefined {
  if (error instanceof MediaAdmissionError) return error;
  if (error instanceof AggregateError) {
    for (const nested of error.errors) {
      const found = findMediaAdmissionError(nested);
      if (found !== undefined) return found;
    }
  }
  if (error instanceof Error && error.cause !== undefined) {
    return findMediaAdmissionError(error.cause);
  }
  return undefined;
}

function errorMessages(error: unknown): readonly string[] {
  if (error instanceof AggregateError) {
    return [
      error.message,
      ...error.errors.flatMap((nested) => errorMessages(nested)),
    ];
  }
  if (error instanceof Error) {
    return error.cause === undefined
      ? [error.message]
      : [error.message, ...errorMessages(error.cause)];
  }
  return [String(error)];
}

describe('SessionPersistenceService concurrent saves', () => {
  let projectRoot = '';
  let storage: Storage;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'llxprt-persistence-queue-'));
    storage = new Storage(projectRoot);
  });

  afterEach(async () => {
    await rm(storage.getProjectTempDir(), { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('serializes generations without losing the final state or sharing temporary files', async () => {
    const service = new SessionPersistenceService(
      storage,
      'concurrent-session',
      {
        maxQueueBytes: 1024 * 1024,
      },
    );

    const saves = [
      service.save(textHistory('generation-one')),
      service.save(textHistory('generation-two')),
      service.save(textHistory('generation-three')),
    ];

    expect(service.getPendingByteCount()).toBeGreaterThan(0);
    await Promise.all(saves);

    const serialized = await readFile(service.getSessionFilePath(), 'utf8');
    const persisted = parseObject(serialized);
    const directoryEntries = await readdir(
      dirname(service.getSessionFilePath()),
    );

    expect(persisted['generation']).toBe(3);
    expect(serialized).toContain('generation-three');
    expect(serialized).not.toContain('generation-one');
    expect(serialized).not.toContain('generation-two');
    expect(
      directoryEntries.filter((entry) => entry.endsWith('.tmp')),
    ).toStrictEqual([]);
    expect(service.getPendingByteCount()).toBe(0);
  });

  it('rejects one failed generation while continuing with the next queued snapshot', async () => {
    const mediaStore = new LocalMediaStore({
      rootDirectory: join(projectRoot, 'media'),
      quotaBytes: 1024,
    });
    const service = new SessionPersistenceService(storage, 'failure-session', {
      mediaStore,
      maxQueueBytes: 1024 * 1024,
    });
    const invalidHistory: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'image/png',
            data: 'not-base64',
          },
        ],
      },
    ];

    const failed = service.save(invalidHistory);
    const succeeded = service.save(textHistory('saved-after-failure'));

    await expect(failed).rejects.toThrow(/media admission failed/i);
    await succeeded;
    const serialized = await readFile(service.getSessionFilePath(), 'utf8');

    expect(serialized).toContain('saved-after-failure');
    expect(parseObject(serialized)['generation']).toBe(2);
    expect(service.getPendingByteCount()).toBe(0);
  });

  it('returns a rejected promise instead of throwing synchronously when snapshot cloning fails', async () => {
    let saveResult: Promise<void> | undefined;

    expect(() => {
      saveResult = serviceWithStorage('clone-failure').save([], undefined, [
        { id: 1, type: 'tool_group', tools: [() => undefined] },
      ]);
    }).not.toThrow();
    assertDefined(saveResult, 'Expected a save promise');
    await expect(saveResult).rejects.toBeInstanceOf(Error);
  });

  it('accepts the exact queued snapshot byte limit and rejects one byte less', async () => {
    const history = textHistory('exact queue limit');
    const probe = serviceWithStorage('queue-probe');
    const probeSave = probe.save(history);
    const exactBytes = probe.getPendingByteCount();
    await probeSave;

    const exact = serviceWithStorage('queue-exact', {
      maxQueueBytes: exactBytes,
    });
    const exactSave = exact.save(history);
    expect(exact.getPendingByteCount()).toBe(exactBytes);
    await exactSave;

    const over = serviceWithStorage('queue-overx', {
      maxQueueBytes: exactBytes - 1,
    });
    const rejected = over.save(history);

    expect(over.getPendingByteCount()).toBe(0);
    await expect(rejected).rejects.toThrow(/queue byte limit/i);
  });

  it('rejects an oversized inline request before the real media store allocates files', async () => {
    const mediaRoot = join(projectRoot, 'preflight-media');
    const mediaStore = new LocalMediaStore({
      rootDirectory: mediaRoot,
      quotaBytes: 1024 * 1024,
    });
    const oversizedBase64 = Buffer.alloc(4096, 7).toString('base64');
    const bounded = serviceWithStorage('preflight-save', {
      mediaStore,
      maxQueueBytes: 128,
    });

    await expect(
      bounded.save(inlineImageHistory(oversizedBase64), undefined, [
        { id: 1, type: 'tool_group', tools: [() => undefined] },
      ]),
    ).rejects.toThrow(/queue byte limit/i);

    expect(await pathExists(mediaRoot)).toBe(false);
    expect(bounded.getPendingByteCount()).toBe(0);
  });

  it('preflights a prepared save before cloning or allocating media', async () => {
    const mediaRoot = join(projectRoot, 'prepared-preflight-media');
    const mediaStore = new LocalMediaStore({
      rootDirectory: mediaRoot,
      quotaBytes: 1024 * 1024,
    });
    const oversizedBase64 = Buffer.alloc(4096, 11).toString('base64');
    const first = inlineImageHistory(oversizedBase64)[0];
    const history: IContent[] = [
      {
        ...first,
        metadata: {
          ...first.metadata,
          providerMetadata: { uncloneable: () => undefined },
        },
      },
    ];
    const bounded = serviceWithStorage('prepared-preflight', {
      mediaStore,
      maxQueueBytes: 128,
    });

    await expect(bounded.prepareSave(history)).rejects.toThrow(
      /queue byte limit/i,
    );

    expect(await pathExists(mediaRoot)).toBe(false);
    expect(bounded.getPendingByteCount()).toBe(0);
  });

  it('accepts an exact post-admission byte limit with a real media store', async () => {
    const probeStore = new LocalMediaStore({
      rootDirectory: join(projectRoot, 'exact-probe-media'),
      quotaBytes: 1024,
    });
    const probe = serviceWithStorage('exact-probe', { mediaStore: probeStore });

    await probe.save(inlineImageHistory());
    const probeBytes = (await stat(probe.getSessionFilePath())).size;
    const probeContentId = persistedMediaContentId(
      await readFile(probe.getSessionFilePath(), 'utf8'),
    );

    expect(await probeStore.hasReservations(probeContentId)).toBe(false);

    const exactStore = new LocalMediaStore({
      rootDirectory: join(projectRoot, 'exact-store-media'),
      quotaBytes: 1024,
    });
    const exact = serviceWithStorage('exact-store', {
      mediaStore: exactStore,
      maxQueueBytes: probeBytes,
    });

    await exact.save(inlineImageHistory());
    const exactBytes = (await stat(exact.getSessionFilePath())).size;
    const exactContentId = persistedMediaContentId(
      await readFile(exact.getSessionFilePath(), 'utf8'),
    );

    expect(exactBytes).toBe(probeBytes);
    expect(exact.getPendingByteCount()).toBe(0);
    expect(await exactStore.hasReservations(exactContentId)).toBe(false);
  });

  it('releases admission ownership after a successful save publishes references', async () => {
    const mediaStore = new LocalMediaStore({
      rootDirectory: join(projectRoot, 'save-success-media'),
      quotaBytes: 1024,
    });
    const persistence = serviceWithStorage('save-success', { mediaStore });

    await persistence.save(inlineImageHistory());
    const contentId = persistedMediaContentId(
      await readFile(persistence.getSessionFilePath(), 'utf8'),
    );

    expect(await mediaStore.hasReservations(contentId)).toBe(false);
    expect(persistence.getPendingByteCount()).toBe(0);
  });

  it('releases admission ownership when a save fails after media admission', async () => {
    const failedStorage = new Storage(join(projectRoot, 'save-failure'));
    const mediaStore = new LocalMediaStore({
      rootDirectory: join(failedStorage.getProjectTempDir(), 'media'),
      quotaBytes: 1024,
    });
    const persistence = new SessionPersistenceService(
      failedStorage,
      'save-failure',
      { mediaStore },
    );
    await mkdir(failedStorage.getProjectTempDir(), { recursive: true });
    await writeFile(
      join(failedStorage.getProjectTempDir(), 'chats'),
      'blocked',
    );

    await expect(persistence.save(inlineImageHistory())).rejects.toBeInstanceOf(
      Error,
    );

    expect(await mediaStore.hasReservations(contentIdFor('AQ=='))).toBe(false);
    expect(persistence.getPendingByteCount()).toBe(0);
  });

  it('aggregates the save failure with every media ownership cleanup failure', async () => {
    const failedStorage = new Storage(join(projectRoot, 'cleanup-failure'));
    const mediaStore = new RollbackFailingMediaStore({
      rootDirectory: join(failedStorage.getProjectTempDir(), 'media'),
      quotaBytes: 1024,
    });
    const persistence = new SessionPersistenceService(
      failedStorage,
      'cleanup-failure',
      { mediaStore },
    );
    await mkdir(failedStorage.getProjectTempDir(), { recursive: true });
    await writeFile(
      join(failedStorage.getProjectTempDir(), 'chats'),
      'blocked',
    );

    const failure = await persistence.save(inlineImageHistory()).then(
      (): unknown => undefined,
      (error: unknown): unknown => error,
    );
    const messages = errorMessages(failure);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(messages.some((message) => message.includes('EEXIST'))).toBe(true);
    expect(
      messages.filter((message) => message === 'load rollback unavailable'),
    ).toHaveLength(2);
    expect(await mediaStore.hasReservations(contentIdFor('AQ=='))).toBe(false);
    expect(persistence.getPendingByteCount()).toBe(0);
  });

  it('releases staged admission ownership when a prepared save is published', async () => {
    const mediaStore = new LocalMediaStore({
      rootDirectory: join(projectRoot, 'prepared-publish-media'),
      quotaBytes: 1024,
    });
    const persistence = serviceWithStorage('prepared-publish', { mediaStore });
    const contentId = contentIdFor('AQ==');

    const prepared = await persistence.prepareSave(inlineImageHistory());
    expect(await mediaStore.hasReservations(contentId)).toBe(true);

    await prepared.publish();

    expect(await mediaStore.hasReservations(contentId)).toBe(false);
    await prepared.finalize();
    expect(persistence.getPendingByteCount()).toBe(0);
  });

  it('releases staged admission ownership when a prepared save is rolled back', async () => {
    const mediaStore = new LocalMediaStore({
      rootDirectory: join(projectRoot, 'prepared-rollback-media'),
      quotaBytes: 1024,
    });
    const persistence = serviceWithStorage('prepared-rollback', { mediaStore });
    const contentId = contentIdFor('AQ==');

    const prepared = await persistence.prepareSave(inlineImageHistory());
    expect(await mediaStore.hasReservations(contentId)).toBe(true);

    await prepared.rollback();

    expect(await mediaStore.hasReservations(contentId)).toBe(false);
    expect(persistence.getPendingByteCount()).toBe(0);
  });

  it('transfers loaded inline media ownership through an explicit release handle', async () => {
    const loadStorage = new Storage(join(projectRoot, 'load-success'));
    const mediaStore = new LocalMediaStore({
      rootDirectory: join(loadStorage.getProjectTempDir(), 'media'),
      quotaBytes: 1024,
    });
    const persistence = new SessionPersistenceService(
      loadStorage,
      'load-success',
      { mediaStore },
    );
    await writePersistedSession(persistence, loadStorage, inlineImageHistory());

    const loaded = await persistence.loadMostRecent();
    assertNotNull(loaded, 'Expected loaded session');
    const contentId = contentIdFor('AQ==');

    expect(await mediaStore.hasReservations(contentId)).toBe(true);
    await loaded.mediaOwnership.release();
    expect(await mediaStore.hasReservations(contentId)).toBe(false);
  });

  it('retries loaded media ownership cleanup until release succeeds', async () => {
    const loadStorage = new Storage(join(projectRoot, 'load-release-retry'));
    const mediaStore = new FailOnceReleaseMediaStore({
      rootDirectory: join(loadStorage.getProjectTempDir(), 'media'),
      quotaBytes: 1024,
    });
    const persistence = new SessionPersistenceService(
      loadStorage,
      'load-release-retry',
      { mediaStore },
    );
    await writePersistedSession(persistence, loadStorage, inlineImageHistory());
    const loaded = await persistence.loadMostRecent();
    assertNotNull(loaded, 'Expected loaded session');
    const firstFailure = await loaded.mediaOwnership.release().then(
      (): unknown => undefined,
      (error: unknown): unknown => error,
    );

    expect(errorMessages(firstFailure)).toContain(
      'transient ownership release failure',
    );
    await expect(loaded.mediaOwnership.release()).resolves.toBeUndefined();
    await loaded.mediaOwnership.release();
    expect(await mediaStore.hasReservations(contentIdFor('AQ=='))).toBe(false);
  });

  it('settles ownership when loading inline media fails partway through admission', async () => {
    const loadStorage = new Storage(join(projectRoot, 'load-failure'));
    const mediaStore = new LocalMediaStore({
      rootDirectory: join(loadStorage.getProjectTempDir(), 'media'),
      quotaBytes: 1024,
    });
    const persistence = new SessionPersistenceService(
      loadStorage,
      'load-failure',
      { mediaStore },
    );
    const first = inlineImageHistory()[0];
    const failingHistory: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          ...first.blocks,
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'image/png',
            data: 'not-base64',
          },
        ],
        metadata: { turnId: 'load-failure' },
      },
    ];
    await writePersistedSession(persistence, loadStorage, failingHistory);

    await expect(persistence.loadMostRecent()).rejects.toThrow(
      /media admission failed/i,
    );

    expect(await mediaStore.hasReservations(contentIdFor('AQ=='))).toBe(false);
  });

  it('rechecks the queue limit after inline media admission changes serialized bytes', async () => {
    const inlineHistory: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'image/png',
            data: 'AQ==',
          },
        ],
        metadata: { turnId: 'post-admission-delta' },
      },
    ];
    const probeStore = new LocalMediaStore({
      rootDirectory: join(projectRoot, 'delta-probe-media'),
      quotaBytes: 1024,
    });
    const probe = serviceWithStorage('delta-probe', {
      mediaStore: probeStore,
    });
    const probeSave = probe.save(inlineHistory);
    const preAdmissionBytes = probe.getPendingByteCount();
    await probeSave;

    const boundedStore = new LocalMediaStore({
      rootDirectory: join(projectRoot, 'delta-bounded-media'),
      quotaBytes: 1024,
    });
    const bounded = serviceWithStorage('delta-limit', {
      mediaStore: boundedStore,
      maxQueueBytes: preAdmissionBytes,
    });

    await expect(bounded.save(inlineHistory)).rejects.toThrow(
      /queue byte limit/i,
    );
    expect(bounded.getPendingByteCount()).toBe(0);
  });

  it('rejects load when admission rollback aggregates a media diagnostic', async () => {
    const loadStorage = new Storage(join(projectRoot, 'aggregate-load'));
    const mediaStore = new RollbackFailingMediaStore({
      rootDirectory: join(projectRoot, 'aggregate-load-media'),
      quotaBytes: 1024,
    });
    const loadService = new SessionPersistenceService(
      loadStorage,
      'aggregate-load-session',
      { mediaStore },
    );
    const persistedHistory: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'image/png',
            data: 'AQ==',
          },
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'image/png',
            data: 'not-base64',
          },
        ],
        metadata: { turnId: 'aggregate-load-turn' },
      },
    ];
    const persisted = {
      version: 1,
      sessionId: 'aggregate-load-session',
      projectHash: createHash('sha256')
        .update(loadStorage.getProjectRoot())
        .digest('hex'),
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
      history: persistedHistory,
    };
    await mkdir(dirname(loadService.getSessionFilePath()), { recursive: true });
    await writeFile(
      loadService.getSessionFilePath(),
      JSON.stringify(persisted),
    );

    const rejection = await loadService.loadMostRecent().then(
      (): unknown => undefined,
      (error: unknown): unknown => error,
    );
    const diagnostic = findMediaAdmissionError(rejection);

    expect(rejection).toBeInstanceOf(AggregateError);
    expect(diagnostic).toBeInstanceOf(MediaAdmissionError);
    expect(diagnostic?.turnId).toBe('aggregate-load-turn');
  });

  function serviceWithStorage(
    name: string,
    options: SessionPersistenceServiceOptions = {},
  ): SessionPersistenceService {
    return new SessionPersistenceService(
      new Storage(join(projectRoot, name)),
      name,
      options,
    );
  }
});
