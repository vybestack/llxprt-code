/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  durableRowsOf,
  expectedRange,
  journalMediaParticipant as mediaParticipant,
  rowsOf,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRow,
  detachedRows,
  withDetachedFixture,
  type DetachedFixture,
} from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import { describe, expect, it } from 'bun:test';
import { mediaRequestFixture } from './__tests__/support/turn-media-request-test-helpers.js';
import { prepareAdmittedUserTurn } from './mediaAdmissionSeam.js';
import * as turnHistory from './turnHistoryCommit.js';

async function expectTurnRejection(
  operation: Promise<void>,
  failure: string,
  writeFailure: Error,
): Promise<void> {
  if (failure === 'released-input')
    await expect(operation).rejects.toThrow(
      'Released user media admission cannot transfer to history',
    );
  else await expect(operation).rejects.toBe(writeFailure);
}

async function expectFollowingTurn(
  history: HistoryService,
  failure: string,
): Promise<void> {
  if (failure === 'released-input') {
    history.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'following' }],
    });
    await history.waitForTokenUpdates();
    expect(
      (await history.getLastUserContent())?.metadata?.chronology?.seq,
    ).toBe(4);
  } else {
    await expect(
      history.addBatch([
        { speaker: 'human', blocks: [{ type: 'text', text: 'following' }] },
      ]),
    ).rejects.toThrow('journal writer failed earlier');
  }
}

async function initializeBaseline(
  fixture: DetachedFixture,
  pending: boolean,
): Promise<void> {
  const { history } = fixture;
  await history.detachedValues.replace(detachedRows(pending ? 2 : 3));
  await history.registerMediaOwner(
    mediaParticipant(() => {
      expect(history.length()).toBeGreaterThanOrEqual(2);
      return { publish: () => {}, rollback: () => {} };
    }),
  );
  if (pending) {
    fixture.pauseWriter(3);
    history.add(detachedRow(2));
    await fixture.writerPaused;
    expect(history.length()).toBe(3);
  }
}

async function turnOptions(
  history: HistoryService,
): Promise<Parameters<typeof turnHistory.commitTurnHistory>[0]> {
  const { runtimeContext, compressionHandler } = mediaRequestFixture(history);
  const preparedUserTurn = await prepareAdmittedUserTurn(
    runtimeContext,
    history,
    [{ speaker: 'human', blocks: [{ type: 'text', text: 'new question' }] }],
    'commit-regression',
  );
  return {
    runtimeContext,
    historyService: history,
    compressionHandler,
    preparedUserTurn,
    response: {
      content: {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'new answer' }],
      },
    },
    promptId: 'commit-regression',
    currentModel: 'commit-model',
    baseUrl: 'https://commit.example',
    lastPromptTokenCount: null,
    attemptIndex: 1,
    eagerlyRecordedToolResponseCallIds: new Set(['completed-tool']),
  };
}

describe('turn history commit surface', () => {
  it('exposes the transactional commit without an eager rollback alternative', async () => {
    expect(Object.keys(turnHistory)).toStrictEqual(['commitTurnHistory']);
    await withDetachedFixture(async ({ history }) => {
      const options = await turnOptions(history);
      await turnHistory.commitTurnHistory(options);
      expect(
        (await rowsOf(history)).map((row) => ({
          speaker: row.speaker,
          seq: row.metadata?.chronology?.seq,
          model: row.metadata?.model,
        })),
      ).toStrictEqual([
        { speaker: 'human', seq: 1, model: undefined },
        { speaker: 'ai', seq: 2, model: 'commit-model' },
      ]);
      expect(options.preparedUserTurn.isTransferredToHistory()).toBe(true);
    });
  });
});

for (const pending of [false, true]) {
  describe(`turn append with pending baseline ${pending}`, () => {
    it('appends a complete turn, preserves the prefix, and transfers admissions', async () => {
      await withDetachedFixture(async (fixture) => {
        const { history, recorder, releaseWriter, owners } = fixture;
        await initializeBaseline(fixture, pending);
        const options = await turnOptions(history);
        const baselineTokens = pending
          ? new Promise<number>((resolve) => {
              history.once('tokensUpdated', () =>
                resolve(history.getTotalTokens()),
              );
            })
          : Promise.resolve(history.getTotalTokens());
        const operation = turnHistory.commitTurnHistory(options);
        releaseWriter();
        expect(await baselineTokens).toBe(12);
        await operation;
        const rows = await rowsOf(history);
        expect(rows.slice(0, 3)).toStrictEqual([
          detachedRow(0),
          detachedRow(1),
          detachedRow(2),
        ]);
        expect(rows.slice(3).map((row) => row.blocks)).toStrictEqual([
          [{ type: 'text', text: 'new question' }],
          [{ type: 'text', text: 'new answer' }],
        ]);
        expect(
          rows.slice(3).map((row) => row.metadata?.chronology?.seq),
        ).toStrictEqual([4, 5]);
        expect(rows[4].metadata?.model).toBe('commit-model');
        expect(rows[4].metadata?.providerBaseURL).toBe(
          'https://commit.example',
        );
        expect(options.preparedUserTurn.isTransferredToHistory()).toBe(true);
        expect(options.eagerlyRecordedToolResponseCallIds.size).toBe(0);
        releaseWriter();
        await recorder.flush();
        expect((await detachedDurableDigest(recorder)).count).toBe(5);
        expect(
          (await durableRowsOf(recorder)).slice(3).map((row) => row.blocks),
        ).toStrictEqual([
          [{ type: 'text', text: 'new question' }],
          [{ type: 'text', text: 'new answer' }],
        ]);
        expect(history.getContextRange()).toStrictEqual(expectedRange(5));
        expect(owners.snapshot().liveRows).toBe(0);
      });
    });
  });

  for (const failure of ['records', 'trailer', 'released-input']) {
    describe(`turn ${failure} with pending baseline ${pending}`, () => {
      it('restores live and durable baseline', async () => {
        await withDetachedFixture(async (fixture) => {
          const { history, recorder, releaseWriter, owners, io } = fixture;
          await initializeBaseline(fixture, pending);
          const expected = await detachedDigest(detachedRows(3));
          const options = await turnOptions(history);
          const writeFailure = new Error(`turn ${failure} failure`);
          if (failure === 'released-input') {
            await options.preparedUserTurn.releaseIfUncommitted();
          } else if (failure === 'records' || failure === 'trailer') {
            releaseWriter();
            await history.waitForCommit();
            io.rejectNextWrite(writeFailure, failure);
          }
          const operation = turnHistory.commitTurnHistory(options);
          releaseWriter();
          await expectTurnRejection(operation, failure, writeFailure);
          expect(
            await detachedDigest(history.streamRawHistory()),
          ).toStrictEqual(expected);
          expect(history.getTotalTokens()).toBe(12);
          expect(history.getContextRange()).toStrictEqual(expectedRange(3));
          expect(owners.snapshot().liveRows).toBe(0);
          expect(options.preparedUserTurn.isTransferredToHistory()).toBe(false);
          expect(options.eagerlyRecordedToolResponseCallIds.size).toBe(0);
          releaseWriter();
          await history.waitForCommit();
          await recorder.flush();
          expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
          await expectFollowingTurn(history, failure);
        });
      });
    });
  }
}
