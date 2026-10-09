/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, vi } from 'bun:test';
import type { ContentBlock } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AgentClient } from './client.js';
import type { ChatSession } from './chatSession.js';
import {
  make413Chat,
  enableFailedApiCallRetry,
} from './client-send-stream-test-helpers.js';
import { AgentEventType, PerformCompressionResult } from './turn.js';
import { fromAsync } from './__tests__/client-test-helpers.js';

export async function testToolNameRetry(
  client: AgentClient,
  mockTurnRunFn: ReturnType<typeof vi.fn>,
  payloadTooLargeStream: () => AsyncGenerator<{
    type: AgentEventType;
    value: { error: { message: string; status: number } };
  }>,
  retriedContentStream: () => AsyncGenerator<{
    type: AgentEventType;
    value: string;
  }>,
): Promise<void> {
  enableFailedApiCallRetry(client);
  // Arrange: first stream yields a 413 error, second yields content
  const mockStream1 = payloadTooLargeStream();
  const mockStream2 = retriedContentStream();

  mockTurnRunFn
    .mockReturnValueOnce(mockStream1)
    .mockReturnValueOnce(mockStream2);

  const mockChat = make413Chat();
  client['chat'] = mockChat as ChatSession;

  // Include tool_response blocks to test tool name extraction
  const initialRequest: ContentBlock[] = [
    { type: 'text', text: 'Hi' },
    {
      type: 'tool_response',
      callId: 'read_file',
      toolName: 'read_file',
      result: { content: 'large content...' },
    },
    {
      type: 'tool_response',
      callId: 'search_file',
      toolName: 'search_file',
      result: { content: 'more large content...' },
    },
  ];
  const promptId = 'prompt-id-413-retry';
  const signal = new AbortController().signal;

  // Act
  const stream = client.sendMessageStream(initialRequest, signal, promptId);
  const events = await fromAsync(stream);

  // Assert: model_info, then error event and retried content
  expect(events).toStrictEqual([
    {
      type: AgentEventType.ModelInfo,
      value: {
        model: 'test-model',
        providerName: 'gemini',
        profileName: null,
        displayLabel: 'test-model',
      },
    },
    {
      type: AgentEventType.Error,
      value: {
        error: { message: 'Payload too large', status: 413 },
      },
    },
    { type: AgentEventType.Content, value: 'Retried content' },
  ]);

  // Second call should include the 413 system message with tool names
  expect(mockTurnRunFn).toHaveBeenNthCalledWith(
    2,
    [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: 'System: The previous tool calls produced a response that was too large (HTTP 413). The tools involved were: read_file, search_file. Please retry with fewer or more focused queries.',
          },
        ],
      },
    ],
    expect.any(Object),
  );

  // A tool-payload 413 must not run compression or enforcement (REQ-3251-5)
  expect(mockChat.performCompression).not.toHaveBeenCalled();
  expect(mockChat.enforceContextWindow).not.toHaveBeenCalled();
}

export async function testContextCompressionRetry(
  client: AgentClient,
  mockTurnRunFn: ReturnType<typeof vi.fn>,
  retriedContentStream: () => AsyncGenerator<{
    type: AgentEventType;
    value: string;
  }>,
): Promise<void> {
  enableFailedApiCallRetry(client);
  // Anthropic-style context-size rejection: no tool or media payload.
  const requestTooLarge = {
    error: { message: 'Request exceeds the maximum size', status: 413 },
  };
  const mockStream1 = (async function* () {
    yield { type: AgentEventType.Error, value: requestTooLarge };
  })();
  const mockStream2 = retriedContentStream();

  mockTurnRunFn
    .mockReturnValueOnce(mockStream1)
    .mockReturnValueOnce(mockStream2);

  const promptId = 'prompt-id-413-context-size';
  const mockChat = make413Chat({
    performCompression: vi
      .fn()
      .mockResolvedValue(PerformCompressionResult.COMPRESSED),
    enforceContextWindow: vi.fn().mockResolvedValue(undefined),
    estimatePendingTokens: vi.fn().mockResolvedValue(4242),
  });
  client['chat'] = mockChat as ChatSession;

  const initialRequest: ContentBlock[] = [{ type: 'text', text: 'Hi' }];
  const events = await fromAsync(
    client.sendMessageStream(
      initialRequest,
      new AbortController().signal,
      promptId,
    ),
  );

  // The retried Content flows to the consumer after the surfaced 413.
  expect(events).toStrictEqual([
    {
      type: AgentEventType.ModelInfo,
      value: {
        model: 'test-model',
        providerName: 'gemini',
        profileName: null,
        displayLabel: 'test-model',
      },
    },
    { type: AgentEventType.Error, value: requestTooLarge },
    { type: AgentEventType.Content, value: 'Retried content' },
  ]);

  expect(mockChat.performCompression).toHaveBeenCalledTimes(1);
  expect(mockChat.performCompression).toHaveBeenCalledWith(promptId, {
    trigger: 'auto',
  });
  expect(mockChat.enforceContextWindow).not.toHaveBeenCalled();

  // The retry carries the ORIGINAL pending request, not a synthetic message.
  expect(mockTurnRunFn).toHaveBeenNthCalledWith(
    2,
    [{ speaker: 'human', blocks: [{ type: 'text', text: 'Hi' }] }],
    expect.any(Object),
  );
}
