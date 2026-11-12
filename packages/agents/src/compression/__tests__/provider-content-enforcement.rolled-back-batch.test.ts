/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round 3 (R2): rolling back a failed compression
 * restores the entries other writers COMMITTED meanwhile, never the entries of
 * an addBatch that published and then reverted itself (a later step of the
 * batch, such as a participant's finalizer, failed).
 *
 * Real LocalMediaStore, HistoryService (its real mutation queue and batch
 * participants), ProviderContentEnforcer, production send seam and
 * AnthropicProvider projection; only HTTP is stubbed.
 */

import { describe, expect, it } from 'bun:test';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { ContextOverflowError } from '../contextOverflowError.js';
import { aiTurn, rejection } from './image-retirement-harness.js';
import {
  historyTexts,
  textTurn,
  useReliefConversation,
} from './media-relief-fixtures.js';

const PARTIAL = 'PARTIAL SUMMARY FROM FAILED COMPRESSION';
const COMMITTED = 'BATCH COMMITTED BY ANOTHER WRITER';
const REVERTED = 'BATCH THAT PUBLISHED AND THEN REVERTED ITSELF';
const CRASH = 'summarizer crashed after rewriting history';

/** An addBatch whose finalizer fails after the batch was published. */
async function revertedBatch(history: HistoryService): Promise<void> {
  const unregister = history.registerBatchParticipant(() => ({
    publish: () => undefined,
    rollback: () => undefined,
    finalize: () => {
      throw new Error('finalizer failed after publication');
    },
  }));
  try {
    await rejection(history.addBatch([aiTurn(REVERTED)]));
  } finally {
    unregister();
  }
}

describe('rollback of a failed compression and a reverted batch (issue #4000 CodeRabbit round 3 R2)', () => {
  const conversation = useReliefConversation('llxprt-issue4000-cr3-r2-');

  it('restores the committed batch the rewrite removed and drops the reverted one', async () => {
    const session = conversation.session();
    await conversation.seedImages(3);
    conversation.seedBigText();
    const before = historyTexts(session.history);
    let runs = 0;
    session.useCompression(async (history) => {
      runs += 1;
      if (runs === 1) {
        await history.addBatch([aiTurn(COMMITTED)]);
        await revertedBatch(history);
      }
      await history.replaceAll([aiTurn(PARTIAL)]);
      throw new Error(CRASH);
    });

    const error = await rejection(session.send([textTurn('next question')]));

    expect({
      contextOverflow: error instanceof ContextOverflowError,
      history: historyTexts(session.history),
    }).toStrictEqual({
      contextOverflow: true,
      history: [...before, COMMITTED],
    });
  });
});
