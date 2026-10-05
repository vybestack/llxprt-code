/// <reference lib="esnext.array" />
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  createFixture,
  createChat,
  exhaustStream,
  separatelyYieldedThinkingAndTool,
} from './__tests__/chatSession-thinking-toolcalls-helpers.js';

describe('Issue #1150: Thinking blocks must be attached to tool call messages', () => {
  it('should NOT create separate history entries for thinking and tool calls', async () => {
    const { chat, historyService } = createChat(
      createFixture(),
      separatelyYieldedThinkingAndTool(),
      'runtime-issue1150-separate',
    );
    await exhaustStream(chat, 'Search for something', 'prompt-separate-test');

    const curated = await Array.fromAsync(
      historyService.getCuratedForProviderStream(),
    );

    // Count AI messages - there should be only ONE that contains both thinking and tool_call
    const aiMessages = curated.filter((c) => c.speaker === 'ai');

    const messagesWithBoth = aiMessages.filter(
      (msg) =>
        msg.blocks.some((b) => b.type === 'thinking') &&
        msg.blocks.some((b) => b.type === 'tool_call'),
    );

    expect(messagesWithBoth.length).toBe(1);

    // There should NOT be a separate thinking-only AI message
    const thinkingOnlyMessages = aiMessages.filter(
      (msg) =>
        msg.blocks.some((b) => b.type === 'thinking') &&
        !msg.blocks.some((b) => b.type === 'tool_call'),
    );

    expect(thinkingOnlyMessages.length).toBe(0);
  });
});
