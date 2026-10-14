/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import { buildContextRangeSnapshot } from './contextRange.js';
import { computeStatistics } from './curationDebugLogger.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

/**
 * The oracle is the old behaviour: a fresh fold of the whole journal on every
 * call, with the rules applied to the decoded rows.
 */
class RescanHistory extends HistoryService {
  rescan(): {
    readonly rows: IContent[];
    readonly statistics: ReturnType<typeof computeStatistics>;
    readonly range: ReturnType<typeof buildContextRangeSnapshot>;
  } {
    return this.journal.withReadRows((cursor) => {
      const rows = [...cursor.rows()];
      return {
        rows,
        statistics: computeStatistics(rows),
        range: buildContextRangeSnapshot(rows, this.spanWindow.get()),
      };
    });
  }

  lastRow(speaker?: IContent['speaker']): IContent | undefined {
    return this.getLastContent(speaker);
  }
}

function mixedRow(index: number, withReplaced = index % 5 === 0): IContent {
  const row = batchRow(index, 64);
  return {
    ...row,
    metadata: {
      ...row.metadata,
      usage: {
        totalTokens: index % 7,
        promptTokens: index % 7,
        completionTokens: 0,
      },
      ...(withReplaced
        ? {
            chronologyReplaced: {
              fromSeq: index + 2,
              toSeq: index + 4,
              itemCount: 3,
            },
          }
        : {}),
    },
  };
}

function lastBy(
  rows: readonly IContent[],
  speaker?: IContent['speaker'],
): IContent | undefined {
  return [...rows]
    .reverse()
    .find((row) => speaker === undefined || row.speaker === speaker);
}

const SPEAKERS = [undefined, 'human', 'ai', 'tool'] as const;

interface Views {
  readonly at: string;
  readonly statistics: ReturnType<typeof computeStatistics>;
  readonly range: ReturnType<typeof buildContextRangeSnapshot>;
  readonly lastRow: Array<IContent | undefined>;
  readonly lastUser: IContent | undefined;
  readonly lastAI: IContent | undefined;
}

function serviceViews(history: RescanHistory, at: string): Views {
  return {
    at,
    statistics: history.getStatistics(),
    range: history.getContextRange(),
    lastRow: SPEAKERS.map((speaker) => history.lastRow(speaker)),
    lastUser: history.getLastUserContent(),
    lastAI: history.getLastAIContent(),
  };
}

function rescanViews(history: RescanHistory, at: string): Views {
  const expected = history.rescan();
  return {
    at,
    statistics: expected.statistics,
    range: expected.range,
    lastRow: SPEAKERS.map((speaker) => lastBy(expected.rows, speaker)),
    lastUser: lastBy(expected.rows, 'human'),
    lastAI: lastBy(expected.rows, 'ai'),
  };
}

/** Every scalar query is read twice, so the second read resumes saved state. */
function twice(step: string, views: (at: string) => Views): Views[] {
  return [0, 1].map((call) => views(`${step} (call ${call})`));
}

describe('history scalar queries', () => {
  const observed = (step: string): Views[] =>
    twice(step, (at) => serviceViews(history, at));
  const rescanned = (step: string): Views[] =>
    twice(step, (at) => rescanViews(history, at));

  let root: string;
  let recording: SessionRecordingService;
  let history: RescanHistory;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'history-summary-differential-'));
    recording = new SessionRecordingService({
      sessionId: 'summary-differential',
      projectHash: 'summary-differential',
      chatsDir: root,
      workspaceDirs: [root],
      provider: 'test',
      model: 'test',
    });
    history = new RescanHistory({ recording });
    history.setTokenizerFactory(exactTokenizer());
  });

  afterEach(async () => {
    await history.dispose();
    await recording.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  describe('scalar history queries against a full rescan', () => {
    it('match across appends, rewinds, compressions, replace and clear written through the service', async () => {
      expect(observed('empty')).toStrictEqual(rescanned('empty'));

      for (let index = 0; index < 8; index++) {
        history.add(mixedRow(index));
        expect(observed(`pending add ${index}`)).toStrictEqual(
          rescanned(`pending add ${index}`),
        );
      }
      await history.waitForCommit();
      expect(observed('acknowledged adds')).toStrictEqual(
        rescanned('acknowledged adds'),
      );

      await history.addBatch([8, 9, 10].map((index) => mixedRow(index)));
      expect(observed('batch')).toStrictEqual(rescanned('batch'));
      await history.waitForCommit();
      expect(observed('acknowledged batch')).toStrictEqual(
        rescanned('acknowledged batch'),
      );

      expect(await history.pop()).toBeDefined();
      expect(observed('pop pending')).toStrictEqual(rescanned('pop pending'));
      await history.waitForCommit();
      expect(observed('pop acknowledged')).toStrictEqual(
        rescanned('pop acknowledged'),
      );

      const tail = lastBy(history.rescan().rows);
      if (tail === undefined) throw new Error('Expected a tail row');
      expect(await history.removeLastIfMatches(tail)).toBe(true);
      await history.waitForCommit();
      expect(observed('removeLastIfMatches')).toStrictEqual(
        rescanned('removeLastIfMatches'),
      );

      history.add(mixedRow(11));
      await history.waitForCommit();
      expect(observed('append after rewind')).toStrictEqual(
        rescanned('append after rewind'),
      );

      await history.summarizeOldHistory(2, async () => ({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'summary' }],
        metadata: {
          chronologyReplaced: { fromSeq: 1, toSeq: 6, itemCount: 6 },
        },
      }));
      expect(observed('compression pending')).toStrictEqual(
        rescanned('compression pending'),
      );
      await history.waitForCommit();
      expect(observed('compression acknowledged')).toStrictEqual(
        rescanned('compression acknowledged'),
      );

      for (let index = 12; index < 16; index++)
        history.add(mixedRow(index, false));
      await history.waitForCommit();
      expect(observed('append after compression')).toStrictEqual(
        rescanned('append after compression'),
      );

      await history.replaceAll(
        [20, 21, 22, 23].map((index) => mixedRow(index)),
      );
      expect(observed('replace')).toStrictEqual(rescanned('replace'));
      await history.waitForCommit();
      expect(observed('replace acknowledged')).toStrictEqual(
        rescanned('replace acknowledged'),
      );

      history.add(mixedRow(24));
      await history.waitForCommit();
      expect(observed('append after replace')).toStrictEqual(
        rescanned('append after replace'),
      );

      history.clear();
      expect(observed('clear')).toStrictEqual(rescanned('clear'));
      await history.waitForCommit();
      expect(observed('clear acknowledged')).toStrictEqual(
        rescanned('clear acknowledged'),
      );

      history.add(mixedRow(30));
      await history.waitForCommit();
      expect(observed('append after clear')).toStrictEqual(
        rescanned('append after clear'),
      );
    });

    it('match when rows carry no chronology marker', async () => {
      history.add(mixedRow(0));
      history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'bare' }],
      });
      await history.waitForCommit();
      expect(observed('unmarked row')).toStrictEqual(rescanned('unmarked row'));
      history.add(mixedRow(2));
      await history.waitForCommit();
      expect(observed('marked after unmarked')).toStrictEqual(
        rescanned('marked after unmarked'),
      );
    });
  });

  describe('scalar history queries over a journal written by another recorder', () => {
    async function commitRows(from: number, to: number): Promise<void> {
      for (let index = from; index < to; index++)
        await recording.commit('content', { content: mixedRow(index) });
    }

    it('match across appends, rewind, compression, density, insert, replace and purge records', async () => {
      await commitRows(0, 6);
      expect(observed('seeded')).toStrictEqual(rescanned('seeded'));
      await commitRows(6, 9);
      expect(observed('external appends')).toStrictEqual(
        rescanned('external appends'),
      );

      await recording.commit('rewind', { itemsRemoved: 2, cutSeq: 8 });
      expect(observed('rewind')).toStrictEqual(rescanned('rewind'));
      await commitRows(9, 11);
      expect(observed('append after rewind')).toStrictEqual(
        rescanned('append after rewind'),
      );

      await recording.commit('density_mutation', {
        removedSeqs: [2],
        replacements: [{ replacedSeq: 3, replacement: mixedRow(2, false) }],
      });
      expect(observed('density')).toStrictEqual(rescanned('density'));
      await commitRows(11, 12);
      expect(observed('append after density')).toStrictEqual(
        rescanned('append after density'),
      );

      await recording.commit('synthetic_insert', {
        chronologySeq: 99,
        afterSeq: 1,
        content: mixedRow(40, false),
      });
      expect(observed('synthetic insert')).toStrictEqual(
        rescanned('synthetic insert'),
      );

      await recording.commit('replace_begin', { txId: 'tx-1' });
      await recording.commit('content', {
        content: mixedRow(50),
        tx: 'tx-1',
      });
      expect(observed('open replace transaction')).toStrictEqual(
        rescanned('open replace transaction'),
      );
      await recording.commit('content', {
        content: mixedRow(51),
        tx: 'tx-1',
      });
      await recording.commit('replace_commit', { txId: 'tx-1', rowCount: 2 });
      expect(observed('committed replace transaction')).toStrictEqual(
        rescanned('committed replace transaction'),
      );
      await commitRows(12, 14);
      expect(observed('append after replace')).toStrictEqual(
        rescanned('append after replace'),
      );

      await recording.commit('replace_begin', { txId: 'tx-2' });
      await recording.commit('content', {
        content: mixedRow(60),
        tx: 'tx-2',
      });
      expect(observed('transaction left open')).toStrictEqual(
        rescanned('transaction left open'),
      );
      await commitRows(14, 15);
      expect(observed('append abandons the open transaction')).toStrictEqual(
        rescanned('append abandons the open transaction'),
      );

      const before = history.rescan().rows;
      await recording.commit('semantic_media_purge', {
        history: before.slice(1),
        frontier: { contentIndex: 0, blockIndex: 0 },
      });
      expect(observed('semantic purge')).toStrictEqual(
        rescanned('semantic purge'),
      );
      await commitRows(15, 17);
      expect(observed('append after purge')).toStrictEqual(
        rescanned('append after purge'),
      );

      await recording.commit('compression_detail', {
        originalRows: 3,
        summaryRows: 1,
      } as never);
      expect(observed('compression detail')).toStrictEqual(
        rescanned('compression detail'),
      );
      await recording.commit('compressed', {
        summary: mixedRow(70),
        itemsCompressed: 3,
      });
      expect(observed('compressed')).toStrictEqual(rescanned('compressed'));
      await commitRows(17, 20);
      expect(observed('append after compressed')).toStrictEqual(
        rescanned('append after compressed'),
      );
    });
  });
});
