/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round 2 (A): when the guard's fixed overhead leaves
 * no room at all (overhead >= the guard's context limit), nothing can fit. The
 * callback must reject with the context overflow error and never return a
 * candidate the guard's own check (ownEstimate + overhead <= contextLimit)
 * would refuse. The token estimator reports one token for the tiny request,
 * the smallest estimate a non-empty request can have. Real LocalMediaStore,
 * HistoryService, ProviderContentEnforcer and AnthropicProvider projection;
 * only HTTP and the tokenizer are stubbed.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ContextOverflowError } from '../contextOverflowError.js';
import { rejection } from './image-retirement-harness.js';
import { textTurn, useReliefConversation } from './media-relief-fixtures.js';

const OVERHEAD = 5_000;
const ONE_TOKEN = (_contents: IContent[]): Promise<number> =>
  Promise.resolve(1);

describe('guard overhead that consumes the whole context limit (issue #4000 CodeRabbit A)', () => {
  const conversation = useReliefConversation('llxprt-issue4000-cr-a-');

  it('rejects with a context overflow instead of returning a candidate that cannot fit', async () => {
    const session = conversation.session();
    const pending = [textTurn('hello')];
    const original = session.compose(pending);
    const guard = {
      estimatedTokens: 1 + OVERHEAD,
      contextLimit: OVERHEAD,
    };

    const error = await rejection(
      session.recomposeViaCallback(pending, guard, original, ONE_TOKEN),
    );

    expect(error instanceof ContextOverflowError).toBe(true);
  });

  it('returns a candidate that fits exactly in the room the overhead leaves', async () => {
    const session = conversation.session();
    const pending = [textTurn('hello')];
    const original = session.compose(pending);
    const guard = {
      estimatedTokens: 1 + OVERHEAD,
      contextLimit: OVERHEAD + 1,
    };

    const contents = await session.recomposeViaCallback(
      pending,
      guard,
      original,
      ONE_TOKEN,
    );

    expect(contents.length).toBe(original.length);
  });
});
