/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  durableRowsOf,
  expectedRange,
  mediaParticipant,
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
import * as turnHistory from './turnHistoryCommit.js';
import { prepareAdmittedUserTurn } from './mediaAdmissionSeam.js';
import { mediaRequestFixture } from './turn-media-request-test-helpers.js';

async function initializeBaseline(
  {
    history,
    recorder,
  }: Pick<DetachedFixture, 'history' | 'recorder' | 'releaseWriter'>,
  pending: boolean,
): Promise<void> {
  for (let index = 0; index < 3; index++) history.add(detachedRow(index));
  await history.waitForTokenUpdates();
  if (!pending) await recorder.flush();
  history.registerMediaOwner(
    mediaParticipant(() => {
      expect(recorder.getPendingRecordCount()).toBe(0);
      return { publish: () => {}, rollback: () => {} };
    }),
  );
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
      await withDetachedFixture(
        async ({ history, recorder, releaseWriter, owners }) => {
          await initializeBaseline(
            { history, recorder, releaseWriter },
            pending,
          );
          const options = await turnOptions(history);
          const operation = turnHistory.commitTurnHistory(options);
          expect(recorder.getPendingRecordCount() > 0).toBe(pending);
          expect(history.getTotalTokens()).toBe(12);
          releaseWriter();
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
        },
        pending,
      );
    });
  });

  for (const failure of [
    'admission-zero',
    'admission-prefix',
    'released-input',
  ]) {
    describe(`turn ${failure} with pending baseline ${pending}`, () => {
      it('restores live and durable baseline', async () => {
        await withDetachedFixture(
          async ({ history, recorder, releaseWriter, owners }) => {
            await initializeBaseline(
              { history, recorder, releaseWriter },
              pending,
            );
            const expected = await detachedDigest(detachedRows(3));
            const options = await turnOptions(history);
            if (failure === 'released-input') {
              await options.preparedUserTurn.releaseIfUncommitted();
            } else {
              recorder.failAdmissionAfter(failure === 'admission-zero' ? 0 : 1);
            }
            const operation = turnHistory.commitTurnHistory(options);
            expect(recorder.getPendingRecordCount() > 0).toBe(pending);
            releaseWriter();
            await expect(operation).rejects.toThrow(
              failure === 'released-input'
                ? 'Released user media admission cannot transfer to history'
                : recorder.failure.message,
            );
            expect(
              await detachedDigest(history.streamRawHistory()),
            ).toStrictEqual(expected);
            expect(history.getTotalTokens()).toBe(12);
            expect(history.getContextRange()).toStrictEqual(expectedRange(3));
            expect(owners.snapshot().liveRows).toBe(0);
            expect(options.preparedUserTurn.isTransferredToHistory()).toBe(
              false,
            );
            expect(options.eagerlyRecordedToolResponseCallIds.size).toBe(0);
            releaseWriter();
            await recorder.flush();
            expect(await detachedDurableDigest(recorder)).toStrictEqual(
              expected,
            );
            history.add({
              speaker: 'human',
              blocks: [{ type: 'text', text: 'following' }],
            });
            await history.waitForTokenUpdates();
            expect(
              history.getLastUserContent()?.metadata?.chronology?.seq,
            ).toBe(4);
          },
          pending,
        );
      });
    });
  }
}
