/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for issue #2329: Claude Fable 5 returns safety-classifier
 * refusals as a successful HTTP 200 with stop_reason: 'refusal'. The streaming
 * path (message_delta.stop_reason === 'refusal') must propagate the raw value
 * into IContent metadata.stopReason so downstream consumers can surface a
 * refusal-specific notice. The non-streaming path is covered in
 * AnthropicResponseParser.issue1844.test.ts.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  setupAnthropicProvider,
  type AnthropicTestSetup,
} from './test-utils/anthropicProviderTestSetup.js';

const mockMessagesCreate = vi.hoisted(() => vi.fn());

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(
    async () => "You are Claude Code, Anthropic's official CLI for Claude.",
  ),
}));

vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

describe('AnthropicProvider issue #2329 – streaming refusal propagation', () => {
  let provider: AnthropicTestSetup['provider'];
  let buildCallOptions: AnthropicTestSetup['buildCallOptions'];

  beforeEach(() => {
    vi.clearAllMocks();
    const setup = setupAnthropicProvider();
    provider = setup.provider;
    buildCallOptions = setup.buildCallOptions;
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('should propagate stopReason "refusal" from message_delta @issue:2329', async () => {
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'I cannot help with that.' },
        };
        yield {
          type: 'message_delta',
          delta: { stop_reason: 'refusal' },
        };
      },
    };

    mockMessagesCreate.mockResolvedValue(mockStream);

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'risky request' }],
      },
    ];
    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );

    const chunks = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    const refusalChunk = chunks.find(
      (c) => c.metadata?.stopReason === 'refusal',
    );
    expect(refusalChunk).toBeDefined();
    expect(refusalChunk?.metadata?.stopReason).toBe('refusal');
  });
});
