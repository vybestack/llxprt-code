/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { historyOriginId } from '../services/history/historyOriginId.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { JournalResumeBoot, resumePointOf } from './journalResume.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { SessionRecordingService } from './SessionRecordingService.js';

import type { IContent } from '../services/history/IContent.js';
import {
  ExactReplayFixture,
  PROJECT,
  diskRows,
  exactRow,
  expectWireRows,
  fixtureDirectory,
  rowsOf,
} from './__tests__/support/exact-replay-fixture.js';

async function expectDistinctNativeRows(
  fixture: ExactReplayFixture,
  expected: readonly IContent[],
): Promise<void> {
  if (fixture.backend !== 'journal') return;
  const disk = await diskRows(fixture.path());
  expectWireRows(
    disk.map((row) => row.content),
    expected,
  );
  expect(new Set(disk.map((row) => row.label)).size).toBe(expected.length);
}

describe('exact replay identity contracts', () => {
  const backend = 'journal';
  it(`rebuilds distinct equal-text unstamped disk rows without duplication on ${backend}`, async () => {
    const fixture = new ExactReplayFixture(
      await fixtureDirectory(`${backend}-unstamped`),
      backend,
    );
    const input: IContent[] = Array.from({ length: 2 }, () => ({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'unstamped disk snapshot' }],
    }));
    try {
      if (fixture.recording instanceof JournalRecordingService)
        await (
          await fixture.recording.session()
        ).append(structuredClone(input));
      else if (fixture.recording instanceof SessionRecordingService)
        for (const row of input)
          fixture.recording.recordContent(structuredClone(row));
      else throw new Error('Unexpected recorder');
      await fixture.recording.flush();
      await fixture.close();
      let expected: IContent[] = [];
      await fixture.resume(async (history, integration) => {
        const disk = await rowsOf(history);
        expect(disk.map((row) => row.blocks)).toStrictEqual(
          input.map((row) => row.blocks),
        );
        expect(disk.map((row) => row.metadata?.chronology?.seq)).toStrictEqual([
          undefined,
          undefined,
        ]);
        await expectDistinctNativeRows(fixture, input);
        await history.replaceAll(disk);
        await integration.flushAtTurnBoundary();
        expect(
          (await rowsOf(history)).map((row) => row.metadata?.chronology?.seq),
        ).toStrictEqual([1, 2]);
        const newRow: IContent = {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'unstamped disk snapshot' }],
        };
        history.add(newRow);
        await integration.flushAtTurnBoundary();
        expected = await rowsOf(history);
        expect(expected.map((row) => row.blocks)).toStrictEqual(
          [...input, newRow].map((row) => row.blocks),
        );
        expect(
          expected.map((row) => row.metadata?.chronology?.seq),
        ).toStrictEqual([1, 2, 3]);
        await history.replaceAll(await rowsOf(history));
        await integration.flushAtTurnBoundary();
        expectWireRows(await rowsOf(history), expected);
      });
      for (let round = 0; round < 2; round++)
        await fixture.resume(async (history, integration) => {
          expectWireRows(await rowsOf(history), expected);
          await integration.flushAtTurnBoundary();
          await expectDistinctNativeRows(fixture, expected);
        });
    } finally {
      await fixture.close();
    }
  });

  it(`shares resumed chronology across rejected replacement, append and successful rebuild on ${backend}`, async () => {
    const fixture = new ExactReplayFixture(
      await fixtureDirectory(`${backend}-chronology-rollback`),
      backend,
    );
    try {
      await fixture.integration.subscribeToJournal(fixture.history);
      await fixture.history.addBatch([
        exactRow('prior', 41),
        exactRow('answer', 42),
      ]);
      await fixture.integration.flushAtTurnBoundary();
      await fixture.close();
      await fixture.resume(async (history, integration) => {
        const before = await rowsOf(history);
        const failure = new Error('reject resumed replacement');
        const reject = (): void => {
          history.off('tokensUpdated', reject);
          throw failure;
        };
        history.on('tokensUpdated', reject);
        await expect(
          history.replaceAll([
            { speaker: 'ai', blocks: [{ type: 'text', text: 'rejected' }] },
          ]),
        ).rejects.toBe(failure);
        expectWireRows(await rowsOf(history), before);
        history.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'after rejection' }],
        });
        await integration.flushAtTurnBoundary();
        expect(
          (await rowsOf(history)).map((row) => row.metadata?.chronology?.seq),
        ).toStrictEqual([41, 42, 43]);
        await history.replaceAll([
          { speaker: 'ai', blocks: [{ type: 'text', text: 'summary' }] },
        ]);
        history.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'summary' }],
        });
        await integration.flushAtTurnBoundary();
        expect(
          (await rowsOf(history)).map((row) => row.metadata?.chronology?.seq),
        ).toStrictEqual([44, 45]);
      });
      await fixture.resume(async (history) => {
        expect(
          (await rowsOf(history)).map((row) => row.metadata?.chronology?.seq),
        ).toStrictEqual([44, 45]);
      });
    } finally {
      await fixture.close();
    }
  });

  it('filters resumed origins and remaps mirror owners without changing complete row bytes', async () => {
    const directory = await fixtureDirectory('journal-origins');
    const fixture = new ExactReplayFixture(directory, 'journal');
    const selected = {};
    const foreign = {};
    const expected = [exactRow('shared', 1), exactRow('selected', 3)];
    try {
      if (!(fixture.recording instanceof JournalRecordingService))
        throw new Error('Expected native primary');
      await fixture.history.adoptResumeBoot(
        fixture.recording,
        new JournalResumeBoot(
          fixture.recording,
          await resumePointOf(fixture.recording),
        ),
      );
      await fixture.integration.subscribeToJournal(fixture.history);
      fixture.history.add(structuredClone(expected[0]));
      fixture.history.add(exactRow('foreign', 2), undefined, foreign);
      fixture.history.add(structuredClone(expected[1]), undefined, selected);
      await fixture.integration.flushAtTurnBoundary();
      const original = await diskRows(fixture.path());
      expect(original.map((row) => row.origin)).toStrictEqual([
        undefined,
        historyOriginId(foreign),
        historyOriginId(selected),
      ]);
      await fixture.close();
      await fixture.resume(async (history) => {
        const mirror = JournalRecordingService.create({
          sessionId: 'selected-mirror',
          projectHash: PROJECT,
          chatsDir: join(directory, 'mirror'),
          workspaceDirs: [],
          provider: 'test',
          model: 'model-1',
        });
        const integration = new RecordingIntegration(mirror);
        const replacement = new HistoryService({});
        try {
          await integration.subscribeToJournal(history, selected);
          await integration.flushAtTurnBoundary();
          const file = mirror.getFilePath();
          if (file === null) throw new Error('Missing mirror file');
          const seeded = await diskRows(file);
          expectWireRows(
            seeded.map((row) => row.content),
            expected,
          );
          expect(seeded.map((row) => row.origin)).toStrictEqual([
            undefined,
            historyOriginId(selected),
          ]);
          expect(seeded[1].owner).toBe(original[2].owner);
          replacement.add(structuredClone(expected[0]));
          replacement.add(structuredClone(expected[1]), undefined, selected);
          await replacement.waitForCommit();
          await integration.subscribeToJournal(replacement, selected);
          await integration.flushAtTurnBoundary();
          const remapped = await diskRows(file);
          expectWireRows(
            remapped.map((row) => row.content),
            expected,
          );
          expect(remapped[1].origin).toBe(historyOriginId(selected));
          expect(remapped[1].owner).not.toBe(seeded[1].owner);
          replacement.add(exactRow('foreign-late', 4), undefined, foreign);
          const accepted = exactRow('selected-late', 5);
          replacement.add(structuredClone(accepted), undefined, selected);
          await integration.flushAtTurnBoundary();
          expectWireRows(
            (await diskRows(file)).map((row) => row.content),
            [...expected, accepted],
          );
          expect(
            (await rowsOf(replacement)).map((row) => row.blocks),
          ).toStrictEqual(
            [
              exactRow('shared', 1),
              exactRow('selected', 3),
              exactRow('foreign-late', 4),
              accepted,
            ].map((row) => row.blocks),
          );
        } finally {
          await integration.dispose();
          await replacement.dispose();
          await mirror.dispose();
        }
      });
    } finally {
      await fixture.close();
    }
  });
});
