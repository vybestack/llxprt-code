/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 review round 3 (H3): when retirement rewrites the request, a
 * stored OpenAI Responses parent anywhere in the rejoined request, pending
 * tail included, describes server-side state that still holds the original
 * pixels. The real computeStatefulConversation must therefore find no parent
 * and keep every retirement note. Real LocalMediaStore, HistoryService,
 * ProviderContentEnforcer and AnthropicProvider projection; only HTTP is
 * stubbed.
 */

import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { computeStatefulConversation } from '../../../../providers/src/openai-responses/openAIResponsesStateful.js';
import { aiTurn } from './image-retirement-harness.js';
import {
  storedAiTurn,
  textTurn,
  useReliefConversation,
} from './media-relief-fixtures.js';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const STALE_PARENT = 'resp_stale_pending_tail';

function tailWithStoredParent(): IContent[] {
  return [
    textTurn('tail question'),
    storedAiTurn('tail answer', STALE_PARENT),
    textTurn('after the stored answer'),
  ];
}

function providerView(contents: IContent[]): {
  parentId: string | undefined;
  noteCount: number;
  storedEntries: number;
} {
  const conversation = computeStatefulConversation(
    { invocation: { modelBehavior: {} } },
    contents,
    {},
    undefined,
    true,
    CODEX_BASE_URL,
    () => false,
    true,
    DebugLogger.getLogger('test:issue4000:responses-parent'),
  );
  return {
    parentId: conversation.parentId,
    noteCount: conversation.content
      .flatMap((content) => content.blocks)
      .filter(
        (block) =>
          block.type === 'text' &&
          block.text.includes('was omitted from this request'),
      ).length,
    storedEntries: contents.filter(
      (content) =>
        content.speaker === 'ai' && content.metadata?.responsesStored === true,
    ).length,
  };
}

describe('stored Responses parents in the pending tail after retire-all recomposition (issue #4000 review round 3)', () => {
  const conversation = useReliefConversation('llxprt-issue4000-r3-h3-');

  it('the compression callback result offers no stale parent and keeps all three retirement notes', async () => {
    const session = conversation.session();
    session.contextLimit = 1_000_000;
    await conversation.seedImages(3);

    const contents = await session.recomposeViaCallback(tailWithStoredParent());

    expect(providerView(contents)).toStrictEqual({
      parentId: undefined,
      noteCount: 3,
      storedEntries: 0,
    });
  });

  it('the enforced request offers no stale parent after a compression and keeps the retirement notes', async () => {
    const session = conversation.session();
    const images = await conversation.seedImages(3);
    conversation.seedBigText();
    let runs = 0;
    session.useCompression(async (history) => {
      runs += 1;
      if (runs === 1) throw new Error('summarizer offline on the byte pass');
      history.clear();
      history.add(aiTurn('short summary of the earlier conversation'));
      for (const image of images) {
        history.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'kept image' }, image.reference],
        });
      }
      await history.waitForTokenUpdates();
    });

    const { contents } = await session.send(tailWithStoredParent());

    expect(providerView(contents)).toStrictEqual({
      parentId: undefined,
      noteCount: 3,
      storedEntries: 0,
    });
  });

  it('keeps canonical history entries marked as stored', async () => {
    const session = conversation.session();
    session.contextLimit = 1_000_000;
    await conversation.seedImages(3);
    const stored = storedAiTurn('committed answer', 'resp_committed');
    session.history.add(stored);
    const pending = tailWithStoredParent();

    await session.recomposeViaCallback(pending);

    expect({
      canonicalHistoryStored: session.history
        .getAll()
        .filter((content) => content.metadata?.responsesStored === true)
        .map((content) => content.metadata?.id),
      pendingStored: pending[1].metadata?.responsesStored,
    }).toStrictEqual({
      canonicalHistoryStored: ['resp_committed'],
      pendingStored: true,
    });
  });
});
