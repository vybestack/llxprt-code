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
  rename,
  rm,
  stat,
  utimes,
  watch,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from './local-media-store.js';
import {
  isMediaReferenceBlock,
  type MediaReferenceBlock,
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

describe('LocalMediaStore quota enforcement', () => {
  const tempDirectory = useTempDirectory();

  it('rejects a non-empty object when quota is zero', async () => {
    const store = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 0,
    });

    const error = await capturedError(store.admit(admitInput(bytes(1))));

    expect(error.message).toContain('quota');
  });

  it('admits an object exactly at quota', async () => {
    const store = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 3,
    });

    const reference = await store.admit(admitInput(bytes(1, 2, 3)));

    expect(reference.byteLength).toBe(3);
  });

  it('rejects an object one byte over quota', async () => {
    const store = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 2,
    });

    const error = await capturedError(store.admit(admitInput(bytes(1, 2, 3))));

    expect(error.message).toContain('quota');
  });

  it('includes pre-existing stored objects in aggregate quota usage', async () => {
    const firstStore = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 4,
    });
    await firstStore.admit(admitInput(bytes(1, 2, 3)));
    const reopenedStore = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 4,
    });

    const error = await capturedError(
      reopenedStore.admit(admitInput(bytes(4, 5))),
    );

    expect(error.message).toContain('quota');
    expect(await reopenedStore.getStoredByteLength()).toBe(3);
  });

  it('allows a duplicate when the spool is already at quota', async () => {
    const store = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 3,
    });
    const first = await store.admit(admitInput(bytes(1, 2, 3)));

    const duplicate = await store.admit(admitInput(bytes(1, 2, 3)));

    expect(duplicate.contentId).toBe(first.contentId);
    expect(await store.getStoredByteLength()).toBe(3);
  });
  it('enforces quota atomically across independent store instances admitting different objects', async () => {
    const firstStore = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 4,
    });
    const secondStore = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 4,
    });

    const outcomes = await Promise.allSettled([
      firstStore.admit(admitInput(bytes(1, 2, 3))),
      secondStore.admit(admitInput(bytes(4, 5, 6))),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected'),
    ).toHaveLength(1);
    expect(await firstStore.getStoredByteLength()).toBe(3);
  });

  it('deduplicates concurrent admission across independent store instances', async () => {
    const firstStore = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 3,
    });
    const secondStore = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 3,
    });
    const input = admitInput(bytes(7, 8, 9));

    const [first, second] = await Promise.all([
      firstStore.admit(input),
      secondStore.admit(input),
    ]);

    expect(first.contentId).toBe(second.contentId);
    expect(await firstStore.getStoredByteLength()).toBe(3);
    expect(await secondStore.readVerified(second)).toEqual(input.bytes);
  });

  it('deduplicates the same blob across concurrent child processes', async () => {
    const command = childCommand('admit', tempDirectory(), 3, '31,32,33');

    const [first, second] = await Promise.all([
      runChild(command),
      runChild(command),
    ]);
    if (first.exitCode !== 0) throw new Error(first.stderr);
    if (second.exitCode !== 0) throw new Error(second.stderr);
    const firstReference = parseChildReference(first.stdout);
    const secondReference = parseChildReference(second.stdout);
    const store = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 3,
    });

    expect(firstReference.contentId).toBe(secondReference.contentId);
    expect(await store.getStoredByteLength()).toBe(3);
  });

  it('serializes quota contention across child processes admitting different blobs', async () => {
    const [first, second] = await Promise.all([
      runChild(childCommand('admit', tempDirectory(), 3, '41,42,43')),
      runChild(childCommand('admit', tempDirectory(), 3, '51,52,53')),
    ]);
    const successes = [first, second].filter((result) => result.exitCode === 0);
    const failures = [first, second].filter((result) => result.exitCode !== 0);
    const store = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 3,
    });

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.stderr).toContain('quota');
    expect(await store.getStoredByteLength()).toBe(3);
  });

  it('fails before publication when quota state exceeds its finite scan bound', async () => {
    const objectDirectory = join(tempDirectory(), 'objects', 'sha256');
    await mkdir(objectDirectory, { recursive: true });
    const existingDigests = ['first', 'second'].map((label) =>
      createHash('sha256').update(label).digest('hex'),
    );
    await Promise.all(
      existingDigests.map((digest) =>
        writeFile(join(objectDirectory, digest), bytes(1), { mode: 0o600 }),
      ),
    );
    const store = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 10,
      quotaScanMaxEntries: 1,
    });
    const payload = bytes(7, 8, 9);
    const digest = createHash('sha256').update(payload).digest('hex');

    await expect(store.admit(admitInput(payload))).rejects.toThrow(
      /quota state.*bound/i,
    );

    expect(await Bun.file(join(objectDirectory, digest)).exists()).toBe(false);
    expect(await readdir(objectDirectory)).toHaveLength(2);
  });

  it('does not remove a replacement holder after partial lock initialization fails', async () => {
    const lockPath = join(tempDirectory(), 'locks', 'store.lock');
    const displacedPath = join(tempDirectory(), 'locks', 'displaced.lock');
    const replacementOwner = '{"token":"replacement-holder"}';
    let failInitialization = true;
    const store = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 3,
      fileOperations: {
        link: publishLink,
        syncDirectory: async (path) => {
          if (path.endsWith(join('locks')) && failInitialization) {
            failInitialization = false;
            await rename(lockPath, displacedPath);
            await writeFile(lockPath, replacementOwner, {
              flag: 'wx',
              mode: 0o600,
            });
            throw new Error('induced lock initialization failure');
          }
        },
      },
    });

    await expect(store.admit(admitInput(bytes(1, 2, 3)))).rejects.toThrow(
      'induced lock initialization failure',
    );

    expect(await readFile(lockPath, 'utf8')).toBe(replacementOwner);
  });

  it('aggregates lock initialization and owned-path cleanup failures', async () => {
    let lockDirectorySyncs = 0;
    const store = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 3,
      fileOperations: {
        link: publishLink,
        syncDirectory: async (path) => {
          if (!path.endsWith(join('locks'))) return;
          lockDirectorySyncs += 1;
          throw new Error(
            lockDirectorySyncs === 1
              ? 'induced lock initialization failure'
              : 'induced lock cleanup failure',
          );
        },
      },
    });

    const error = await capturedError(store.admit(admitInput(bytes(1, 2, 3))));

    if (!(error.cause instanceof AggregateError)) {
      throw new Error('Expected aggregated lock initialization failures');
    }
    expect(
      error.cause.errors.map((failure) =>
        failure instanceof Error ? failure.message : String(failure),
      ),
    ).toEqual([
      'induced lock initialization failure',
      'induced lock cleanup failure',
    ]);
    expect(
      await Bun.file(join(tempDirectory(), 'locks', 'store.lock')).exists(),
    ).toBe(false);
  });

  it('refuses to release a lock whose inode has an active takeover claim', async () => {
    const payload = bytes(1, 2, 3);
    const contentId = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
    const lockPath = join(tempDirectory(), 'locks', 'store.lock');
    const claimPath = join(
      tempDirectory(),
      'locks',
      'store.lock.test.takeover',
    );
    const store = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 3,
    });

    try {
      await expect(
        store.admitObjectsTransaction(
          [
            {
              object: {
                contentId,
                mimeType: 'image/png',
                byteLength: payload.byteLength,
                normalizedBase64Length: 4,
              },
              bytes: payload,
            },
          ],
          async () => {
            await publishLink(lockPath, claimPath);
          },
        ),
      ).rejects.toThrow(/ownership changed/i);
      expect(await Bun.file(lockPath).exists()).toBe(true);
    } finally {
      await rm(claimPath, { force: true });
      await rm(lockPath, { force: true });
    }
  });

  it('recovers a store lock abandoned by a crashed child process', async () => {
    const crashed = await runChild(
      childCommand('lock-crash', tempDirectory(), 3, '81,82,83'),
    );
    if (crashed.exitCode !== 0) throw new Error(crashed.stderr);
    const epoch = new Date(0);
    await utimes(join(tempDirectory(), 'locks', 'store.lock'), epoch, epoch);
    const store = new LocalMediaStore({
      rootDirectory: tempDirectory(),
      quotaBytes: 3,
      lockTimeoutMs: 2_000,
      staleLockMs: 30,
    });

    const reference = await store.admit(admitInput(bytes(81, 82, 83)));

    expect(await store.readVerified(reference)).toEqual(bytes(81, 82, 83));
  });

  it('keeps a live slow publisher exclusive after a deterministic heartbeat barrier', async () => {
    const readyPath = join(tempDirectory(), 'slow-publisher-ready');
    const releasePath = join(tempDirectory(), 'release-slow-publisher');
    const lockDirectory = join(tempDirectory(), 'locks');
    const lockPath = join(lockDirectory, 'store.lock');
    const child = Bun.spawn(
      childCommand(
        'hold-publish',
        tempDirectory(),
        3,
        '91,92,93',
        readyPath,
        releasePath,
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
      const epoch = new Date(0);
      await utimes(lockPath, epoch, epoch);
      await waitForMtimeAfterEpoch(lockPath, lockDirectory);
      const contender = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 3,
        lockTimeoutMs: 2_000,
        staleLockMs: 30,
      });

      const reclamation = contender.reclaimUnreferenced(new Set(), Date.now());
      await writeFile(releasePath, 'release', { flag: 'wx' });
      const [exitCode, result, stdout, stderr] = await Promise.all([
        child.exited,
        reclamation,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (exitCode !== 0) throw new Error(stderr);
      const reference = parseChildReference(stdout);

      expect(result.temporaryFilesRemoved).toBe(0);
      expect(await contender.readVerified(reference)).toEqual(
        bytes(91, 92, 93),
      );
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await child.exited;
    }
  });
});
