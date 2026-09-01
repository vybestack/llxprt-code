/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  assertDefined,
  assertInstanceOf,
} from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  watch,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStorePersistence } from './local-media-store-persistence.js';
import {
  LocalMediaStore,
  MediaObjectCorruptError,
  MediaObjectHashMismatchError,
  MediaObjectMissingError,
  MediaStoreError,
} from './local-media-store.js';
import {
  isMediaReferenceBlock,
  type MediaReferenceBlock,
} from '../services/history/IContent.js';

describe('local-media-store-verification', () => {
  function useTempDirectory(): () => string {
    let directory = '';
    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'llxprt-media-store-'));
    });
    afterEach(async () => {
      if (directory !== '') {
        await chmod(directory, 0o700).catch(() => undefined);
        await rm(directory, { recursive: true, force: true });
      }
    });
    return () => directory;
  }

  async function allFiles(directory: string): Promise<readonly string[]> {
    const result: string[] = [];
    async function visit(current: string): Promise<void> {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) {
          await visit(path);
        } else {
          result.push(path);
        }
      }
    }
    await visit(directory);
    return result;
  }

  async function storedObjectPath(
    root: string,
    reference: MediaReferenceBlock,
  ): Promise<string> {
    const digest = reference.contentId.slice('sha256:'.length);
    const files = await allFiles(root);
    const matches = files.filter((path) => path.endsWith(digest));
    if (matches.length !== 1) {
      throw new Error(`Expected one stored object for ${reference.contentId}`);
    }
    return matches[0];
  }

  function bytes(...values: number[]): Uint8Array {
    return new Uint8Array(values);
  }

  function admitInput(payload: Uint8Array) {
    return {
      bytes: payload,
      mimeType: 'image/png',
      semanticMetadata: { detail: 'high', nested: { page: 2 } },
    };
  }

  async function capturedError(work: Promise<unknown>): Promise<Error> {
    try {
      await work;
    } catch (error) {
      if (error instanceof Error) {
        return error;
      }
      throw new Error('Expected an Error instance');
    }
    throw new Error('Expected operation to reject');
  }

  interface ChildResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  }

  function childCommand(
    mode: string,
    rootDirectory: string,
    quotaBytes: number,
    payload: string,
    ...additionalArguments: readonly string[]
  ): string[] {
    return [
      process.execPath,
      join(import.meta.dir, 'local-media-store-child.ts'),
      mode,
      rootDirectory,
      String(quotaBytes),
      payload,
      ...additionalArguments,
    ];
  }

  async function runChild(command: string[]): Promise<ChildResult> {
    const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exitCode, stdout, stderr };
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await child.exited;
    }
  }
  async function waitForPath(path: string, directory: string): Promise<void> {
    if (await Bun.file(path).exists()) return;
    const controller = new AbortController();
    const events = watch(directory, { signal: controller.signal });
    try {
      if (await Bun.file(path).exists()) return;
      for await (const _event of events) {
        if (await Bun.file(path).exists()) return;
      }
      throw new Error(`Filesystem watch ended before ${path} appeared`);
    } finally {
      controller.abort();
    }
  }

  async function waitForMtimeAfterEpoch(
    path: string,
    directory: string,
  ): Promise<void> {
    if ((await stat(path)).mtimeMs > 0) return;
    const controller = new AbortController();
    const events = watch(directory, { signal: controller.signal });
    try {
      if ((await stat(path)).mtimeMs > 0) return;
      for await (const _event of events) {
        if ((await stat(path)).mtimeMs > 0) return;
      }
      throw new Error(`Filesystem watch ended before ${path} was renewed`);
    } finally {
      controller.abort();
    }
  }

  function parseChildReference(serialized: string): MediaReferenceBlock {
    const parsed: unknown = JSON.parse(serialized.trim());
    if (!isMediaReferenceBlock(parsed)) {
      throw new Error('Child returned malformed media reference');
    }
    return parsed;
  }

  class ReclamationReadHarness extends LocalMediaStorePersistence {
    async scanObjectDirectory(): Promise<void> {
      await this.scanReclamationCandidates(new Set(), Date.now());
    }
  }

  describe('local-media-store-verification', () => {
    describe('LocalMediaStore verified reads', () => {
      const tempDirectory = useTempDirectory();

      it('distinguishes a missing object and carries content identity and operation', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
        });
        const reference = await store.admit(admitInput(bytes(1, 2, 3)));
        await rm(await storedObjectPath(tempDirectory(), reference));

        const error = await capturedError(store.readVerified(reference));

        expect(error).toBeInstanceOf(MediaObjectMissingError);
        expect(error).toBeInstanceOf(MediaStoreError);
        assertInstanceOf(error, MediaStoreError, 'Expected MediaStoreError');
        expect(error.contentId).toBe(reference.contentId);
        expect(error.operation).toBe('read verified');
      });

      it('distinguishes corrupt length from a hash mismatch', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
        });
        const reference = await store.admit(admitInput(bytes(1, 2, 3)));
        await writeFile(
          await storedObjectPath(tempDirectory(), reference),
          bytes(9),
        );

        const error = await capturedError(store.readVerified(reference));

        expect(error).toBeInstanceOf(MediaObjectCorruptError);
        expect(error.message).toContain(reference.contentId);
      });

      it('distinguishes same-length hash-mismatched bytes', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
        });
        const reference = await store.admit(admitInput(bytes(1, 2, 3)));
        await writeFile(
          await storedObjectPath(tempDirectory(), reference),
          bytes(3, 2, 1),
        );

        const error = await capturedError(store.readVerified(reference));

        expect(error).toBeInstanceOf(MediaObjectHashMismatchError);
        expect(error.message).toContain(reference.contentId);
      });

      it('rejects a non-file object as corrupt', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
        });
        const reference = await store.admit(admitInput(bytes(1, 2, 3)));
        const path = await storedObjectPath(tempDirectory(), reference);
        await rm(path);
        await Bun.write(join(path, 'nested'), 'not an object file');

        const error = await capturedError(store.readVerified(reference));

        expect(error).toBeInstanceOf(MediaObjectCorruptError);
      });

      it('reports malformed runtime references through the media-store error contract', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
        });
        const invocation: unknown = Reflect.apply(store.readVerified, store, [
          undefined,
        ]);
        assertInstanceOf(
          invocation,
          Promise,
          'Expected readVerified to return a promise',
        );

        const error = await capturedError(invocation);

        expect(error).toBeInstanceOf(MediaObjectCorruptError);
      });

      it('attributes object-directory read failures to reclamation', async () => {
        await mkdir(join(tempDirectory(), 'objects'), { recursive: true });
        await writeFile(
          join(tempDirectory(), 'objects', 'sha256'),
          'not a directory',
        );
        const harness = new ReclamationReadHarness({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
        });

        const error = await capturedError(harness.scanObjectDirectory());

        expect(error).toBeInstanceOf(MediaStoreError);
        assertInstanceOf(error, MediaStoreError, 'Expected MediaStoreError');
        expect(error.operation).toBe('reclaim media');
      });
    });

    describe('LocalMediaStore ownership reservations', () => {
      const tempDirectory = useTempDirectory();

      it('reserves and releases explicit owners without changing spool usage', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
        });
        const reference = await store.admit(admitInput(bytes(1, 2, 3)));

        await store.reserve(reference, 'in-flight:request-1');
        const reserved = await store.hasReservations(reference.contentId);
        await store.release(reference.contentId, 'in-flight:request-1');

        expect(reserved).toBe(true);
        expect(await store.hasReservations(reference.contentId)).toBe(false);
        expect(await store.getStoredByteLength()).toBe(3);
      });

      it('fails reservation of missing content with identity and operation context', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
        });
        const contentId = `sha256:${createHash('sha256').update('missing').digest('hex')}`;
        const missingReference: MediaReferenceBlock = {
          type: 'media',
          encoding: 'reference',
          mimeType: 'image/png',
          contentId,
          originalContentId: contentId,
          selectedContentId: contentId,
          originalObject: {
            contentId,
            mimeType: 'image/png',
            byteLength: 1,
            normalizedBase64Length: 4,
          },
          selectedObject: {
            contentId,
            mimeType: 'image/png',
            byteLength: 1,
            normalizedBase64Length: 4,
          },
          transformation: {
            policyId: 'identity',
            policyVersion: 1,
            parameters: {},
          },
          byteLength: 1,
          normalizedBase64Length: 4,
          semanticMetadata: {},
        };

        const error = await capturedError(
          store.reserve(missingReference, 'persisted:session-1'),
        );

        expect(error).toBeInstanceOf(MediaObjectMissingError);
        assertInstanceOf(error, MediaStoreError, 'Expected MediaStoreError');
        expect(error.contentId).toBe(contentId);
        expect(error.operation).toBe('reserve reference');
      });

      it('uses owner identity rather than exposing it as a path segment', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
        });
        const reference = await store.admit(admitInput(bytes(1, 2, 3)));
        const ownerId = '../../outside';

        await store.reserve(reference, ownerId);

        expect(
          (await allFiles(tempDirectory())).some((path) =>
            path.includes(ownerId),
          ),
        ).toBe(false);
        await expect(
          access(join(tempDirectory(), '..', 'outside'), constants.F_OK),
        ).rejects.toThrow('ENOENT');
      });

      it('recovers stale ownership after a reserving process exits', async () => {
        const child = await runChild(
          childCommand('reserve-crash', tempDirectory(), 3, '61,62,63'),
        );
        if (child.exitCode !== 0) throw new Error(child.stderr);
        const reference = parseChildReference(child.stdout);
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
          reservationLeaseMs: 30,
        });
        const instancePath = (await allFiles(tempDirectory())).find((path) =>
          path.includes(join('instances')),
        );
        assertDefined(instancePath, 'Expected an instance lease');
        const epoch = new Date(0);
        await utimes(instancePath, epoch, epoch);

        const result = await store.reclaimUnreferenced(new Set(), Date.now());

        expect(result.objectsRemoved).toBe(1);
        await expect(
          stat(
            join(
              store.rootDirectory,
              'objects',
              'sha256',
              reference.contentId.slice('sha256:'.length),
            ),
          ),
        ).rejects.toMatchObject({ code: 'ENOENT' });
      });

      it('does not reclaim a live blob owned by another process', async () => {
        const readyPath = join(tempDirectory(), 'child-ready.json');
        const child = Bun.spawn(
          childCommand(
            'reserve-live',
            tempDirectory(),
            3,
            '71,72,73',
            readyPath,
          ),
          { stdout: 'pipe', stderr: 'pipe' },
        );
        try {
          await Promise.race([
            waitForPath(readyPath, tempDirectory()),
            child.exited.then(async () => {
              if (!(await Bun.file(readyPath).exists())) {
                throw new Error(await new Response(child.stderr).text());
              }
            }),
          ]);
          const reference = parseChildReference(
            await readFile(readyPath, 'utf8'),
          );
          const instanceDirectory = join(tempDirectory(), 'instances');
          const instancePath = (await allFiles(tempDirectory())).find((path) =>
            path.includes(join('instances')),
          );
          assertDefined(instancePath, 'Expected an instance lease');
          const epoch = new Date(0);
          await utimes(instancePath, epoch, epoch);
          await waitForMtimeAfterEpoch(instancePath, instanceDirectory);
          const store = new LocalMediaStore({
            rootDirectory: tempDirectory(),
            quotaBytes: 3,
            reservationLeaseMs: 30,
          });

          const whileLive = await store.reclaimUnreferenced(
            new Set(),
            Date.now(),
          );
          child.kill('SIGKILL');
          await child.exited;
          await utimes(instancePath, epoch, epoch);
          const afterCrash = await store.reclaimUnreferenced(
            new Set(),
            Date.now(),
          );

          expect(whileLive.objectsRemoved).toBe(0);
          expect(afterCrash.objectsRemoved).toBe(1);
          await expect(store.readVerified(reference)).rejects.toBeInstanceOf(
            MediaObjectMissingError,
          );
        } finally {
          if (child.exitCode === null) child.kill('SIGKILL');
          await child.exited;
        }
      });

      it('treats repeated reservation and release by one owner as idempotent', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
        });
        const reference = await store.admit(admitInput(bytes(1, 2, 3)));

        await store.reserve(reference, 'request:stable-owner');
        await store.reserve(reference, 'request:stable-owner');
        await store.release(reference.contentId, 'request:stable-owner');
        await store.release(reference.contentId, 'request:stable-owner');

        expect(await store.hasReservations(reference.contentId)).toBe(false);
      });

      it('atomically replaces reservation records with restrictive permissions', async () => {
        let replacementStarted = (): void => undefined;
        const started = new Promise<void>((resolve) => {
          replacementStarted = resolve;
        });
        let allowReplacement = (): void => undefined;
        const allowed = new Promise<void>((resolve) => {
          allowReplacement = resolve;
        });
        let blockReplacement = false;
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
          fileOperations: {
            link,
            rename: async (sourcePath, destinationPath) => {
              if (blockReplacement) {
                replacementStarted();
                await allowed;
              }
              await rename(sourcePath, destinationPath);
            },
          },
        });
        const reference = await store.admit(admitInput(bytes(1, 2, 3)));
        await store.reserve(reference, 'request:atomic-replacement');
        const reservationPath = (await allFiles(tempDirectory())).find((path) =>
          path.includes(join('references', 'sha256')),
        );
        assertDefined(reservationPath, 'Expected a durable reservation record');
        const existing: unknown = JSON.parse(
          await readFile(reservationPath, 'utf8'),
        );
        if (typeof existing !== 'object' || existing === null) {
          throw new Error('Expected a reservation object');
        }
        Reflect.set(existing, 'expiresAt', 0);
        Reflect.set(existing, 'instanceId', 'expired-instance');
        await writeFile(reservationPath, JSON.stringify(existing));
        blockReplacement = true;

        const replacement = store.reserve(
          reference,
          'request:atomic-replacement',
        );
        await started;
        let visibleDuringReplacement: string;
        try {
          visibleDuringReplacement = await readFile(reservationPath, 'utf8');
        } finally {
          allowReplacement();
        }
        await replacement;

        expect(visibleDuringReplacement).toBe(JSON.stringify(existing));
        const reservationMode = (await stat(reservationPath)).mode & 0o777;
        expect(process.platform === 'win32' || reservationMode === 0o600).toBe(
          true,
        );
      });

      it('fails conservatively for a malformed present instance lease and later reclaims a valid stale lease', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
          reservationLeaseMs: 30_000,
        });
        const reference = await store.admit(admitInput(bytes(1, 2, 3)));
        await store.reserve(reference, 'request:malformed-live-lease');
        const files = await allFiles(tempDirectory());
        const reservationPath = files.find((path) =>
          path.includes(join('references', 'sha256')),
        );
        assertDefined(reservationPath, 'Expected a reservation record');
        await store.close();
        const externalInstanceId = 'external-live-instance';
        const instancePath = join(
          tempDirectory(),
          'instances',
          externalInstanceId,
        );
        const reservation: unknown = JSON.parse(
          await readFile(reservationPath, 'utf8'),
        );
        if (typeof reservation !== 'object' || reservation === null) {
          throw new Error('Expected a reservation object');
        }
        Reflect.set(reservation, 'expiresAt', 0);
        Reflect.set(reservation, 'instanceId', externalInstanceId);
        await writeFile(reservationPath, JSON.stringify(reservation));
        await writeFile(instancePath, '{');
        const scanner = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
          reservationLeaseMs: 30,
        });

        await expect(
          scanner.hasReservations(reference.contentId),
        ).rejects.toThrow(/owner lease/i);
        expect(await Bun.file(reservationPath).exists()).toBe(true);

        await writeFile(
          instancePath,
          JSON.stringify({
            version: 1,
            instanceId: externalInstanceId,
            token: 'external-token',
            createdAt: 0,
          }),
        );
        const epoch = new Date(0);
        await utimes(instancePath, epoch, epoch);
        expect(await scanner.hasReservations(reference.contentId)).toBe(false);
        expect(await Bun.file(reservationPath).exists()).toBe(false);
      });

      it('rejects owner identities containing control characters', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
        });
        const reference = await store.admit(admitInput(bytes(1, 2, 3)));

        await expect(
          store.reserve(reference, 'request\u0000owner'),
        ).rejects.toThrow(/owner id/i);

        expect(await store.hasReservations(reference.contentId)).toBe(false);
      });

      it('expires a dead instance reservation even when its pid has been reused', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
          reservationLeaseMs: 30,
        });
        const reference = await store.admit(admitInput(bytes(1, 2, 3)));
        await store.reserve(reference, 'request:expired-instance');
        const reservationPath = (await allFiles(tempDirectory())).find((path) =>
          path.includes(join('references', 'sha256')),
        );
        assertDefined(reservationPath, 'Expected a durable reservation record');
        const record: unknown = JSON.parse(
          await readFile(reservationPath, 'utf8'),
        );
        if (typeof record !== 'object' || record === null) {
          throw new Error('Expected a reservation object');
        }
        Reflect.set(record, 'instanceId', 'dead-instance');
        Reflect.set(record, 'pid', process.pid);
        Reflect.set(record, 'expiresAt', 0);
        await writeFile(reservationPath, JSON.stringify(record));

        const result = await store.reclaimUnreferenced(new Set(), Date.now());

        expect(result.objectsRemoved).toBe(1);
      });

      it('removes a torn reservation instead of wedging reclamation', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 3,
        });
        const reference = await store.admit(admitInput(bytes(1, 2, 3)));
        await store.reserve(reference, 'request:torn-record');
        const reservationPath = (await allFiles(tempDirectory())).find((path) =>
          path.includes(join('references', 'sha256')),
        );
        assertDefined(reservationPath, 'Expected a durable reservation record');
        await writeFile(reservationPath, '{');

        const result = await store.reclaimUnreferenced(new Set(), Date.now());

        expect(result.objectsRemoved).toBe(1);
        expect(await store.hasReservations(reference.contentId)).toBe(false);
      });

      it('allows verified reads and admission during a slow multi-object reclamation scan', async () => {
        const initialStore = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 12,
        });
        const first = await initialStore.admit(admitInput(bytes(1, 2, 3)));
        await initialStore.admit(admitInput(bytes(4, 5, 6)));
        await initialStore.admit(admitInput(bytes(7, 8, 9)));
        const objectPaths = (await allFiles(tempDirectory())).filter((path) =>
          path.includes(join('objects', 'sha256')),
        );
        const creationTimes = await Promise.all(
          objectPaths.map(async (path) => (await stat(path)).ctimeMs),
        );
        const latestCreationTime = Math.max(...creationTimes);
        while (Date.now() <= latestCreationTime) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        let releaseScan = (): void => undefined;
        const scanRelease = new Promise<void>((resolve) => {
          releaseScan = resolve;
        });
        let markScanBlocked = (): void => undefined;
        const scanBlocked = new Promise<void>((resolve) => {
          markScanBlocked = resolve;
        });
        let inspected = 0;
        const scanner = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 12,
          fileOperations: {
            link,
            inspectReclamationCandidate: async () => {
              inspected += 1;
              if (inspected === 2) {
                markScanBlocked();
                await scanRelease;
              }
            },
          },
        });
        const contender = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 12,
        });
        const reclamation = scanner.reclaimUnreferenced(new Set(), Date.now());
        await scanBlocked;

        const concurrentWork = Promise.all([
          contender.readVerified(first),
          contender.admit(admitInput(bytes(10, 11, 12))),
        ]);
        try {
          await concurrentWork;
        } finally {
          releaseScan();
        }
        const [verified, admitted] = await concurrentWork;
        const result = await reclamation;

        expect(verified).toStrictEqual(bytes(1, 2, 3));
        expect(await contender.readVerified(admitted)).toStrictEqual(
          bytes(10, 11, 12),
        );
        expect(result.objectsRemoved).toBe(3);
      });

      it('isolates malformed reservation entries while preserving a valid live reservation', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 6,
        });
        const reclaimable = await store.admit(admitInput(bytes(1, 2, 3)));
        const live = await store.admit(admitInput(bytes(4, 5, 6)));
        await store.reserve(live, 'request:live-corruption-control');
        const reservationDirectory = join(
          tempDirectory(),
          'references',
          'sha256',
          reclaimable.contentId.slice('sha256:'.length),
        );
        await mkdir(reservationDirectory, { recursive: true });
        const digestName = (label: string): string =>
          createHash('sha256').update(label).digest('hex');
        await Promise.all([
          writeFile(join(reservationDirectory, 'malformed-name'), '{}'),
          mkdir(join(reservationDirectory, digestName('non-file-entry'))),
          writeFile(
            join(reservationDirectory, digestName('invalid-json')),
            '{',
          ),
          writeFile(
            join(reservationDirectory, digestName('schema-invalid')),
            JSON.stringify({ version: 1 }),
          ),
        ]);

        const result = await store.reclaimUnreferenced(new Set(), Date.now());

        expect(result.objectsRemoved).toBe(1);
        await expect(store.readVerified(reclaimable)).rejects.toBeInstanceOf(
          MediaObjectMissingError,
        );
        expect(await store.readVerified(live)).toStrictEqual(bytes(4, 5, 6));
        expect(await store.hasReservations(live.contentId)).toBe(true);
      });
    });
  });
});
