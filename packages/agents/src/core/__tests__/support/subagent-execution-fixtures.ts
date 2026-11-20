/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import type { ChatSession } from '../../chatSession.js';
import type { executeToolCall } from '../../nonInteractiveToolExecutor.js';
import type { createCompletedToolCallResponse } from '../subagent-test-helpers.js';

export function messageBlocks(
  message:
    | Parameters<ChatSession['sendMessageStream']>[0]['message']
    | undefined,
): ContentBlock[] {
  if (!Array.isArray(message))
    throw new Error('Expected subagent content blocks');
  const blocks: ContentBlock[] = [];
  for (const block of message) {
    if (!('type' in block))
      throw new Error('Expected a content block, not a history row');
    blocks.push(block);
  }
  return blocks;
}

export function completeToolFixture(
  value: ReturnType<typeof createCompletedToolCallResponse>,
): Awaited<ReturnType<typeof executeToolCall>> {
  const response = { ...value.response, resultDisplay: undefined };
  if (value.status === 'error') return { ...value, status: 'error', response };
  const tool = new MockTool('mock_tool');
  return {
    ...value,
    status: 'success',
    response,
    tool,
    invocation: tool.build({}),
  };
}
