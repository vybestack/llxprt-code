/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round (T4): the context guard's fixed overhead (tool
 * schemas, system prompt) is calibrated once, from the request the guard
 * measured. A relieved request is then held to the guard's limit with that
 * same overhead, so the tokens saved by retiring images are never mistaken
 * for fixed overhead. Real LocalMediaStore, HistoryService,
 * ProviderContentEnforcer and AnthropicProvider projection; only HTTP is
 * stubbed.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ContextOverflowError } from '../contextOverflowError.js';
import { MODEL, rejection } from './image-retirement-harness.js';
import { textTurn, useReliefConversation } from './media-relief-fixtures.js';

const FIXED_OVERHEAD = 100;

describe('guard overhead calibration across media relief (issue #4000 CodeRabbit T4)', () => {
  const conversation = useReliefConversation('llxprt-issue4000-cr-t4-');

  async function measure(): Promise<{
    original: IContent[];
    pending: IContent[];
    originalTokens: number;
    relievedTokens: number;
  }> {
    const session = conversation.session();
    await conversation.seedImages(3);
    const pending = [textTurn('next question')];
    const original = await session.compose(pending);
    const relieved = await session.recomposeViaCallback(pending);
    return {
      original,
      pending,
      originalTokens: await session.history.estimateTokensForContents(
        original,
        MODEL,
      ),
      relievedTokens: await session.history.estimateTokensForContents(
        relieved,
        MODEL,
      ),
    };
  }

  it('returns a relieved request that fits the guard instead of rejecting it', async () => {
    const { original, pending, originalTokens, relievedTokens } =
      await measure();
    expect(originalTokens).toBeGreaterThan(relievedTokens + 2 * FIXED_OVERHEAD);
    const guard = {
      estimatedTokens: originalTokens + FIXED_OVERHEAD,
      contextLimit: originalTokens + FIXED_OVERHEAD - 1,
    };

    const contents = await conversation
      .session()
      .recomposeViaCallback(pending, guard, original);

    expect(
      contents.some((content) =>
        content.blocks.some((block) => block.type === 'media'),
      ),
    ).toBe(false);
  });

  it('still rejects a relieved request that does not fit the guard with its overhead', async () => {
    const { original, pending, relievedTokens, originalTokens } =
      await measure();
    const guard = {
      estimatedTokens: originalTokens + FIXED_OVERHEAD,
      contextLimit: relievedTokens + FIXED_OVERHEAD - 1,
    };

    const error = await rejection(
      conversation.session().recomposeViaCallback(pending, guard, original),
    );

    expect(error instanceof ContextOverflowError).toBe(true);
  });
});
