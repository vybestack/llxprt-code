/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round (T5): cancellation during a compression that
 * runs after media relief must surface as the abort. It is never a failed
 * compression that lets truncation or the context overflow error take over.
 * Real LocalMediaStore, HistoryService, ProviderContentEnforcer, production
 * send seam and AnthropicProvider projection; only HTTP is stubbed.
 */

import { describe, expect, it } from 'bun:test';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { aiTurn, rejection } from './image-retirement-harness.js';
import { textTurn, useReliefConversation } from './media-relief-fixtures.js';

const PARTIAL = 'PARTIAL SUMMARY FROM CANCELLED COMPRESSION';

async function cancelAfterPartialRewrite(
  history: HistoryService,
): Promise<never> {
  await history.replaceAll([aiTurn(PARTIAL)]);
  throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

describe('cancellation during compression after media relief (issue #4000 CodeRabbit T5)', () => {
  const conversation = useReliefConversation('llxprt-issue4000-cr-t5-');

  it('enforce: the escalation ladder propagates the abort and leaves history as it was', async () => {
    const session = conversation.session();
    await conversation.seedImages(3);
    conversation.seedBigText();
    let runs = 0;
    session.useCompression(async (history) => {
      runs += 1;
      if (runs === 1) throw new Error('summarizer offline on the byte pass');
      return cancelAfterPartialRewrite(history);
    });
    const before = JSON.stringify(session.history.getAll());

    const error = await rejection(session.send([textTurn('next question')]));

    expect({
      name: errorName(error),
      sent: session.sent.length,
      historyRestored: JSON.stringify(session.history.getAll()) === before,
    }).toStrictEqual({ name: 'AbortError', sent: 0, historyRestored: true });
  });

  it('enforce: the ineffective-compression retry propagates the abort and leaves history as it was', async () => {
    const session = conversation.session();
    await conversation.seedImages(3);
    conversation.seedBigText();
    let runs = 0;
    session.useCompression(async (history) => {
      runs += 1;
      if (runs === 1) throw new Error('summarizer offline on the byte pass');
      if (runs === 2) return undefined;
      return cancelAfterPartialRewrite(history);
    });
    const before = JSON.stringify(session.history.getAll());

    const error = await rejection(session.send([textTurn('next question')]));

    expect({
      name: errorName(error),
      compressionRuns: session.compressionRuns,
      sent: session.sent.length,
      historyRestored: JSON.stringify(session.history.getAll()) === before,
    }).toStrictEqual({
      name: 'AbortError',
      compressionRuns: 3,
      sent: 0,
      historyRestored: true,
    });
  });

  it('compressAndRecompose: the post-relief continuation propagates the abort and leaves history as it was', async () => {
    const session = conversation.session();
    await conversation.seedImages(3);
    conversation.seedBigText();
    session.useCompression(cancelAfterPartialRewrite);
    const before = JSON.stringify(session.history.getAll());

    const error = await rejection(
      session.recomposeViaCallback([textTurn('next question')]),
    );

    expect({
      name: errorName(error),
      historyRestored: JSON.stringify(session.history.getAll()) === before,
    }).toStrictEqual({ name: 'AbortError', historyRestored: true });
  });

  it('compressAndRecompose: the first ladder, without relief, propagates the abort', async () => {
    const session = conversation.session();
    conversation.seedBigText();
    session.useCompression(cancelAfterPartialRewrite);
    const before = JSON.stringify(session.history.getAll());

    const error = await rejection(
      session.recomposeViaCallback([textTurn('next question')]),
    );

    expect({
      name: errorName(error),
      historyRestored: JSON.stringify(session.history.getAll()) === before,
    }).toStrictEqual({ name: 'AbortError', historyRestored: true });
  });
});
