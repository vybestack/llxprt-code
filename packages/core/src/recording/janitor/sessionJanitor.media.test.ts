/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertNotNull } from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type {
  IContent,
  MediaReferenceBlock,
} from '../../services/history/IContent.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { SessionRecordingService } from '../SessionRecordingService.js';
import { runSessionCleanup } from './sessionJanitor.js';

const PROJECT_HASH = 'a'.repeat(64);
const RETENTION = {
  enabled: true,
  maxTotalSizeBytes: 1024 * 1024,
  maxAgeMs: null,
  maxCount: null,
  minRetentionMs: 0,
} as const;

function referenceContent(reference: MediaReferenceBlock): IContent {
  return {
    speaker: 'human',
    blocks: [reference],
    metadata: { turnId: 'janitor-media-turn' },
  };
}

function objectPath(store: LocalMediaStore, contentId: string): string {
  return join(
    store.rootDirectory,
    'objects',
    'sha256',
    contentId.slice('sha256:'.length),
  );
}

describe('SessionJanitor media reclamation', () => {
  let globalTempDir = '';

  beforeEach(async () => {
    globalTempDir = await mkdtemp(join(tmpdir(), 'llxprt-janitor-media-'));
  });

  afterEach(async () => {
    await rm(globalTempDir, { recursive: true, force: true });
  });

  it('reclaims only stale interrupted portable replay files with the exact managed suffix', async () => {
    const chatsDirectory = join(globalTempDir, PROJECT_HASH, 'chats');
    await mkdir(chatsDirectory, { recursive: true });
    const staleReplay = join(
      chatsDirectory,
      'session-interrupted.jsonl.550e8400-e29b-41d4-a716-446655440000.portable.tmp',
    );
    const recentReplay = join(
      chatsDirectory,
      'session-recent.jsonl.550e8400-e29b-41d4-a716-446655440001.portable.tmp',
    );
    const unrelated = join(chatsDirectory, 'notes.portable.tmp');
    await writeFile(staleReplay, 'interrupted replay');
    await writeFile(recentReplay, 'active replay');
    await writeFile(unrelated, 'unrelated');
    const staleDate = new Date(Date.now() - 120_000);
    await utimes(staleReplay, staleDate, staleDate);

    const cleanup = await runSessionCleanup({
      globalTempDir,
      config: RETENTION,
      quiet: true,
    });

    expect(cleanup.failed).toBe(0);
    await expect(stat(staleReplay)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(recentReplay, 'utf8')).toBe('active replay');
    expect(await readFile(unrelated, 'utf8')).toBe('unrelated');
  });

  it('keeps recorded and reserved deduplicated blobs while reclaiming orphans and stale temporary files', async () => {
    const projectDir = join(globalTempDir, PROJECT_HASH);
    const store = new LocalMediaStore({
      rootDirectory: join(projectDir, 'media'),
      quotaBytes: 1024,
    });
    const kept = await store.admit({
      bytes: new Uint8Array([1, 2, 3, 4]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const orphan = await store.admit({
      bytes: new Uint8Array([5, 6, 7, 8]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const reserved = await store.admit({
      bytes: new Uint8Array([9, 10, 11, 12]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    await store.reserve(reserved, 'in-flight-request');

    const recording = new SessionRecordingService({
      sessionId: 'janitor-media-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(projectDir, 'chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: store,
    });
    recording.recordContent(referenceContent(kept));
    recording.recordContent(referenceContent(kept));
    await recording.flush();
    await recording.dispose();

    const staleTemp = join(store.rootDirectory, 'temporary', 'stale.tmp');
    await writeFile(staleTemp, 'partial');
    const staleDate = new Date(Date.now() - 120_000);
    await utimes(staleTemp, staleDate, staleDate);
    await utimes(objectPath(store, orphan.contentId), staleDate, staleDate);

    await sleep(20);
    const firstCleanup = await runSessionCleanup({
      globalTempDir,
      config: RETENTION,
      quiet: true,
    });

    expect(firstCleanup.failed).toBe(0);
    expect(await readFile(objectPath(store, kept.contentId))).toStrictEqual(
      Buffer.from([1, 2, 3, 4]),
    );
    expect(await readFile(objectPath(store, reserved.contentId))).toStrictEqual(
      Buffer.from([9, 10, 11, 12]),
    );
    await expect(
      stat(objectPath(store, orphan.contentId)),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(stat(staleTemp)).rejects.toMatchObject({ code: 'ENOENT' });

    await store.release(reserved.contentId, 'in-flight-request');
    const recordingPath = recording.getFilePath();
    assertNotNull(recordingPath, 'Expected recording path');
    await unlink(recordingPath);
    await utimes(objectPath(store, kept.contentId), staleDate, staleDate);
    await utimes(objectPath(store, reserved.contentId), staleDate, staleDate);

    await sleep(20);
    await runSessionCleanup({
      globalTempDir,
      config: RETENTION,
      quiet: true,
    });

    await expect(stat(objectPath(store, kept.contentId))).rejects.toMatchObject(
      {
        code: 'ENOENT',
      },
    );
    await expect(
      stat(objectPath(store, reserved.contentId)),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('reports a top-level media reclaim failure without discarding completed sweep metrics', async () => {
    const projectDir = join(globalTempDir, PROJECT_HASH);
    const store = new LocalMediaStore({
      rootDirectory: join(projectDir, 'media'),
      quotaBytes: 1024,
    });
    const reference = await store.admit({
      bytes: new Uint8Array([21, 22, 23]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const recording = new SessionRecordingService({
      sessionId: 'janitor-failure-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(projectDir, 'chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });

    try {
      recording.recordContent(referenceContent(reference));
      await recording.flush();
      const malformedActiveHistory: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ ...reference, contentId: 'invalid-content-id' }],
          metadata: { turnId: 'malformed-active-turn' },
        },
      ];

      const cleanup = await runSessionCleanup({
        globalTempDir,
        config: RETENTION,
        quiet: true,
        activeHistory: malformedActiveHistory,
      });

      expect({
        scanned: cleanup.scanned,
        failed: cleanup.failed,
      }).toStrictEqual({
        scanned: 1,
        failed: 1,
      });
      expect(cleanup.bytesBefore).toBeGreaterThan(0);
    } finally {
      await recording.dispose();
    }
  });
});
