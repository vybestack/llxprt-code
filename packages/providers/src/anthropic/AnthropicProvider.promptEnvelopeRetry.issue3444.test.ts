/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260909-ISSUE3444
 *
 * Issue #3444 — a RetryOrchestrator retry must not replay a spent
 * promptEnvelopeTransportToken through AnthropicProvider. The token maps to a
 * prepared media request that the attempt which consumed it releases in its
 * finally; a retry that replays the token fails at media consumption
 * (`Cannot consume media request contents after release`) and masks the real
 * transport error. Only the SDK transport is mocked; the provider, projection,
 * and RetryOrchestrator under test are real.
 */

import { vi, describe, it, expect, afterEach } from 'bun:test';
import { APIError } from '@anthropic-ai/sdk';
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

const RELEASE_ERROR = 'Cannot consume media request contents after release';

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

// Proven imageRecovery harness piece: keep the provider's INTERNAL retry
// loop out of the picture so both 429s propagate to the RetryOrchestrator,
// which is the layer under test.
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

    yield { type: 'message_stop' };
  },
});

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
    new Headers({ 'request-id': 'req_429', 'retry-after': '0' }),
  );
}

function setupProvider(): {
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
      runtimeId: 'anthropic.promptEnvelopeRetry.test',
      metadata: {
        source: 'AnthropicProvider.promptEnvelopeRetry.issue3444.test.ts',
      },
    },
  );
  const { provider, runtime, settingsService: svc } = result;
  runtime.config ??= createRuntimeConfigStub(svc);
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

function mediaMessages(png: string): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          mimeType: 'image/png',
          data: png,
          encoding: 'base64' as const,
        },
        { type: 'text', text: 'describe this image' },
      ],
    },
  ];
}

function errorMessage(error: unknown): string {
  return String(error instanceof Error ? error.message : error);
}

describe('AnthropicProvider prompt-envelope retry (@issue:3444)', () => {
  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('retries a projected media turn with a fresh envelope instead of the spent token', async () => {
    vi.clearAllMocks();
    // Leftover mock*Once queue entries leak across tests (a failed prep
    // never consumes its queued response); flush them explicitly.
    mockMessagesCreate.mockReset();
    const png = await pngBase64(64, 64);
    const { provider, runtimeContext, settingsService } = setupProvider();
    mockMessagesCreate
      .mockRejectedValueOnce(make429RateLimitError())
      .mockResolvedValueOnce(createMockStream('recovered'));

    const callOptions = createProviderCallOptions({
      providerName: provider.name,
      contents: mediaMessages(png),
      settings: settingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
      ephemerals: { retries: 2, retrywait: 0 },
    } as Parameters<typeof createProviderCallOptions>[0]);

    // The agent seam mints the projection and hands the token to the
    // orchestrator-wrapped provider, exactly as the production entry does.
    const projection = await provider.projectPromptEnvelope(callOptions);
    expect(projection.transportToken).toBeDefined();

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 2,
      initialDelayMs: 0,
    });

    const chunks: string[] = [];
    let threw = false;
    let error: unknown;
    try {
      const gen = orchestrator.generateChatCompletion({
        ...callOptions,
        promptEnvelopeTransportToken: projection.transportToken,
      });
      for await (const chunk of gen) {
        const text = chunk.blocks.find((b) => b.type === 'text');
        if (text !== undefined) chunks.push(text.text);
      }
    } catch (e) {
      threw = true;
      error = e;
    }

    expect(threw).toBe(false);
    expect(chunks.join('')).toContain('recovered');
    // Attempt 1 (429) + attempt 2 (recovered): both reached the transport.
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
    // Both attempts carried the full media payload — the image survives the
    // retry instead of being silently dropped with it.
    for (const call of mockMessagesCreate.mock.calls) {
      expect(JSON.stringify(call[0].messages)).toContain('base64');
    }
    if (error !== undefined) {
      expect(errorMessage(error)).not.toContain(RELEASE_ERROR);
    }
  });

  it('surfaces the terminal transport error, never the media-release error, when retries exhaust', async () => {
    vi.clearAllMocks();
    // Leftover mock*Once queue entries leak across tests (a failed prep
    // never consumes its queued response); flush them explicitly.
    mockMessagesCreate.mockReset();
    const png = await pngBase64(64, 64);
    const { provider, runtimeContext, settingsService } = setupProvider();
    mockMessagesCreate
      .mockRejectedValueOnce(make429RateLimitError())
      .mockRejectedValueOnce(make429RateLimitError());

    const callOptions = createProviderCallOptions({
      providerName: provider.name,
      contents: mediaMessages(png),
      settings: settingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
      ephemerals: { retries: 2, retrywait: 0 },
    } as Parameters<typeof createProviderCallOptions>[0]);

    const projection = await provider.projectPromptEnvelope(callOptions);

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 2,
      initialDelayMs: 0,
    });

    let caught: unknown;
    try {
      const gen = orchestrator.generateChatCompletion({
        ...callOptions,
        promptEnvelopeTransportToken: projection.transportToken,
      });
      for await (const _chunk of gen) {
        // The exhaust case yields nothing on the final failed attempt.
      }
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    // The real transport failure (rate limit) is what the consumer sees.
    expect(errorMessage(caught)).toContain('Rate limit');
    expect(errorMessage(caught)).not.toContain(RELEASE_ERROR);
    // Both physical attempts reached the SDK; neither died in preparation.
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
  });
});
