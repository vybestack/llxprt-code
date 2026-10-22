/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { JournalSession } from '../services/history/journalSession.js';
import { LocalMediaStore } from './local-media-store.js';
import { HistoryMediaOwnership } from './history-media-ownership.js';
import { HistoryMediaReleaseGate } from './history-media-release-gate.js';
import { deferredMediaFixture } from './native-media-queue-fixture.js';

const directory = useTempDir('native-media-queue-reopen-');
const contentId = `sha256:${createHash('sha256')
  .update(new Uint8Array([13, 21, 34]))
  .digest('hex')}`;

async function queueCounter(
  session: JournalSession,
  key: string,
): Promise<number> {
  const bytes = await session.store.getState(`rel:${key}`);
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof value !== 'number')
    throw new Error('Missing durable queue counter');
  return value;
}

async function crashWithDeferredRelease(root: string): Promise<void> {
  const child = spawn(process.execPath, [
    join(import.meta.dir, 'native-media-queue-fixture.ts'),
    root,
  ]);
  let output = '';
  let errors = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    errors += chunk;
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  try {
    expect({ exit: await exited, errors }).toStrictEqual({
      exit: 77,
      errors: '',
    });
    expect(output).toBe('');
    process.stdout.write(`queue crash child pid=${child.pid}
`);
    expect(child.exitCode).toBe(77);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await exited;
  }
}

describe('native media release queue across owner reopen', () => {
  it('reclaims a queued blob after a killed request without expiring its instance lease', async () => {
    await crashWithDeferredRelease(directory());
    const session = await JournalSession.open(
      join(directory(), 'history.llxj'),
    );
    const media = new LocalMediaStore({
      rootDirectory: join(directory(), 'media'),
      quotaBytes: 1024,
    });
    try {
      expect(session.store.mediaPins.oldestVersion).toBeUndefined();
      expect(await queueCounter(session, 'head')).toBe(0);
      expect(await queueCounter(session, 'tail')).toBe(1);
      expect(await session.store.getState('rel:0')).toBeDefined();
      expect(await media.hasReservations(contentId)).toBe(true);
      expect(
        (await media.reclaimUnreferenced(new Set(), Number.MAX_SAFE_INTEGER))
          .objectsRemoved,
      ).toBe(0);
      await new HistoryMediaOwnership(media).bindNativeMedia(session.store);
      expect(await queueCounter(session, 'head')).toBe(1);
      expect(await media.hasReservations(contentId)).toBe(false);
      expect(
        (await media.reclaimUnreferenced(new Set(), Number.MAX_SAFE_INTEGER))
          .objectsRemoved,
      ).toBe(1);
      await expect(
        stat(
          join(media.rootDirectory, 'objects', 'sha256', contentId.slice(7)),
        ),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await session.close();
      await media.close();
    }
  });

  it('vetoes actual compaction while pinned and preserves current media after drain and swap', async () => {
    const fixture = await deferredMediaFixture(directory());
    const { session, media, request, owner, row, reference, bytes } = fixture;
    try {
      const before = await readFile(session.path);
      await expect(session.store.compact()).rejects.toThrow('live pin');
      expect(await readFile(session.path)).toStrictEqual(before);
      expect(
        (await media.reclaimUnreferenced(new Set(), Number.MAX_SAFE_INTEGER))
          .objectsRemoved,
      ).toBe(0);
      await session.append([row]);
      await owner.reconcile([], () => [row]);
      await request.close();
      expect(await queueCounter(session, 'head')).toBe(
        await queueCounter(session, 'tail'),
      );
      expect(await media.readReserved(reference)).toStrictEqual(bytes);
      expect(await session.store.compact()).toBe('swapped');
      expect(await session.store.getState('rel:head')).toBeUndefined();
      expect(await media.hasReservations(reference.contentId)).toBe(true);
      expect(
        (await media.reclaimUnreferenced(new Set(), Number.MAX_SAFE_INTEGER))
          .objectsRemoved,
      ).toBe(0);
      const reopened = await JournalSession.open(session.path);
      try {
        const rows = [];
        for await (const saved of reopened.rows()) rows.push(saved.content);
        expect(rows).toStrictEqual([row]);
      } finally {
        await reopened.close();
      }
      await session.store.commit([{ kind: 'clear' }]);
      await owner.reconcile([row], () => []);
      expect(
        (await media.reclaimUnreferenced(new Set(), Number.MAX_SAFE_INTEGER))
          .objectsRemoved,
      ).toBe(1);
    } finally {
      await request.close();
      await session.close();
      await media.close();
    }
  });

  it('keeps a failed release durable and retries it idempotently on an independent owner open', async () => {
    const { session, media, request } = await deferredMediaFixture(directory());
    const failure = new Error('release storage unavailable');
    const release = spyOn(media, 'release').mockRejectedValue(failure);
    try {
      await expect(request.close()).rejects.toBe(failure);
      expect(session.store.mediaPins.oldestVersion).toBeUndefined();
      const before = await readFile(session.path);
      await expect(session.store.compact()).rejects.toThrow('live pin');
      expect(await readFile(session.path)).toStrictEqual(before);
      expect(
        (await media.reclaimUnreferenced(new Set(), Number.MAX_SAFE_INTEGER))
          .objectsRemoved,
      ).toBe(0);
      release.mockRestore();
      const reopened = await JournalSession.open(session.path);
      const nextMedia = new LocalMediaStore({
        rootDirectory: media.rootDirectory,
        quotaBytes: 1024,
      });
      try {
        const gate = new HistoryMediaReleaseGate(
          reopened.store,
          nextMedia,
          () => false,
        );
        await gate.open();
        expect(await gate.pendingCount()).toBe(0);
        expect(
          (
            await nextMedia.reclaimUnreferenced(
              new Set(),
              Number.MAX_SAFE_INTEGER,
            )
          ).objectsRemoved,
        ).toBe(1);
        const settled = await readFile(reopened.path);
        const mediaFiles = (
          await readdir(media.rootDirectory, { recursive: true })
        ).sort();
        await gate.settle();
        expect(await readFile(reopened.path)).toStrictEqual(settled);
        expect(
          (await readdir(media.rootDirectory, { recursive: true })).sort(),
        ).toStrictEqual(mediaFiles);
      } finally {
        await reopened.close();
        await nextMedia.close();
      }
    } finally {
      release.mockRestore();
      await session.close();
      await media.close();
    }
  });
});
