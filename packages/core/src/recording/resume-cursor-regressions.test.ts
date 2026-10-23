/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { resumeSession } from './resumeSession.js';
import { requireJournalRecorder } from '../services/history/recorderBackend.js';
import type { SessionRecordingPort } from './recordingPort.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import { readJournalFileFacts } from './journalSessionListing.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import {
  PROJECT_HASH,
  PAGE_BOUND,
  recordingConfig,
  seedRecording,
  requireBoot,
  textRow,
  useJournalReadProbe,
} from './__tests__/support/journalRecordingFixture.js';

describe('native resume row and metadata regressions', () => {
  const directory = useTempDir('resume-regressions-native-');
  const probe = useJournalReadProbe();
  const recordings: SessionRecordingPort[] = [];
  afterEach(async () => {
    for (const recording of recordings.splice(0)) await recording.dispose();
  });

  it('strips stored-response markers only from rows predating the resume boundary', async () => {
    const seed = await seedRecording(directory(), 0);
    const writer = await JournalRecordingService.open(
      recordingConfig(directory(), {
        sessionId: seed.recording.getSessionId(),
      }),
      seed.filePath,
    );
    await (
      await writer.session()
    ).append([
      { ...textRow('retained', 'ai'), metadata: { responsesStored: true } },
    ]);
    await writer.dispose();
    const result = await resumeSession({
      continueRef: writer.getSessionId(),
      projectHash: PROJECT_HASH,
      chatsDir: directory(),
      currentProvider: 'test',
      currentModel: 'model',
      workspaceDirs: [],
    });
    const boot = requireBoot(result);
    if (!result.ok) throw new Error(result.error);
    recordings.push(result.recording);
    await (
      await requireJournalRecorder(result.recording).session()
    ).append([
      { ...textRow('later', 'ai'), metadata: { responsesStored: true } },
    ]);
    const restored = await Array.fromAsync(boot.streamRows());
    expect(restored).toHaveLength(2);
    expect(restored[0].metadata?.responsesStored).toBeUndefined();
    expect(restored[1].metadata?.responsesStored).toBe(true);
    const durable = await readJournalSnapshot(seed.filePath, PROJECT_HASH);
    expect(
      durable.history.map((row) => row.metadata?.responsesStored),
    ).toStrictEqual([true, true]);
  });

  it('releases a cancelled row iterator while the recorder remains usable', async () => {
    const seed = await seedRecording(directory(), 3);
    const result = await resumeSession({
      continueRef: seed.recording.getSessionId(),
      projectHash: PROJECT_HASH,
      chatsDir: directory(),
      currentProvider: 'test',
      currentModel: 'model',
      workspaceDirs: [],
    });
    const boot = requireBoot(result);
    if (!result.ok) throw new Error(result.error);
    recordings.push(result.recording);
    for await (const row of boot.streamRows()) {
      expect(row.blocks).toStrictEqual(seed.contents[0].blocks);
      break;
    }
    expect(probe().activeReads).toBe(0);
    expect(await Array.fromAsync(boot.streamRows())).toStrictEqual(
      seed.contents,
    );
    await result.recording.dispose();
  });

  it('reads current provider, directories and title with bounded descriptor reads and no row decode', async () => {
    const seed = await seedRecording(directory(), 40);
    const writer = await JournalRecordingService.open(
      recordingConfig(directory(), {
        sessionId: seed.recording.getSessionId(),
      }),
      seed.filePath,
    );
    writer.recordProviderSwitch('other', 'new-model');
    writer.recordDirectoriesChanged(['/changed']);
    writer.recordSessionMetadata('title');
    await writer.dispose();
    probe().reset();
    const facts = await readJournalFileFacts(seed.filePath);
    expect(facts).toMatchObject({
      facts: {
        provider: 'other',
        model: 'new-model',
        directories: ['/changed'],
        title: 'title',
      },
      rows: 40,
    });
    expect(probe().decodedRows).toBe(0);
    expect(probe().reads).toBeGreaterThan(0);
    expect(probe().reads).toBeLessThanOrEqual(PAGE_BOUND);
  });

  it.each(['missing', 'malformed', 'valid'])(
    'validates %s referenced media during streamed boot without retaining reads or reservations',
    async (mode) => {
      const sourceMedia = new LocalMediaStore({
        rootDirectory: join(directory(), 'source-media'),
        quotaBytes: 1024,
      });
      const media = new LocalMediaStore({
        rootDirectory: join(directory(), 'media'),
        quotaBytes: 1024,
      });
      try {
        const reference = await sourceMedia.admit({
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        const seed = await seedRecording(directory(), 0);
        const writer = await JournalRecordingService.open(
          recordingConfig(directory(), {
            sessionId: seed.recording.getSessionId(),
          }),
          seed.filePath,
        );
        const block =
          mode === 'malformed'
            ? { ...reference, contentId: 'bad-id' }
            : reference;
        await (
          await writer.session()
        ).append([{ speaker: 'human', blocks: [block] }]);
        await writer.dispose();
        if (mode === 'valid')
          await media.admit({
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: 'image/png',
            semanticMetadata: {},
          });
        const result = await resumeSession({
          continueRef: writer.getSessionId(),
          projectHash: PROJECT_HASH,
          chatsDir: directory(),
          currentProvider: 'test',
          currentModel: 'model',
          workspaceDirs: [],
          mediaStore: media,
        });
        const boot = requireBoot(result);
        if (!result.ok) throw new Error(result.error);
        recordings.push(result.recording);
        const outcome = await Array.fromAsync(boot.streamRows()).then(
          (rows) => ({ status: 'fulfilled', blocks: rows[0].blocks }),
          (error: unknown) => ({ status: 'rejected', error }),
        );
        const validationError = expect.objectContaining({
          message: expect.stringContaining('Media reference validation failed'),
        });
        expect(outcome).toStrictEqual(
          mode === 'valid'
            ? { status: 'fulfilled', blocks: [reference] }
            : { status: 'rejected', error: validationError },
        );
        expect(probe().activeReads).toBe(0);
        expect(await media.hasReservations(reference.contentId)).toBe(false);
      } finally {
        await media.close();
        await sourceMedia.close();
      }
    },
  );
});
