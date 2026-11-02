/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { unwatchFile, watchFile } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalMediaStore,
  MediaObjectCorruptError,
  MediaObjectHashMismatchError,
  MediaObjectMissingError,
} from './local-media-store.js';
import type { MediaReferenceBlock } from '../services/history/IContent.js';

const QUOTA_BYTES = 64 * 1024 * 1024;
const LOCK_TIMEOUT_MS = 300;
const HOLDER_PAYLOAD = '91,92,93';

interface ForeignHolder {
  readonly process: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  readonly lockPath: string;
  release(): Promise<void>;
  kill(): Promise<void>;
}

function waitForPath(path: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const observe = (): void => {
      void stat(path).then(
        () => {
          unwatchFile(path, observe);
          resolve();
        },
        (error: unknown) => {
          if (
            typeof error === 'object' &&
            error !== null &&
            Reflect.get(error, 'code') === 'ENOENT'
          ) {
            return;
          }
          unwatchFile(path, observe);
          reject(error);
        },
      );
    };
    watchFile(path, { interval: 10 }, observe);
    observe();
  });
}

function patternBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 7 + 3) % 251);
}

describe('LocalMediaStore verified reads are independent of the store lock', () => {
  let directory = '';
  let stores: readonly LocalMediaStore[] = [];
  let holders: readonly ForeignHolder[] = [];

  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-media-read-'));
  });

  afterEach(async (): Promise<void> => {
    try {
      await Promise.all(holders.map((holder) => holder.kill()));
      await Promise.all(stores.map((store) => store.close()));
    } finally {
      holders = [];
      stores = [];
      await rm(directory, { recursive: true, force: true });
    }
  });

  function rootDirectory(): string {
    return join(directory, 'store');
  }

  function createStore(): LocalMediaStore {
    const store = new LocalMediaStore({
      rootDirectory: rootDirectory(),
      quotaBytes: QUOTA_BYTES,
      lockTimeoutMs: LOCK_TIMEOUT_MS,
    });
    stores = [...stores, store];
    return store;
  }

  function admitInput(payload: Uint8Array): {
    readonly bytes: Uint8Array;
    readonly mimeType: string;
    readonly semanticMetadata: Record<string, never>;
  } {
    return { bytes: payload, mimeType: 'image/png', semanticMetadata: {} };
  }

  function objectPath(reference: MediaReferenceBlock): string {
    return join(
      rootDirectory(),
      'objects',
      'sha256',
      reference.contentId.slice('sha256:'.length),
    );
  }

  /**
   * Starts a real child process that holds `locks/store.lock` while parked
   * inside an admission publish step, and returns once it has reached the
   * barrier.
   */
  async function startForeignHolder(): Promise<ForeignHolder> {
    const readyPath = join(directory, 'holder-ready');
    const releasePath = join(directory, 'holder-release');
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, 'local-media-store-child.ts'),
        'hold-publish',
        rootDirectory(),
        String(QUOTA_BYTES),
        HOLDER_PAYLOAD,
        readyPath,
        releasePath,
      ],
      { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    );
    const holder: ForeignHolder = {
      process: child,
      lockPath: join(rootDirectory(), 'locks', 'store.lock'),
      release: async (): Promise<void> => {
        await writeFile(releasePath, 'release', { flag: 'wx' });
        const [exitCode, stderr] = await Promise.all([
          child.exited,
          new Response(child.stderr).text(),
        ]);
        if (exitCode !== 0) throw new Error(stderr);
      },
      kill: async (): Promise<void> => {
        if (child.exitCode === null) child.kill('SIGKILL');
        await child.exited;
      },
    };
    holders = [...holders, holder];
    await Promise.race([
      waitForPath(readyPath),
      child.exited.then(async (): Promise<void> => {
        if (!(await Bun.file(readyPath).exists())) {
          throw new Error(await new Response(child.stderr).text());
        }
      }),
    ]);
    return holder;
  }

  async function admitObject(
    payload: Uint8Array,
  ): Promise<{ store: LocalMediaStore; reference: MediaReferenceBlock }> {
    const store = createStore();
    const reference = await store.admit(admitInput(payload));
    return { store, reference };
  }

  describe('with a live foreign lock holder', () => {
    it('returns exact bytes from readObjectVerified while the lock is still held', async (): Promise<void> => {
      const payload = patternBytes(1024);
      const { store, reference } = await admitObject(payload);
      const holder = await startForeignHolder();

      const bytes = await store.readObjectVerified(reference.selectedObject);

      expect(bytes).toStrictEqual(payload);
      expect(holder.process.exitCode).toBeNull();
      expect(await Bun.file(holder.lockPath).exists()).toBe(true);
      await holder.release();
    });

    it('returns exact bytes from readVerified while the lock is still held', async (): Promise<void> => {
      const payload = patternBytes(2048);
      const { store, reference } = await admitObject(payload);
      const holder = await startForeignHolder();

      const bytes = await store.readVerified(reference);

      expect(bytes).toStrictEqual(payload);
      expect(holder.process.exitCode).toBeNull();
      expect(await Bun.file(holder.lockPath).exists()).toBe(true);
      await holder.release();
    });

    it('still bounds reserveAndReadVerified by the lock timeout', async (): Promise<void> => {
      const { store, reference } = await admitObject(patternBytes(64));
      const holder = await startForeignHolder();

      await expect(
        store.reserveAndReadVerified(reference, 'contended-owner'),
      ).rejects.toThrow(`Lock contention exceeded ${LOCK_TIMEOUT_MS}ms`);

      expect(holder.process.exitCode).toBeNull();
      await holder.release();
    });

    describe('integrity failures keep their typed errors', () => {
      it('reports a flipped byte as a hash mismatch', async (): Promise<void> => {
        const payload = patternBytes(256);
        const { store, reference } = await admitObject(payload);
        const holder = await startForeignHolder();
        const flipped = Buffer.from(await readFile(objectPath(reference)));
        flipped.writeUInt8(flipped.readUInt8(0) ^ 0xff, 0);
        await rm(objectPath(reference));
        await writeFile(objectPath(reference), flipped);

        await expect(
          store.readObjectVerified(reference.selectedObject),
        ).rejects.toBeInstanceOf(MediaObjectHashMismatchError);
        await holder.release();
      });

      it('reports a truncated file as corrupt', async (): Promise<void> => {
        const payload = patternBytes(256);
        const { store, reference } = await admitObject(payload);
        const holder = await startForeignHolder();
        await rm(objectPath(reference));
        await writeFile(objectPath(reference), payload.subarray(0, 255));

        await expect(
          store.readObjectVerified(reference.selectedObject),
        ).rejects.toBeInstanceOf(MediaObjectCorruptError);
        await holder.release();
      });

      it('reports a missing object as missing', async (): Promise<void> => {
        const { store, reference } = await admitObject(patternBytes(256));
        const holder = await startForeignHolder();
        await rm(objectPath(reference));

        await expect(
          store.readObjectVerified(reference.selectedObject),
        ).rejects.toBeInstanceOf(MediaObjectMissingError);
        await holder.release();
      });

      it('reports a directory in place of the object as corrupt', async (): Promise<void> => {
        const { store, reference } = await admitObject(patternBytes(256));
        const holder = await startForeignHolder();
        await rm(objectPath(reference));
        await mkdir(objectPath(reference));

        await expect(
          store.readObjectVerified(reference.selectedObject),
        ).rejects.toBeInstanceOf(MediaObjectCorruptError);
        await holder.release();
      });

      it('reports a symlink in place of the object as corrupt even when its target holds the right bytes', async (): Promise<void> => {
        const payload = patternBytes(256);
        const { store, reference } = await admitObject(payload);
        const holder = await startForeignHolder();
        const decoy = join(directory, 'decoy');
        await writeFile(decoy, payload);
        await rm(objectPath(reference));
        await symlink(decoy, objectPath(reference));

        await expect(
          store.readObjectVerified(reference.selectedObject),
        ).rejects.toBeInstanceOf(MediaObjectCorruptError);
        await holder.release();
      });
    });
  });

  describe('with a same-process exclusive turn in progress', () => {
    it.each(['same instance', 'second instance on the same root'] as const)(
      'reads from the %s without queueing behind the parked turn',
      async (reader): Promise<void> => {
        const payload = patternBytes(1024);
        const { store, reference } = await admitObject(payload);
        const readerStore = reader === 'same instance' ? store : createStore();
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let holderSettled = false;
        const holding = store
          .admitObjectsTransaction([], async (): Promise<void> => {
            entered.resolve();
            await release.promise;
          })
          .finally((): void => {
            holderSettled = true;
          });
        await entered.promise;

        try {
          const bytes = await readerStore.readObjectVerified(
            reference.selectedObject,
          );

          expect({ bytes, holderSettled }).toStrictEqual({
            bytes: payload,
            holderSettled: false,
          });
        } finally {
          release.resolve();
          await holding;
        }
      },
    );
  });

  describe('on a root that was never created', () => {
    it('reports the object as missing without creating store directories', async (): Promise<void> => {
      const { reference } = await admitObject(patternBytes(128));
      const absentRoot = join(directory, 'never-created');
      const absentStore = new LocalMediaStore({
        rootDirectory: absentRoot,
        quotaBytes: QUOTA_BYTES,
        lockTimeoutMs: LOCK_TIMEOUT_MS,
      });
      stores = [...stores, absentStore];

      await expect(
        absentStore.readObjectVerified(reference.selectedObject),
      ).rejects.toBeInstanceOf(MediaObjectMissingError);
      await expect(stat(absentRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  describe('with an orphaned lock left by a killed process', () => {
    it('reads verified bytes without waiting for the orphan to go stale', async (): Promise<void> => {
      const payload = patternBytes(512);
      const { store, reference } = await admitObject(payload);
      const holder = await startForeignHolder();
      holder.process.kill('SIGKILL');
      await holder.process.exited;

      const bytes = await store.readObjectVerified(reference.selectedObject);

      expect(bytes).toStrictEqual(payload);
      expect(await Bun.file(holder.lockPath).exists()).toBe(true);
    });
  });

  describe('closing the store', () => {
    it('joins an in-flight read and rejects reads started afterwards', async (): Promise<void> => {
      const payload = patternBytes(8 * 1024 * 1024);
      const { store, reference } = await admitObject(payload);
      const order: string[] = [];

      const reading = store
        .readObjectVerified(reference.selectedObject)
        .then((bytes): Uint8Array => {
          order.push('read');
          return bytes;
        });
      const closing = store.close().then((): void => {
        order.push('close');
      });
      await expect(
        store.readObjectVerified(reference.selectedObject),
      ).rejects.toThrow('Local media store is closed');
      const [bytes] = await Promise.all([reading, closing]);

      expect(order).toStrictEqual(['read', 'close']);
      expect(Buffer.from(bytes).equals(Buffer.from(payload))).toBe(true);
    });

    it('rejects readVerified and readObjectVerified once closed', async (): Promise<void> => {
      const { store, reference } = await admitObject(patternBytes(16));
      await store.close();

      await expect(store.readVerified(reference)).rejects.toThrow(/closed/);
      await expect(
        store.readObjectVerified(reference.selectedObject),
      ).rejects.toThrow(/closed/);
    });
  });
});
