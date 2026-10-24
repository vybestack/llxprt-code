/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  testJournalSeams,
  type Failures,
} from '../journal/__tests__/support/journalFixtures.js';
import { loadFlushRecords } from '../journal/flushRecords.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '../services/history/IContent.js';
import { HistoryMediaOwnership } from '../storage/history-media-ownership.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import {
  ExactReplayFixture,
  PROJECT,
  diskRows,
  expectWireRows,
  fixtureDirectory,
  rowsOf,
} from './__tests__/support/exact-replay-fixture.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { resumeSession, type ResumeResult } from './resumeSession.js';

class FailableMediaStore extends LocalMediaStore {
  rejectedId: string | undefined;
  readonly failure = new Error('injected media reservation failure');

  override async reserve(
    reference: MediaReferenceBlock,
    ownerId: string,
  ): Promise<void> {
    if (reference.contentId === this.rejectedId) throw this.failure;
    await super.reserve(reference, ownerId);
  }
}

async function reference(
  store: LocalMediaStore,
  bytes: number[],
): Promise<MediaReferenceBlock> {
  return store.admit({
    bytes: new Uint8Array(bytes),
    mimeType: 'application/octet-stream',
    semanticMetadata: {},
  });
}

function mediaRow(blocks: MediaReferenceBlock[]): IContent {
  return { speaker: 'human', blocks };
}

async function openResume(
  fixture: ExactReplayFixture,
  mediaStore: LocalMediaStore,
  failures: Failures = {},
): Promise<ResumeResult> {
  const seams = testJournalSeams(failures);
  const flush = await loadFlushRecords();
  const result = await resumeSession({
    continueRef: fixture.sessionId,
    projectHash: PROJECT,
    chatsDir: fixture.chats,
    currentProvider: 'test',
    currentModel: 'model-1',
    workspaceDirs: [],
    mediaStore,
    journal: {
      journal: {
        ...seams.dependencies,
        flush: (fd) => {
          seams.dependencies.flush(fd);
          flush(fd);
        },
      },
    },
  });
  if (!result.ok) throw new Error(result.error);
  return result;
}

async function seed(
  fixture: ExactReplayFixture,
  rows: IContent[],
): Promise<void> {
  await (await fixture.recording.session()).append(rows);
  await fixture.recording.flush();
  await fixture.close();
}

async function bootRows(boot: ResumeResult['boot']): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of boot.streamRows()) rows.push(row);
  return rows;
}

async function checkPending(
  failures: Failures,
  proof: () => Promise<void>,
  release: () => void,
): Promise<void> {
  const gate = failures.readGate;
  if (gate === undefined) return;
  try {
    while (gate.hits === 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
    await proof();
  } finally {
    release();
  }
}

describe('public native reference-media resume and adoption', () => {
  it('verifies real referenced bytes without a replay reservation and transfers ownership only on adoption', async () => {
    const fixture = new ExactReplayFixture(
      await fixtureDirectory('reference-media'),
    );
    const media = new LocalMediaStore({
      rootDirectory: join(fixture.directory, 'media'),
      quotaBytes: 1024,
    });
    const expectedBytes = new Uint8Array([1, 2, 3, 4]);
    const ref = await reference(media, [...expectedBytes]);
    const expected = [mediaRow([ref])];
    try {
      await seed(fixture, structuredClone(expected));
      for (let round = 0; round < 2; round++) {
        const resumed = await openResume(fixture, media);
        const history = new HistoryService({});
        const integration = new RecordingIntegration(resumed.recording);
        try {
          expectWireRows(await bootRows(resumed.boot), expected);
          expect(await media.readVerified(ref)).toStrictEqual(expectedBytes);
          expect(await media.hasReservations(ref.contentId)).toBe(false);
          await history.registerMediaOwner(new HistoryMediaOwnership(media));
          await history.adoptResumeBoot(resumed.recording, resumed.boot);
          await integration.subscribeToJournal(history);
          expect(await media.hasReservations(ref.contentId)).toBe(true);
          expectWireRows(await rowsOf(history), expected);
          await integration.flushAtTurnBoundary();
          expectWireRows(
            (await diskRows(fixture.path())).map((row) => row.content),
            expected,
          );
          await integration.dispose();
          expect(await media.hasReservations(ref.contentId)).toBe(true);
        } finally {
          await integration.dispose();
          await history.dispose();
          await history.waitForOwnershipSettlement();
          await resumed.recording.dispose();
        }
        expect(await media.hasReservations(ref.contentId)).toBe(false);
        expect(await media.readVerified(ref)).toStrictEqual(expectedBytes);
      }
    } finally {
      await fixture.close();
      await media.close();
    }
  });

  for (const stage of [
    'pending',
    'reservation',
    'listener',
    'after-publication',
  ] as const) {
    it(`preserves prior rows, accounting, recorder and reservations through ${stage} adoption`, async () => {
      const fixture = new ExactReplayFixture(
        await fixtureDirectory(`reference-${stage}`),
      );
      const media = new FailableMediaStore({
        rootDirectory: join(fixture.directory, 'media'),
        quotaBytes: 1024,
      });
      const previous = await reference(media, [9, 8, 7]);
      const first = await reference(media, [1, 2, 3, 4]);
      const second = await reference(media, [5, 6]);
      const failure = new Error(`injected ${stage} adoption rejection`);
      const failures: Failures = {};
      await seed(fixture, [mediaRow([first, second])]);
      const resumed = await openResume(fixture, media, failures);
      const history = new HistoryService({});
      const recorder = JournalRecordingService.create({
        sessionId: 'prior-session',
        projectHash: PROJECT,
        chatsDir: join(fixture.directory, 'prior'),
        workspaceDirs: [],
        provider: 'test',
        model: 'model-1',
      });
      const integration = new RecordingIntegration(recorder);
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await history.registerMediaOwner(new HistoryMediaOwnership(media));
        await integration.subscribeToJournal(history);
        await history.addBatch([mediaRow([previous])]);
        await integration.flushAtTurnBoundary();
        const priorRows = await rowsOf(history);
        const priorPath = history.journalPath();
        const file = recorder.getFilePath();
        if (file === null) throw new Error('Missing prior recorder');
        const priorDisk = await diskRows(file);
        const tokens = history.getTotalTokens();
        const range = history.getContextRange();
        if (stage === 'pending') failures.readGate = { promise: held, hits: 0 };
        if (stage === 'reservation') media.rejectedId = second.contentId;
        const rejectListener = (): void => {
          history.off('tokensUpdated', rejectListener);
          throw failure;
        };
        if (stage === 'listener') history.on('tokensUpdated', rejectListener);
        const adopting = history.adoptResumeBoot(
          resumed.recording,
          resumed.boot,
          async () => {
            expect(await media.hasReservations(previous.contentId)).toBe(true);
            expect(await media.hasReservations(first.contentId)).toBe(true);
            expect(await media.hasReservations(second.contentId)).toBe(true);
            throw failure;
          },
        );
        const outcome = adopting.then(
          () => undefined,
          (error: unknown) => error,
        );
        await checkPending(
          failures,
          async () => {
            expect({
              path: history.journalPath(),
              disk: await diskRows(file),
              range: history.getContextRange(),
              tokens: history.getTotalTokens(),
            }).toStrictEqual({
              path: priorPath,
              disk: priorDisk,
              range,
              tokens,
            });
            expect(await media.hasReservations(previous.contentId)).toBe(true);
            expect(await media.hasReservations(first.contentId)).toBe(false);
          },
          release,
        );
        expect(await outcome).toBe(
          stage === 'reservation' ? media.failure : failure,
        );
        expect({
          path: history.journalPath(),
          tokens: history.getTotalTokens(),
          range: history.getContextRange(),
          disk: await diskRows(file),
        }).toStrictEqual({ path: priorPath, tokens, range, disk: priorDisk });
        expectWireRows(await rowsOf(history), priorRows);
        expect(await media.hasReservations(previous.contentId)).toBe(true);
        expect(await media.hasReservations(first.contentId)).toBe(false);
        expect(await media.hasReservations(second.contentId)).toBe(false);
        expectWireRows(
          (await diskRows(fixture.path())).map((row) => row.content),
          [mediaRow([first, second])],
        );
        media.rejectedId = undefined;
        history.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'after rollback' }],
        });
        await integration.flushAtTurnBoundary();
        expect(
          (await diskRows(file)).map((row) => row.content.blocks),
        ).toStrictEqual([
          [previous],
          [{ type: 'text', text: 'after rollback' }],
        ]);
        await history.adoptResumeBoot(resumed.recording, resumed.boot);
        expect(await media.hasReservations(previous.contentId)).toBe(false);
        expect(await media.hasReservations(first.contentId)).toBe(true);
        expect(await media.hasReservations(second.contentId)).toBe(true);
        expectWireRows(await rowsOf(history), [mediaRow([first, second])]);
      } finally {
        release();
        await integration.dispose();
        await history.dispose();
        await history.waitForOwnershipSettlement();
        await recorder.dispose();
        await resumed.recording.dispose();
        await fixture.close();
        expect(await media.hasReservations(first.contentId)).toBe(false);
        expect(await media.hasReservations(second.contentId)).toBe(false);
        await media.close();
      }
    });
  }
});
