/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3216 — Provider-level integration tests for Anthropic poisoned-history
 * recovery. Uses a fake transport (mocked SDK messages.create) that first
 * returns a 400 image-dimension error, then accepts the sanitized retry. The
 * sanitizer/classifier under test are never mocked; only the SDK transport is.
 */

import { vi, describe, it, expect, afterEach } from 'bun:test';
import { APIError } from '@anthropic-ai/sdk';
import {
  attachTransportAttemptBudget,
  getTransportAttemptBudget,
} from '../transportAttemptBudget.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import {
  createProviderWithRuntime,
  createRuntimeConfigStub,
} from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import sharp from 'sharp';
import { createAnthropicRawPostTestAdapter } from '../test-utils/rawPostTestAdapters.js';

async function pngBase64(width: number, height: number): Promise<string> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 12, g: 34, b: 56, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return buffer.toString('base64');
}

const mockMessagesCreate = vi.fn();

void vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    ...createAnthropicRawPostTestAdapter(mockMessagesCreate),
    messages: {
      create: mockMessagesCreate,
    },
    beta: {
      models: {
        list: vi.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {
            yield {
              id: 'claude-opus-5',
              display_name: 'Claude Opus 5',
            };
          },
        }),
      },
    },
  })),
}));

void vi.mock('@vybestack/llxprt-code-tools/ToolFormatter.js', () => ({
  ToolFormatter: vi.fn().mockImplementation(() => ({
    toProviderFormat: vi.fn(() => []),
    fromProviderFormat: vi.fn(() => []),
  })),
}));

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('System prompt'),
}));

void vi.mock(
  '@vybestack/llxprt-code-core/prompt-config/subagent-delegation.js',
  () => ({
    shouldIncludeSubagentDelegation: vi.fn().mockReturnValue(false),
  }),
);

void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

const createMockStream = (text: string) => ({
  async *[Symbol.asyncIterator]() {
    yield {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text },
    };
  },
});

function make400ImageDimensionError(): Error {
  // Construct through the real SDK APIError.generate to match production
  // error shape exactly (status, nested body, message string).
  return APIError.generate(
    400,
    {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message:
          'At least one of the image dimensions exceed max allowed size for many-image requests: 2000 pixels',
      },
    },
    undefined,
    new Headers({ 'request-id': 'req_test' }),
  );
}

function make400UnrelatedError(): Error {
  return APIError.generate(
    400,
    {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'tools.0: extra inputs not permitted',
      },
    },
    undefined,
    new Headers({ 'request-id': 'req_test' }),
  );
}

function make429RateLimitError(): Error {
  return APIError.generate(
    429,
    {
      type: 'error',
      error: {
        type: 'rate_limit_error',
        message: 'Rate limit exceeded',
      },
    },
    undefined,
    new Headers({ 'request-id': 'req_429', 'retry-after': '1' }),
  );
}

/**
 * A distinct non-image, non-transient 500 whose message is a unique marker. Used
 * to prove the sanitized retry's own error propagates verbatim (it is NOT
 * swallowed and replaced by the original 400 image-dimension error).
 */
function make500MarkerError(): Error {
  return APIError.generate(
    500,
    {
      type: 'error',
      error: {
        type: 'api_error',
        message: 'RETRY_MARKER_PROPAGATED_FROM_SANITIZED_RETRY',
      },
    },
    undefined,
    new Headers({ 'request-id': 'req_marker' }),
  );
}

function setupProvider(
  options: {
    withImageBudget?: boolean;
    maxImageDimension?: number;
  } = {},
): {
  provider: AnthropicProvider;
  runtimeContext: ProviderRuntimeContext;
  settingsService: SettingsService;
} {
  const result = createProviderWithRuntime<AnthropicProvider>(
    ({ settingsService: svc }) => {
      svc.set('auth-key', 'test-api-key');
      svc.set('activeProvider', 'anthropic');
      svc.setProviderSetting('anthropic', 'streaming', 'disabled');
      svc.setProviderSetting('anthropic', 'prompt-caching', 'off');
      return new AnthropicProvider(
        'test-api-key',
        undefined,
        TEST_PROVIDER_CONFIG,
      );
    },
    {
      runtimeId: 'anthropic.imageRecovery.test',
      metadata: { source: 'AnthropicProvider.imageRecovery.issue3216.test.ts' },
    },
  );
  const { provider, runtime, settingsService: svc } = result;
  runtime.config ??= createRuntimeConfigStub(svc);
  // The budget must reach the provider through the real runtime path:
  // invocation.ephemerals is built by buildEphemeralsSnapshot from the
  // SettingsService global map (the same path model defaults take via
  // setEphemeralSetting). Writing it to the SettingsService guarantees the
  // proactive sanitizer in prepareAnthropicRequest sees it.
  if (options.withImageBudget === true) {
    svc.set('max-image-dimension', options.maxImageDimension ?? 2000);
  }
  const ephemeralSettings: Record<string, unknown> = {
    ...svc.getAllGlobalSettings(),
    ...svc.getProviderSettings(provider.name),
  };
  runtime.config.getEphemeralSettings = () => ({ ...ephemeralSettings });
  runtime.config.getEphemeralSetting = (key: string) => {
    const providerValue = svc.getProviderSettings(provider.name)[key];
    if (providerValue !== undefined) return providerValue;
    return svc.get(key);
  };

  setActiveProviderRuntimeContext(runtime);
  return { provider, runtimeContext: runtime, settingsService: svc };
}

const buildCallOptions = (
  provider: AnthropicProvider,
  runtimeContext: ProviderRuntimeContext,
  settingsService: SettingsService,
  contents: IContent[],
) =>
  createProviderCallOptions({
    providerName: provider.name,
    contents,
    settings: settingsService,
    runtime: runtimeContext,
    config: runtimeContext.config,
  } as Parameters<typeof createProviderCallOptions>[0]);

async function consumeGenerator(
  provider: AnthropicProvider,
  callOptions: ReturnType<typeof createProviderCallOptions>,
): Promise<{ chunks: string[]; threw: boolean; error: unknown }> {
  const chunks: string[] = [];
  let threw = false;
  let error: unknown;
  try {
    const generator = provider.generateChatCompletion(callOptions);
    for await (const chunk of generator) {
      const text = chunk.blocks.find((b) => b.type === 'text');
      if (text !== undefined) chunks.push(text.text);
    }
  } catch (e) {
    threw = true;
    error = e;
  }
  return { chunks, threw, error };
}

describe('AnthropicProvider image recovery (@issue:3216)', () => {
  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('proactively sanitizes oversized history images so no 400 is sent', async () => {
    vi.clearAllMocks();
    const big = await pngBase64(3000, 3000);
    const { provider, runtimeContext, settingsService } = setupProvider({
      withImageBudget: true,
    });
    mockMessagesCreate.mockResolvedValue(createMockStream('ok'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: big,
            encoding: 'base64' as const,
          },
          { type: 'text', text: 'describe this' },
        ],
      },
    ];

    await consumeGenerator(
      provider,
      buildCallOptions(provider, runtimeContext, settingsService, messages),
    );

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const request = mockMessagesCreate.mock.calls[0][0];
    const allContent = JSON.stringify(request.messages);
    expect(allContent).toContain('dropped');
    expect(allContent).not.toContain(big);
  });

  it('retries exactly once after a 400 image-dimension error and succeeds', async () => {
    vi.clearAllMocks();
    const big = await pngBase64(3000, 3000);
    // NO image budget in config — the error's own limit is used for recovery.
    const { provider, runtimeContext, settingsService } = setupProvider({
      withImageBudget: false,
    });
    mockMessagesCreate
      .mockRejectedValueOnce(make400ImageDimensionError())
      .mockResolvedValueOnce(createMockStream('recovered'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: big,
            encoding: 'base64' as const,
          },
        ],
      },
    ];

    const result = await consumeGenerator(
      provider,
      buildCallOptions(provider, runtimeContext, settingsService, messages),
    );

    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
    expect(result.threw).toBe(false);
    expect(result.chunks.join('')).toContain('recovered');
    // The retry request must not contain the oversized image.
    const retryRequest = mockMessagesCreate.mock.calls[1][0];
    expect(JSON.stringify(retryRequest.messages)).not.toContain(big);
  });

  it('intersects a configured budget with the provider-reported recovery limit', async () => {
    vi.clearAllMocks();
    const image = await pngBase64(2200, 1000);
    const { provider, runtimeContext, settingsService } = setupProvider({
      withImageBudget: true,
      maxImageDimension: 2500,
    });
    mockMessagesCreate
      .mockRejectedValueOnce(make400ImageDimensionError())
      .mockResolvedValueOnce(createMockStream('recovered'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: image,
            encoding: 'base64' as const,
          },
        ],
      },
    ];

    const result = await consumeGenerator(
      provider,
      buildCallOptions(provider, runtimeContext, settingsService, messages),
    );

    expect(result.threw).toBe(false);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
    expect(
      JSON.stringify(mockMessagesCreate.mock.calls[0][0].messages),
    ).toContain(image);
    const retryMessages = JSON.stringify(
      mockMessagesCreate.mock.calls[1][0].messages,
    );
    expect(retryMessages).not.toContain(image);
  });

  it('does NOT retry for an unrelated 400 error', async () => {
    vi.clearAllMocks();
    const { provider, runtimeContext, settingsService } = setupProvider({
      withImageBudget: false,
    });
    mockMessagesCreate.mockRejectedValueOnce(make400UnrelatedError());

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hello' }],
      },
    ];

    const result = await consumeGenerator(
      provider,
      buildCallOptions(provider, runtimeContext, settingsService, messages),
    );

    expect(result.threw).toBe(true);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a second time if the sanitized request also fails', async () => {
    vi.clearAllMocks();
    const big = await pngBase64(3000, 3000);
    const { provider, runtimeContext, settingsService } = setupProvider({
      withImageBudget: false,
    });
    mockMessagesCreate
      .mockRejectedValueOnce(make400ImageDimensionError())
      .mockRejectedValueOnce(make400ImageDimensionError());

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: big,
            encoding: 'base64' as const,
          },
        ],
      },
    ];

    const result = await consumeGenerator(
      provider,
      buildCallOptions(provider, runtimeContext, settingsService, messages),
    );

    expect(result.threw).toBe(true);
    // First call (400) + one retry (also 400) = 2 total. No third attempt.
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
  });

  it('does NOT consume a transport slot for recovery when the signal is already aborted', async () => {
    vi.clearAllMocks();
    const big = await pngBase64(3000, 3000);
    const { provider, runtimeContext, settingsService } = setupProvider({
      withImageBudget: false,
    });

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: big,
            encoding: 'base64' as const,
          },
        ],
      },
    ];

    // Direct call with an explicit transport budget so slot consumption is
    // observable. The signal is aborted BEFORE recovery runs, so the
    // known-aborted recovery must bail out BEFORE consuming a slot.
    const baseOptions = buildCallOptions(
      provider,
      runtimeContext,
      settingsService,
      messages,
    );
    const attached = attachTransportAttemptBudget(baseOptions, 5);
    const abortController = new AbortController();
    mockMessagesCreate.mockImplementationOnce(() => {
      abortController.abort();
      return Promise.reject(make400ImageDimensionError());
    });
    // Preserve the narrowed options type while overriding the signal and
    // carrying the budget-bearing metadata from the attached copy.
    const abortedOptions = {
      ...baseOptions,
      invocation: {
        ...baseOptions.invocation,
        signal: abortController.signal,
      },
      metadata: attached.options.metadata,
    };

    const result = await consumeGenerator(provider, abortedOptions);

    // Recovery was skipped: the ORIGINAL 400 propagates (nothing sanitized).
    expect(result.threw).toBe(true);
    const errorMessage = String(
      result.error instanceof Error ? result.error.message : result.error,
    );
    expect(errorMessage).toContain('image dimensions');
    // The recovery retry never reached the transport.
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    // No transport slot was consumed by the known-aborted recovery.
    const budget = getTransportAttemptBudget(abortedOptions);
    expect(budget?.used).toBe(0);
  });

  it('retries once after a 400 when oversized image is nested in tool_result media', async () => {
    vi.clearAllMocks();
    const big = await pngBase64(3000, 3000);
    const { provider, runtimeContext, settingsService } = setupProvider({
      withImageBudget: false,
    });
    mockMessagesCreate
      .mockRejectedValueOnce(make400ImageDimensionError())
      .mockResolvedValueOnce(createMockStream('recovered-nested'));

    // Real neutral AI history: a tool_call from the assistant followed by a
    // tool_response carrying the oversized image — the actual read_file shape.
    const messages: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'toolu_abc',
            name: 'read_file',
            parameters: { absolute_path: 'big.png' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'toolu_abc',
            toolName: 'read_file',
            result: 'Read big.png',
          },
          {
            type: 'media',
            mimeType: 'image/png',
            data: big,
            encoding: 'base64' as const,
          },
        ],
      },
    ];

    const result = await consumeGenerator(
      provider,
      buildCallOptions(provider, runtimeContext, settingsService, messages),
    );

    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
    expect(result.threw).toBe(false);
    expect(result.chunks.join('')).toContain('recovered-nested');
    // The retry request must not contain the oversized image bytes anywhere.
    const retryRequest = mockMessagesCreate.mock.calls[1][0];
    expect(JSON.stringify(retryRequest.messages)).not.toContain(big);
    // The tool_result wrapper and pairing must survive in the retry body.
    const retryMessages = retryRequest.messages as Array<{
      content: unknown[];
    }>;
    const allBlocks = retryMessages.flatMap((msg) =>
      Array.isArray(msg.content) ? msg.content : [],
    );
    const toolResultBlock = allBlocks.find(
      (b): b is { tool_use_id?: string; type: string } =>
        typeof b === 'object' &&
        b !== null &&
        (b as { type: string }).type === 'tool_result',
    );
    expect(toolResultBlock).toBeDefined();
    expect(toolResultBlock?.tool_use_id).toBe('toolu_abc');
  });
});

describe('AnthropicProvider image recovery through RetryOrchestrator (@issue:3216 H2)', () => {
  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('dimension-400 then sanitized retry 429 = exactly two physical calls (budget-exhausted)', async () => {
    vi.clearAllMocks();
    const big = await pngBase64(3000, 3000);
    const { provider, runtimeContext, settingsService } = setupProvider({
      withImageBudget: false,
    });
    mockMessagesCreate
      .mockRejectedValueOnce(make400ImageDimensionError())
      .mockRejectedValueOnce(make429RateLimitError());

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: big,
            encoding: 'base64' as const,
          },
        ],
      },
    ];

    // Wrap in RetryOrchestrator with retries=2 (budget limit = 2 physical
    // calls). The recovery's sanitized retry must consume the 2nd slot so
    // the orchestrator does NOT make a third outer attempt.
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 2,
      initialDelayMs: 0,
    });

    const callOptions = createProviderCallOptions({
      providerName: provider.name,
      contents: messages,
      settings: settingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
      ephemerals: { retries: 2, retrywait: 0 },
    } as Parameters<typeof createProviderCallOptions>[0]);

    const chunks: string[] = [];
    let threw = false;
    try {
      const gen = orchestrator.generateChatCompletion(callOptions);
      for await (const chunk of gen) {
        const text = chunk.blocks.find((b) => b.type === 'text');
        if (text !== undefined) chunks.push(text.text);
      }
    } catch {
      threw = true;
    }

    expect(threw).toBe(true); // The 429 exhausts the budget → throws
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2); // exactly two
    // The second call must be the sanitized retry (image removed)
    const retryReq = mockMessagesCreate.mock.calls[1][0];
    expect(JSON.stringify(retryReq.messages)).not.toContain(big);
  });

  it('sanitized retry error propagates verbatim; no third physical call', async () => {
    vi.clearAllMocks();
    const big = await pngBase64(3000, 3000);
    const { provider, runtimeContext, settingsService } = setupProvider({
      withImageBudget: false,
    });
    // phys 1: poisoned original → 400 image-dimension error.
    // phys 2: sanitized retry → distinct 500 marker error.
    mockMessagesCreate
      .mockRejectedValueOnce(make400ImageDimensionError())
      .mockRejectedValueOnce(make500MarkerError());

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: big,
            encoding: 'base64' as const,
          },
        ],
      },
    ];

    // retries=2 → transport budget limit = 2 physical calls. The sanitized
    // retry consumes the 2nd slot, so the orchestrator must stop there.
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 2,
      initialDelayMs: 0,
    });

    const callOptions = createProviderCallOptions({
      providerName: provider.name,
      contents: messages,
      settings: settingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
      ephemerals: { retries: 2, retrywait: 0 },
    } as Parameters<typeof createProviderCallOptions>[0]);

    let caught: unknown;
    try {
      const gen = orchestrator.generateChatCompletion(callOptions);
      for await (const _chunk of gen) {
        // drain
      }
    } catch (e) {
      caught = e;
    }

    // The sanitized retry's OWN error is the real outcome and must propagate
    // so the outer retry classification sees it — NOT the original 400.
    expect(caught).toBeDefined();
    const caughtMessage = String(
      caught instanceof Error ? caught.message : caught,
    );
    expect(caughtMessage).toContain(
      'RETRY_MARKER_PROPAGATED_FROM_SANITIZED_RETRY',
    );
    expect(caughtMessage).not.toContain('many-image');
    // Exactly two physical calls: poisoned original + sanitized retry.
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
  });

  it('does NOT resend the poisoned original on a subsequent outer attempt', async () => {
    vi.clearAllMocks();
    const big = await pngBase64(3000, 3000);
    const { provider, runtimeContext, settingsService } = setupProvider({
      withImageBudget: false,
    });
    mockMessagesCreate
      .mockRejectedValueOnce(make400ImageDimensionError()) // phys 1: poisoned
      .mockRejectedValueOnce(make429RateLimitError()) // phys 2: sanitized retry
      .mockResolvedValueOnce(createMockStream('third-ok')); // phys 3: sanitized

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: big,
            encoding: 'base64' as const,
          },
        ],
      },
    ];

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 3,
      initialDelayMs: 0,
    });

    const callOptions = createProviderCallOptions({
      providerName: provider.name,
      contents: messages,
      settings: settingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
      ephemerals: { retries: 3, retrywait: 0 },
    } as Parameters<typeof createProviderCallOptions>[0]);

    const chunks: string[] = [];
    let threw = false;
    try {
      const gen = orchestrator.generateChatCompletion(callOptions);
      for await (const chunk of gen) {
        const text = chunk.blocks.find((b) => b.type === 'text');
        if (text !== undefined) chunks.push(text.text);
      }
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(chunks.join('')).toContain('third-ok');
    expect(mockMessagesCreate).toHaveBeenCalledTimes(3);
    // Call 1: the poisoned original (contains big)
    expect(
      JSON.stringify(mockMessagesCreate.mock.calls[0][0].messages),
    ).toContain(big);
    // Call 2: sanitized retry (no big)
    expect(
      JSON.stringify(mockMessagesCreate.mock.calls[1][0].messages),
    ).not.toContain(big);
    // Call 3: sanitized body reused (no big, no resend of poisoned original)
    expect(
      JSON.stringify(mockMessagesCreate.mock.calls[2][0].messages),
    ).not.toContain(big);
  });
});
