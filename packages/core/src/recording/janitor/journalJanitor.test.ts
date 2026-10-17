/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { metricReference } from '../../storage/media-metrics-test-helpers.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { useBackendEnv } from '../__tests__/support/backendEnv.js';
import {
  recordJournal,
  userRow,
} from '../__tests__/support/recordedJournals.js';
import { reclaimSessionMedia } from './mediaReclamation.js';
import { resolveRetentionConfig } from './retentionPolicy.js';
import { readSessionHeaderInfo } from './sessionHeaderReader.js';
import {
  buildSessionGroups,
  evaluateGroupEligibility,
} from './sessionGrouping.js';
import { runSessionCleanup } from './sessionJanitor.js';
import { scanGlobalSessions } from './sessionScanner.js';

const PROJECT_DIR = 'a'.repeat(64);
const DAY_MS = 24 * 60 * 60 * 1000;

describe('the janitor on the journal backend', () => {
  const root = useTempDir('janitor-journal-');
  const setBackend = useBackendEnv();
  const chatsDir = () => path.join(root(), PROJECT_DIR, 'chats');
  const archiveDir = () => path.join(chatsDir(), 'archive');

  it('reads the session id, start time and project of a journal header', async () => {
    const { filePath } = await recordJournal(chatsDir(), 'sess-1', {
      rows: [userRow('hi')],
    });
    const header = await readSessionHeaderInfo(filePath);
    expect(header?.sessionId).toBe('sess-1');
    expect(header?.projectHash).toBe('project-hash');
    expect(typeof header?.startTime).toBe('string');
  });

  it('reports a damaged journal as unreadable (no header)', async () => {
    await fsp.mkdir(chatsDir(), { recursive: true });
    const damaged = path.join(chatsDir(), 'session-damaged.llxj');
    await fsp.writeFile(damaged, 'not a journal');
    expect(await readSessionHeaderInfo(damaged)).toBeNull();
  });

  it('scans journal files and archives, and lists retired JSONL files as unreadable without opening them', async () => {
    setBackend('journal');
    const { filePath } = await recordJournal(chatsDir(), 'sess-1', {
      rows: [userRow('hi')],
    });
    await fsp.mkdir(archiveDir(), { recursive: true });
    await fsp.writeFile(
      path.join(archiveDir(), 'session-old.llxj.gz'),
      gzipSync('x'),
    );
    await fsp.writeFile(
      path.join(archiveDir(), 'session-older.jsonl.gz'),
      gzipSync('x'),
    );
    const retired = path.join(chatsDir(), 'session-retired.jsonl');
    await fsp.writeFile(
      retired,
      '{"type":"session_start","payload":{"sessionId":"retired-id"}}\n',
    );

    const scan = await scanGlobalSessions(root(), 'sess-1');

    const byName = new Map(scan.candidates.map((c) => [c.fileName, c]));
    expect([...byName.keys()].sort()).toStrictEqual(
      [
        path.basename(filePath),
        'session-old.llxj.gz',
        'session-older.jsonl.gz',
        'session-retired.jsonl',
      ].sort(),
    );
    const journal = byName.get(path.basename(filePath));
    expect(journal?.sessionId).toBe('sess-1');
    expect(journal?.isCurrentSession).toBe(true);
    expect(byName.get('session-retired.jsonl')?.sessionId).toBeNull();
    expect(byName.get('session-retired.jsonl')?.kind).toBe('raw');
    expect(byName.get('session-old.llxj.gz')?.kind).toBe('archive');
  });

  it('keeps a retired JSONL file protected, the way every unreadable recording is', async () => {
    setBackend('journal');
    await fsp.mkdir(chatsDir(), { recursive: true });
    await fsp.writeFile(path.join(chatsDir(), 'session-retired.jsonl'), '{}\n');
    const scan = await scanGlobalSessions(root());
    const groups = buildSessionGroups(scan.candidates);
    expect(groups).toHaveLength(1);
    expect(
      await evaluateGroupEligibility(groups[0], resolveRetentionConfig({})),
    ).toBe('protected');
  });

  it('pairs a journal file with its archive in one group', async () => {
    setBackend('journal');
    await fsp.mkdir(archiveDir(), { recursive: true });
    await fsp.writeFile(path.join(chatsDir(), 'session-x.llxj'), 'a');
    await fsp.writeFile(path.join(archiveDir(), 'session-x.llxj.gz'), 'b');
    const groups = buildSessionGroups(
      (await scanGlobalSessions(root())).candidates,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].raw).not.toBeNull();
    expect(groups[0].archive).not.toBeNull();
    expect(groups[0].baseName).toBe('session-x.llxj');
  });

  it('sees only the files of the old backend when the old backend is selected', async () => {
    setBackend('old');
    await recordJournal(chatsDir(), 'sess-1', { rows: [userRow('hi')] });
    const scan = await scanGlobalSessions(root());
    expect(scan.candidates).toStrictEqual([]);
  });

  it('applies the existing age policy: a journal session ages out, a retired file stays', async () => {
    setBackend('journal');
    const old = new Date(Date.now() - 5 * DAY_MS);
    const { filePath } = await recordJournal(chatsDir(), 'sess-old', {
      rows: [userRow('hi')],
      modifiedAt: old,
    });
    const retired = path.join(chatsDir(), 'session-retired.jsonl');
    await fsp.writeFile(retired, '{}\n');
    await fsp.utimes(retired, old, old);

    const result = await runSessionCleanup({
      globalTempDir: root(),
      config: resolveRetentionConfig({ maxAge: '3d' }),
      quiet: true,
    });

    expect(result.rawDeleted).toBe(1);
    await expect(fsp.stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fsp.stat(retired)).isFile()).toBe(true);
  });
});

describe('media reclamation over journal files', () => {
  const root = useTempDir('media-journal-');
  const chatsDir = () => path.join(root(), PROJECT_DIR, 'chats');

  async function storeWithOrphan(
    index: number,
  ): Promise<{ store: LocalMediaStore; contentId: string }> {
    const store = new LocalMediaStore({
      rootDirectory: path.join(root(), PROJECT_DIR, 'media'),
      quotaBytes: 1024 * 1024,
    });
    const reference = await store.admit({
      bytes: new Uint8Array([index, index + 1, index + 2]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    return { store, contentId: reference.contentId };
  }

  function objectPath(store: LocalMediaStore, contentId: string): string {
    return path.join(
      store.rootDirectory,
      'objects',
      'sha256',
      contentId.slice('sha256:'.length),
    );
  }

  it('keeps the blobs a journal row names and reclaims the rest', async () => {
    const kept = await storeWithOrphan(1);
    const orphan = await storeWithOrphan(9);
    await recordJournal(chatsDir(), 'sess-m', {
      rows: [
        {
          speaker: 'human',
          blocks: [
            {
              ...metricReference(1),
              contentId: kept.contentId,
              originalContentId: kept.contentId,
              selectedContentId: kept.contentId,
            },
          ],
        },
      ],
    });

    const errors = await reclaimSessionMedia(root(), undefined);

    expect(errors).toBe(0);
    expect(
      (await fsp.stat(objectPath(kept.store, kept.contentId))).isFile(),
    ).toBe(true);
    await expect(
      fsp.stat(objectPath(orphan.store, orphan.contentId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('scans a journal larger than the byte limits instead of leaving the project unreclaimed', async () => {
    const kept = await storeWithOrphan(1);
    const orphan = await storeWithOrphan(9);
    await recordJournal(chatsDir(), 'sess-big', {
      rows: [
        userRow('x'.repeat(200 * 1024)),
        {
          speaker: 'human',
          blocks: [
            {
              ...metricReference(1),
              contentId: kept.contentId,
              originalContentId: kept.contentId,
              selectedContentId: kept.contentId,
            },
          ],
        },
      ],
    });

    const errors = await reclaimSessionMedia(root(), undefined, {
      maxBytesPerFile: 16,
      maxBytesPerProject: 64,
      maxDecompressedBytesPerFile: 16,
    });

    expect(errors).toBe(0);
    expect(
      (await fsp.stat(objectPath(kept.store, kept.contentId))).isFile(),
    ).toBe(true);
    await expect(
      fsp.stat(objectPath(orphan.store, orphan.contentId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('still refuses an oversize retired JSONL file and reclaims nothing from its project', async () => {
    const orphan = await storeWithOrphan(9);
    await fsp.mkdir(chatsDir(), { recursive: true });
    await fsp.writeFile(
      path.join(chatsDir(), 'session-old.jsonl'),
      'y'.repeat(256),
    );

    const errors = await reclaimSessionMedia(root(), undefined, {
      maxBytesPerFile: 16,
    });

    expect(errors).toBe(1);
    expect(
      (await fsp.stat(objectPath(orphan.store, orphan.contentId))).isFile(),
    ).toBe(true);
  });
});
