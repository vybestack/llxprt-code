/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { batchGate, batchRow } from './addbatch-stream-test-helpers.js';
import {
  AdmissionFailureRecorder,
  durableRowsOf,
  exactTokenizer,
} from './chronology-rollback-test-helpers.js';
import { HistoryService } from './HistoryService.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { HistoryMediaOwnership } from '../../storage/history-media-ownership.js';
import {
  removalReferences,
  removalRow,
} from './history-removals-test-helpers.js';
import { observeHistorySynchronouslyForTest } from '@vybestack/llxprt-code-test-utils/core/synchronous-history-test-observation.js';

interface ClearFixture {
  readonly history: HistoryService;
  readonly recorder: AdmissionFailureRecorder;
  readonly waitForPausedWrite: Promise<void>;
  pauseWriter(): void;
  releaseWriter(): void;
}

async function withClearFixture(
  action: (fixture: ClearFixture) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'compression-clear-'));
  const gate = batchGate();
  const entered = batchGate();
  let paused = false;
  const recorder = new AdmissionFailureRecorder({
    sessionId: 'compression-clear',
    projectHash: 'compression-clear',
    chatsDir: directory,
    workspaceDirs: [directory],
    provider: 'test',
    model: 'test',
    io: {
      appendFile: async (path, data, encoding): Promise<void> => {
        if (paused) {
          entered.resolve();
          await gate.promise;
        }
        await appendFile(path, data, encoding);
      },
    },
  });
  const history = new HistoryService({ recording: recorder });
  history.setTokenizerFactory(exactTokenizer());
  try {
    await action({
      history,
      recorder,
      waitForPausedWrite: entered.promise,
      pauseWriter: () => {
        paused = true;
      },
      releaseWriter: () => gate.resolve(),
    });
  } finally {
    gate.resolve();
    history.dispose();
    await recorder.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
}
async function withClearMediaFixture(
  action: (fixture: ClearFixture, store: LocalMediaStore) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'compression-clear-media-'));
  const store = new LocalMediaStore({
    rootDirectory: directory,
    quotaBytes: 1024,
  });
  try {
    await withClearFixture(async (fixture) => {
      fixture.history.registerMediaOwner(new HistoryMediaOwnership(store));
      try {
        await action(fixture, store);
      } finally {
        fixture.history.dispose();
        await fixture.history.waitForOwnershipSettlement();
      }
    });
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('compression rebuild clear observer failure', () => {
  for (const durability of ['pending', 'mixed', 'durable']) {
    it(`keeps one replacement and the streaming row across ${durability} durability`, async () => {
      await withClearFixture(async (fixture) => {
        const { history, recorder } = fixture;
        const retained = [batchRow(0), batchRow(1)];
        const incoming = batchRow(2);
        history.setBaseTokenOffset(37);
        history.setCacheAnchorSeq(1);
        if (durability !== 'pending') await history.addBatch([retained[0]]);
        if (durability !== 'durable') fixture.pauseWriter();
        history.addAll(durability === 'pending' ? retained : [retained[1]]);
        if (durability === 'durable') {
          await history.waitForCommit();
          await history.waitForTokenUpdates();
        } else {
          await fixture.waitForPausedWrite;
        }
        const failure = new Error('rebuild clear observer failed');
        const events: string[] = [];
        const rejectClear = (): void => {
          history.off('tokensUpdated', rejectClear);
          events.push('clear');
          throw failure;
        };
        history.on('tokensUpdated', rejectClear);
        history.on('contentAdded', (row) => {
          events.push(row === incoming ? 'streaming' : 'rebuild');
        });
        history.on('compressionLockReleased', () => {
          events.push('released');
          expect(observeHistorySynchronouslyForTest(history)).toStrictEqual(
            retained,
          );
        });
        history.startCompression();
        history.add(incoming);
        history.rebuildWith(() => {
          history.clear();
          for (const row of retained) history.add(row);
        });
        let observed: unknown;
        try {
          history.endCompression();
        } catch (error: unknown) {
          observed = error;
        }
        expect(observed).toBe(failure);
        expect(events).toStrictEqual([
          'clear',
          'rebuild',
          'rebuild',
          'released',
          'streaming',
        ]);
        expect(observeHistorySynchronouslyForTest(history)).toStrictEqual([
          ...retained,
          incoming,
        ]);
        fixture.releaseWriter();
        await history.waitForCommit();
        await history.waitForTokenUpdates();
        expect(await durableRowsOf(recorder)).toStrictEqual([
          ...retained,
          incoming,
        ]);
        expect(history.getTotalTokens()).toBe(37 + 3 * 4);
        expect(history.getBaseTokenOffset()).toBe(37);
        expect(history.getCacheAnchorSeq()).toBe(1);
        expect(history.getContextRange().totalEntries).toBe(3);
        expect(history.getContextRange().removedInterior).toStrictEqual([]);
      });
    });
  }
});

describe('standalone clear observer failure', () => {
  it('restores pending rows and token work while propagating the same exception', async () => {
    await withClearFixture(async (fixture) => {
      const { history, recorder } = fixture;
      const retained = [batchRow(0), batchRow(1)];
      fixture.pauseWriter();
      history.addAll(retained);
      await fixture.waitForPausedWrite;
      const failure = new Error('standalone clear observer failed');
      const rejectClear = (): void => {
        history.off('tokensUpdated', rejectClear);
        throw failure;
      };
      history.on('tokensUpdated', rejectClear);
      let observed: unknown;
      try {
        history.clear();
      } catch (error: unknown) {
        observed = error;
      }
      expect(observed).toBe(failure);
      expect(observeHistorySynchronouslyForTest(history)).toStrictEqual(
        retained,
      );
      fixture.releaseWriter();
      await history.waitForCommit();
      await history.waitForTokenUpdates();
      expect(await durableRowsOf(recorder)).toStrictEqual(retained);
      expect(history.getTotalTokens()).toBe(2 * 4);
      expect(history.getContextRange().removedInterior).toStrictEqual([]);
    });
  });
});

describe('compression rebuild clear media settlement', () => {
  it('releases only removed media after same-turn rebuild and streaming publication', async () => {
    await withClearMediaFixture(async ({ history, recorder }, store) => {
      const [kept, removed] = await removalReferences(store);
      const retained = removalRow(0, kept);
      const discarded = removalRow(1, removed);
      const incoming = batchRow(2);
      await history.addBatch([retained, discarded]);
      const failure = new Error('media rebuild clear observer failed');
      const rejectClear = (): void => {
        history.off('tokensUpdated', rejectClear);
        throw failure;
      };
      history.on('tokensUpdated', rejectClear);
      let released = false;
      history.on('compressionLockReleased', () => {
        released = true;
        expect(observeHistorySynchronouslyForTest(history)).toStrictEqual([
          retained,
        ]);
      });
      history.startCompression();
      history.add(incoming);
      history.rebuildWith(() => {
        history.clear();
        history.add(retained);
      });
      let observed: unknown;
      try {
        history.endCompression();
      } catch (error: unknown) {
        observed = error;
      }
      expect(observed).toBe(failure);
      expect(released).toBe(true);
      expect(observeHistorySynchronouslyForTest(history)).toStrictEqual([
        retained,
        incoming,
      ]);
      await history.waitForOwnershipSettlement();
      await history.waitForCommit();
      await history.waitForTokenUpdates();
      expect(await durableRowsOf(recorder)).toStrictEqual([retained, incoming]);
      expect(await store.hasReservations(kept.contentId)).toBe(true);
      expect(await store.hasReservations(removed.contentId)).toBe(false);
      expect(history.getTotalTokens()).toBe(2 * 4);
    });
  });
});
