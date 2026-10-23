/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { openJournalReadOnly } from '../../journal/journalReader.js';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import type { ContextRange } from './historyEventTypes.js';

import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

function textRow(speaker: 'human' | 'ai', text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

async function texts(history: HistoryService): Promise<string[]> {
  const out: string[] = [];
  for await (const row of history.streamRawHistory()) out.push(textOf(row));
  return out;
}

/** The service reads the backend from the environment when it is constructed. */

function restoreBackend(): void {}

const SUMMARY_FROM_SEQ = 1;
const SUMMARY_TO_SEQ = 3;

/** The oldest three rows replaced by one summary row, the way compression publishes it. */
async function compressOldestThree(history: HistoryService): Promise<void> {
  await history.detachedValues.transform(
    async (source, sink) => {
      await sink.appendValue({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'summary of one to three' }],
        metadata: {
          chronology: { seq: 99, userTurn: 1, step: 1, recordedAt: 0 },
          chronologyReplaced: {
            fromSeq: SUMMARY_FROM_SEQ,
            toSeq: SUMMARY_TO_SEQ,
            itemCount: 3,
          },
        },
      });
      let index = 0;
      for await (const row of source.streamRows()) {
        if (index >= 3) await sink.appendDerived(index, row);
        index++;
      }
    },
    undefined,
    { publishTokens: true },
  );
}

describe.each(['journal'] as const)(
  'HistoryService scalars after the commit boundary (%s store)',
  () => {
    const created: HistoryService[] = [];

    afterEach(async () => {
      restoreBackend();
      for (const history of created.splice(0)) await history.dispose();
    });
    function service(): HistoryService {
      const history = new HistoryService();
      created.push(history);
      return history;
    }

    it('answers statistics for the committed rows', async () => {
      const history = service();
      history.add(textRow('human', 'question'));
      history.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_1',
            name: 'read',
            parameters: {},
          },
        ],
      });
      history.add({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_1',
            toolName: 'read',
            result: 'ok',
          },
        ],
      });
      history.add(textRow('ai', 'answer'));
      await history.waitForCommit();

      expect(history.getStatistics()).toStrictEqual({
        totalMessages: 4,
        userMessages: 1,
        aiMessages: 2,
        toolCalls: 1,
        toolResponses: 1,
      });
    });

    it('answers the context range of the committed rows', async () => {
      const history = service();
      for (const text of ['one', 'two', 'three']) {
        history.add(textRow('human', text));
      }
      await history.waitForCommit();

      const range = history.getContextRange();
      expect(range.totalEntries).toBe(3);
      expect(range.firstSeq).toBeLessThan(range.lastSeq);
      expect(range.removedInterior).toStrictEqual([]);
      expect(range.approximate).toBe(false);
    });

    it('keeps the span a compression removed in the context range, as its event reported it', async () => {
      const history = service();
      for (const text of ['one', 'two', 'three', 'four', 'five']) {
        history.add(textRow('human', text));
      }
      await history.waitForCommit();
      const events: ContextRange[] = [];
      history.on('contextRangeChanged', (range) => events.push(range));

      await compressOldestThree(history);

      const reported = events[events.length - 1];
      expect(reported.removedInterior).toStrictEqual([
        { start: SUMMARY_FROM_SEQ, end: SUMMARY_TO_SEQ, reason: 'compressed' },
      ]);
      expect(history.getContextRange()).toStrictEqual(reported);
      expect(history.getContextRange().totalEntries).toBe(3);
    });

    it('reads the emptied history in the event a clear emits and afterwards', async () => {
      const history = service();
      for (const text of ['one', 'two']) history.add(textRow('human', text));
      await history.waitForCommit();
      const events: ContextRange[] = [];
      history.on('contextRangeChanged', (range) => events.push(range));

      await history.clear();

      const emptied: ContextRange = {
        firstSeq: 0,
        lastSeq: 0,
        totalEntries: 0,
        removedInterior: [{ start: 1, end: 2, reason: 'cleared' }],
        approximate: false,
      };
      expect(events).toStrictEqual([emptied]);
      expect(history.getContextRange()).toStrictEqual(emptied);
      expect(history.getStatistics().totalMessages).toBe(0);
    });
  },
);

describe('HistoryService commit boundary with a journal recorder', () => {
  const directory = useTempDir('history-commit-boundary-');
  const histories: HistoryService[] = [];
  const recorders: JournalRecordingService[] = [];

  afterEach(async () => {
    restoreBackend();
    for (const history of histories.splice(0)) await history.dispose();
    for (const recorder of recorders.splice(0)) {
      await recorder.dispose().catch(() => undefined);
    }
  });

  async function committedSeq(filePath: string): Promise<number> {
    const reader = await openJournalReadOnly(filePath);
    try {
      return reader.trailer?.commitSeq ?? 0;
    } finally {
      await reader.close();
    }
  }

  it('does not resolve waitForCommit until the recorder file holds the rows', async () => {
    const failures: { gateWriteAt?: number } = {};
    const seams = testJournalSeams(failures);
    const recorder = JournalRecordingService.create({
      sessionId: 'session-aaaaaaaa-1111',
      projectHash: 'project',
      chatsDir: path.join(directory(), 'chats'),
      workspaceDirs: ['/work'],
      provider: 'anthropic',
      model: 'model-1',
      journal: { journal: seams.dependencies },
    });
    recorders.push(recorder);
    const history = new HistoryService({ recording: recorder });
    histories.push(history);
    history.add(textRow('human', 'first'));
    await history.waitForCommit();
    const filePath = recorder.getFilePath();
    if (filePath === null) throw new Error('the recorder wrote no file');
    const before = await committedSeq(filePath);
    failures.gateWriteAt = seams.events.filter(
      (event) => event.type === 'write',
    ).length;

    // A failing assertion must still release the gated write, or the cleanup waits on it forever.
    let waiting: Promise<void> | undefined;
    let settled = false;
    try {
      history.add(textRow('human', 'second'));
      waiting = history.waitForCommit().then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(settled).toBe(false);
      expect(await committedSeq(filePath)).toBe(before);
    } finally {
      seams.release();
    }
    await waiting;

    expect(await committedSeq(filePath)).toBeGreaterThan(before);
    const rows: string[] = [];
    for await (const { content } of (await recorder.session()).rows()) {
      rows.push(textOf(content));
    }
    expect(rows).toStrictEqual(['first', 'second']);
  });

  it('removes only the last row when a merged row repeats a chronology number', async () => {
    const history = new HistoryService();
    histories.push(history);
    const marked = (text: string, seq: number): IContent => ({
      ...textRow('human', text),
      metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 0 } },
    });
    history.add(marked('a', 1));
    history.add(marked('b', 2));
    history.add(marked('merged', 2));
    await history.waitForCommit();

    const removed = await history.pop();

    expect(removed === undefined ? undefined : textOf(removed)).toBe('merged');
    expect(await texts(history)).toStrictEqual(['a', 'b']);
  });
});
