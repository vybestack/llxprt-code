/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createFixture,
  createChat,
  exhaustStream,
  multiTurnThinkingAndTool,
} from './__tests__/chatSession-thinking-toolcalls-helpers.js';

describe('Issue #1150: Thinking blocks must be attached to tool call messages', () => {
  it('should handle multiple tool calls with thinking block in multi-turn conversation', async () => {
    const calls: IContent[][] = [];
    const { chat, historyService } = createChat(
      createFixture(),
      multiTurnThinkingAndTool(calls),
      'runtime-issue1150-multiturn',
    );

    // First turn: user message -> thinking + tool calls
    await exhaustStream(chat, 'List the directory', 'prompt-turn1');

    // Simulate tool response being added to history
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

    // Second turn: continuation after tool response
    await exhaustStream(chat, 'What did you find?', 'prompt-turn2');

    // Check the second call's contents - it should have the AI message with thinking + tool_call
    expect(calls.length).toBe(2);
    const secondCallContents = calls[1];

    // Find the AI message with tool calls in the history sent to provider
    const aiWithToolCall = secondCallContents.find(
      (content) =>
        content.speaker === 'ai' &&
        content.blocks.some((block) => block.type === 'tool_call'),
    );

    expect(aiWithToolCall).toBeDefined();

    // The thinking block MUST be present in this message for Anthropic
    const hasThinking = aiWithToolCall?.blocks.some(
      (block) => block.type === 'thinking',
    );
    expect(hasThinking).toBe(true);
    expect(aiWithToolCall?.blocks).toStrictEqual([
      {
        type: 'thinking',
        thought: 'First turn thinking',
        sourceField: 'thinking',
        signature: 'sig-turn-1',
      },
      {
        type: 'tool_call',
        id: 'hist_tool_turn1_001',
        name: 'list_directory',
        parameters: { path: '/tmp' },
      },
    ]);
    expect(
      secondCallContents.find((content) => content.speaker === 'tool')?.blocks,
    ).toStrictEqual([
      {
        type: 'tool_response',
        callId: 'hist_tool_turn1_001',
        toolName: 'list_directory',
        result: { output: 'file1.txt\nfile2.txt' },
      },
    ]);
  });
});
