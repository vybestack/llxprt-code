/// <reference lib="esnext.array" />
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for compression callback attachment via duck typing in
 * CompressionHandler.enforceProviderContents (issue #2207).
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
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
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
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

async function readCallback(
  callback: CompressionCallback,
): Promise<IContent[]> {
  return Array.fromAsync((await callback()).openReader());
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
let historyService: HistoryService;
let mockContentGenerator: ReturnType<typeof buildMockContentGenerator>;
const observeClearsCompressionCallbackWhenProviderSetterRejectsAttachment =
  async () => {
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

    return { chat, providerWithThrowingSetter, setCompressionCallback };
  };
const observeAttachedCallbackRunsCompressionMachineryAndReturnsHistoryContents =
  async () => {
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
      {
        contents: await Array.fromAsync(
          historyService.getCuratedForProviderStream(),
        ),
        pendingContents: [],
      },
      'test-prompt',
      providerWithCallback as unknown as IProvider,
    );

    const callback = expectCapturedCallback(capturedCallback);
    const currentContents = await Array.fromAsync(
      historyService.getCuratedForProviderStream(),
    );
    const result = await readCallback(callback);

    const emptyResult = await readCallback(callback);

    const attachedCallbackRunsCompressionMachineryAndReturnsHistoryContentsObservation1 =
      result.every(
        (content) =>
          typeof content.speaker === 'string' && Array.isArray(content.blocks),
      );
    return {
      result,
      currentContents,
      emptyResult,
      attachedCallbackRunsCompressionMachineryAndReturnsHistoryContentsObservation1,
    };
  };
const observePreservesPendingRequestContentsWhenCallbackRecomposesCompressedHistory =
  async () => {
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
    // This test exercises the callback recompose path after successful
    // compression, not compression semantics, so mock COMPRESSED.
    vi.spyOn(
      chat['compressionHandler'],
      'performCompression',
    ).mockResolvedValue(PerformCompressionResult.COMPRESSED);

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
      {
        contents: await Array.fromAsync(
          historyService.getCuratedForProviderStream([pending]),
        ),
        pendingContents: [pending],
      },
      'test-prompt',
      providerWithCallback as unknown as IProvider,
    );

    const callback = expectCapturedCallback(capturedCallback);
    const result = await readCallback(callback);

    return { result, pending };
  };
const observePreservesAPendingMatchingToolResponseWithoutDuplicatingHistory =
  async () => {
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
    // This test exercises the callback recompose path after successful
    // compression, not compression semantics, so mock COMPRESSED.
    vi.spyOn(
      chat['compressionHandler'],
      'performCompression',
    ).mockResolvedValue(PerformCompressionResult.COMPRESSED);

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
      {
        contents: await Array.fromAsync(
          historyService.getCuratedForProviderStream([pendingToolResult]),
        ),
        pendingContents: [pendingToolResult],
      },
      'test-prompt',
      providerWithCallback as unknown as IProvider,
    );

    const callback = expectCapturedCallback(capturedCallback);
    const result = await readCallback(callback);

    assertToolResponseResult(result, 'pending-call', {
      value: 'large tool response '.repeat(50),
    });

    return { result };
  };

describe('CompressionHandler.enforceProviderContents - compression callback attachment (issue #2207)', () => {
  beforeEach(facadeCallback0);

  it(
    'attaches compression callback to provider with setCompressionCallback method',
    facadeCallback1,
  );

  it(
    'clears compression callback when provider setter rejects attachment',
    facadeCallback2,
  );

  it(
    'does not throw when provider lacks setCompressionCallback method',
    facadeCallback3,
  );

  it('ignores non-callable setCompressionCallback properties', facadeCallback4);

  it(
    'attached callback runs compression machinery and returns history contents',
    facadeCallback5,
  );

  it(
    'preserves pending request contents when callback recomposes compressed history',
    facadeCallback6,
  );

  it(
    'compresses provider payloads that remain above the compression threshold after density optimization',
    facadeCallback7,
  );

  it(
    'preserves a pending matching tool response without duplicating history',
    facadeCallback8,
  );
});

function facadeCallback0(): void {
  vi.clearAllMocks();
  historyService = new HistoryService();
  mockContentGenerator = buildMockContentGenerator();
}

async function facadeCallback1(): Promise<void> {
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
    {
      contents: await Array.fromAsync(
        historyService.getCuratedForProviderStream(),
      ),
      pendingContents: [],
    },
    'test-prompt',
    providerWithCallback as unknown as IProvider,
  );
  chat['compressionHandler'].clearProviderCompressionCallback(
    providerWithCallback as unknown as IProvider,
  );

  expect(providerWithCallback.setCompressionCallback).toHaveBeenNthCalledWith(
    1,
    expect.any(Function),
  );
  expect(providerWithCallback.setCompressionCallback).toHaveBeenNthCalledWith(
    2,
    null,
  );
}

async function facadeCallback2(): Promise<void> {
  const { chat, providerWithThrowingSetter, setCompressionCallback } =
    await observeClearsCompressionCallbackWhenProviderSetterRejectsAttachment();
  await expect(
    chat['compressionHandler'].enforceProviderContents(
      {
        contents: await Array.fromAsync(
          historyService.getCuratedForProviderStream(),
        ),
        pendingContents: [],
      },
      'test-prompt',
      providerWithThrowingSetter as unknown as IProvider,
    ),
  ).rejects.toThrow('attach failed');
  expect(setCompressionCallback).toHaveBeenNthCalledWith(
    1,
    expect.any(Function),
  );
  expect(setCompressionCallback).toHaveBeenNthCalledWith(2, null);
}

async function facadeCallback3(): Promise<void> {
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

  const expectedContents = await Array.fromAsync(
    historyService.getCuratedForProviderStream(),
  );
  await expect(
    chat['compressionHandler'].enforceProviderContents(
      { contents: expectedContents, pendingContents: [] },
      'test-prompt',
      providerWithoutCallback as unknown as IProvider,
    ),
  ).resolves.toStrictEqual(expectedContents);
}

async function facadeCallback4(): Promise<void> {
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

  const expectedContents = await Array.fromAsync(
    historyService.getCuratedForProviderStream(),
  );
  await expect(
    chat['compressionHandler'].enforceProviderContents(
      { contents: expectedContents, pendingContents: [] },
      'test-prompt',
      providerWithNonCallableCallback as unknown as IProvider,
    ),
  ).resolves.toStrictEqual(expectedContents);
}

async function facadeCallback5(): Promise<void> {
  const {
    result,
    currentContents,
    emptyResult,
    attachedCallbackRunsCompressionMachineryAndReturnsHistoryContentsObservation1,
  } =
    await observeAttachedCallbackRunsCompressionMachineryAndReturnsHistoryContents();
  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBeLessThanOrEqual(currentContents.length);
  expect(
    attachedCallbackRunsCompressionMachineryAndReturnsHistoryContentsObservation1,
  ).toBe(true);
  expect(emptyResult).toStrictEqual([]);
}

async function facadeCallback6(): Promise<void> {
  const { result, pending } =
    await observePreservesPendingRequestContentsWhenCallbackRecomposesCompressedHistory();
  expect(result).toContainEqual(pending);
  expect(result.at(-1)).toStrictEqual(pending);
}

async function facadeCallback7(): Promise<void> {
  const runtimeContext = buildRuntimeContext(historyService, {
    contextLimit: 100000,
    compressionThreshold: 0.0001,
  });
  historyService.add(makeUserMessage('previous assistant context'));
  const chat = new ChatSession(runtimeContext, mockContentGenerator, {}, []);
  const compressionHandler = chat['compressionHandler'];
  const performCompression = vi
    .spyOn(compressionHandler, 'performCompression')
    .mockResolvedValue(PerformCompressionResult.COMPRESSED);
  const pending = makeUserMessage('threshold crossing request '.repeat(50));

  await compressionHandler.enforceProviderContents(
    {
      contents: await Array.fromAsync(
        historyService.getCuratedForProviderStream([pending]),
      ),
      pendingContents: [pending],
    },
    'test-prompt',
    { name: 'fake', generateChatCompletion: vi.fn() } as unknown as IProvider,
  );

  expect(performCompression).toHaveBeenCalledWith('test-prompt', {
    bypassCooldown: true,
    trigger: 'auto',
  });
}

async function facadeCallback8(): Promise<void> {
  const { result } =
    await observePreservesAPendingMatchingToolResponseWithoutDuplicatingHistory();
  expect(countToolCalls(result, 'pending-call')).toBe(1);
  expect(countToolResponses(result, 'pending-call')).toBe(1);
}
