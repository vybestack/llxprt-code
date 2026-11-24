/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SendRequestState } from './sendRequestState.js';

describe('SendRequestState answer marker', () => {
  it('is unanswered until an attempt publishes its answer', () => {
    expect(new SendRequestState().hasAnswerInHistory()).toBe(false);
  });

  it('is cleared when the attempt that published the answer revokes it', () => {
    const state = new SendRequestState();
    const attempt = {};

    state.markAnswerPublished(attempt);
    state.markAnswerRevoked(attempt);

    expect(state.hasAnswerInHistory()).toBe(false);
  });

  it('keeps the answer of a later attempt when an earlier, abandoned attempt revokes late', () => {
    const state = new SendRequestState();
    const abandoned = {};
    const replacement = {};

    state.markAnswerPublished(abandoned);
    state.markAnswerPublished(replacement);
    state.markAnswerRevoked(abandoned);

    expect(state.hasAnswerInHistory()).toBe(true);
  });

  it('ignores a revocation from an attempt that never published', () => {
    const state = new SendRequestState();
    const publisher = {};

    state.markAnswerPublished(publisher);
    state.markAnswerRevoked({});

    expect(state.hasAnswerInHistory()).toBe(true);
  });
});
