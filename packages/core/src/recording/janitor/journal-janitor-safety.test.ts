/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  LocalMediaStore,
  MediaObjectMissingError,
} from '../../storage/local-media-store.js';

import { remainderDirectory } from '../__tests__/support/discovery-remainder-fixture.js';
import {
  recordJournal,
  userRow,
} from '../__tests__/support/recordedJournals.js';
import { resolveRetentionConfig } from './retentionPolicy.js';
import {
  runSessionCleanup,
  setRmdirFaultForTest,
  setScanToMutationHookForTest,
} from './sessionJanitor.js';

const HASH = 'a'.repeat(64);
const OLD = new Date('2026-01-01T00:00:00.000Z');

describe('native janitor safety and media interaction', () => {
  let root: string;
  let chats: string;
  beforeEach(async () => {
    root = await remainderDirectory('janitor-safety');
    chats = join(root, HASH, 'chats');
    await fs.mkdir(chats, { recursive: true });
  });
  afterEach(() => {
    setScanToMutationHookForTest(null);
    setRmdirFaultForTest(null);
  });

  async function session(): Promise<string> {
    return (
      await recordJournal(chats, 'native-safety', {
        rows: [userRow('A'.repeat(50_000))],
        modifiedAt: OLD,
      })
    ).filePath;
  }

  async function sweep(
    maxTotalSizeMB = 0.001,
  ): Promise<Awaited<ReturnType<typeof runSessionCleanup>>> {
    return runSessionCleanup({
      globalTempDir: root,
      config: resolveRetentionConfig({ maxTotalSizeMB }),
      quiet: true,
    });
  }

  it('keeps the global root after actually deleting an expired native session', async () => {
    const file = await session();
    const result = await runSessionCleanup({
      globalTempDir: root,
      config: resolveRetentionConfig({ maxAge: '3d' }),
      quiet: true,
    });
    expect(result.scanned).toBe(1);
    expect(result.rawDeleted).toBe(1);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.stat(root)).isDirectory()).toBe(true);
  });

  it('does not follow a symlinked archive directory while a native raw is over budget', async () => {
    const outside = join(root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(join(outside, 'secret.txt'), 'outside bytes');
    await fs.symlink(outside, join(chats, 'archive'), 'dir');
    const file = await session();
    const bytes = await fs.readFile(file);
    const result = await sweep();
    expect(result.scanned).toBe(1);
    expect(result.archived).toBe(0);
    expect(Buffer.compare(await fs.readFile(file), bytes)).toBe(0);
    expect(await fs.readdir(outside)).toStrictEqual(['secret.txt']);
    expect(await fs.readFile(join(outside, 'secret.txt'), 'utf8')).toBe(
      'outside bytes',
    );
    expect((await fs.lstat(join(chats, 'archive'))).isSymbolicLink()).toBe(
      true,
    );
  });

  it('does not follow a native pathname replaced by a symlink before scanning', async () => {
    const file = await session();
    const outside = join(root, 'outside-target');
    const bytes = await fs.readFile(file);
    await fs.writeFile(outside, bytes);
    await fs.rename(file, `${file}.held`);
    await fs.symlink(outside, file);
    const result = await sweep();
    expect(result.archived).toBe(0);
    expect(result.rawDeleted).toBe(0);
    expect((await fs.lstat(file)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(outside)).toStrictEqual(bytes);
    expect(await fs.readFile(`${file}.held`)).toStrictEqual(bytes);
    expect((await fs.readdir(chats)).sort()).toStrictEqual(
      [basename(file), `${basename(file)}.held`].sort(),
    );
  });

  it('retains stale non-session and native-looking portable temp files outside the actual transfer grammar', async () => {
    const archive = join(chats, 'archive');
    await fs.mkdir(archive);
    const innocent = join(archive, 'random.bak');
    const portable = join(
      chats,
      'session-native.llxj.550e8400-e29b-41d4-a716-446655440000.portable.tmp',
    );
    await fs.writeFile(innocent, 'backup');
    await fs.writeFile(portable, 'unrelated native-looking transfer');
    await fs.utimes(innocent, OLD, OLD);
    await fs.utimes(portable, OLD, OLD);
    const file = await session();
    const bytes = await fs.readFile(file);
    const result = await sweep(4096);
    expect(result.scanned).toBe(1);
    expect(await fs.readFile(innocent, 'utf8')).toBe('backup');
    expect(await fs.readFile(portable, 'utf8')).toBe(
      'unrelated native-looking transfer',
    );
    expect(Buffer.compare(await fs.readFile(file), bytes)).toBe(0);
  });

  it('retains a valid same-ID native replacement by inode and keeps its referenced media while reclaiming an orphan', async () => {
    const store = new LocalMediaStore({
      rootDirectory: join(root, HASH, 'media'),
      quotaBytes: 1024 * 1024,
    });
    const reference = await store.admit({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const orphan = await store.admit({
      bytes: new Uint8Array([7, 8, 9]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const file = await session();
    const originalStat = await fs.stat(file);
    const replacement = await recordJournal(
      join(root, 'replacement'),
      'native-safety',
      { rows: [{ speaker: 'human', blocks: [reference] }], modifiedAt: OLD },
    );
    const bytes = await fs.readFile(replacement.filePath);
    setScanToMutationHookForTest(async () => {
      await fs.rename(file, `${file}.held-original`);
      await fs.rename(replacement.filePath, file);
    });
    const result = await sweep();
    expect(result.scanned).toBe(1);
    expect((await fs.stat(file)).ino).not.toBe(originalStat.ino);
    expect(result.archived).toBe(0);
    expect(result.rawDeleted).toBe(0);
    expect(Buffer.compare(await fs.readFile(file), bytes)).toBe(0);
    expect(await store.readVerified(reference)).toStrictEqual(
      new Uint8Array([1, 2, 3]),
    );
    await expect(store.readVerified(orphan)).rejects.toBeInstanceOf(
      MediaObjectMissingError,
    );
  });

  it('counts injected non-benign directory I/O errors after scanning a native candidate', async () => {
    const file = await session();
    const bytes = await fs.readFile(file);
    setRmdirFaultForTest(async () => {
      throw Object.assign(new Error('native rmdir EIO'), { code: 'EIO' });
    });
    const result = await sweep(4096);
    expect(result.scanned).toBe(1);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(Buffer.compare(await fs.readFile(file), bytes)).toBe(0);
    expect((await fs.stat(root)).isDirectory()).toBe(true);
  });

  it('keeps all project media when an unreadable native sibling prevents a complete ownership scan', async () => {
    const store = new LocalMediaStore({
      rootDirectory: join(root, HASH, 'media'),
      quotaBytes: 1024 * 1024,
    });
    const reference = await store.admit({
      bytes: new Uint8Array([4, 5, 6]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const file = await session();
    const damaged = join(chats, 'session-damaged.llxj');
    await fs.writeFile(damaged, 'damaged external journal');
    const bytes = await fs.readFile(file);
    const result = await sweep(4096);
    expect(result.scanned).toBe(2);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await store.readVerified(reference)).toStrictEqual(
      new Uint8Array([4, 5, 6]),
    );
    expect(Buffer.compare(await fs.readFile(file), bytes)).toBe(0);
    expect(await fs.readFile(damaged, 'utf8')).toBe('damaged external journal');
  });
});
