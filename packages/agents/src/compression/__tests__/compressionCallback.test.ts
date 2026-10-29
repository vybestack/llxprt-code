import { chatSessionPorts } from '../../core/chatSessionPorts.js';
/// <reference lib="esnext.array" />
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for compression callback attachment via duck typing in
 * CompressionHandler.enforceProviderSource (issue #2207).
 */

import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionCallback } from '@vybestack/llxprt-code-providers';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  buildMockContentGenerator,
  buildRuntimeContext,
  makeAiText,
  makeUserMessage,
} from '../../core/__tests__/chatSession-density-helpers.js';
import { ChatSession } from '../../core/chatSession.js';

import { enforceProviderSourceForTest } from './support/enforce-provider-source.js';

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
    const chat = new ChatSession(
      chatSessionPorts(runtimeContext),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockContentGenerator,
      {},
      [],
    );
    const setCompressionCallback = vi.fn((cb: CompressionCallback | null) => {
      if (cb !== null) {
        throw new Error('attach failed');
      }
    });
    const providerWithThrowingSetter = {
      name: 'load-balancer',
      getModels: async () => [],
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

    const chat = new ChatSession(
      chatSessionPorts(runtimeContext),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockContentGenerator,
      {},
      [],
    );

    let capturedCallback: CompressionCallback | null = null;
    const providerWithCallback = {
      name: 'load-balancer',
      getModels: async () => [],
      generateChatCompletion: vi.fn(),
      setCompressionCallback: vi.fn((cb: CompressionCallback | null) => {
        if (cb !== null) {
          capturedCallback = cb;
        }
      }),
    };

    let currentContents: IContent[] = [];
    let result: IContent[] = [];
    let repeatedResult: IContent[] = [];
    await enforceProviderSourceForTest(
      chat['compressionHandler'],
      historyService,
      [],
      'test-prompt',
      providerWithCallback,
      undefined,
      true,
      async () => {
        const callback = expectCapturedCallback(capturedCallback);
        currentContents = await Array.fromAsync(
          historyService.getCuratedForProviderStream(),
        );
        result = await readCallback(callback);
        repeatedResult = await readCallback(callback);
      },
    );

    const attachedCallbackRunsCompressionMachineryAndReturnsHistoryContentsObservation1 =
      result.every(
        (content) =>
          typeof content.speaker === 'string' && Array.isArray(content.blocks),
      );
    return {
      result,
      currentContents,
      repeatedResult,
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
    const chat = new ChatSession(
      chatSessionPorts(runtimeContext),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockContentGenerator,
      {},
      [],
    );
    // This test exercises the callback recompose path after successful
    // compression, not compression semantics, so mock COMPRESSED.
    vi.spyOn(
      chat['compressionHandler'],
      'performCompression',
    ).mockResolvedValue(PerformCompressionResult.COMPRESSED);

    let capturedCallback: CompressionCallback | null = null;
    const providerWithCallback = {
      name: 'load-balancer',
      getModels: async () => [],
      generateChatCompletion: vi.fn(),
      setCompressionCallback: vi.fn((cb: CompressionCallback | null) => {
        if (cb !== null) {
          capturedCallback = cb;
        }
      }),
    };

    let result: IContent[] = [];
    await enforceProviderSourceForTest(
      chat['compressionHandler'],
      historyService,
      [pending],
      'test-prompt',
      providerWithCallback,
      undefined,
      true,
      async () => {
        result = await readCallback(expectCapturedCallback(capturedCallback));
      },
    );

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
    const chat = new ChatSession(
      chatSessionPorts(runtimeContext),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockContentGenerator,
      {},
      [],
    );
    // This test exercises the callback recompose path after successful
    // compression, not compression semantics, so mock COMPRESSED.
    vi.spyOn(
      chat['compressionHandler'],
      'performCompression',
    ).mockResolvedValue(PerformCompressionResult.COMPRESSED);

    let capturedCallback: CompressionCallback | null = null;
    const providerWithCallback = {
      name: 'load-balancer',
      getModels: async () => [],
      generateChatCompletion: vi.fn(),
      setCompressionCallback: vi.fn((cb: CompressionCallback | null) => {
        if (cb !== null) {
          capturedCallback = cb;
        }
      }),
    };

    let result: IContent[] = [];
    await enforceProviderSourceForTest(
      chat['compressionHandler'],
      historyService,
      [pendingToolResult],
      'test-prompt',
      providerWithCallback,
      undefined,
      true,
      async () => {
        result = await readCallback(expectCapturedCallback(capturedCallback));
      },
    );

    assertToolResponseResult(result, 'pending-call', {
      value: 'large tool response '.repeat(50),
    });

    return { result };
  };

describe('CompressionHandler.enforceProviderSource - compression callback attachment (issue #2207)', () => {
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

  const chat = new ChatSession(
    chatSessionPorts(runtimeContext),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    mockContentGenerator,
    {},
    [],
  );

  const providerWithCallback = {
    name: 'load-balancer',
    getModels: async () => [],
    generateChatCompletion: vi.fn(),
    setCompressionCallback: vi.fn(),
  };

  await enforceProviderSourceForTest(
    chat['compressionHandler'],
    historyService,
    [],
    'test-prompt',
    providerWithCallback,
  );
  chat['compressionHandler'].clearProviderCompressionCallback(
    providerWithCallback,
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
    enforceProviderSourceForTest(
      chat['compressionHandler'],
      historyService,
      [],
      'test-prompt',
      providerWithThrowingSetter,
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

  const chat = new ChatSession(
    chatSessionPorts(runtimeContext),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    mockContentGenerator,
    {},
    [],
  );

  const providerWithoutCallback = {
    name: 'gemini',
    getModels: async () => [],
    generateChatCompletion: vi.fn(),
  };

  const expectedContents = await Array.fromAsync(
    historyService.getCuratedForProviderStream(),
  );
  await expect(
    enforceProviderSourceForTest(
      chat['compressionHandler'],
      historyService,
      [],
      'test-prompt',
      providerWithoutCallback,
    ),
  ).resolves.toStrictEqual(expectedContents);
}

async function facadeCallback5(): Promise<void> {
  const {
    result,
    currentContents,
    repeatedResult,
    attachedCallbackRunsCompressionMachineryAndReturnsHistoryContentsObservation1,
  } =
    await observeAttachedCallbackRunsCompressionMachineryAndReturnsHistoryContents();
  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBeLessThanOrEqual(currentContents.length);
  expect(
    attachedCallbackRunsCompressionMachineryAndReturnsHistoryContentsObservation1,
  ).toBe(true);
  expect(repeatedResult).toStrictEqual(result);
}

async function facadeCallback6(): Promise<void> {
  const { result, pending } =
    await observePreservesPendingRequestContentsWhenCallbackRecomposesCompressedHistory();
  expect(result).toContainEqual(pending);
  expect(result[result.length - 1]).toStrictEqual(pending);
}

async function facadeCallback7(): Promise<void> {
  const runtimeContext = buildRuntimeContext(historyService, {
    contextLimit: 100000,
    compressionThreshold: 0.0001,
  });
  historyService.add(makeUserMessage('previous assistant context'));
  const chat = new ChatSession(
    chatSessionPorts(runtimeContext),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    mockContentGenerator,
    {},
    [],
  );
  const compressionHandler = chat['compressionHandler'];
  const performCompression = vi
    .spyOn(compressionHandler, 'performCompression')
    .mockResolvedValue(PerformCompressionResult.COMPRESSED);
  const pending = makeUserMessage('threshold crossing request '.repeat(50));

  await enforceProviderSourceForTest(
    compressionHandler,
    historyService,
    [pending],
    'test-prompt',
    {
      name: 'fake',
      getModels: async () => [],
      generateChatCompletion: vi.fn(),
    },
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

describe('compression callback property admission', () => {
  it('ignores non-callable setCompressionCallback properties', async () => {
    const history = new HistoryService();
    history.add(makeUserMessage('test'));
    const runtime = buildRuntimeContext(history, {
      contextLimit: 131134,
      compressionThreshold: 0.85,
    });
    const chat = new ChatSession(
      chatSessionPorts(runtime),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      buildMockContentGenerator(),
    );
    const provider = {
      name: 'load-balancer',
      getModels: async () => [],
      generateChatCompletion: vi.fn(),
    };
    Object.defineProperty(provider, 'setCompressionCallback', {
      value: 'not-a-function',
    });
    try {
      const expected = await Array.fromAsync(
        history.getCuratedForProviderStream(),
      );
      await expect(
        enforceProviderSourceForTest(
          chat['compressionHandler'],
          history,
          [],
          'test-prompt',
          provider,
        ),
      ).resolves.toStrictEqual(expected);
    } finally {
      await chat.clearHistoryForDisposal();
    }
  });
});
