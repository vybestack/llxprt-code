/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  chmod,
  link as publishLink,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
  MediaStoreError,
} from './local-media-store.js';
import type {
  MediaSemanticMetadata,
  MediaSemanticMetadataValue,
  MediaReferenceBlock,
} from '../services/history/IContent.js';

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

function testStore(rootDirectory: string): LocalMediaStore {
  return new LocalMediaStore({ rootDirectory, quotaBytes: 10 });
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

describe('local-media-store', () => {
  describe('LocalMediaStore admission', () => {
    const tempDirectory = useTempDirectory();

    it('stores exact bytes and returns complete immutable metadata', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 4,
      });
      const payload = bytes(0, 1, 2, 3);

      const reference = await store.admit({
        ...admitInput(payload),
        knownByteLength: 4,
        dimensions: { width: 640, height: 480 },
        providerFileIds: { openai: 'file-123' },
      });
      payload[0] = 99;

      expect(reference).toStrictEqual({
        type: 'media',
        encoding: 'reference',
        mimeType: 'image/png',
        contentId:
          'sha256:054edec1d0211f624fed0cbca9d4f9400b0e491c43742af2c5b0abebf0c990d8',
        originalContentId:
          'sha256:054edec1d0211f624fed0cbca9d4f9400b0e491c43742af2c5b0abebf0c990d8',
        selectedContentId:
          'sha256:054edec1d0211f624fed0cbca9d4f9400b0e491c43742af2c5b0abebf0c990d8',
        originalObject: {
          contentId:
            'sha256:054edec1d0211f624fed0cbca9d4f9400b0e491c43742af2c5b0abebf0c990d8',
          mimeType: 'image/png',
          byteLength: 4,
          normalizedBase64Length: 8,
          dimensions: { width: 640, height: 480 },
        },
        selectedObject: {
          contentId:
            'sha256:054edec1d0211f624fed0cbca9d4f9400b0e491c43742af2c5b0abebf0c990d8',
          mimeType: 'image/png',
          byteLength: 4,
          normalizedBase64Length: 8,
          dimensions: { width: 640, height: 480 },
        },
        transformation: {
          policyId: 'identity',
          policyVersion: 1,
          parameters: {},
        },
        byteLength: 4,
        normalizedBase64Length: 8,
        dimensions: { width: 640, height: 480 },
        semanticMetadata: { detail: 'high', nested: { page: 2 } },
        providerFileIds: { openai: 'file-123' },
      });
      expect(await store.readVerified(reference)).toStrictEqual(
        bytes(0, 1, 2, 3),
      );
      expect(Object.isFrozen(reference.semanticMetadata)).toBe(true);
      expect(Object.isFrozen(reference.semanticMetadata['nested'])).toBe(true);
      expect(Object.isFrozen(reference.providerFileIds)).toBe(true);
      expect(
        (await storedObjectPath(tempDirectory(), reference)).startsWith(
          tempDirectory(),
        ),
      ).toBe(true);
    });

    it('stores and verifies original and selected derived objects with stable policy identity', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 16,
      });
      const originalBytes = bytes(1, 2, 3, 4);
      const selectedBytes = bytes(9, 8, 7);

      const reference = await store.admit({
        bytes: selectedBytes,
        mimeType: 'image/webp',
        dimensions: { width: 20, height: 10 },
        original: {
          bytes: originalBytes,
          mimeType: 'image/png',
          dimensions: { width: 200, height: 100 },
        },
        transformation: {
          policyId: 'image-resize',
          policyVersion: 1,
          parameters: { maxLongEdge: 20 },
        },
        semanticMetadata: { detail: 'high' },
      });

      expect(reference).toMatchObject({
        mimeType: 'image/webp',
        byteLength: 3,
        transformation: {
          policyId: 'image-resize',
          policyVersion: 1,
          parameters: { maxLongEdge: 20 },
        },
        originalObject: {
          mimeType: 'image/png',
          byteLength: 4,
          dimensions: { width: 200, height: 100 },
        },
        selectedObject: {
          mimeType: 'image/webp',
          byteLength: 3,
          dimensions: { width: 20, height: 10 },
        },
      });
      expect(reference.originalContentId).not.toBe(reference.selectedContentId);
      expect(
        await store.readObjectVerified(reference.originalObject),
      ).toStrictEqual(originalBytes);
      expect(await store.readVerified(reference)).toStrictEqual(selectedBytes);
      expect(await store.getStoredByteLength()).toBe(7);
    });

    it('rejects known-size quota failure before invoking the byte source', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 2,
      });
      const payload = bytes(1, 2, 3);
      const contentId = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
      let sourceRead = false;

      const work = store.admitKnown(
        {
          contentId,
          knownByteLength: payload.byteLength,
          mimeType: 'image/png',
          semanticMetadata: {},
        },
        async () => {
          sourceRead = true;
          return payload;
        },
      );

      await expect(work).rejects.toThrow('quota');
      expect(sourceRead).toBe(false);
    });

    it('snapshots a known byte source while the cross-process lock is not held', async () => {
      const payload = bytes(1, 2, 3);
      const contentId = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: payload.byteLength,
      });
      let lockVisibleDuringRead = true;

      const reference = await store.admitKnown(
        {
          contentId,
          knownByteLength: payload.byteLength,
          mimeType: 'image/png',
          semanticMetadata: {},
        },
        async () => {
          lockVisibleDuringRead = await Bun.file(
            join(tempDirectory(), 'locks', 'store.lock'),
          ).exists();
          return payload;
        },
      );

      expect(lockVisibleDuringRead).toBe(false);
      expect(await store.readVerified(reference)).toStrictEqual(payload);
    });

    it('deduplicates identical content without charging it twice', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 3,
      });

      const first = await store.admit(admitInput(bytes(1, 2, 3)));
      const second = await store.admit(admitInput(bytes(1, 2, 3)));

      expect(second.contentId).toBe(first.contentId);
      expect(await store.getStoredByteLength()).toBe(3);
    });

    it('stores distinct bytes as distinct content', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 6,
      });

      const first = await store.admit(admitInput(bytes(1, 2, 3)));
      const second = await store.admit(admitInput(bytes(1, 2, 4)));

      expect(second.contentId).not.toBe(first.contentId);
      expect(await store.getStoredByteLength()).toBe(6);
    });

    it('admits one concurrent copy of identical content without partial data', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 4,
      });
      const input = admitInput(bytes(7, 8, 9, 10));

      const references = await Promise.all(
        Array.from({ length: 20 }, () => store.admit(input)),
      );

      expect(
        new Set(references.map((reference) => reference.contentId)).size,
      ).toBe(1);
      expect(await store.getStoredByteLength()).toBe(4);
      expect(await store.readVerified(references[0])).toStrictEqual(
        input.bytes,
      );
    });

    it('uses restrictive directory and file permissions where supported', async () => {
      if (process.platform === 'win32') {
        return;
      }
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 3,
      });

      const reference = await store.admit(admitInput(bytes(1, 2, 3)));
      const objectPath = await storedObjectPath(tempDirectory(), reference);

      expect((await stat(tempDirectory())).mode & 0o777).toBe(0o700);
      expect((await stat(objectPath)).mode & 0o777).toBe(0o600);
    });

    it('cleans temporary files after successful admission', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 3,
      });

      await store.admit(admitInput(bytes(1, 2, 3)));

      expect(
        (await allFiles(tempDirectory())).some((path) => path.endsWith('.tmp')),
      ).toBe(false);
    });

    it('cleans temporary files when atomic commit fails', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 3,
        fileOperations: {
          link: async () => {
            throw new Error('induced link failure');
          },
        },
      });

      const error = await capturedError(
        store.admit(admitInput(bytes(1, 2, 3))),
      );

      expect(error).toBeInstanceOf(MediaStoreError);
      expect(error.message).toContain('commit');
      expect(
        (await allFiles(tempDirectory())).some((path) => path.endsWith('.tmp')),
      ).toBe(false);
    });
    it('rolls back a newly published object when post-publication commit fails', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 3,
        fileOperations: {
          link: async (sourcePath, destinationPath) => {
            await publishLink(sourcePath, destinationPath);
            throw new Error('induced post-publication failure');
          },
        },
      });

      const error = await capturedError(
        store.admit(admitInput(bytes(1, 2, 3))),
      );

      expect(error).toBeInstanceOf(MediaStoreError);
      expect(await store.getStoredByteLength()).toBe(0);
    });

    it('does not roll back an object published concurrently by another owner', async () => {
      const payload = bytes(1, 2, 3);
      const contentId = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
      const object = {
        contentId,
        mimeType: 'image/png',
        byteLength: payload.byteLength,
        normalizedBase64Length: 4,
      };
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 3,
        fileOperations: {
          link: async (sourcePath, destinationPath) => {
            await publishLink(sourcePath, destinationPath);
            await publishLink(sourcePath, destinationPath);
          },
        },
      });

      await expect(
        store.admitObjectsTransaction([{ object, bytes: payload }], () =>
          Promise.reject(new Error('durable history publication failed')),
        ),
      ).rejects.toThrow('durable history publication failed');

      expect(await store.readObjectVerified(object)).toStrictEqual(payload);
      expect(await store.getStoredByteLength()).toBe(payload.byteLength);
    });

    it('rolls back a newly published known object when verification fails', async () => {
      const payload = bytes(4, 5, 6);
      const contentId = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 3,
        fileOperations: {
          link: async (sourcePath, destinationPath) => {
            await publishLink(sourcePath, destinationPath);
            await writeFile(destinationPath, bytes(9, 9, 9));
          },
        },
      });

      await expect(
        store.admitKnown(
          {
            contentId,
            knownByteLength: payload.byteLength,
            mimeType: 'image/png',
            semanticMetadata: {},
          },
          () => Promise.resolve(payload),
        ),
      ).rejects.toBeInstanceOf(MediaObjectHashMismatchError);

      expect(await store.getStoredByteLength()).toBe(0);
    });

    it('rejects a symlink source without publishing its target', async () => {
      const payload = bytes(7, 8, 9);
      const contentId = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
      const sourceTarget = join(tempDirectory(), 'source-target');
      const sourceLink = join(tempDirectory(), 'source-link');
      await writeFile(sourceTarget, payload);
      await symlink(sourceTarget, sourceLink);
      const store = new LocalMediaStore({
        rootDirectory: join(tempDirectory(), 'store'),
        quotaBytes: payload.byteLength,
      });

      await expect(
        store.stageObjectFiles([
          {
            object: {
              contentId,
              mimeType: 'image/png',
              byteLength: payload.byteLength,
              normalizedBase64Length: 4,
            },
            sourcePath: sourceLink,
          },
        ]),
      ).rejects.toThrow(/symbolic link|regular file/i);

      expect(await store.getStoredByteLength()).toBe(0);
    });

    it('rejects a symlink root without changing its target permissions', async () => {
      if (process.platform === 'win32') return;
      const target = join(tempDirectory(), 'target');
      const rootLink = join(tempDirectory(), 'store-link');
      await mkdir(target, { mode: 0o755 });
      await symlink(target, rootLink);
      const store = new LocalMediaStore({
        rootDirectory: rootLink,
        quotaBytes: 3,
      });

      await expect(store.admit(admitInput(bytes(1, 2, 3)))).rejects.toThrow(
        /symbolic link/i,
      );

      expect((await stat(target)).mode & 0o777).toBe(0o755);
    });

    it('never follows an object-path symlink during deduplicated publication', async () => {
      if (process.platform === 'win32') return;
      const payload = bytes(10, 11, 12);
      const externalTarget = join(tempDirectory(), 'external-target');
      await writeFile(externalTarget, payload, { mode: 0o640 });
      const store = new LocalMediaStore({
        rootDirectory: join(tempDirectory(), 'store'),
        quotaBytes: payload.byteLength,
        fileOperations: {
          link: async (sourcePath, destinationPath) => {
            await symlink(externalTarget, destinationPath);
            await publishLink(sourcePath, destinationPath);
          },
        },
      });

      await expect(store.admit(admitInput(payload))).rejects.toBeInstanceOf(
        MediaObjectCorruptError,
      );

      expect((await stat(externalTarget)).mode & 0o777).toBe(0o640);
      expect([...(await readFile(externalTarget))]).toStrictEqual([...payload]);
    });
  });

  describe('LocalMediaStore child byte parsing', () => {
    const tempDirectory = useTempDirectory();

    it('rejects empty and non-decimal byte tokens', async () => {
      const results = await Promise.all([
        runChild(childCommand('admit', tempDirectory(), 6, '1,,2')),
        runChild(childCommand('admit', tempDirectory(), 6, '0x10')),
      ]);

      expect(results.map((result) => result.exitCode === 0)).toStrictEqual([
        false,
        false,
      ]);
      expect(
        results.every((result) => result.stderr.includes('Invalid bytes')),
      ).toBe(true);
    });
  });

  describe('LocalMediaStore input validation', () => {
    const tempDirectory = useTempDirectory();

    it('rejects invalid quotas at construction', () => {
      const invalid = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY];

      const failures = invalid.map(() => false);
      invalid.forEach((quotaBytes, index) => {
        try {
          new LocalMediaStore({ rootDirectory: tempDirectory(), quotaBytes });
        } catch (error) {
          failures[index] = error instanceof MediaStoreError;
        }
      });

      expect(failures).toStrictEqual([true, true, true, true]);
    });

    it('rejects empty bytes', async () => {
      const store = testStore(tempDirectory());

      const error = await capturedError(store.admit(admitInput(bytes())));

      expect(error.message).toContain('empty');
    });

    it('rejects invalid MIME types', async () => {
      const store = testStore(tempDirectory());

      const error = await capturedError(
        store.admit({ ...admitInput(bytes(1)), mimeType: 'not a mime' }),
      );

      expect(error.message).toContain('MIME');
    });

    it('rejects malformed dimensions', async () => {
      const store = testStore(tempDirectory());
      const malformed = JSON.parse('{"width":0,"height":12}');

      const error = await capturedError(
        store.admit({ ...admitInput(bytes(1)), dimensions: malformed }),
      );

      expect(error.message).toContain('dimensions');
    });

    it('rejects invalid semantic metadata', async () => {
      const store = testStore(tempDirectory());
      const invalidMetadata = { score: Number.NaN };

      const error = await capturedError(
        store.admit({
          ...admitInput(bytes(1)),
          semanticMetadata: invalidMetadata,
        }),
      );

      expect(error.message).toContain('semantic metadata');
    });

    it('rejects semantic metadata beyond the recursion bound with its media location', async () => {
      const store = testStore(tempDirectory());
      const mediaBytes = bytes(1);
      const contentId = `sha256:${createHash('sha256').update(mediaBytes).digest('hex')}`;
      let nested: MediaSemanticMetadataValue = 'leaf';
      for (let depth = 0; depth < 66; depth += 1) {
        nested = [nested];
      }
      const semanticMetadata: MediaSemanticMetadata = { pipeline: nested };

      const error = await capturedError(
        store.admit({
          ...admitInput(mediaBytes),
          semanticMetadata,
        }),
      );

      expect(error.message).toContain('semanticMetadata.pipeline');
      expect(error.message).toMatch(/maximum depth 64/i);
      expect(error.message).toContain(contentId);
    });

    it('rejects invalid provider file metadata', async () => {
      const store = testStore(tempDirectory());
      const invalid = JSON.parse('{"openai":""}');

      const error = await capturedError(
        store.admit({ ...admitInput(bytes(1)), providerFileIds: invalid }),
      );

      expect(error.message).toContain('provider file IDs');
    });

    it('rejects a known size inconsistent with actual bytes', async () => {
      const store = testStore(tempDirectory());

      const error = await capturedError(
        store.admit({ ...admitInput(bytes(1, 2)), knownByteLength: 3 }),
      );

      expect(error.message).toContain('known byte length');
    });

    it('rejects invalid known sizes', async () => {
      const store = testStore(tempDirectory());

      const error = await capturedError(
        store.admit({ ...admitInput(bytes(1)), knownByteLength: -1 }),
      );

      expect(error.message).toContain('known byte length');
    });

    it('rejects conflicting dimensions for one content-addressed object', async () => {
      const store = testStore(tempDirectory());
      const contentId = `sha256:${createHash('sha256').update(bytes(1)).digest('hex')}`;

      await expect(
        store.preflightObjects([
          {
            contentId,
            mimeType: 'image/png',
            byteLength: 1,
            normalizedBase64Length: 4,
            dimensions: { width: 10, height: 20 },
          },
          {
            contentId,
            mimeType: 'image/png',
            byteLength: 1,
            normalizedBase64Length: 4,
            dimensions: { width: 20, height: 10 },
          },
        ]),
      ).rejects.toThrow('Conflicting stored object metadata');
    });
  });
});
