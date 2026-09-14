/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { computeStatefulConversation } from './openAIResponsesStateful.js';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

function options(): NormalizedGenerateChatOptions {
  return {
    invocation: {
      getModelBehavior: () => undefined,
    },
  } as unknown as NormalizedGenerateChatOptions;
}

function historyWithStoredParent(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'first question' }],
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'first answer' }],
      metadata: {
        id: 'resp_stored',
        responsesStored: true,
        providerBaseURL: CODEX_BASE_URL,
      },
    },
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'second question' }],
    },
  ];
}

function textOf(content: IContent[]): string {
  return content
    .flatMap((message) => message.blocks)
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

const logger = { debug: vi.fn() } as unknown as DebugLogger;

describe('computeStatefulConversation forceParentless @issue:3446', () => {
  it('skips the parent scan and returns full content with statefulness enabled when an eligible parent exists', () => {
    const result = computeStatefulConversation(
      options(),
      historyWithStoredParent(),
      {},
      undefined,
      /* isCodex */ true,
      CODEX_BASE_URL,
      () => false,
      /* statefulTransportSupported */ true,
      logger,
      /* forceParentless */ true,
    );

    expect(result.enabled).toBe(true);
    expect(result.parentId).toBeUndefined();
    // Full history, not trimmed to the post-parent turns.
    expect(textOf(result.content)).toContain('first question');
    expect(textOf(result.content)).toContain('first answer');
    expect(textOf(result.content)).toContain('second question');
  });

  it('returns the normal trimmed shape without forceParentless', () => {
    const result = computeStatefulConversation(
      options(),
      historyWithStoredParent(),
      {},
      undefined,
      /* isCodex */ true,
      CODEX_BASE_URL,
      () => false,
      /* statefulTransportSupported */ true,
      logger,
    );

    expect(result.enabled).toBe(true);
    expect(result.parentId).toBe('resp_stored');
    expect(textOf(result.content)).not.toContain('first question');
    expect(textOf(result.content)).toContain('second question');
  });

  it('stays disabled when the transport cannot carry statefulness, even with forceParentless', () => {
    const result = computeStatefulConversation(
      options(),
      historyWithStoredParent(),
      {},
      undefined,
      /* isCodex */ true,
      CODEX_BASE_URL,
      () => false,
      /* statefulTransportSupported */ false,
      logger,
      /* forceParentless */ true,
    );

    expect(result.enabled).toBe(false);
    expect(result.parentId).toBeUndefined();
    expect(textOf(result.content)).toContain('first question');
  });

  it('stays disabled when the user set store=false, even with forceParentless', () => {
    const result = computeStatefulConversation(
      options(),
      historyWithStoredParent(),
      {},
      /* explicitUserStore */ false,
      /* isCodex */ true,
      CODEX_BASE_URL,
      () => false,
      /* statefulTransportSupported */ true,
      logger,
      /* forceParentless */ true,
    );

    expect(result.enabled).toBe(false);
    expect(result.parentId).toBeUndefined();
  });
});
