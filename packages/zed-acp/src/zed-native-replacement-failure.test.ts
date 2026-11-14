/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { access } from 'node:fs/promises';
import { todoEvents } from '@vybestack/llxprt-code-core';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import {
  SessionLockManager,
  type LockHandle,
} from '@vybestack/llxprt-code-core/recording/SessionLockManager.js';
import { journalFileRows } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import {
  isMediaReferenceBlock,
  type MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import {
  nativeAcpFixture,
  nativeRows,
  nativeFailureLeaves,
  replayText,
} from './__tests__/support/native-acp-fault-fixture.js';
import { observeNativeAcpResources } from './__tests__/support/native-acp-resources.js';

const image =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDTsAAAAASUVORK5CYII=';

async function archivedImage(
  path: string,
  rootDirectory: string,
): Promise<Uint8Array> {
  for await (const row of journalFileRows(path)) {
    const reference = row.blocks.find(isMediaReferenceBlock);
    if (reference !== undefined)
      return readArchivedReference(rootDirectory, reference);
  }
  throw new Error('Missing archived image reference');
}

async function readArchivedReference(
  rootDirectory: string,
  reference: MediaReferenceBlock,
): Promise<Uint8Array> {
  const archive = new LocalMediaStore({
    rootDirectory,
    quotaBytes: 1024 * 1024,
  });
  try {
    return await archive.readVerified(reference);
  } finally {
    await archive.close();
  }
}

describe('native ACP retire-first replacement failure', () => {
  for (const failAfter of [0, 2]) {
    it(`retires both owners after ${failAfter} delivered replay rows, preserves archived media and permits a clean load and turn`, async () => {
      const resources = observeNativeAcpResources();
      const fixture = await nativeAcpFixture();
      try {
        const id = await fixture.create();
        await fixture.peer.client.prompt({
          sessionId: id,
          prompt: [
            { type: 'text', text: 'Remember this image' },
            { type: 'image', mimeType: 'image/png', data: image },
          ],
        });
        await fixture.prompt(id);
        const path = await fixture.path(id);
        const before = await nativeRows(path);
        const prior = fixture.recordings.find(
          (recording) => recording.getSessionId() === id,
        );
        if (prior === undefined) throw new Error('Missing prior recorder');
        expect(before.count).toBe(4);
        let delivered = 0;
        fixture.consume(async (update) => {
          if (!replayText(update)) return;
          if (delivered === failAfter)
            throw new Error('Replacement transcript delivery rejected');
          delivered++;
        });
        await expect(fixture.load(id)).rejects.toMatchObject({
          code: -32603,
          data: {
            phase: 'replay',
            reason: 'Replacement transcript delivery rejected',
          },
        });
        expect(delivered).toBe(failAfter);
        expect(prior.isActive()).toBe(false);
        expect(resources.disposals.get(prior)).toBe(1);
        expect(
          fixture.recordings.filter((recording) => recording.isActive()),
        ).toStrictEqual([]);
        expect(
          [...resources.disposals.values()].every((count) => count === 1),
        ).toBe(true);
        expect(await fixture.locks()).toStrictEqual([]);
        expect(resources.handles.length).toBeGreaterThan(0);
        expect(
          resources.handles.filter((handle) => handle.fd !== -1),
        ).toHaveLength(0);
        expect(resources.retiredMedia).toHaveLength(2);
        const archiveRoot =
          resources.retiredMedia[0].store.recordingArchive?.rootDirectory;
        if (archiveRoot === undefined) throw new Error('Missing media archive');
        for (const owner of resources.retiredMedia) {
          await expect(
            owner.store.admit({
              bytes: new Uint8Array([1]),
              mimeType: 'image/png',
              semanticMetadata: {},
            }),
          ).rejects.toThrow('Local media store is closed');
          await expect(access(owner.store.rootDirectory)).rejects.toMatchObject(
            { code: 'ENOENT' },
          );
        }
        await expect(
          fixture.zed.prompt({
            sessionId: id,
            prompt: [{ type: 'text', text: 'No half-loaded owner' }],
          }),
        ).rejects.toThrow('Session not found');
        let staleUpdates = 0;
        fixture.consume(async () => {
          staleUpdates++;
        });
        todoEvents.emitTodoUpdated({
          sessionId: id,
          todos: [],
          timestamp: new Date(),
        });
        expect(staleUpdates).toBe(0);
        expect(await nativeRows(path)).toStrictEqual({ ...before });
        expect(await archivedImage(path, archiveRoot)).toStrictEqual(
          new Uint8Array(Buffer.from(image, 'base64')),
        );
        fixture.consume(async () => {});
        await fixture.load(id);
        expect(await fixture.prompt(id)).toMatchObject({
          stopReason: 'end_turn',
        });
        await fixture.peer.client.closeSession({ sessionId: id });
        expect((await nativeRows(path)).count).toBe(6);
        expect(await nativeRows(path, 4)).toStrictEqual({ ...before });
        expect(await archivedImage(path, archiveRoot)).toStrictEqual(
          new Uint8Array(Buffer.from(image, 'base64')),
        );
        expect(await fixture.locks()).toHaveLength(0);
        expect(resources.disposals.get(prior)).toBe(1);
        expect(
          resources.handles.filter((handle) => handle.fd !== -1),
        ).toStrictEqual([]);
      } finally {
        await fixture.finish();
        resources.restore();
      }
    }, 30000);
  }

  it('reports a replacement lock failure with independent credential cleanup failure and releases the retired owner exactly once', async () => {
    let target: JournalRecordingService | undefined;
    let contender: LockHandle | undefined;
    let chatsDir = '';
    const resources = observeNativeAcpResources(async (recorder) => {
      if (recorder === target)
        contender = await SessionLockManager.acquire(
          chatsDir,
          recorder.getSessionId(),
        );
    });
    const fixture = await nativeAcpFixture();
    chatsDir = fixture.config.projectChatsDir;
    const acquireKeys =
      fixture.credentialAuthority.createProviderKeyStorage.bind(
        fixture.credentialAuthority,
      );
    let configCount = 0;
    const cleanup = new Error('Replacement credential cleanup rejected');
    const configs = vi
      .spyOn(fixture.credentialAuthority, 'createProviderKeyStorage')
      .mockImplementation(() => {
        const keys = acquireKeys();
        const close = keys.close.bind(keys);
        keys.close = () => {
          close();
          if (target !== undefined && ++configCount === 2) throw cleanup;
        };
        return keys;
      });
    try {
      const id = await fixture.create();
      await fixture.prompt(id);
      const path = await fixture.path(id);
      const before = await nativeRows(path);
      target = fixture.recordings.find(
        (recording) => recording.getSessionId() === id,
      );
      if (target === undefined) throw new Error('Missing live target');
      const error = await fixture.zed
        .loadSession({ sessionId: id, cwd: fixture.root, mcpServers: [] })
        .catch((reason: unknown) => reason);
      expect(error).toMatchObject({ code: -32603 });
      expect(String(error)).toContain('in use');
      if (!(error instanceof Error) || !(error.cause instanceof AggregateError))
        throw new Error('Missing primary and cleanup errors');
      expect(error.cause.errors).toHaveLength(1);
      const failures = nativeFailureLeaves(error);
      expect(failures).toStrictEqual([cleanup]);
      expect(failures[0]).toBe(cleanup);
      expect(error.cause.errors[0]).toMatchObject({
        name: 'AggregateDisposeError',
      });
      expect(resources.disposals.get(target)).toBe(1);
      expect(target.isActive()).toBe(false);
      expect(await contender?.ownsLock()).toBe(true);
      expect(await fixture.locks()).toHaveLength(1);
      expect(
        resources.handles.filter((handle) => handle.fd !== -1),
      ).toHaveLength(0);
      expect(resources.retiredMedia).toHaveLength(2);
      await expect(
        fixture.zed.prompt({
          sessionId: id,
          prompt: [{ type: 'text', text: 'Failed owner' }],
        }),
      ).rejects.toThrow('Session not found');
      expect(await nativeRows(path)).toStrictEqual({ ...before });
      await contender?.release();
      contender = undefined;
      configs.mockRestore();
      await fixture.load(id);
      expect(await fixture.prompt(id)).toMatchObject({
        stopReason: 'end_turn',
      });
      await fixture.peer.client.closeSession({ sessionId: id });
      expect((await nativeRows(path)).count).toBe(4);
      expect(await nativeRows(path, 2)).toStrictEqual({ ...before });
      expect(await fixture.locks()).toStrictEqual([]);
    } finally {
      configs.mockRestore();
      await contender?.release();
      await fixture.finish();
      resources.restore();
    }
  }, 30000);
});
