/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { reclaimSessionMedia } from './mediaReclamation.js';

function objectPath(store: LocalMediaStore, contentId: string): string {
  return join(
    store.rootDirectory,
    'objects',
    'sha256',
    contentId.slice('sha256:'.length),
  );
}

async function createOrphanStore(
  globalTempDirectory: string,
  projectHash: string,
  bytes: Uint8Array,
): Promise<{ store: LocalMediaStore; contentId: string }> {
  const store = new LocalMediaStore({
    rootDirectory: join(globalTempDirectory, projectHash, 'media'),
    quotaBytes: 1024,
  });
  const reference = await store.admit({
    bytes,
    mimeType: 'application/octet-stream',
    semanticMetadata: {},
  });
  return { store, contentId: reference.contentId };
}

describe('media reclamation bounded conservative scanning', () => {
  let globalTempDirectory = '';

  beforeEach(async () => {
    globalTempDirectory = await mkdtemp(
      join(tmpdir(), 'llxprt-media-reclaim-'),
    );
  });

  afterEach(async () => {
    await rm(globalTempDirectory, { recursive: true, force: true });
  });

  it('reports a corrupt recording, preserves its project, and reclaims another project', async () => {
    const corruptProject = 'a'.repeat(64);
    const eligibleProject = 'b'.repeat(64);
    const corrupt = await createOrphanStore(
      globalTempDirectory,
      corruptProject,
      new Uint8Array([1, 2, 3]),
    );
    const eligible = await createOrphanStore(
      globalTempDirectory,
      eligibleProject,
      new Uint8Array([4, 5, 6]),
    );
    const chatsDirectory = join(globalTempDirectory, corruptProject, 'chats');
    await mkdir(chatsDirectory, { recursive: true });
    await writeFile(
      join(chatsDirectory, 'session-corrupt.jsonl.gz'),
      'not-gzip',
    );

    const errors = await reclaimSessionMedia(globalTempDirectory, undefined);

    expect(errors).toBe(1);
    expect(
      await stat(objectPath(corrupt.store, corrupt.contentId)),
    ).toBeDefined();
    await expect(
      stat(objectPath(eligible.store, eligible.contentId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports a file-byte bound and preserves blobs when the ownership scan is incomplete', async () => {
    const projectHash = 'c'.repeat(64);
    const orphan = await createOrphanStore(
      globalTempDirectory,
      projectHash,
      new Uint8Array([7, 8, 9]),
    );
    const chatsDirectory = join(globalTempDirectory, projectHash, 'chats');
    await mkdir(chatsDirectory, { recursive: true });
    await writeFile(
      join(chatsDirectory, 'session-oversize.jsonl'),
      JSON.stringify({ contentId: orphan.contentId, padding: 'x'.repeat(64) }),
    );

    const errors = await reclaimSessionMedia(globalTempDirectory, undefined, {
      maxProjects: 4,
      maxFilesPerProject: 4,
      maxBytesPerFile: 16,
      maxBytesPerProject: 64,
    });

    expect(errors).toBe(1);
    expect(
      await stat(objectPath(orphan.store, orphan.contentId)),
    ).toBeDefined();
  });
});
