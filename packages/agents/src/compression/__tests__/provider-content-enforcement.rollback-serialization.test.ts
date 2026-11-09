/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round 2 (B, C): rolling back a failed compression
 * must never lose another writer's entry.
 *
 * B: an entry committed while the compression ran is kept even when the
 * compression's own partial rewrite (built from an older snapshot, applied
 * through replaceAll as in production) removed it.
 *
 * C: an entry already queued in the history's mutation FIFO when the rollback
 * starts is applied before the rollback reads history, so the rollback's
 * replace cannot drop it.
 *
 * Real LocalMediaStore, HistoryService (its real mutation queue),
 * ProviderContentEnforcer, production send seam and AnthropicProvider
 * projection; only HTTP is stubbed.
 */

import { describe, expect, it } from 'bun:test';
import { ContextOverflowError } from '../contextOverflowError.js';
import { aiTurn } from './image-retirement-harness.js';
import {
  historyTexts,
  textTurn,
  useReliefConversation,
} from './media-relief-fixtures.js';

const PARTIAL = 'PARTIAL SUMMARY FROM FAILED COMPRESSION';
const INDEPENDENT = 'ENTRY COMMITTED BY ANOTHER WRITER DURING COMPRESSION';
const CRASH = 'summarizer crashed after rewriting history';

/** The rejection of `work`, or undefined when it resolved. */
function outcomeOf(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('rollback of a failed compression keeps other writers entries (issue #4000 CodeRabbit round 2)', () => {
  const conversation = useReliefConversation('llxprt-issue4000-cr2-rollback-');

  it('keeps an addBatch entry that the failed rewrite removed (B)', async () => {
    const session = conversation.session();
    await conversation.seedImages(3);
    conversation.seedBigText();
    const before = historyTexts(session.history);
    let runs = 0;
    session.useCompression(async (history) => {
      runs += 1;
      if (runs === 1) await history.addBatch([aiTurn(INDEPENDENT)]);
      await history.replaceAll([aiTurn(PARTIAL)]);
      throw new Error(CRASH);
    });

    const error = await outcomeOf(session.send([textTurn('next question')]));

    expect({
      contextOverflow: error instanceof ContextOverflowError,
      history: historyTexts(session.history),
    }).toStrictEqual({
      contextOverflow: true,
      history: [...before, INDEPENDENT],
    });
  });

  it('keeps an addBatch that is still in flight when the compression fails (C)', async () => {
    const session = conversation.session();
    await conversation.seedImages(3);
    conversation.seedBigText();
    const before = historyTexts(session.history);
    let runs = 0;
    let inFlight: Promise<void> = Promise.resolve();
    session.useCompression(async (history) => {
      runs += 1;
      await history.replaceAll([aiTurn(PARTIAL)]);
      if (runs === 1) inFlight = history.addBatch([aiTurn(INDEPENDENT)]);
      throw new Error(CRASH);
    });

    const error = await outcomeOf(session.send([textTurn('next question')]));
    await inFlight;

    expect({
      contextOverflow: error instanceof ContextOverflowError,
      history: historyTexts(session.history),
    }).toStrictEqual({
      contextOverflow: true,
      history: [...before, INDEPENDENT],
    });
  });

  it('keeps an add queued behind an in-flight rewrite when the compression fails (C)', async () => {
    const session = conversation.session();
    await conversation.seedImages(3);
    conversation.seedBigText();
    const before = historyTexts(session.history);
    let runs = 0;
    let rewrite: Promise<void> = Promise.resolve();
    session.useCompression(async (history) => {
      runs += 1;
      if (runs === 1) {
        rewrite = history.replaceAll([aiTurn(PARTIAL)]);
        history.add(aiTurn(INDEPENDENT));
      }
      throw new Error(CRASH);
    });

    const error = await outcomeOf(session.send([textTurn('next question')]));
    await rewrite;

    expect({
      contextOverflow: error instanceof ContextOverflowError,
      history: historyTexts(session.history),
    }).toStrictEqual({
      contextOverflow: true,
      history: [...before, INDEPENDENT],
    });
  });
});
