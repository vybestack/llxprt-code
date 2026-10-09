/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, type Mock } from 'bun:test';
import type {
  AgentMessageInput,
  ContentBlock,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AgentClient } from '../../client.js';
import {
  installOverflowMockChat,
  installZeroCountGenerator,
  setMockTokenLimit,
} from '../../client-send-stream-test-helpers.js';
import {
  AgentEventType,
  PerformCompressionResult,
  type ServerAgentStreamEvent,
} from '../../turn.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-core/telemetry/uiTelemetry.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import { fromAsync } from '../client-test-helpers.js';

export async function testShouldDeferOverflowDecisionsToFinalizedProviderEnforcement1(
  client: AgentClient,
): Promise<{
  events: readonly ServerAgentStreamEvent[];
  mockChat: ReturnType<typeof installOverflowMockChat>;
}> {
  // Arrange
  setMockTokenLimit(1000);

  // Set last prompt token count
  const lastPromptTokenCount = 900;
  (
    uiTelemetryService.getLastPromptTokenCount as Mock<
      typeof uiTelemetryService.getLastPromptTokenCount
    >
  ).mockReturnValue(lastPromptTokenCount);

  // Mock the chat to return the lastPromptTokenCount
  const mockChat = installOverflowMockChat(client, lastPromptTokenCount, {
    performCompression: vi
      .fn()
      .mockResolvedValue(PerformCompressionResult.FAILED),
  });

  installZeroCountGenerator(client);

  // Remaining = 100. Threshold (95%) = 95.
  // We need a request > 95 tokens.
  // A string of length 400 is roughly 100 tokens.
  const longText = 'a'.repeat(400);
  const request = [{ type: 'text' as const, text: longText }];
  // Client preflight must not make the authoritative overflow decision.

  // Act
  const stream = client.sendMessageStream(
    request,
    new AbortController().signal,
    'prompt-id-overflow',
  );

  const events = await fromAsync(stream);

  return { events, mockChat };
}

export async function testShouldNOTEmitContextWindowWillOverflowWhenRemainingCapacityI2(
  client: AgentClient,
  mockTurnRunFn: ReturnType<typeof vi.fn>,
  yieldOkStream: () => void,
): Promise<{ events: readonly ServerAgentStreamEvent[] }> {
  // Arrange — simulate a provider/profile switch where the prior session's
  // lastPromptTokenCount exceeds the switched model's limit. Remaining is
  // therefore negative, and the preflight guard must NOT short-circuit;
  // the normal send/compression/enforcement path should attempt to resolve
  // the overflow with the switched model's tokenizer.
  setMockTokenLimit(200000);

  // e.g. 249,442 stored tokens against a 200,000-token model.
  const lastPromptTokenCount = 249442;
  (
    uiTelemetryService.getLastPromptTokenCount as Mock<
      typeof uiTelemetryService.getLastPromptTokenCount
    >
  ).mockReturnValue(lastPromptTokenCount);

  installOverflowMockChat(client, lastPromptTokenCount, {
    convertPartListUnionToIContent: vi
      .fn()
      .mockReturnValue({ speaker: 'human', blocks: [] }),
    estimatePendingTokens: vi.fn().mockResolvedValue(0),
  });

  installZeroCountGenerator(client);

  // A small "continue" request — remaining is -49,442.
  const request: ContentBlock[] = [{ type: 'text', text: 'continue' }];

  yieldOkStream();

  // Act
  const stream = client.sendMessageStream(
    request,
    new AbortController().signal,
    'prompt-id-negative-remaining',
  );
  const events = await fromAsync(stream);

  return { events };
}

export async function testShouldNOTEmitContextWindowWillOverflowForAFunctionResponseOn3(
  client: AgentClient,
  mockTurnRunFn: ReturnType<typeof vi.fn>,
  yieldOkStream: () => void,
): Promise<{ events: readonly ServerAgentStreamEvent[] }> {
  // Arrange — after a tool call completes, the continuation request is a
  // bare functionResponse part. The negative-remaining short-circuit must
  // defer to the send path rather than tripping a bogus guard.
  setMockTokenLimit(200000);

  const lastPromptTokenCount = 249442;
  (
    uiTelemetryService.getLastPromptTokenCount as Mock<
      typeof uiTelemetryService.getLastPromptTokenCount
    >
  ).mockReturnValue(lastPromptTokenCount);

  installOverflowMockChat(client, lastPromptTokenCount, {
    convertPartListUnionToIContent: vi.fn().mockReturnValue({
      speaker: 'tool',
      blocks: [],
    }),
    estimatePendingTokens: vi.fn().mockResolvedValue(0),
  });

  installZeroCountGenerator(client);

  // Pure tool_response continuation — 0 tokens by text estimate.
  const request: ContentBlock[] = [
    {
      type: 'tool_response',
      callId: 'someTool',
      toolName: 'someTool',
      result: { result: 'done' },
    },
  ];

  yieldOkStream();

  // Act
  const stream = client.sendMessageStream(
    request,
    new AbortController().signal,
    'prompt-id-tool-response-continuation',
  );
  const events = await fromAsync(stream);

  return { events };
}

export async function testShouldDeferModelAwareTokenizationToFinalizedProviderEnforcem4(
  client: AgentClient,
  mockTurnRunFn: ReturnType<typeof vi.fn>,
  yieldOkStream: () => void,
): Promise<{ estimateSpy: ReturnType<typeof vi.fn> }> {
  // Arrange — legacy client preflight must not invoke generic tokenization.
  const MOCKED_TOKEN_LIMIT = 10000;
  (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(MOCKED_TOKEN_LIMIT);
  const lastPromptTokenCount = 1000;
  (
    uiTelemetryService.getLastPromptTokenCount as Mock<
      typeof uiTelemetryService.getLastPromptTokenCount
    >
  ).mockReturnValue(lastPromptTokenCount);

  const estimateSpy = vi.fn();
  installOverflowMockChat(client, lastPromptTokenCount, {
    estimatePendingTokens: estimateSpy,
  });

  yieldOkStream();

  const request = [{ type: 'text' as const, text: 'continue' }];

  // Act
  const stream = client.sendMessageStream(
    request,
    new AbortController().signal,
    'prompt-id-tokenizer-positive-remaining',
  );
  await fromAsync(stream);

  return { estimateSpy };
}

export async function testShouldNOTInvokeTheTokenizerWhenRemainingCapacityIsAlreadyNeg5(
  client: AgentClient,
  mockTurnRunFn: ReturnType<typeof vi.fn>,
  yieldOkStream: () => void,
): Promise<{
  convertSpy: ReturnType<typeof vi.fn>;
  estimateSpy: ReturnType<typeof vi.fn>;
  events: readonly ServerAgentStreamEvent[];
}> {
  // Arrange — proves the negative-remaining short-circuit avoids the
  // tokenizer-backed sizing path entirely (it returns before sizing).
  const MOCKED_TOKEN_LIMIT = 200000;
  (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(MOCKED_TOKEN_LIMIT);
  const lastPromptTokenCount = 249442;
  (
    uiTelemetryService.getLastPromptTokenCount as Mock<
      typeof uiTelemetryService.getLastPromptTokenCount
    >
  ).mockReturnValue(lastPromptTokenCount);

  const convertSpy = vi.fn();
  const estimateSpy = vi.fn();
  installOverflowMockChat(client, lastPromptTokenCount, {
    convertPartListUnionToIContent: convertSpy,
    estimatePendingTokens: estimateSpy,
  });

  yieldOkStream();

  // Act
  const stream = client.sendMessageStream(
    [{ type: 'text', text: 'continue' }],
    new AbortController().signal,
    'prompt-id-tokenizer-skipped-negative',
  );
  const events = await fromAsync(stream);

  return { convertSpy, estimateSpy, events };
}

export async function testShouldDeferFunctionResponseSizingToFinalizedProviderEnforcem6(
  client: AgentClient,
  mockTurnRunFn: ReturnType<typeof vi.fn>,
  yieldOkStream: () => void,
): Promise<{ events: readonly ServerAgentStreamEvent[] }> {
  // Arrange — a minimal chat double without tokenizer methods must still proceed
  // to finalized provider enforcement.
  const MOCKED_TOKEN_LIMIT = 1000;
  (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(MOCKED_TOKEN_LIMIT);
  const lastPromptTokenCount = 0;
  (
    uiTelemetryService.getLastPromptTokenCount as Mock<
      typeof uiTelemetryService.getLastPromptTokenCount
    >
  ).mockReturnValue(lastPromptTokenCount);

  installOverflowMockChat(client, lastPromptTokenCount);

  yieldOkStream();

  // Build a tool_response payload large enough that its JSON/4 exceeds
  // the 95% threshold of the full limit (1000 * 0.95 = 950 tokens).
  const largeResult = 'x'.repeat(4000);
  const request = [
    {
      type: 'tool_response' as const,
      callId: 'someTool',
      toolName: 'someTool',
      result: { result: largeResult },
    },
  ];

  // Act
  const stream = client.sendMessageStream(
    request,
    new AbortController().signal,
    'prompt-id-structured-fallback-fn-response',
  );
  const events = await fromAsync(stream);

  return { events };
}

export const observeNotTriggerThinkingOnlyContinuationAfterInvalidStreamWhenFlagIsFalse =
  async (
    client: AgentClient,
    mockTurnRunFn: ReturnType<typeof vi.fn>,
    todoStoreReadMock: ReturnType<typeof vi.fn>,
  ) => {
    vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
      false,
    );

    const forwardedRequests: ContentBlock[][] = [];
    mockTurnRunFn.mockReset();
    mockTurnRunFn.mockImplementation((req: AgentMessageInput) => {
      forwardedRequests.push(req as ContentBlock[]);
      return (async function* () {
        yield {
          type: AgentEventType.Thought,
          value: {
            subject: 'Planning',
            description: 'I will do something',
          },
        };
        yield { type: AgentEventType.InvalidStream };
      })();
    });

    vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(false);

    installOverflowMockChat(client, 0);

    installZeroCountGenerator(client);

    todoStoreReadMock.mockResolvedValue([]);

    const stream = client.sendMessageStream(
      [{ type: 'text', text: 'Do something' }],
      new AbortController().signal,
      'prompt-thinking-invalid-stream-no-continue',
    );
    const events = await fromAsync(stream);

    const continuationRequestPresent = forwardedRequests[0]?.some(
      (part) =>
        typeof part === 'object' &&
        'text' in part &&
        typeof part.text === 'string' &&
        part.text.includes('Continue and take the next concrete action now'),
    );
    return {
      events,
      continuationRequestPresent,
      forwardedRequestCount: forwardedRequests.length,
    };
  };
