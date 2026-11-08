/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 review round 3 (H1): a compression that fails after rewriting
 * history must leave no trace. The token-enforcement ladder that runs after
 * media relief reads the shared curated history, so the failed compression's
 * partial rewrite has to be rolled back before anything is recomposed. Real
 * LocalMediaStore, HistoryService, ProviderContentEnforcer, production send
 * seam and AnthropicProvider projection; only HTTP is stubbed.
 */

import { describe, expect, it } from 'bun:test';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { ContextOverflowError } from '../contextOverflowError.js';
import {
  aiTurn,
  collectImageData,
  collectText,
  rejection,
} from './image-retirement-harness.js';
import { textTurn, useReliefConversation } from './media-relief-fixtures.js';

const PARTIAL = 'PARTIAL SUMMARY FROM FAILED COMPRESSION';
const REAL_SUMMARY = 'REAL SUMMARY OF THE EARLIER CONVERSATION';

/** Applies the rewrite through replaceAll, as the production apply path does. */
async function rewriteToPartialSummary(history: HistoryService): Promise<void> {
  await history.replaceAll([aiTurn(PARTIAL)]);
}

async function crashAfterPartialRewrite(
  history: HistoryService,
): Promise<never> {
  await rewriteToPartialSummary(history);
  throw new Error('summarizer crashed after rewriting history');
}

describe('a failed compression restores history before the ladder continues (issue #4000 review round 3)', () => {
  const conversation = useReliefConversation('llxprt-issue4000-r3-h1-');

  describe('enforce: byte recovery pass', () => {
    it('sends the real summary of a later compression, never the failed one', async () => {
      const session = conversation.session();
      await conversation.seedImages(3);
      conversation.seedBigText();
      let runs = 0;
      session.useCompression(async (history) => {
        runs += 1;
        if (runs === 1) return crashAfterPartialRewrite(history);
        history.clear();
        history.add(aiTurn(REAL_SUMMARY));
        await history.waitForTokenUpdates();
        return undefined;
      });

      await session.send([textTurn('next question')]);

      const body = session.lastBody();
      const text = collectText(body, []).join('\n');
      expect({
        requests: session.sent.length,
        compressionRuns: session.compressionRuns,
        sentImages: collectImageData(body, []).length,
        partialSent: text.includes(PARTIAL),
        realSummarySent: text.includes(REAL_SUMMARY),
      }).toStrictEqual({
        requests: 1,
        compressionRuns: 2,
        sentImages: 0,
        partialSent: false,
        realSummarySent: true,
      });
    });

    it('fails with the context error and the original history intact when every compression fails after rewriting', async () => {
      const session = conversation.session();
      await conversation.seedImages(3);
      conversation.seedBigText();
      session.useCompression(crashAfterPartialRewrite);
      const before = JSON.stringify(session.history.getAll());

      const error = await rejection(session.send([textTurn('next question')]));

      expect({
        contextOverflow: error instanceof ContextOverflowError,
        sent: session.sent.length,
        historyRestored: JSON.stringify(session.history.getAll()) === before,
      }).toStrictEqual({
        contextOverflow: true,
        sent: 0,
        historyRestored: true,
      });
    });

    it('propagates cancellation and restores the history the cancelled compression rewrote', async () => {
      const session = conversation.session();
      await conversation.seedImages(3);
      conversation.seedBigText();
      session.useCompression(async (history) => {
        await rewriteToPartialSummary(history);
        throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      });
      const before = JSON.stringify(session.history.getAll());

      const error = await rejection(session.send([textTurn('next question')]));

      expect({
        name: error instanceof Error ? error.name : '',
        sent: session.sent.length,
        historyRestored: JSON.stringify(session.history.getAll()) === before,
      }).toStrictEqual({
        name: 'AbortError',
        sent: 0,
        historyRestored: true,
      });
    });

    it('rejects instead of continuing when the rollback itself fails', async () => {
      const session = conversation.session();
      await conversation.seedImages(3);
      conversation.seedBigText();
      session.useCompression(async (history) => {
        await rewriteToPartialSummary(history);
        history.replaceAll = () => Promise.reject(new Error('disk full'));
        throw new Error('summarizer crashed after rewriting history');
      });

      const error = await rejection(session.send([textTurn('next question')]));

      expect({
        aggregate: error instanceof AggregateError,
        causes:
          error instanceof AggregateError
            ? error.errors.map((cause) =>
                cause instanceof Error ? cause.message : '',
              )
            : [],
        sent: session.sent.length,
      }).toStrictEqual({
        aggregate: true,
        causes: ['summarizer crashed after rewriting history', 'disk full'],
        sent: 0,
      });
    });
  });

  describe('compressAndRecompose: provider compression callback', () => {
    it('fails with the context error and the original history intact instead of returning the failed compression', async () => {
      const session = conversation.session();
      await conversation.seedImages(3);
      conversation.seedBigText();
      session.useCompression(crashAfterPartialRewrite);
      const before = JSON.stringify(session.history.getAll());

      const error = await rejection(
        session.recomposeViaCallback([textTurn('next question')]),
      );

      expect({
        contextOverflow: error instanceof ContextOverflowError,
        historyRestored: JSON.stringify(session.history.getAll()) === before,
      }).toStrictEqual({ contextOverflow: true, historyRestored: true });
    });
  });
});
