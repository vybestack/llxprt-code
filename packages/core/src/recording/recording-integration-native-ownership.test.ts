/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  testJournalSeams,
  type Failures,
} from '../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { HistoryMediaOwnership } from '../storage/history-media-ownership.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { MediaAdmissionService } from '../storage/media-admission-service.js';
import {
  nativeText,
  useNativeIntegration,
} from './__tests__/support/native-integration-fixture.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { SessionLockManager } from './SessionLockManager.js';

function messages(error: unknown): string[] {
  if (error instanceof AggregateError) return error.errors.flatMap(messages);
  if (error instanceof Error) return [error.message];
  throw new Error('Expected disposal error');
}

describe('native recorder cleanup ownership', () => {
  const directory = useTempDir('native-recorder-cleanup-');

  it('aggregates write, file close and lock release failures after releasing the actual lock', async () => {
    const failures: Failures = {};
    const seams = testJournalSeams(failures);
    const chatsDir = join(directory(), 'chats');
    const lock = await SessionLockManager.acquire(chatsDir, 'cleanup');
    let failClose = false;
    let failRelease = false;
    const recording = JournalRecordingService.create({
      sessionId: 'cleanup',
      projectHash: 'cleanup',
      chatsDir,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      journal: {
        journal: {
          ...seams.dependencies,
          open: async (file, flags) => {
            const handle = await seams.dependencies.open(file, flags);
            return {
              ...handle,
              close: async () => {
                await handle.close();
                if (failClose) throw new Error('injected file close failure');
              },
            };
          },
        },
      },
    });
    recording.adoptLock({
      lockPath: lock.lockPath,
      ownsLock: () => lock.ownsLock(),
      release: async () => {
        await lock.release();
        if (failRelease) throw new Error('injected lock release failure');
      },
    });
    const history = new HistoryService({});
    const integration = new RecordingIntegration(recording);
    try {
      await integration.subscribeToJournal(history);
      history.add(nativeText('durable'));
      await integration.flushAtTurnBoundary();
      await integration.dispose();
      expect(await lock.ownsLock()).toBe(true);
      failures.failWriteAt = seams.events.filter(
        (event) => event.type === 'write',
      ).length;
      failClose = true;
      failRelease = true;
      recording.recordSessionMetadata('failed metadata');
      const failure = await recording.dispose().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(AggregateError);
      expect(messages(failure)).toStrictEqual([
        'injected write failure',
        'injected file close failure',
        'injected lock release failure',
      ]);
      expect(recording.isActive()).toBe(false);
      expect(recording.getOwnedLockHandle()).toBeNull();
      expect(await lock.ownsLock()).toBe(false);
      const next = await SessionLockManager.acquire(chatsDir, 'cleanup');
      try {
        expect(await next.ownsLock()).toBe(true);
      } finally {
        await next.release();
      }
    } finally {
      failClose = false;
      failRelease = false;
      await integration.dispose();
      await history.dispose();
      await recording.dispose();
    }
  });
});

describe('native integration media ownership', () => {
  const fixture = useNativeIntegration();

  it('retains real media reservations through recorder detachment until the history owner closes', async () => {
    const { history, integration, recording, directory, recorded } = fixture();
    const media = new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 1024 * 1024,
    });
    const admission = new MediaAdmissionService(media);
    const context = {
      turnId: 'native-lifecycle',
      source: 'user-input',
      reservationOwnerScope: 'lifecycle-admission',
    };
    try {
      await history.registerMediaOwner(new HistoryMediaOwnership(media));
      const rows = await admission.admitContents(
        [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'media',
                mimeType: 'image/png',
                encoding: 'base64',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
              },
            ],
          },
        ],
        context,
      );
      const reference = rows[0].blocks[0];
      if (reference.type !== 'media' || reference.encoding !== 'reference')
        throw new Error('Expected admitted media reference');
      await integration.subscribeToJournal(history);
      await history.addBatch(rows);
      await admission.releaseContents(rows, context);
      await integration.flushAtTurnBoundary();
      await integration.dispose();
      await recording.dispose();
      expect(await media.hasReservations(reference.contentId)).toBe(true);
      expect((await recorded())[0].blocks).toStrictEqual([reference]);
      expect((await media.readVerified(reference)).byteLength).toBeGreaterThan(
        0,
      );
      await history.dispose();
      await history.waitForOwnershipSettlement();
      expect(await media.hasReservations(reference.contentId)).toBe(false);
      expect((await recorded())[0].blocks).toStrictEqual([reference]);
      expect((await media.readVerified(reference)).byteLength).toBeGreaterThan(
        0,
      );
    } finally {
      await history.dispose();
      await history.waitForOwnershipSettlement();
      await media.close();
    }
  });
});
