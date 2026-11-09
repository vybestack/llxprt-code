/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round 3 (R3): restoring a rejected fallback
 * truncation removes the rejected candidate but keeps every entry another
 * writer committed while the fallback ran, whether the entry landed before
 * the candidate replaced the history (and was removed by it) or after.
 *
 * Real LocalMediaStore, HistoryService (its real mutation queue),
 * ProviderContentEnforcer, production send seam and AnthropicProvider
 * projection; only HTTP is stubbed.
 */

import { describe, expect, it } from 'bun:test';
import { ContextOverflowError } from '../contextOverflowError.js';
import { aiTurn, rejection } from './image-retirement-harness.js';
import {
  historyTexts,
  textTurn,
  useReliefConversation,
} from './media-relief-fixtures.js';

const CANDIDATE = 'REJECTED TRUNCATION CANDIDATE';
const BEFORE_CANDIDATE = 'ENTRY COMMITTED BEFORE THE CANDIDATE WAS INSTALLED';
const AFTER_CANDIDATE = 'ENTRY COMMITTED AFTER THE CANDIDATE WAS INSTALLED';

describe('rejected fallback truncation keeps other writers entries (issue #4000 CodeRabbit round 3 R3)', () => {
  const conversation = useReliefConversation('llxprt-issue4000-cr3-r3-');

  it('restores the snapshot, drops the candidate and keeps both independent entries', async () => {
    const session = conversation.session();
    await conversation.seedImages(3);
    conversation.seedBigText();
    const before = historyTexts(session.history);
    session.useCompression(() => Promise.reject(new Error('summarizer down')));
    session.useFallback(async (history, applyResult) => {
      await history.addBatch([aiTurn(BEFORE_CANDIDATE)]);
      await applyResult([aiTurn(CANDIDATE)]);
      await history.addBatch([aiTurn(AFTER_CANDIDATE)]);
      return false;
    });

    const error = await rejection(session.send([textTurn('next question')]));

    expect({
      contextOverflow: error instanceof ContextOverflowError,
      history: historyTexts(session.history),
    }).toStrictEqual({
      contextOverflow: true,
      history: [...before, BEFORE_CANDIDATE, AFTER_CANDIDATE],
    });
  });

  it('restores the snapshot exactly when no one else wrote', async () => {
    const session = conversation.session();
    await conversation.seedImages(3);
    conversation.seedBigText();
    const before = JSON.stringify(session.history.getAll());
    session.useCompression(() => Promise.reject(new Error('summarizer down')));
    session.useFallback(async (_history, applyResult) => {
      await applyResult([aiTurn(CANDIDATE)]);
      return false;
    });

    const error = await rejection(session.send([textTurn('next question')]));

    expect({
      contextOverflow: error instanceof ContextOverflowError,
      historyRestored: JSON.stringify(session.history.getAll()) === before,
    }).toStrictEqual({ contextOverflow: true, historyRestored: true });
  });
});
