/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { collectJournalFileRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import {
  nativeText,
  useNativeIntegration,
  type NativeIntegrationFixture,
} from './__tests__/support/native-integration-fixture.js';
import { withResumed } from './__tests__/support/native-resume-fixture.js';
import {
  readJournalCheckpoints,
  readJournalFileFacts,
} from './journalSessionListing.js';

function fileOf(fixture: NativeIntegrationFixture): string {
  const file = fixture.recording.getFilePath();
  if (file === null) throw new Error('Expected a recorded native session');
  return file;
}

async function rowsOf(history: HistoryService): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of history.streamRawHistory()) rows.push(row);
  return rows;
}

describe('native recording replay and adoption contracts', () => {
  const fixture = useNativeIntegration();

  it('preserves fifty rapid additions and a large row across flushes on one file', async () => {
    const { history, integration, recording } = fixture();
    await integration.subscribeToJournal(history);
    const rows = Array.from({ length: 50 }, (_, index) =>
      nativeText(`rapid-${index}`),
    );
    for (const row of rows) history.add(row);
    await integration.flushAtTurnBoundary();
    const firstFile = recording.getFilePath();
    const large = nativeText('x'.repeat(80_000), 'ai');
    history.add(large);
    await integration.flushAtTurnBoundary();
    expect(firstFile).not.toBeNull();
    expect(new Set([firstFile, recording.getFilePath()]).size).toBe(1);
    await collectJournalFileRowsForAssertions(
      fileOf(fixture()),
      (persisted) => {
        expect(persisted).toStrictEqual([...rows, large]);
      },
    );
  });

  it('preserves arbitrary row count, order and complete random text on disk', async () => {
    const { history, integration, recorded } = fixture();
    await integration.subscribeToJournal(history);
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 5000 }), {
          minLength: 1,
          maxLength: 12,
        }),
        async (messages) => {
          await history.replaceAll(messages.map((text) => nativeText(text)));
          await integration.flushAtTurnBoundary();
          expect(await recorded()).toStrictEqual(
            messages.map((text) => nativeText(text)),
          );
        },
      ),
      { numRuns: 8 },
    );
  });

  it('preserves legacy inline media as a complete native row', async () => {
    const { history, integration } = fixture();
    const row: IContent = {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png; charset=utf-8',
          data: 'AQIDBA==',
        },
      ],
    };
    await integration.subscribeToJournal(history);
    history.add(row);
    await integration.flushAtTurnBoundary();
    await collectJournalFileRowsForAssertions(
      fileOf(fixture()),
      (persisted) => {
        expect(persisted).toStrictEqual([row]);
      },
    );
  });

  for (const title of [undefined, null, 'Original session title']) {
    it(`resumes title ${String(title)} with session identity, name, facts and checkpoint intact`, async () => {
      const current = fixture();
      const { history, integration, recording } = current;
      await integration.subscribeToJournal(history);
      history.add(nativeText('original question'));
      await integration.flushAtTurnBoundary();
      if (title !== undefined) recording.recordSessionMetadata(title);
      await recording.setSessionName('  named-session  ');
      integration.recordDirectoriesChanged(['/persisted/a', '/persisted/b']);
      await integration.flushAtTurnBoundary();
      const checkpoint = await recording.createCheckpoint('before-resume');
      const file = fileOf(current);
      const before = await readJournalFileFacts(file);
      await withResumed(
        current,
        async (resumed, adopted, resumedIntegration) => {
          expect(resumed.metadata).toMatchObject({
            sessionId: recording.getSessionId(),
            projectHash: recording.getProjectHash(),
            provider: 'anthropic',
            model: 'model-1',
            workspaceDirs: ['/persisted/a', '/persisted/b'],
            startTime: before?.facts.start.startTime,
          });
          expect(resumed.metadata.title).toBe(title);
          expect(resumed.recording.getSessionMetadataTitle()).toBe(title);
          expect(adopted.journalPath()).toBe(file);
          expect(resumed.recording.getFilePath()).toBe(file);
          expect(resumed.recording.ownsLockFor(recording.getSessionId())).toBe(
            true,
          );
          adopted.add(nativeText('continued answer', 'ai'));
          await resumedIntegration.flushAtTurnBoundary();
          expect(await current.texts()).toStrictEqual([
            'original question',
            'continued answer',
          ]);
          const after = await readJournalFileFacts(file);
          expect(after?.facts.name).toBe('named-session');
          expect(after?.facts.title).toBe(title);
          expect(after?.facts.start).toStrictEqual(before?.facts.start);
          expect(await readJournalCheckpoints(file)).toContainEqual(
            expect.objectContaining({
              checkpointId: checkpoint.checkpointId,
              name: 'before-resume',
              sequence: checkpoint.sequence,
            }),
          );
        },
      );
    });
  }

  it('rebuilds adopted disk rows with changed turn IDs without duplication and retains new equal text', async () => {
    const current = fixture();
    await current.integration.subscribeToJournal(current.history);
    current.history.add({
      ...nativeText('same text', 'ai'),
      metadata: { turnId: 'original-turn', responsesStored: true },
    });
    await current.integration.flushAtTurnBoundary();
    await withResumed(current, async (_resumed, history, integration) => {
      const rows = await rowsOf(history);
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata?.responsesStored).not.toBe(true);
      await history.replaceAll([
        {
          ...rows[0],
          metadata: { ...rows[0].metadata, turnId: 'rebuilt-turn' },
        },
      ]);
      history.add(nativeText('same text'));
      await integration.flushAtTurnBoundary();
      expect(await current.texts()).toStrictEqual(['same text', 'same text']);
      expect(history.getContextRange().totalEntries).toBe(2);
      await collectJournalFileRowsForAssertions(
        fileOf(current),
        (persisted) => {
          expect(persisted[0].metadata?.turnId).toBe('rebuilt-turn');
          expect(persisted[1].metadata?.chronology?.seq).toBeGreaterThan(
            persisted[0].metadata?.chronology?.seq ?? 0,
          );
        },
      );
    });
  });

  it('compresses adopted disk history then rebuilds without resurrecting the pre-resume rows', async () => {
    const current = fixture();
    await current.integration.subscribeToJournal(current.history);
    await current.history.addBatch([
      nativeText('first'),
      nativeText('second', 'ai'),
    ]);
    await current.integration.flushAtTurnBoundary();
    await withResumed(current, async (_resumed, history, integration) => {
      history.startCompression();
      await history.replaceAll([nativeText('resumed summary', 'ai')]);
      history.endCompression(nativeText('resumed summary', 'ai'), 2);
      await history.replaceAll(await rowsOf(history));
      history.add(nativeText('post-resume'));
      await integration.flushAtTurnBoundary();
      expect(await current.texts()).toStrictEqual([
        'resumed summary',
        'post-resume',
      ]);
      expect(await readJournalFileFacts(fileOf(current))).toMatchObject({
        rows: 2,
      });
    });
  });
});
