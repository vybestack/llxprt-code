/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  LocalMediaStore,
  MediaStoreError,
  type LocalMediaStoreOptions,
} from './local-media-store.js';
import { DebugLogger } from '../debug/index.js';
import { publishRecordedMedia } from './recorded-media-transfer.js';
import { RequestMediaResolver } from './request-media-resolver.js';

const LOCK_TIMEOUT_MS = 40;

async function withHeldStore<T>(
  store: LocalMediaStore,
  work: () => Promise<T>,
): Promise<T> {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const holder = store.admitObjectsTransaction([], async (): Promise<void> => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  try {
    const pending = work().then(
      (value): { readonly ok: true; readonly value: T } => ({
        ok: true,
        value,
      }),
      (error: unknown): { readonly ok: false; readonly error: unknown } => ({
        ok: false,
        error,
      }),
    );
    await delay(LOCK_TIMEOUT_MS * 5);
    release.resolve();
    const outcome = await pending;
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  } finally {
    release.resolve();
    await holder;
  }
}

describe('LocalMediaStore local contention', () => {
  let directory = '';
  let stores: readonly LocalMediaStore[] = [];

  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-media-queue-'));
  });

  afterEach(async (): Promise<void> => {
    try {
      await Promise.all(stores.map((store) => store.close()));
    } finally {
      stores = [];
      await rm(directory, { recursive: true, force: true });
    }
  });

  function createStore(
    rootDirectory = join(directory, 'store'),
    options: Omit<LocalMediaStoreOptions, 'rootDirectory' | 'quotaBytes'> = {},
  ): LocalMediaStore {
    const store = new LocalMediaStore({
      rootDirectory,
      quotaBytes: 1024,
      lockTimeoutMs: LOCK_TIMEOUT_MS,
      ...options,
    });
    stores = [...stores, store];
    return store;
  }

  it('warns once about a stalled local queue without rejecting the waiter or close', async (): Promise<void> => {
    const holder = createStore();
    const reader = createStore();
    const independent = createStore(join(directory, 'independent'));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const warnings: Array<{ message: string; details: readonly unknown[] }> =
      [];
    const warningSink = vi
      .spyOn(DebugLogger.prototype, 'warn')
      .mockImplementation((message, ...details): void => {
        warnings.push({
          message: typeof message === 'function' ? message() : message,
          details,
        });
      });
    vi.useFakeTimers();
    const holding = holder.admitObjectsTransaction(
      [],
      async (): Promise<void> => {
        entered.resolve();
        await release.promise;
      },
    );
    let reading: Promise<number> = Promise.resolve(-1);
    let closing: Promise<void> = Promise.resolve();
    try {
      await entered.promise;
      let readFinished = false;
      reading = reader.getStoredByteLength().finally((): void => {
        readFinished = true;
      });
      let closeFinished = false;
      closing = reader.close().then((): void => {
        closeFinished = true;
      });
      await independent.getStoredByteLength();

      vi.advanceTimersByTime(29_999);
      expect(warnings).toStrictEqual([]);
      vi.advanceTimersByTime(1);
      expect(warnings).toStrictEqual([
        {
          message: expect.stringContaining('Local media store queue wait'),
          details: [
            {
              root: holder.rootDirectory,
              operation: 'measure spool quota',
              waitedMs: 30_000,
            },
          ],
        },
      ]);
      vi.advanceTimersByTime(60_000);
      expect(warnings).toHaveLength(1);
      expect(readFinished).toBe(false);
      expect(closeFinished).toBe(false);
      release.resolve();
      expect(await reading).toBe(0);
      await closing;
      expect(closeFinished).toBe(true);
    } finally {
      vi.useRealTimers();
      release.resolve();
      await Promise.allSettled([holding, reading, closing]);
      warningSink.mockRestore();
    }
  });

  it('stops the wait warning when a queued callback starts, even if that callback remains pending', async (): Promise<void> => {
    const store = createStore();
    const independent = createStore(join(directory, 'independent'));
    const firstEntered = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const nextEntered = Promise.withResolvers<void>();
    const releaseNext = Promise.withResolvers<void>();
    const warnings: string[] = [];
    const warningSink = vi
      .spyOn(DebugLogger.prototype, 'warn')
      .mockImplementation((message): void => {
        warnings.push(typeof message === 'function' ? message() : message);
      });
    vi.useFakeTimers();
    const first = store.admitObjectsTransaction([], async (): Promise<void> => {
      firstEntered.resolve();
      await releaseFirst.promise;
    });
    let next: Promise<void> = Promise.resolve();
    try {
      await firstEntered.promise;
      next = store.admitObjectsTransaction([], async (): Promise<void> => {
        nextEntered.resolve();
        await releaseNext.promise;
      });
      await independent.getStoredByteLength();
      vi.advanceTimersByTime(1_000);
      releaseFirst.resolve();
      await nextEntered.promise;
      vi.advanceTimersByTime(30_000);
      expect(warnings).toStrictEqual([]);
      releaseNext.resolve();
      await next;
      vi.advanceTimersByTime(30_000);
      expect(warnings).toStrictEqual([]);
    } finally {
      vi.useRealTimers();
      releaseFirst.resolve();
      releaseNext.resolve();
      await Promise.allSettled([first, next]);
      warningSink.mockRestore();
    }
  });

  it.each(['same instance', 'same root', 'parent alias'])(
    'reads verified bytes after a local wait longer than the acquisition budget: %s',
    async (mode): Promise<void> => {
      const store = createStore();
      const bytes = new Uint8Array([1, 2, 3]);
      const reference = await store.admit({
        bytes,
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      const alias = join(directory, 'alias');
      await symlink(
        directory,
        alias,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const readerRoot =
        mode === 'parent alias' ? join(alias, 'store') : store.rootDirectory;
      const reader = mode === 'same instance' ? store : createStore(readerRoot);

      const results = await withHeldStore(store, () =>
        Promise.all(
          Array.from({ length: 8 }, () => reader.readVerified(reference)),
        ),
      );

      expect(results).toStrictEqual(Array.from({ length: 8 }, () => bytes));
    },
  );

  it('runs accepted transactions in FIFO order across instances and lexical aliases', async (): Promise<void> => {
    const first = createStore();
    const second = createStore(`${first.rootDirectory}/../store`);
    await Promise.all([
      first.getStoredByteLength(),
      second.getStoredByteLength(),
    ]);
    const journal = join(directory, 'order');

    await withHeldStore(first, () =>
      Promise.all(
        [second, first, second, first].map((store, index) =>
          store.admitObjectsTransaction([], async (): Promise<void> => {
            await appendFile(journal, `${index}\n`);
          }),
        ),
      ),
    );

    expect(await readFile(journal, 'utf8')).toBe('0\n1\n2\n3\n');
  });

  it('lets an independent root finish while another root is held', async (): Promise<void> => {
    const first = createStore();
    const independent = createStore(join(directory, 'independent'));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const holder = first.admitObjectsTransaction(
      [],
      async (): Promise<void> => {
        entered.resolve();
        await release.promise;
      },
    );
    await entered.promise;
    try {
      const reference = await independent.admit({
        bytes: new Uint8Array([4, 5]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      expect(await independent.readVerified(reference)).toStrictEqual(
        new Uint8Array([4, 5]),
      );
    } finally {
      release.resolve();
      await holder;
    }
  });

  it('propagates a failed transaction and still runs queued work', async (): Promise<void> => {
    const store = createStore();
    const peer = createStore();
    const failure = new Error('publication failed');

    const outcomes = await withHeldStore(store, () =>
      Promise.allSettled([
        store.admitObjectsTransaction([], async (): Promise<void> => {
          throw failure;
        }),
        peer.admit({
          bytes: new Uint8Array([6]),
          mimeType: 'image/png',
          semanticMetadata: {},
        }),
      ]),
    );

    expect(outcomes[0]).toMatchObject({ status: 'rejected', reason: failure });
    expect(outcomes[1]).toMatchObject({
      status: 'fulfilled',
      value: { byteLength: 1 },
    });
    expect(await peer.getStoredByteLength()).toBe(1);
  });

  it('drains accepted queued operations on close and rejects new operations', async (): Promise<void> => {
    const holder = createStore();
    const reader = createStore();
    const bytes = new Uint8Array([7, 8]);
    const reference = await holder.admit({
      bytes,
      mimeType: 'image/png',
      semanticMetadata: {},
    });

    const results = await withHeldStore(holder, async () => {
      const reads = Promise.all([
        reader.readVerified(reference),
        reader.readVerified(reference),
      ]);
      let closed = false;
      const closing = reader.close().then(() => {
        closed = true;
      });
      await expect(reader.readVerified(reference)).rejects.toThrow('closed');
      expect(closed).toBe(false);
      const values = await reads;
      await closing;
      expect(closed).toBe(true);
      return values;
    });

    expect(results).toStrictEqual([bytes, bytes]);
    expect(await holder.readVerified(reference)).toStrictEqual(bytes);
  });

  it('publishes recorded objects and the journal after finite local contention', async (): Promise<void> => {
    const archive = createStore(join(directory, 'archive'));
    const store = createStore(join(directory, 'live'), {
      recordingArchive: archive,
    });
    const references = await Promise.all(
      [1, 2, 3, 4].map((value) =>
        store.admit({
          bytes: new Uint8Array([value]),
          mimeType: 'image/png',
          semanticMetadata: {},
        }),
      ),
    );
    const journal = join(directory, 'journal');

    await withHeldStore(store, () =>
      publishRecordedMedia(store, references, async (): Promise<void> => {
        await writeFile(journal, JSON.stringify(references));
      }),
    );

    expect(await readFile(journal, 'utf8')).toBe(JSON.stringify(references));
    expect(
      await Promise.all(
        references.map((reference) => archive.readVerified(reference)),
      ),
    ).toStrictEqual([1, 2, 3, 4].map((value) => new Uint8Array([value])));
  });

  it('resolves request bytes after finite local contention and releases reservations', async (): Promise<void> => {
    const store = createStore();
    const peer = createStore();
    const reference = await store.admit({
      bytes: new Uint8Array([0, 1, 2]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const resolver = new RequestMediaResolver(peer);

    const resolved = await withHeldStore(store, () =>
      resolver.resolve({
        contents: [{ speaker: 'human', blocks: [reference] }],
        requestId: 'contended-request',
        turnId: 'contended-turn',
        aggregateBudgetBytes: 4,
      }),
    );
    try {
      expect(
        resolved.withContents((contents) => contents)[0]?.blocks[0],
      ).toMatchObject({
        type: 'media',
        encoding: 'base64',
        data: 'AAEC',
      });
      expect(await peer.hasReservations(reference.contentId)).toBe(true);
    } finally {
      await resolved.release();
    }
    expect(await peer.hasReservations(reference.contentId)).toBe(false);
  });

  it('allows nested independent-root work and later same-root work from an inherited context', async (): Promise<void> => {
    const store = createStore();
    const independent = createStore(join(directory, 'independent'));
    const released = Promise.withResolvers<void>();
    let descendant: Promise<number> = Promise.resolve(-1);
    const storedBytes = await store.admitObjectsTransaction(
      [],
      async (): Promise<number> => {
        descendant = released.promise.then(() => store.getStoredByteLength());
        return independent.getStoredByteLength();
      },
    );
    released.resolve();

    expect(storedBytes).toBe(0);
    expect(await descendant).toBe(0);
  });

  it.each([
    ['publish', 'same instance'],
    ['publish', 'same root'],
    ['publish', 'parent alias'],
    ['read protected', 'same instance'],
    ['read protected', 'same root'],
    ['read protected', 'parent alias'],
  ])(
    'rejects reentrant %s work through %s and drains followers on close',
    async (callback, mode): Promise<void> => {
      const store = createStore();
      await store.getStoredByteLength();
      const alias = join(directory, 'alias');
      await symlink(
        directory,
        alias,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const peerRoot =
        mode === 'parent alias' ? join(alias, 'store') : store.rootDirectory;
      const peer = mode === 'same instance' ? store : createStore(peerRoot);
      const entered = Promise.withResolvers<void>();
      const breakCycle = Promise.withResolvers<void>();
      let nested: Promise<unknown> = Promise.resolve();
      const reenter = async (): Promise<void> => {
        nested = peer.getStoredByteLength();
        entered.resolve();
        await Promise.race([nested, breakCycle.promise]);
      };
      const staged =
        callback === 'read protected'
          ? await store.stageObjects([])
          : undefined;
      const outer = (
        staged === undefined
          ? store.admitObjectsTransaction([], reenter)
          : staged.rollback(async (): Promise<ReadonlySet<string>> => {
              await reenter();
              return new Set<string>();
            })
      ).then(
        (): string => 'fulfilled',
        (error: unknown): unknown => error,
      );
      await entered.promise;
      const follower = peer.getStoredByteLength();
      const closing = store.close();
      try {
        const outcome = await Promise.race([
          outer,
          delay(LOCK_TIMEOUT_MS * 5).then((): string => 'pending'),
        ]);
        expect(outcome).toBeInstanceOf(MediaStoreError);
        expect(outcome).toMatchObject({
          message: expect.stringContaining('reentrant'),
        });
        expect(await follower).toBe(0);
        await closing;
      } finally {
        breakCycle.resolve();
        await Promise.allSettled([outer, nested, follower, closing]);
      }
    },
  );

  it('keeps filesystem contention bounded and can acquire after a failed turn', async (): Promise<void> => {
    const store = createStore();
    const locks = join(store.rootDirectory, 'locks');
    await mkdir(locks, { recursive: true });
    const lockPath = join(locks, 'store.lock');
    const foreignLock = JSON.stringify({
      version: 1,
      token: 'foreign',
      pid: process.pid,
      hostname: 'peer',
      createdAt: Date.now(),
    });
    await writeFile(lockPath, foreignLock, { flag: 'wx' });

    await expect(store.getStoredByteLength()).rejects.toThrow(
      'Lock contention exceeded 40ms',
    );
    expect(await readFile(lockPath, 'utf8')).toBe(foreignLock);
    await rm(lockPath);
    expect(await store.getStoredByteLength()).toBe(0);
  });
});
