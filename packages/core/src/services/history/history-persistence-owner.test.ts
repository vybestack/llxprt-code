import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from './HistoryService.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { SessionPersistenceService } from '../../storage/SessionPersistenceService.js';
import type { IContent } from './IContent.js';
import { RecordingIntegration } from '../../recording/RecordingIntegration.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import {
  createRecordedSession,
  PROJECT_HASH,
} from '../../recording/p05dTestKit.js';
import {
  resumeSession,
  type ResumeResult,
} from '../../recording/resumeSession.js';
import { JournalResolver } from '../../recording/journalResolver.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

async function reopen(file: string): Promise<IContent[]> {
  const resolver = await JournalResolver.open(file);
  try {
    const rows: IContent[] = [];
    for await (const entry of resolver.resolve()) rows.push(entry.content);
    return rows;
  } finally {
    await resolver.close();
  }
}

let directory: string;

let history: HistoryService;

let old: SessionRecordingService;

let integration: RecordingIntegration;

let resumed: ResumeResult | undefined;

async function candidate(): Promise<ResumeResult> {
  const fixture = await createRecordedSession(directory, { rows: 3 });
  const result = await resumeSession({
    continueRef: fixture.sessionId,
    chatsDir: directory,
    projectHash: PROJECT_HASH,
    currentProvider: 'test',
    currentModel: 'test',
    workspaceDirs: [],
  });
  if (!result.ok) throw new Error(result.error);
  resumed = result;
  return result;
}

describe('journal persistence ownership', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'history-persistence-'));
    old = new SessionRecordingService({
      sessionId: 'old',
      projectHash: PROJECT_HASH,
      chatsDir: directory,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    history = new HistoryService({ recording: old });
    integration = new RecordingIntegration(old);
    void integration.subscribeToJournal(history);
    history.add(row('old row'));
    await history.waitForCommit();
  });
  afterEach(async () => {
    await integration.dispose();
    history.dispose();
    await old.dispose();
    await resumed?.recording.dispose();
    await resumed?.lockHandle.release();
    await rm(directory, { recursive: true, force: true });
  });
  it(
    'preserves adopted chronology through independent reopen and addressed replacement',
    verifyPreservesAdoptedChronologyThroughIndependentReopenAndAddressedReplacement,
  );

  it(
    'does not reattach a rejected recorder when publication subscribes before failing',
    verifyDoesNotReattachARejectedRecorderWhenPublicationSubscribesBeforeFailing,
  );
  it(
    'finishes an in-flight journal snapshot before disposal settles',
    verifyFinishesAnInFlightJournalSnapshotBeforeDisposalSettles,
  );

  it(
    'records a row once when observers and history share the journal',
    verifyRecordsARowOnceWhenObserversAndHistoryShareTheJournal,
  );
  it(
    'excludes the old journal after adoption even before its integration is retired',
    verifyExcludesTheOldJournalAfterAdoptionEvenBeforeItsIntegrationIsRetired,
  );
  it(
    'waitForCommit includes a preceding asynchronous summary and subsequent add',
    verifyWaitForCommitIncludesAPrecedingAsynchronousSummaryAndSubsequentAdd,
  );
  it(
    'does not dispose a recorder owned by its caller',
    verifyDoesNotDisposeARecorderOwnedByItsCaller,
  );
  it(
    'serializes token recalculation and configuration behind adoption publication',
    verifySerializesTokenRecalculationAndConfigurationBehindAdoptionPublication,
  );
  it(
    'detaches a disabled integration without stopping live history or writing its old journal',
    verifyDetachesADisabledIntegrationWithoutStoppingLiveHistoryOrWritingItsOld,
  );
  it(
    'persists add, density, deletion, synthetic repair, compression and clear only to the adopted owner',
    verifyPersistsAddDensityDeletionSyntheticRepairCompressionAndClearOnlyToThe,
  );

  it(
    'retains the old recording subscription when publication rolls back',
    verifyRetainsTheOldRecordingSubscriptionWhenPublicationRollsBack,
  );
});

async function verifyPreservesAdoptedChronologyThroughIndependentReopenAndAddressedReplacement(): Promise<void> {
  const result = await candidate();
  await history.adoptResumeBoot(result.recording, result.boot);
  await collectRowsForAssertions(history.streamRawHistory(), async (rows) => {
    const adopted = rows;
    expect<readonly IContent[]>(
      await reopen(result.boot.filePath),
    ).toStrictEqual(adopted);
    const replacement = { ...adopted[1], blocks: row('replacement').blocks };
    await history.replaceBatch([adopted[0], replacement, adopted[2]]);
    await history.waitForCommit();
    expect(
      (await reopen(result.boot.filePath)).map((item) => item.blocks),
    ).toStrictEqual([
      row('row-0').blocks,
      row('replacement').blocks,
      row('row-2').blocks,
    ]);
  });
}

async function verifyDoesNotReattachARejectedRecorderWhenPublicationSubscribesBeforeFailing(): Promise<void> {
  const result = await candidate();
  const next = new RecordingIntegration(result.recording);
  await expect(
    history.adoptResumeBoot(result.recording, result.boot, () => {
      void next.subscribeToJournal(history);
      throw new Error('subscribed publication failed');
    }),
  ).rejects.toThrow('subscribed publication failed');
  await next.dispose();
  history.add(row('restored owner'));
  await history.waitForCommit();
  expect(history.journalPath()).toBe(old.getFilePath());
  expect(
    (await reopen(old.getFilePath()!)).map((item) => item.blocks),
  ).toStrictEqual([row('old row').blocks, row('restored owner').blocks]);
}

async function verifyFinishesAnInFlightJournalSnapshotBeforeDisposalSettles(): Promise<void> {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  class GatedPersistence extends SessionPersistenceService {
    override async saveJournal(journal: string): Promise<void> {
      entered.resolve();
      await release.promise;
      await super.saveJournal(journal);
    }
  }
  await integration.dispose();
  const persistence = new GatedPersistence(new Storage(directory), 'gated');
  integration = new RecordingIntegration(old, persistence);
  void integration.subscribeToJournal(history);
  history.add(row('snapshot row'));
  const boundary = integration.flushAtTurnBoundary();
  await entered.promise;
  let settled = false;
  const disposal = integration.dispose().then(() => {
    settled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const settledBeforeRelease = settled;
  release.resolve();
  await boundary;
  await disposal;
  const loaded = await persistence.loadMostRecent();
  expect(settledBeforeRelease).toBe(false);
  expect(loaded?.history.map((item) => item.blocks)).toStrictEqual([
    row('old row').blocks,
    row('snapshot row').blocks,
  ]);
  await loaded?.mediaOwnership.release();
}

async function verifyRecordsARowOnceWhenObserversAndHistoryShareTheJournal(): Promise<void> {
  await integration.flushAtTurnBoundary();
  expect(
    (await reopen(history.journalPath()!)).map((item) => item.blocks),
  ).toStrictEqual([row('old row').blocks]);
}

async function verifyExcludesTheOldJournalAfterAdoptionEvenBeforeItsIntegrationIsRetired(): Promise<void> {
  const result = await candidate();
  await old.flush();
  const oldPath = old.getFilePath()!;
  const before = await readFile(oldPath);
  await history.adoptResumeBoot(result.recording, result.boot);
  history.add(row('new row'));
  await history.waitForCommit();
  await integration.flushAtTurnBoundary();
  expect(Buffer.compare(await readFile(oldPath), before)).toBe(0);
  expect(
    (await reopen(result.boot.filePath)).map((item) => item.blocks),
  ).toStrictEqual([
    row('row-0').blocks,
    row('row-1').blocks,
    row('row-2').blocks,
    row('new row').blocks,
  ]);
}

async function verifyWaitForCommitIncludesAPrecedingAsynchronousSummaryAndSubsequentAdd(): Promise<void> {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  history.add(row('second'));
  const summary = history.summarizeOldHistory(0, async () => {
    entered.resolve();
    await release.promise;
    return row('summary');
  });
  await entered.promise;
  history.add(row('after summary'));
  let durable = false;
  const barrier = history.waitForCommit().then(() => {
    durable = true;
  });
  await old.flush();
  expect(durable).toBe(false);
  release.resolve();
  await summary;
  await barrier;
  expect(
    (await reopen(history.journalPath()!)).map((item) => item.blocks),
  ).toStrictEqual([row('summary').blocks, row('after summary').blocks]);
}

async function verifyDoesNotDisposeARecorderOwnedByItsCaller(): Promise<void> {
  history.dispose();
  await old.commit('content', { content: row('caller still owns recorder') });
  const reopened = await reopen(old.getFilePath()!);
  expect(reopened[reopened.length - 1].blocks).toStrictEqual(
    row('caller still owns recorder').blocks,
  );
}

async function verifySerializesTokenRecalculationAndConfigurationBehindAdoptionPublication(): Promise<void> {
  const result = await candidate();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const adoption = history.adoptResumeBoot(
    result.recording,
    result.boot,
    async () => {
      entered.resolve();
      await release.promise;
    },
  );
  await entered.promise;
  history.setBaseTokenOffset(73);
  const during = history.getBaseTokenOffset();
  const recalculation = history.recalculateTotalTokens();
  release.resolve();
  await adoption;
  await recalculation;
  expect(during).toBe(0);
  expect(history.getBaseTokenOffset()).toBe(73);
  expect(history.getTotalTokens()).toBeGreaterThan(73);
}

async function verifyDetachesADisabledIntegrationWithoutStoppingLiveHistoryOrWritingItsOld(): Promise<void> {
  const oldFile = old.getFilePath()!;
  const before = await readFile(oldFile);
  await integration.dispose();
  history.add(row('after disable'));
  await history.waitForCommit();
  expect(Buffer.compare(await readFile(oldFile), before)).toBe(0);
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((item) => item.blocks)).toStrictEqual([
      row('old row').blocks,
      row('after disable').blocks,
    ]);
  });
}

async function verifyPersistsAddDensityDeletionSyntheticRepairCompressionAndClearOnlyToThe(): Promise<void> {
  const result = await candidate();
  const oldBytes = await readFile(old.getFilePath()!);
  const persistence = new SessionPersistenceService(
    new Storage(directory),
    'snapshot',
  );
  const next = new RecordingIntegration(result.recording, persistence);
  await history.adoptResumeBoot(result.recording, result.boot);
  void next.subscribeToJournal(history);
  const check = async (): Promise<void> => {
    await next.flushAtTurnBoundary();
    await collectRowsForAssertions(history.streamRawHistory(), async (rows) => {
      expect<readonly IContent[]>(
        await reopen(result.boot.filePath),
      ).toStrictEqual(rows);
    });
    const loaded = await persistence.loadMostRecent();
    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect<readonly IContent[] | undefined>(loaded?.history).toStrictEqual(
        rows,
      );
    });
    await loaded?.mediaOwnership.release();
    expect(await readFile(old.getFilePath()!)).toStrictEqual(oldBytes);
  };
  try {
    history.add(row('appended'));
    await check();
    await history.applyDensityResult({
      removals: [0],
      replacements: new Map([[1, row('density replacement')]]),
      metadata: {
        readWritePairsPruned: 0,
        fileDeduplicationsPruned: 0,
        recencyPruned: 1,
      },
    });
    await check();
    await history.pop();
    await check();
    await collectRowsForAssertions(history.streamRawHistory(), async (rows) => {
      const current = rows;
      const last = current[current.length - 1];
      expect(await history.removeLastIfMatches(last)).toBe(true);
      await check();
      history.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'missing',
            name: 'read_file',
            parameters: {},
          },
        ],
      });
      history.validateAndFix();
      await check();
      await collectRowsForAssertions(
        history.streamRawHistory(),
        async (rows) => {
          const repaired = rows;
          expect(repaired[repaired.length - 1].speaker).toBe('tool');
          history.startCompression();
          await history.replaceBatch([row('compressed')]);
          await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
            history.endCompression(rows[0], 3);
          });
          await check();
          history.clear();
          await check();
          expect(await reopen(result.boot.filePath)).toStrictEqual([]);
        },
      );
    });
  } finally {
    await next.dispose();
  }
}

async function verifyRetainsTheOldRecordingSubscriptionWhenPublicationRollsBack(): Promise<void> {
  const result = await candidate();
  await result.recording.flush();
  const candidateBytes = await readFile(result.boot.filePath);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const adoption = history.adoptResumeBoot(
    result.recording,
    result.boot,
    async () => {
      entered.resolve();
      await release.promise;
      throw new Error('rollback owner');
    },
  );
  await entered.promise;
  history.add(row('queued rollback row'));
  history.validateAndFix();
  const barrier = history.waitForCommit();
  release.resolve();
  await expect(adoption).rejects.toThrow('rollback owner');
  await barrier;
  await integration.flushAtTurnBoundary();
  expect(
    (await reopen(old.getFilePath()!)).map((item) => item.blocks),
  ).toStrictEqual([row('old row').blocks, row('queued rollback row').blocks]);
  expect(
    Buffer.compare(await readFile(result.boot.filePath), candidateBytes),
  ).toBe(0);
}
