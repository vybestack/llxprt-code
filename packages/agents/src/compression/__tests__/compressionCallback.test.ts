/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for compression callback attachment via duck typing in
 * CompressionHandler.enforceProviderContents (issue #2207).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  makeUserMessage,
  makeAiText,
  buildRuntimeContext,
  buildMockContentGenerator,
} from '../../core/__tests__/chatSession-density-helpers.js';
import { ChatSession } from '../../core/chatSession.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { CompressionCallback } from '@vybestack/llxprt-code-providers';

function expectCapturedCallback(
  callback: CompressionCallback | null,
): CompressionCallback {
  expect(callback).not.toBeNull();
  if (callback === null) {
    throw new Error('Expected compression callback to be captured');
  }
  return callback;
}

function countToolCalls(contents: IContent[], id: string): number {
  let count = 0;
  for (const content of contents) {
    for (const block of content.blocks) {
      if (block.type === 'tool_call' && block.id === id) {
        count++;
      }
    }
  }
  return count;
}

function countToolResponses(contents: IContent[], callId: string): number {
  let count = 0;
  for (const content of contents) {
    for (const block of content.blocks) {
      if (block.type === 'tool_response' && block.callId === callId) {
        count++;
      }
    }
  }
  return count;
}

function assertToolResponseResult(
  contents: IContent[],
  callId: string,
  result: unknown,
): void {
  for (const content of contents) {
    for (const block of content.blocks) {
      if (block.type === 'tool_response' && block.callId === callId) {
        expect(block.result).toStrictEqual(result);
        return;
      }
    }
  }
  expect.fail(`Expected tool response for call ${callId}`);
}

describe('CompressionHandler.enforceProviderContents - compression callback attachment (issue #2207)', () => {
  let historyService: HistoryService;
  let mockContentGenerator: ReturnType<typeof buildMockContentGenerator>;

  beforeEach(() => {
    vi.clearAllMocks();
    historyService = new HistoryService();
    mockContentGenerator = buildMockContentGenerator();
  });

  it('attaches compression callback to provider with setCompressionCallback method', async () => {
    const runtimeContext = buildRuntimeContext(historyService, {
      contextLimit: 131134,
      compressionThreshold: 0.85,
    });

    historyService.add(makeUserMessage('test'));
    historyService.add(makeAiText('response'));

    const chat = new ChatSession(runtimeContext, mockContentGenerator, {}, []);

    const providerWithCallback = {
      name: 'load-balancer',
      generateChatCompletion: vi.fn(),
      setCompressionCallback: vi.fn(),
    };

    await chat['compressionHandler'].enforceProviderContents(
      historyService.getCuratedForProvider(),
      'test-prompt',
      providerWithCallback as unknown as IProvider,
    );
    chat['compressionHandler'].clearProviderCompressionCallback(
      providerWithCallback as unknown as IProvider,
    );

    const calls = providerWithCallback.setCompressionCallback.mock.calls;
    expect(calls[0][0]).toStrictEqual(expect.any(Function));
    expect(calls[calls.length - 1][0]).toBeNull();
  });

  it('clears compression callback when provider setter rejects attachment', async () => {
    const runtimeContext = buildRuntimeContext(historyService, {
      contextLimit: 131134,
      compressionThreshold: 0.85,
    });

    historyService.add(makeUserMessage('test'));
    const chat = new ChatSession(runtimeContext, mockContentGenerator, {}, []);
    const setCompressionCallback = vi.fn((cb: CompressionCallback | null) => {
      if (cb !== null) {
        throw new Error('attach failed');
      }
    });
    const providerWithThrowingSetter = {
      name: 'load-balancer',
      generateChatCompletion: vi.fn(),
      setCompressionCallback,
    };

    await expect(
      chat['compressionHandler'].enforceProviderContents(
        historyService.getCuratedForProvider(),
        'test-prompt',
        providerWithThrowingSetter as unknown as IProvider,
      ),
    ).rejects.toThrow('attach failed');

    const calls = setCompressionCallback.mock.calls;
    expect(calls[0][0]).toStrictEqual(expect.any(Function));
    expect(calls[calls.length - 1][0]).toBeNull();
  });

  it('does not throw when provider lacks setCompressionCallback method', async () => {
    const runtimeContext = buildRuntimeContext(historyService, {
      contextLimit: 131134,
      compressionThreshold: 0.85,
    });

    historyService.add(makeUserMessage('test'));

    const chat = new ChatSession(runtimeContext, mockContentGenerator, {}, []);

    const providerWithoutCallback = {
      name: 'gemini',
      generateChatCompletion: vi.fn(),
    };

    await expect(
      chat['compressionHandler'].enforceProviderContents(
        historyService.getCuratedForProvider(),
        'test-prompt',
        providerWithoutCallback as unknown as IProvider,
      ),
    ).resolves.toStrictEqual(historyService.getCuratedForProvider());
  });

  it('ignores non-callable setCompressionCallback properties', async () => {
    const runtimeContext = buildRuntimeContext(historyService, {
      contextLimit: 131134,
      compressionThreshold: 0.85,
    });

    historyService.add(makeUserMessage('test'));

    const chat = new ChatSession(runtimeContext, mockContentGenerator, {}, []);

    const providerWithNonCallableCallback = {
      name: 'load-balancer',
      generateChatCompletion: vi.fn(),
      setCompressionCallback: 'not-a-function',
    };

    await expect(
      chat['compressionHandler'].enforceProviderContents(
        historyService.getCuratedForProvider(),
        'test-prompt',
        providerWithNonCallableCallback as unknown as IProvider,
      ),
    ).resolves.toStrictEqual(historyService.getCuratedForProvider());
  });

  it('attached callback runs compression machinery and returns history contents', async () => {
    const runtimeContext = buildRuntimeContext(historyService, {
      contextLimit: 200000,
      compressionThreshold: 0.1,
      compressionStrategy: 'top-down-truncation',
    });

    for (let i = 0; i < 20; i++) {
      historyService.add(makeUserMessage(`Message ${i} `.repeat(50)));
    }

    const chat = new ChatSession(runtimeContext, mockContentGenerator, {}, []);

    let capturedCallback: CompressionCallback | null = null;
    const providerWithCallback = {
      name: 'load-balancer',
      generateChatCompletion: vi.fn(),
      setCompressionCallback: vi.fn((cb: CompressionCallback | null) => {
        if (cb !== null) {
          capturedCallback = cb;
        }
      }),
    };

    await chat['compressionHandler'].enforceProviderContents(
      historyService.getCuratedForProvider(),
      'test-prompt',
      providerWithCallback as unknown as IProvider,
    );

    const callback = expectCapturedCallback(capturedCallback);
    const currentContents = historyService.getCuratedForProvider();
    const result = await callback(currentContents);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(currentContents.length);
    expect(
      result.every(
        (content) =>
          typeof content.speaker === 'string' && Array.isArray(content.blocks),
      ),
    ).toBe(true);

    // Empty input means no pending content; the callback still recomposes the
    // current HistoryService contents into the provider-ready request payload.
    const emptyResult = await callback([]);
    expect(Array.isArray(emptyResult)).toBe(true);
    expect(emptyResult.length).toBeGreaterThan(0);
    expect(emptyResult.some((content) => content.speaker === 'human')).toBe(
      true,
    );
  });

  it('preserves pending request contents when callback recomposes compressed history', async () => {
    const runtimeContext = buildRuntimeContext(historyService, {
      contextLimit: 200000,
      compressionThreshold: 0.1,
      compressionStrategy: 'top-down-truncation',
    });

    historyService.add(makeUserMessage('old history '.repeat(50)));
    historyService.add({
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'call-1',
          name: 'lookup',
          parameters: { query: 'history' },
        },
        { type: 'text', text: 'old response text after call' },
      ],
    });
    historyService.add({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call-1',
          toolName: 'lookup',
          result: { value: 'history-result' },
        },
      ],
    });
    const pending = makeUserMessage('latest user request after tool result');
    const chat = new ChatSession(runtimeContext, mockContentGenerator, {}, []);

    let capturedCallback: CompressionCallback | null = null;
    const providerWithCallback = {
      name: 'load-balancer',
      generateChatCompletion: vi.fn(),
      setCompressionCallback: vi.fn((cb: CompressionCallback | null) => {
        if (cb !== null) {
          capturedCallback = cb;
        }
      }),
    };

    await chat['compressionHandler'].enforceProviderContents(
      historyService.getCuratedForProvider(),
      'test-prompt',
      providerWithCallback as unknown as IProvider,
    );

    const callback = expectCapturedCallback(capturedCallback);
    const providerReadyContents = historyService.getCuratedForProvider([
      pending,
    ]);
    const result = await callback(providerReadyContents);

    expect(result).toContainEqual(pending);
    expect(result.at(-1)).toStrictEqual(pending);
  });

  it('preserves a pending matching tool response without duplicating history', async () => {
    const runtimeContext = buildRuntimeContext(historyService, {
      contextLimit: 200000,
      compressionThreshold: 0.1,
      compressionStrategy: 'top-down-truncation',
    });

    historyService.add(makeUserMessage('old history '.repeat(50)));
    historyService.add({
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'pending-call',
          name: 'lookup',
          parameters: { query: 'current' },
        },
      ],
    });

    const pendingToolResult: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'pending-call',
          toolName: 'lookup',
          result: { value: 'large tool response '.repeat(50) },
        },
      ],
    };
    const chat = new ChatSession(runtimeContext, mockContentGenerator, {}, []);

    let capturedCallback: CompressionCallback | null = null;
    const providerWithCallback = {
      name: 'load-balancer',
      generateChatCompletion: vi.fn(),
      setCompressionCallback: vi.fn((cb: CompressionCallback | null) => {
        if (cb !== null) {
          capturedCallback = cb;
        }
      }),
    };

    await chat['compressionHandler'].enforceProviderContents(
      historyService.getCuratedForProvider(),
      'test-prompt',
      providerWithCallback as unknown as IProvider,
    );

    const callback = expectCapturedCallback(capturedCallback);
    const providerReadyContents = historyService.getCuratedForProvider([
      pendingToolResult,
    ]);
    const result = await callback(providerReadyContents);

    expect(countToolCalls(result, 'pending-call')).toBe(1);
    expect(countToolResponses(result, 'pending-call')).toBe(1);
    assertToolResponseResult(result, 'pending-call', {
      value: 'large tool response '.repeat(50),
    });
  });
});
