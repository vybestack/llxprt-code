/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertNotNull } from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IContent,
  MediaReferenceBlock,
  MediaStoredObject,
} from '../services/history/IContent.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import {
  exportSessionMediaPackage,
  importSessionMediaPackage,
  validateSessionMediaPackage,
} from './session-media-package.js';

const PROJECT_HASH = 'package-integrity-project';
const FIRST_BYTES = new Uint8Array([11, 22, 33, 44]);
const SECOND_BYTES = new Uint8Array([101, 102, 103, 104, 105]);

/** Independent of the product's hashing helpers on purpose. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function abortError(): Error {
  const error = new Error('operation cancelled');
  error.name = 'AbortError';
  return error;
}

class CancellableMediaStore extends LocalMediaStore {
  private readObjectCalls = 0;
  private cancelOnReadObjectCall = 0;

  /** Cancels the nth readObjectVerified call made after this is armed. */
  cancelReadObjectAfter(calls: number): void {
    this.cancelOnReadObjectCall = this.readObjectCalls + calls;
  }
  cancelOnReserveCall = 0;
  private reserveCalls = 0;

  override async readObjectVerified(
    object: MediaStoredObject,
  ): Promise<Uint8Array> {
    this.readObjectCalls += 1;
    if (this.readObjectCalls === this.cancelOnReadObjectCall)
      throw abortError();
    return super.readObjectVerified(object);
  }

  override async reserve(
    ...args: Parameters<LocalMediaStore['reserve']>
  ): ReturnType<LocalMediaStore['reserve']> {
    this.reserveCalls += 1;
    if (this.reserveCalls === this.cancelOnReserveCall) throw abortError();
    return super.reserve(...args);
  }
}

interface ExportedPackage {
  readonly directory: string;
  readonly references: readonly MediaReferenceBlock[];
  readonly sourceStore: CancellableMediaStore;
  readonly recordingPath: string;
}

async function listTree(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await listTree(path)).map((p) => join(entry.name, p)));
    } else {
      found.push(entry.name);
    }
  }
  return found.sort();
}

async function treeDigest(root: string): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  for (const relative of await listTree(root)) {
    digests[relative] = sha256Hex(await readFile(join(root, relative)));
  }
  return digests;
}

describe('session media package integrity and cancellation', () => {
  let tempDirectory = '';

  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'llxprt-package-integrity-'));
  });

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  function destinationStore(name: string): CancellableMediaStore {
    return new CancellableMediaStore({
      rootDirectory: join(tempDirectory, name, 'media'),
      quotaBytes: 1024,
    });
  }

  async function exportPackage(): Promise<ExportedPackage> {
    const sourceStore = destinationStore('source');
    const references = [
      await sourceStore.admit({
        bytes: FIRST_BYTES,
        mimeType: 'application/octet-stream',
        semanticMetadata: {},
      }),
      await sourceStore.admit({
        bytes: SECOND_BYTES,
        mimeType: 'application/octet-stream',
        semanticMetadata: {},
      }),
    ];
    const recording = new SessionRecordingService({
      sessionId: 'integrity-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'source', 'chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    const rows: IContent[] = references.map((reference, index) => ({
      speaker: 'human',
      blocks: [reference],
      metadata: { turnId: `integrity-turn-${index}` },
    }));
    for (const row of rows) recording.recordContent(row);
    await recording.flush();
    const recordingPath = recording.getFilePath();
    assertNotNull(recordingPath, 'Expected recording path');
    const directory = join(tempDirectory, 'exported-package');
    await exportSessionMediaPackage(
      recordingPath,
      PROJECT_HASH,
      sourceStore,
      directory,
    );
    await recording.dispose();
    return { directory, references, sourceStore, recordingPath };
  }

  async function expectUntouchedDestination(
    store: LocalMediaStore,
    references: readonly MediaReferenceBlock[],
    chats: string,
  ): Promise<void> {
    expect(await store.getStoredByteLength()).toBe(0);
    for (const reference of references) {
      expect(await store.hasReservations(reference.contentId)).toBe(false);
    }
    await expect(readdir(chats)).rejects.toMatchObject({ code: 'ENOENT' });
  }

  it('writes blobs and manifest digests that match independently computed sha256 values', async () => {
    const exported = await exportPackage();

    const manifest = JSON.parse(
      await readFile(join(exported.directory, 'manifest.json'), 'utf8'),
    ) as { objects: MediaStoredObject[]; recording: string };
    const expectedIds = [FIRST_BYTES, SECOND_BYTES]
      .map((bytes) => `sha256:${sha256Hex(bytes)}`)
      .sort();
    expect(
      manifest.objects.map((object) => object.contentId).sort(),
    ).toStrictEqual(expectedIds);
    for (const bytes of [FIRST_BYTES, SECOND_BYTES]) {
      const blob = await readFile(
        join(exported.directory, 'blobs', 'sha256', sha256Hex(bytes)),
      );
      expect(new Uint8Array(blob)).toStrictEqual(bytes);
      expect(sha256Hex(blob)).toBe(sha256Hex(bytes));
    }
    expect(
      (await readdir(join(exported.directory, 'blobs', 'sha256'))).sort(),
    ).toStrictEqual(expectedIds.map((id) => id.slice('sha256:'.length)));

    const recordingBytes = await readFile(
      join(exported.directory, manifest.recording),
    );
    const validated = await validateSessionMediaPackage(exported.directory);
    expect(validated.recording.sha256).toBe(sha256Hex(recordingBytes));
    expect(validated.recording.byteLength).toBe(recordingBytes.byteLength);

    const store = destinationStore('digest-destination');
    await importSessionMediaPackage(
      exported.directory,
      join(tempDirectory, 'digest-destination', 'chats'),
      PROJECT_HASH,
      store,
    );
    for (const bytes of [FIRST_BYTES, SECOND_BYTES]) {
      const stored = await readFile(
        join(store.rootDirectory, 'objects', 'sha256', sha256Hex(bytes)),
      );
      expect(sha256Hex(stored)).toBe(sha256Hex(bytes));
    }
  });

  it('cleans staged export files and reservations when export is cancelled while copying blobs', async () => {
    const exported = await exportPackage();
    const destination = join(tempDirectory, 'cancelled-export');
    // Calls 1 and 2 verify each row during replay; call 3 is the first blob copy.
    exported.sourceStore.cancelReadObjectAfter(3);
    const sourceBefore = await stat(exported.recordingPath);

    await expect(
      exportSessionMediaPackage(
        exported.recordingPath,
        PROJECT_HASH,
        exported.sourceStore,
        destination,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      (await readdir(tempDirectory)).filter((name) =>
        name.startsWith('cancelled-export'),
      ),
    ).toStrictEqual([]);
    for (const reference of exported.references) {
      expect(
        await exported.sourceStore.hasReservations(reference.contentId),
      ).toBe(false);
    }
    expect((await stat(exported.recordingPath)).size).toBe(sourceBefore.size);
  });

  it('leaves the destination untouched and releases reservations when import is cancelled mid-reservation', async () => {
    const exported = await exportPackage();
    const before = await treeDigest(exported.directory);
    const store = destinationStore('cancel-reserve');
    store.cancelOnReserveCall = 2;
    const chats = join(tempDirectory, 'cancel-reserve', 'chats');

    await expect(
      importSessionMediaPackage(exported.directory, chats, PROJECT_HASH, store),
    ).rejects.toMatchObject({ name: 'AbortError' });

    await expectUntouchedDestination(store, exported.references, chats);
    expect(await treeDigest(exported.directory)).toStrictEqual(before);
  });

  it('removes the published session and staged media when activation is cancelled', async () => {
    const exported = await exportPackage();
    const store = destinationStore('cancel-activate');
    const chats = join(tempDirectory, 'cancel-activate', 'chats');

    await expect(
      importSessionMediaPackage(
        exported.directory,
        chats,
        PROJECT_HASH,
        store,
        async () => {
          throw abortError();
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    await expectUntouchedDestination(store, exported.references, chats);
  });

  it('rejects a missing blob naming its content ID and rolls back completely', async () => {
    const exported = await exportPackage();
    const missing = `sha256:${sha256Hex(SECOND_BYTES)}`;
    await rm(
      join(exported.directory, 'blobs', 'sha256', sha256Hex(SECOND_BYTES)),
    );
    const store = destinationStore('missing-blob');
    const chats = join(tempDirectory, 'missing-blob', 'chats');

    await expect(
      importSessionMediaPackage(exported.directory, chats, PROJECT_HASH, store),
    ).rejects.toThrow(missing);

    await expectUntouchedDestination(store, exported.references, chats);
  });

  it('rejects a same-length corrupt blob by hash mismatch and rolls back completely', async () => {
    const exported = await exportPackage();
    const corrupted = new Uint8Array(SECOND_BYTES.byteLength).fill(7);
    await writeFile(
      join(exported.directory, 'blobs', 'sha256', sha256Hex(SECOND_BYTES)),
      corrupted,
    );
    const store = destinationStore('corrupt-blob');
    const chats = join(tempDirectory, 'corrupt-blob', 'chats');

    await expect(
      importSessionMediaPackage(exported.directory, chats, PROJECT_HASH, store),
    ).rejects.toThrow(/corrupt/);

    await expectUntouchedDestination(store, exported.references, chats);
  });

  it('rejects a blob corrupted after validation and rolls back completely', async () => {
    const exported = await exportPackage();
    const validated = await validateSessionMediaPackage(exported.directory);
    await writeFile(
      join(exported.directory, 'blobs', 'sha256', sha256Hex(FIRST_BYTES)),
      new Uint8Array(FIRST_BYTES.byteLength).fill(9),
    );
    const store = destinationStore('late-corrupt');
    const chats = join(tempDirectory, 'late-corrupt', 'chats');

    await expect(
      importSessionMediaPackage(validated, chats, PROJECT_HASH, store),
    ).rejects.toThrow(/changed during publication/);

    await expectUntouchedDestination(store, exported.references, chats);
  });
});
