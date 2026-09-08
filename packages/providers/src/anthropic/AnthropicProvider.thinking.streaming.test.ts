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

import { vi, describe, it, expect, beforeEach, afterEach } from 'bun:test';
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

function findThinkingBlock(chunk: IContent): ThinkingBlock {
  const block = chunk.blocks.find(
    (contentBlock): contentBlock is ThinkingBlock =>
      contentBlock.type === 'thinking',
  );
  if (block === undefined) {
    throw new Error('Expected chunk to contain a thinking block');
  }
  return block;
}

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

        yield { type: 'message_stop' };
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

    const thinkingBlocks = thinkingChunks.map(findThinkingBlock);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'First',
      'First part',
      'First part here',
      'First part here',
    ]);
    // Within one thinking block every delta plus the final complete emission
    // must collapse onto ONE stream id (acceptance criterion 2).
    const streamIds = thinkingBlocks.map((block) => block.streamId);
    expect(new Set(streamIds).size).toBe(1);
    expect(streamIds[0]?.startsWith('anthropic-thinking:')).toBe(true);
    expect(thinkingBlocks.map((block) => block.streamStatus)).toStrictEqual([
      'delta',
      'delta',
      'delta',
      'complete',
    ]);
    expect(thinkingBlocks.every((block) => block.isHidden !== true)).toBe(true);
    // No signature_delta in this stream, so the final chunk carries no signature.
    expect(thinkingBlocks[3].signature).toBeUndefined();
  });

  it('should attach signature to accumulated thinking at content_block_stop @issue:1723', async () => {
    const mockSignature = 'sig-accumulated-123';
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
          delta: { type: 'thinking_delta', thinking: 'Analyzing' },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: ' the data' },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: mockSignature },
        };
        yield { type: 'content_block_stop', index: 0 };

        yield { type: 'message_stop' };
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

    // 2 deltas + 1 content_block_stop = 3 thinking chunks
    expect(thinkingChunks.length).toBe(3);

    const delta1 = findThinkingBlock(thinkingChunks[0]);
    expect(delta1.thought).toBe('Analyzing');

    const delta2 = findThinkingBlock(thinkingChunks[1]);
    expect(delta2.thought).toBe('Analyzing the data');

    const final = findThinkingBlock(thinkingChunks[2]);
    // The final chunk carries both the accumulated text AND the signature.
    expect(final.thought).toBe('Analyzing the data');
    expect(final.signature).toBe(mockSignature);
  });

  it('should keep sequential signed thinking blocks distinct when Anthropic reuses a content index', async () => {
    const firstSignature = 'sig-first-block';
    const secondSignature = 'sig-second-block';
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
          delta: { type: 'thinking_delta', thinking: 'First signed thought' },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: firstSignature },
        };
        yield { type: 'content_block_stop', index: 0 };
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Second signed thought' },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: secondSignature },
        };
        yield { type: 'content_block_stop', index: 0 };

        yield { type: 'message_stop' };
      },
    };

    mockMessagesCreate.mockResolvedValue(mockStream);

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Think twice' }],
      },
    ];

    const chunks: IContent[] = [];
    for await (const chunk of provider.generateChatCompletion(
      buildCallOptions(messages),
    )) {
      chunks.push(chunk);
    }

    const thinkingBlocks: ThinkingBlock[] = chunks.flatMap((chunk) =>
      chunk.blocks.filter(
        (block): block is ThinkingBlock => block.type === 'thinking',
      ),
    );
    const completedBlocks = thinkingBlocks.filter(
      (block) => block.streamStatus === 'complete',
    );

    expect(thinkingBlocks).toHaveLength(4);
    expect(completedBlocks).toHaveLength(2);
    expect(completedBlocks.map((block) => block.thought)).toStrictEqual([
      'First signed thought',
      'Second signed thought',
    ]);
    expect(completedBlocks.map((block) => block.signature)).toStrictEqual([
      firstSignature,
      secondSignature,
    ]);
    expect(new Set(completedBlocks.map((block) => block.streamId)).size).toBe(
      2,
    );
    // The two thinking blocks share the same source index (Anthropic reused 0)
    // but must still carry distinct stream ids. Deltas + complete for each
    // block collapse onto that block's single id.
    expect(thinkingBlocks.map((block) => block.streamId)).toStrictEqual([
      completedBlocks[0].streamId,
      completedBlocks[0].streamId,
      completedBlocks[1].streamId,
      completedBlocks[1].streamId,
    ]);
    expect(completedBlocks[0].streamId).not.toBe(completedBlocks[1].streamId);
    expect(
      completedBlocks.every(
        (block) => block.streamId?.startsWith('anthropic-thinking:') === true,
      ),
    ).toBe(true);
  });

  it('should hide streaming thinking chunks when reasoning.includeInResponse is false', async () => {
    settingsService.set('reasoning.includeInResponse', false);
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
          delta: { type: 'thinking_delta', thinking: 'Hidden' },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: ' reasoning' },
        };
        yield { type: 'content_block_stop', index: 0 };

        yield { type: 'message_stop' };
      },
    };

    mockMessagesCreate.mockResolvedValue(mockStream);

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Think privately' }],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );

    const chunks: IContent[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    const thinkingBlocks: ThinkingBlock[] = chunks.flatMap((chunk) =>
      chunk.blocks.filter(
        (block): block is ThinkingBlock => block.type === 'thinking',
      ),
    );

    expect(thinkingBlocks).toHaveLength(3);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'Hidden',
      'Hidden reasoning',
      'Hidden reasoning',
    ]);
    expect(thinkingBlocks.every((block) => block.isHidden === true)).toBe(true);
    expect(thinkingBlocks.map((block) => block.streamStatus)).toStrictEqual([
      'delta',
      'delta',
      'complete',
    ]);
  });

  it('should hide redacted streaming thinking when reasoning.includeInResponse is false', async () => {
    settingsService.set('reasoning.includeInResponse', false);
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'redacted_thinking',
            data: 'encrypted-reasoning',
          },
        };

        yield { type: 'message_stop' };
      },
    };

    mockMessagesCreate.mockResolvedValue(mockStream);

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Think privately' }],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );

    const chunks: IContent[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    const thinkingBlocks = chunks.flatMap((chunk) =>
      chunk.blocks.filter(
        (block): block is ThinkingBlock => block.type === 'thinking',
      ),
    );

    expect(thinkingBlocks).toHaveLength(1);
    expect(thinkingBlocks[0]).toMatchObject({
      thought: '[redacted]',
      signature: 'encrypted-reasoning',
      isHidden: true,
      streamStatus: 'complete',
    });
    expect(thinkingBlocks[0].streamId?.startsWith('anthropic-thinking:')).toBe(
      true,
    );
  });

  it('should not emit thinking chunks for empty thinking deltas or zero-length final text', async () => {
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
          delta: { type: 'thinking_delta', thinking: '' },
        };
        yield { type: 'content_block_stop', index: 0 };

        yield { type: 'message_stop' };
      },
    };

    mockMessagesCreate.mockResolvedValue(mockStream);

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Think if needed' }],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );

    const chunks: IContent[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(
      chunks.some((chunk) =>
        chunk.blocks.some((block) => block.type === 'thinking'),
      ),
    ).toBe(false);
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
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: mockSignature },
        };
        yield { type: 'content_block_stop', index: 0 };

        yield { type: 'message_stop' };
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
    const thinkingBlock = findThinkingBlock(thinkingChunks[0]);
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

        yield { type: 'message_stop' };
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

    // Verify thinking content accumulated correctly
    const thinkingDelta = findThinkingBlock(thinkingChunks[0]);
    expect(thinkingDelta.thought).toBe('Thinking part 1');

    const finalThinking = findThinkingBlock(thinkingChunks[1]);
    expect(finalThinking.thought).toBe('Thinking part 1');

    // Verify text content (use find for robustness against future block-packing changes)
    expect(textChunks[0].blocks.find((b) => b.type === 'text')).toMatchObject({
      text: 'Hello ',
    });
    expect(textChunks[1].blocks.find((b) => b.type === 'text')).toMatchObject({
      text: 'world',
    });
  });

  it('produces distinct thinking stream ids across consecutive API calls (issue #3128)', async () => {
    // Each generateChatCompletion call drives one Anthropic API call. A user
    // turn spans many such calls, and the UI ref that consumes these ids
    // lives for the whole turn, so ids must be unique across calls.
    const buildThinkingStream = (thought: string, signature: string) => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: thought },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature },
        };
        yield { type: 'content_block_stop', index: 0 };

        yield { type: 'message_stop' };
      },
    });

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Think twice' }],
      },
    ];

    const collectThinking = async (
      thought: string,
      signature: string,
    ): Promise<ThinkingBlock[]> => {
      mockMessagesCreate.mockResolvedValue(
        buildThinkingStream(thought, signature),
      );
      const chunks: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(
        buildCallOptions(messages),
      )) {
        chunks.push(chunk);
      }
      return chunks.flatMap((chunk) =>
        chunk.blocks.filter(
          (block): block is ThinkingBlock => block.type === 'thinking',
        ),
      );
    };

    const firstCallBlocks = await collectThinking(
      'Reasoning from the first iteration',
      'sig-first',
    );
    const secondCallBlocks = await collectThinking(
      'Reasoning from the second iteration',
      'sig-second',
    );

    // Within each call, the single delta + the final complete share one id.
    expect(new Set(firstCallBlocks.map((b) => b.streamId)).size).toBe(1);
    expect(new Set(secondCallBlocks.map((b) => b.streamId)).size).toBe(1);

    const firstId = firstCallBlocks[0].streamId;
    const secondId = secondCallBlocks[0].streamId;

    // Cross-call: the two iterations must NOT reuse the same id. This is the
    // core regression — previously every call produced block-0 and the second
    // iteration silently overwrote the first in the transcript.
    expect(firstId).not.toBe(secondId);

    // Cross-session safety: freshly generated ids must never equal the legacy
    // format (`anthropic-thinking:0:block-0`) that a resumed session's
    // persisted history would carry.
    for (const id of [firstId, secondId]) {
      expect(id).not.toBe('anthropic-thinking:0:block-0');
      expect(id?.startsWith('anthropic-thinking:')).toBe(true);
    }
  });
});
