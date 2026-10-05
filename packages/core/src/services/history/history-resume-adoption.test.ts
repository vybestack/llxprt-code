import { collectRowsForAssertions } from '../../test-utils/collect-rows-for-assertions.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  afterEach,
  beforeEach,
  expect,
  it,
  describe,
  setSystemTime,
} from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from './HistoryService.js';
import type { TextBlock } from './IContent.js';
import {
  createRecordedSession,
  PROJECT_HASH,
} from '../../recording/p05dTestKit.js';
import {
  resumeSession,
  type ResumeResult,
} from '../../recording/resumeSession.js';

let root: string;

let service: HistoryService;

let resumed: ResumeResult | undefined;

async function candidate(): Promise<ResumeResult> {
  const fixture = await createRecordedSession(root, { rows: 3 });
  const result = await resumeSession({
    continueRef: fixture.sessionId,
    chatsDir: root,
    projectHash: PROJECT_HASH,
    currentProvider: 'anthropic',
    currentModel: 'claude-4',
    workspaceDirs: [],
  });
  if (!result.ok) throw new Error(result.error);
  resumed = result;
  return result;
}

describe('history resume adoption', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'history-boot-'));
    service = new HistoryService();
    service.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'prior' }],
    });
    await service.waitForCommit();
  });
  afterEach(async () => {
    service.dispose();
    await resumed?.recording.dispose();
    await rm(root, { recursive: true, force: true });
  });
  it(
    'adopts the validated journal without copying rows and restores prior identity on publication failure',
    verifyAdoptsTheValidatedJournalWithoutCopyingRowsAndRestoresPriorIdentityOn,
  );
  it(
    'commits journal identity and continues new history on the adopted recording',
    verifyCommitsJournalIdentityAndContinuesNewHistoryOnTheAdoptedRecording,
  );

  it(
    'preserves new response chains after resume adoption',
    verifyPreservesNewResponseChainsAfterResumeAdoption,
  );
  it(
    'drains additions queued by the previous compression before adoption',
    verifyDrainsAdditionsQueuedByThePreviousCompressionBeforeAdoption,
  );

  it(
    'defers disposal until adoption has committed',
    verifyDefersDisposalUntilAdoptionHasCommitted,
  );

  it.each(['pop', 'remove'])(
    'serializes %s and replacing behind a failed adoption',
    verifyRemovalBehindFailedAdoption,
  );

  it(
    'notifies later observers of restoration when an earlier observer throws',
    verifyNotifiesLaterObserversOfRestorationWhenAnEarlierObserverThrows,
  );

  it(
    'keeps chronology stable on subsequent reads and appends',
    verifyKeepsChronologyStableOnSubsequentReadsAndAppends,
  );

  it(
    'queues synchronous additions behind adoption publication',
    verifyQueuesSynchronousAdditionsBehindAdoptionPublication,
  );

  it(
    'compensates published token and range observations after rollback',
    verifyCompensatesPublishedTokenAndRangeObservationsAfterRollback,
  );
});

async function verifyAdoptsTheValidatedJournalWithoutCopyingRowsAndRestoresPriorIdentityOn(): Promise<void> {
  const result = await candidate();
  await result.recording.flush();
  const priorPath = service.journalPath();
  await collectRowsForAssertions(service.streamRawHistory(), async (rows) => {
    const prior = rows;
    const tokens = service.getTotalTokens();
    const bytes = await readFile(result.boot.filePath);
    await expect(
      service.adoptResumeBoot(result.recording, result.boot, () => {
        throw new Error('publication failed');
      }),
    ).rejects.toThrow('publication failed');
    expect(service.journalPath()).toBe(priorPath);
    await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
      expect(rows).toStrictEqual(prior);
    });
    expect(service.getTotalTokens()).toBe(tokens);
    expect(await readFile(result.boot.filePath)).toStrictEqual(bytes);
  });
}

async function verifyCommitsJournalIdentityAndContinuesNewHistoryOnTheAdoptedRecording(): Promise<void> {
  const result = await candidate();
  await service.adoptResumeBoot(result.recording, result.boot);
  expect(service.journalPath()).toBe(result.boot.filePath);
  await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
    expect(rows.map((row) => row.blocks[0])).toStrictEqual(
      [0, 1, 2].map<TextBlock>((index) => ({
        type: 'text',
        text: `row-${index}`,
      })),
    );
  });
  service.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'continued' }],
  });
  await service.waitForCommit();
  await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
    expect(rows).toHaveLength(4);
  });
  expect(service.getTotalTokens()).toBeGreaterThan(0);
}

async function verifyPreservesNewResponseChainsAfterResumeAdoption(): Promise<void> {
  const result = await candidate();
  await service.adoptResumeBoot(result.recording, result.boot);
  service.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'new-chain' }],
    metadata: { responsesStored: true },
  });
  await service.waitForCommit();
  await collectRowsForAssertions(service.streamRawHistory(), async (rows) => {
    const current = rows;
    expect(current[current.length - 1].metadata?.responsesStored).toBe(true);
  });
}

async function verifyDrainsAdditionsQueuedByThePreviousCompressionBeforeAdoption(): Promise<void> {
  const result = await candidate();
  service.startCompression();
  service.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'old queued row' }],
  });
  const adoption = service.adoptResumeBoot(result.recording, result.boot);
  service.endCompression();
  await adoption;
  await service.waitForCommit();
  await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
    expect(rows.map((row) => row.blocks[0])).toStrictEqual(
      [0, 1, 2].map<TextBlock>((index) => ({
        type: 'text',
        text: `row-${index}`,
      })),
    );
  });
}

async function verifyDefersDisposalUntilAdoptionHasCommitted(): Promise<void> {
  const result = await candidate();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const adoption = service.adoptResumeBoot(
    result.recording,
    result.boot,
    async () => {
      entered.resolve();
      await release.promise;
    },
  );
  await entered.promise;
  let failure: unknown;
  try {
    service.dispose();
  } catch (error) {
    failure = error;
  } finally {
    release.resolve();
  }
  await adoption;
  await service.waitForOwnershipSettlement();
  expect(failure).toBeUndefined();
  expect(service.getTotalTokens()).toBe(0);
}

async function verifyNotifiesLaterObserversOfRestorationWhenAnEarlierObserverThrows(): Promise<void> {
  const result = await candidate();
  await service.waitForTokenUpdates();
  const before = service.getTotalTokens();
  let current = before;
  service.on('tokensUpdated', (event) => {
    if (event.totalTokens === before) throw new Error('observer fault');
  });
  service.on('tokensUpdated', (event) => {
    current = event.totalTokens;
  });
  await expect(
    service.adoptResumeBoot(result.recording, result.boot, () => {
      throw new Error('publication fault');
    }),
  ).rejects.toThrow('publication fault');
  expect(current).toBe(before);
}

async function verifyKeepsChronologyStableOnSubsequentReadsAndAppends(): Promise<void> {
  const result = await candidate();
  const adoptedAt = new Date('2026-09-21T12:00:00Z');
  setSystemTime(adoptedAt);
  try {
    await service.adoptResumeBoot(result.recording, result.boot);
    setSystemTime(new Date('2026-09-21T13:00:00Z'));
    await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
      expect(rows.map((row) => row.metadata?.chronology)).toStrictEqual([
        { seq: 1, userTurn: 1, step: 1, recordedAt: adoptedAt.getTime() },
        { seq: 2, userTurn: 1, step: 2, recordedAt: adoptedAt.getTime() },
        { seq: 3, userTurn: 2, step: 1, recordedAt: adoptedAt.getTime() },
      ]);
    });
  } finally {
    setSystemTime();
  }
  service.add({ speaker: 'human', blocks: [{ type: 'text', text: 'tail' }] });
  await service.waitForCommit();
  await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
    expect(rows.map((row) => row.metadata?.chronology?.seq)).toStrictEqual([
      1, 2, 3, 4,
    ]);
  });
}

async function verifyQueuesSynchronousAdditionsBehindAdoptionPublication(): Promise<void> {
  const result = await candidate();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const adoption = service.adoptResumeBoot(
    result.recording,
    result.boot,
    async () => {
      entered.resolve();
      await release.promise;
    },
  );
  await entered.promise;
  let failure: unknown;
  try {
    service.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'queued' }],
    });
  } catch (error) {
    failure = error;
  } finally {
    release.resolve();
  }
  await adoption;
  await service.waitForCommit();
  expect(failure).toBeUndefined();
  await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
    expect(rows.map((row) => row.blocks[0])).toStrictEqual([
      ...[0, 1, 2].map<TextBlock>((index) => ({
        type: 'text',
        text: `row-${index}`,
      })),
      { type: 'text', text: 'queued' },
    ]);
  });
}

async function verifyCompensatesPublishedTokenAndRangeObservationsAfterRollback(): Promise<void> {
  const result = await candidate();
  await service.waitForTokenUpdates();
  const tokens = service.getTotalTokens();
  const range = service.getContextRange();
  const observedTokens: number[] = [];
  const observedRanges: unknown[] = [];
  service.on('tokensUpdated', (event) =>
    observedTokens.push(event.totalTokens),
  );
  service.on('contextRangeChanged', (event) => observedRanges.push(event));
  await expect(
    service.adoptResumeBoot(result.recording, result.boot, () => {
      throw new Error('publication failed');
    }),
  ).rejects.toThrow('publication failed');
  expect(observedTokens[observedTokens.length - 1]).toBe(tokens);
  expect(observedRanges[observedRanges.length - 1]).toStrictEqual(range);
}

async function verifyRemovalBehindFailedAdoption(
  method: string,
): Promise<void> {
  await collectRowsForAssertions(service.streamRawHistory(), async (rows) => {
    const prior = rows[0];
    const result = await candidate();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const adoption = service.adoptResumeBoot(
      result.recording,
      result.boot,
      async () => {
        entered.resolve();
        await release.promise;
        throw new Error('rollback');
      },
    );
    const rejected = adoption.catch((error: unknown) => error);
    await entered.promise;
    let removal: Promise<unknown>;
    try {
      removal = Promise.resolve(
        method === 'pop' ? service.pop() : service.removeLastIfMatches(prior),
      );
    } catch (error) {
      removal = Promise.reject(error);
    }
    const outcome = removal.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    const replacement = service.replaceBatch([
      { speaker: 'human', blocks: [{ type: 'text', text: 'replacement' }] },
    ]);
    release.resolve();
    expect(await rejected).toBeInstanceOf(Error);
    expect(await outcome).toStrictEqual({
      value: method === 'pop' ? prior : true,
    });
    await replacement;
    await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
      expect(rows[0].blocks).toStrictEqual([
        { type: 'text', text: 'replacement' },
      ]);
    });
    expect(service.journalPath()).not.toBe(result.boot.filePath);
  });
}
