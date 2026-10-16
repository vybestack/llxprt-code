/// <reference lib="esnext.array" />
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #1150: Anthropic thinking blocks must be attached to tool call messages
 *
 * Behavioral tests for thinking/tool-call co-location in ChatSession history.
 * REPRO/root-cause scenarios live in chatSession.thinking-toolcalls.repro.test.ts.
 */

import { describe, it, expect } from 'bun:test';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import {
  createFixture,
  createChat,
  exhaustStream,
  separatedThinkingAndTools,
  signedThinkingAndTool,
} from './__tests__/chatSession-thinking-toolcalls-helpers.js';

describe('Issue #1150: Thinking blocks must be attached to tool call messages', () => {
  it('should combine thinking block with subsequent tool calls in same history entry when yielded separately', async () => {
    const calls: GenerateChatOptions[] = [];
    const { chat, historyService } = createChat(
      createFixture(),
      separatedThinkingAndTools(calls),
      'runtime-issue1150',
    );
    await exhaustStream(
      chat,
      'Make some tool calls while thinking',
      'prompt-issue1150',
    );

    const curated = await Array.fromAsync(
      historyService.getCuratedForProviderStream(),
    );

    // Find the AI message that has tool calls
    const aiMessageWithToolCalls = curated.find(
      (content) =>
        content.speaker === 'ai' &&
        content.blocks.some((block) => block.type === 'tool_call'),
    );

    expect(aiMessageWithToolCalls).toBeDefined();

    // THE KEY ASSERTION: The thinking block MUST be in the SAME message as the tool calls
    const hasThinkingBlock = aiMessageWithToolCalls?.blocks.some(
      (block) => block.type === 'thinking',
    );

    expect(hasThinkingBlock).toBe(true);

    // Verify thinking block comes BEFORE tool calls (order matters for Anthropic)
    const thinkingIndex = aiMessageWithToolCalls?.blocks.findIndex(
      (block) => block.type === 'thinking',
    );
    const firstToolCallIndex = aiMessageWithToolCalls?.blocks.findIndex(
      (block) => block.type === 'tool_call',
    );

    expect(thinkingIndex).toBeLessThan(firstToolCallIndex!);
  });

  it('should preserve thinking signature when combining with tool calls', async () => {
    const calls: GenerateChatOptions[] = [];
    const testSignature = 'anthropic-thinking-signature-xyz789';
    const { chat, historyService } = createChat(
      createFixture(),
      signedThinkingAndTool(calls, testSignature),
      'runtime-issue1150-sig',
    );
    await exhaustStream(chat, 'Find typescript files', 'prompt-sig-test');

    const curated = await Array.fromAsync(
      historyService.getCuratedForProviderStream(),
    );
    const aiMessage = curated.find(
      (content) =>
        content.speaker === 'ai' &&
        content.blocks.some((block) => block.type === 'tool_call'),
    );

    const thinkingBlock = aiMessage?.blocks.find(
      (block) => block.type === 'thinking',
    );

    expect(thinkingBlock).toBeDefined();
    expect(thinkingBlock?.signature).toBe(testSignature);
  });
});
