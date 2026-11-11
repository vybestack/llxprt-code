import { readHistory } from './retirement-source-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round (T2): a failed compression is rolled back to
 * the history it started from, but a conversation entry that another writer
 * (a queued add under the compression lock, or appendGeneration's addBatch)
 * committed while the compression was in flight is not part of the failed
 * attempt and must survive. The simulated compression applies its rewrite
 * through replaceAll, as the production apply path does. Real
 * LocalMediaStore, HistoryService, ProviderContentEnforcer, production send
 * seam and AnthropicProvider projection; only HTTP is stubbed.
 */

import { describe, expect, it } from 'bun:test';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { ContextOverflowError } from '../contextOverflowError.js';
import { aiTurn, rejection } from './image-retirement-harness.js';
import { textTurn, useReliefConversation } from './media-relief-fixtures.js';

const PARTIAL = 'PARTIAL SUMMARY FROM FAILED COMPRESSION';
const INDEPENDENT = 'ENTRY COMMITTED BY ANOTHER WRITER DURING COMPRESSION';

async function texts(history: HistoryService): Promise<string[]> {
  return (await readHistory(history)).flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'text' ? [block.text] : [],
    ),
  );
}

/** What CompressionHandler.performCompression does around a strategy. */
async function underCompressionLock(
  history: HistoryService,
  body: () => Promise<void>,
): Promise<void> {
  history.startCompression();
  try {
    await body();
  } finally {
    history.endCompression();
  }
}

describe('a failed compression keeps entries other writers committed meanwhile (issue #4000 CodeRabbit T2)', () => {
  const conversation = useReliefConversation('llxprt-issue4000-cr-t2-');

  it('keeps an add that was queued under the compression lock', async () => {
    const session = conversation.session();
    await conversation.seedImages(3);
    conversation.seedBigText();
    const before = await texts(session.history);
    let runs = 0;
    session.useCompression((history) => {
      runs += 1;
      return underCompressionLock(history, async () => {
        if (runs === 1) history.add(aiTurn(INDEPENDENT));
        await history.replaceAll([aiTurn(PARTIAL)]);
        throw new Error('summarizer crashed after rewriting history');
      });
    });

    const error = await rejection(session.send([textTurn('next question')]));

    expect({
      contextOverflow: error instanceof ContextOverflowError,
      history: await texts(session.history),
    }).toStrictEqual({
      contextOverflow: true,
      history: [...before, INDEPENDENT],
    });
  });

  it('keeps an addBatch committed while the compression was in flight', async () => {
    const session = conversation.session();
    await conversation.seedImages(3);
    conversation.seedBigText();
    const before = await texts(session.history);
    let runs = 0;
    session.useCompression(async (history) => {
      runs += 1;
      await history.replaceAll([aiTurn(PARTIAL)]);
      if (runs === 1) await history.addBatch([aiTurn(INDEPENDENT)]);
      throw new Error('summarizer crashed after rewriting history');
    });

    const error = await rejection(session.send([textTurn('next question')]));

    expect({
      contextOverflow: error instanceof ContextOverflowError,
      history: await texts(session.history),
    }).toStrictEqual({
      contextOverflow: true,
      history: [...before, INDEPENDENT],
    });
  });
});
