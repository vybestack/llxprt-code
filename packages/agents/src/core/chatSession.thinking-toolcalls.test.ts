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
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
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

describe('thinking tool-call multi-turn journal', () => {
  it('should handle multiple tool calls with thinking block in multi-turn conversation', async () => {
    const requests: IContent[][] = [];
    const { chat, historyService } = createChat(
      createFixture(),
      async function* (options): AsyncGenerator<IContent> {
        requests.push(await Array.fromAsync(options.contents));
        if (requests.length > 1) {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Here are the results.' }],
          };
          return;
        }
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'First turn thinking',
              sourceField: 'thinking',
              signature: 'sig-turn-1',
            },
          ],
        };
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_turn1_001',
              name: 'list_directory',
              parameters: { path: '/tmp' },
            },
          ],
        };
      },
      'runtime-issue1150-multiturn',
    );
    await exhaustStream(chat, 'List the directory', 'prompt-turn1');
    historyService.add({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'hist_tool_turn1_001',
          toolName: 'list_directory',
          result: { output: 'file1.txt\nfile2.txt' },
        },
      ],
    });
    await exhaustStream(chat, 'What did you find?', 'prompt-turn2');
    expect(requests.length).toBe(2);
    const aiWithToolCall = requests[1].find(
      (row) =>
        row.speaker === 'ai' &&
        row.blocks.some((block) => block.type === 'tool_call'),
    );
    expect(aiWithToolCall).toBeDefined();
    expect(
      aiWithToolCall?.blocks.some((block) => block.type === 'thinking'),
    ).toBe(true);
    expect(
      aiWithToolCall?.blocks.find((block) => block.type === 'thinking')
        ?.signature,
    ).toBe('sig-turn-1');
  });

  it('should NOT create separate history entries for thinking and tool calls', async () => {
    const { chat, historyService } = createChat(
      createFixture(),
      async function* (): AsyncGenerator<IContent> {
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Thinking separately',
              sourceField: 'thinking',
              signature: 'sig-separate',
            },
          ],
        };
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_separate_001',
              name: 'search_file_content',
              parameters: { pattern: 'test' },
            },
          ],
        };
      },
      'runtime-issue1150-separate',
    );
    await exhaustStream(chat, 'Search for something', 'prompt-separate-test');
    const aiMessages = (
      await Array.fromAsync(historyService.getCuratedForProviderStream())
    ).filter((row) => row.speaker === 'ai');
    const combined = aiMessages.filter(
      (row) =>
        row.blocks.some((block) => block.type === 'thinking') &&
        row.blocks.some((block) => block.type === 'tool_call'),
    );
    const thinkingOnly = aiMessages.filter(
      (row) =>
        row.blocks.some((block) => block.type === 'thinking') &&
        !row.blocks.some((block) => block.type === 'tool_call'),
    );
    expect(combined.length).toBe(1);
    expect(thinkingOnly.length).toBe(0);
  });
});
