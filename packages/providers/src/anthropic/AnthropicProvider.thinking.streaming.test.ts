/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for AnthropicProvider extended thinking real-time streaming (issue #1723).
 *
 * Verifies that thinking_delta events emit incremental IContent chunks during
 * streaming (not just at content_block_stop), enabling real-time UI rendering.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  IContent,
  ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  mockMessagesCreate,
  setupThinkingProvider,
  type ThinkingTestSetup,
} from './test-utils/anthropicThinkingTestSetup.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

describe('AnthropicProvider Extended Thinking Streaming (issue #1723)', () => {
  let provider: ThinkingTestSetup['provider'];
  let settingsService: ThinkingTestSetup['settingsService'];
  let buildCallOptions: ThinkingTestSetup['buildCallOptions'];

  beforeEach(() => {
    vi.clearAllMocks();
    const setup = setupThinkingProvider();
    provider = setup.provider;
    settingsService = setup.settingsService;
    buildCallOptions = setup.buildCallOptions;
    settingsService.setProviderSetting('anthropic', 'streaming', 'enabled');
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('should emit thinking deltas during streaming, not just at content_block_stop', async () => {
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'First' },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: ' part' },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: ' here' },
        };
        yield { type: 'content_block_stop', index: 0 };
      },
    };

    mockMessagesCreate.mockResolvedValue(mockStream);

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Think deeply' }],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );

    const chunks: IContent[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    const thinkingChunks = chunks.filter((c) =>
      c.blocks.some((b) => b.type === 'thinking'),
    );

    // 3 deltas + 1 content_block_stop = 4 thinking chunks
    expect(thinkingChunks.length).toBe(4);

    const delta1 = thinkingChunks[0].blocks.find(
      (b) => b.type === 'thinking',
    ) as ThinkingBlock;
    expect(delta1.thought).toBe('First');

    const delta2 = thinkingChunks[1].blocks.find(
      (b) => b.type === 'thinking',
    ) as ThinkingBlock;
    expect(delta2.thought).toBe('First part');

    const delta3 = thinkingChunks[2].blocks.find(
      (b) => b.type === 'thinking',
    ) as ThinkingBlock;
    expect(delta3.thought).toBe('First part here');

    const final = thinkingChunks[3].blocks.find(
      (b) => b.type === 'thinking',
    ) as ThinkingBlock;
    expect(final.thought).toBe('First part here');
  });

  it('should emit thinking block at content_block_stop even with zero deltas', async () => {
    const mockSignature = 'redactedSig';
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        };
        yield {
          type: 'content_block_stop',
          index: 0,
          content_block: {
            type: 'thinking',
            thinking: '',
            signature: mockSignature,
          },
        };
      },
    };

    mockMessagesCreate.mockResolvedValue(mockStream);

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Test' }],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );

    const chunks: IContent[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    const thinkingChunks = chunks.filter((c) =>
      c.blocks.some((b) => b.type === 'thinking'),
    );

    expect(thinkingChunks.length).toBe(1);
    const thinkingBlock = thinkingChunks[0].blocks.find(
      (b) => b.type === 'thinking',
    ) as ThinkingBlock;
    expect(thinkingBlock.signature).toBe(mockSignature);
  });

  it('should stream interleaved text and thinking deltas independently', async () => {
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Thinking part 1' },
        };
        yield { type: 'content_block_stop', index: 0 };
        yield {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: '' },
        };
        yield {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'Hello ' },
        };
        yield {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'world' },
        };
        yield { type: 'content_block_stop', index: 1 };
      },
    };

    mockMessagesCreate.mockResolvedValue(mockStream);

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hi' }],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );

    const chunks: IContent[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    const thinkingChunks = chunks.filter((c) =>
      c.blocks.some((b) => b.type === 'thinking'),
    );
    const textChunks = chunks.filter((c) =>
      c.blocks.some((b) => b.type === 'text'),
    );

    expect(thinkingChunks.length).toBe(2);
    expect(textChunks.length).toBe(2);
    expect(textChunks[0].blocks[0]).toMatchObject({ text: 'Hello ' });
    expect(textChunks[1].blocks[0]).toMatchObject({ text: 'world' });
  });
});
