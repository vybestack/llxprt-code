/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  extractFailoverSettings,
  isImmediateFailoverError,
  shouldFailover,
} from '../loadBalancing/failoverSettings.js';
import {
  isTimeoutError,
  wrapWithTimeout,
} from '../loadBalancing/streamTimeout.js';
import { getBaseUrlFromProvider } from '../baseUrlResolver.js';
import { ProviderCapabilitiesService } from '../providerCapabilitiesService.js';
import { normalizeRuntimeInputs } from '../runtimeNormalizer.js';
import { buildRoundRobinResolvedOptions } from '../loadBalancing/resolvedOptionsBuilder.js';
import { BackendMetricsCollector } from '../loadBalancing/backendMetrics.js';
import {
  normalizeChatCompletionOptions,
  ensureRuntimeContext,
} from '../logging/optionsNormalizer.js';
import { accumulateTokenUsage } from '../logging/tokenAccumulator.js';
import { extractTokenCountsFromResponse } from '../logging/tokenCounts.js';
import {
  resolveFromAsyncLocalStorage,
  resolveFromActiveContext,
  resolveFromFirstRegistered,
} from '../runtime/runtimeIdentityResolution.js';

function debugLoggerStub(): DebugLogger {
  return {
    debug: () => {},
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as DebugLogger;
}
function providerStub(overrides: Partial<IProvider> = {}): IProvider {
  return {
    name: 'provider-a',
    getModels: vi.fn().mockResolvedValue([]),
    getDefaultModel: vi.fn().mockReturnValue('default-model'),
    generateChatCompletion: vi.fn(),
    getServerTools: vi.fn().mockReturnValue([]),
    invokeServerTool: vi.fn().mockRejectedValue(new Error('not implemented')),
    ...overrides,
  } as unknown as IProvider;
}

function statusError(status: number): Error {
  return Object.assign(new Error(`status ${status}`), { status });
}

async function collectChunks(
  stream: AsyncIterable<IContent>,
): Promise<IContent[]> {
  const chunks: IContent[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('extracted provider helper behavior', () => {
  it('preserves load-balancer failover defaults and status classification', () => {
    const defaults = extractFailoverSettings(undefined);

    expect(defaults.retryCount).toBe(1);
    expect(defaults.retryDelayMs).toBe(0);
    expect(defaults.failoverOnNetworkErrors).toBe(true);
    expect(shouldFailover(statusError(502), defaults)).toBe(true);
    expect(shouldFailover(statusError(404), defaults)).toBe(false);
    expect(isImmediateFailoverError(statusError(401))).toBe(true);

    const custom = extractFailoverSettings({
      failover_retry_count: 120,
      failover_status_codes: [408, 'bad', 409],
      failover_on_network_errors: false,
    });
    expect(custom.retryCount).toBe(100);
    expect(custom.failoverStatusCodes).toStrictEqual([408, 409]);
    expect(shouldFailover(statusError(409), custom)).toBe(true);
    expect(shouldFailover(statusError(502), custom)).toBe(false);
  });

  it('preserves first-chunk timeout behavior and timeout identification', async () => {
    async function* delayedFirstChunk(): AsyncIterableIterator<IContent> {
      await new Promise((resolve) => setTimeout(resolve, 20));
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'late' }] };
    }

    await expect(
      collectChunks(
        wrapWithTimeout(
          delayedFirstChunk(),
          1,
          'timeout-profile',
          debugLoggerStub(),
        ),
      ),
    ).rejects.toThrow('Request timeout after 1ms');
    expect(isTimeoutError(new Error('Request timeout after 1ms'))).toBe(true);
  });

  it('preserves backend token extraction and request metrics accumulation', () => {
    const metrics = new Map();
    const collector = new BackendMetricsCollector(metrics);
    const startTime = collector.recordRequestStart('primary');
    const tokens = BackendMetricsCollector.extractTokenCount([
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 2, output_tokens: 3 },
      } as unknown as IContent,
    ]);

    collector.recordRequestSuccess('primary', startTime, tokens);

    expect(tokens).toBe(5);
    expect(metrics.get('primary')).toMatchObject({
      requests: 1,
      successes: 1,
      tokens: 5,
    });
  });

  it('preserves logging option normalization and missing-config fail-fast behavior', () => {
    const settingsService = new SettingsService();
    const config = { getConversationLoggingEnabled: () => false } as Config;
    const normalized = normalizeChatCompletionOptions(
      [{ speaker: 'user', blocks: [{ type: 'text', text: 'hello' }] }],
      undefined,
      {
        providerName: 'provider-a',
        statelessRuntimeMetadata: { inherited: true },
        runtimeContextResolver: () => ({
          settingsService,
          config,
          runtimeId: 'runtime-a',
          metadata: { runtime: true },
        }),
        optionsNormalizer: (options) => ({
          ...options,
          metadata: { ...options.metadata, normalized: true },
        }),
      },
    );

    expect(normalized.runtime?.runtimeId).toBe('runtime-a');
    expect(normalized.settings).toBe(settingsService);
    expect(normalized.metadata).toMatchObject({
      inherited: true,
      runtime: true,
      source: 'LoggingProviderWrapper.generateChatCompletion',
      normalized: true,
    });

    expect(() =>
      ensureRuntimeContext(
        { contents: [], runtime: { settingsService } },
        'provider-a',
        debugLoggerStub(),
      ),
    ).toThrow(/config/);
  });

  it('preserves token count extraction and session accumulation semantics', () => {
    const accumulateSessionTokens = vi.fn();
    const config = {
      getProviderManager: () => ({ accumulateSessionTokens }),
    } as unknown as Config;
    const tokenCounts = extractTokenCountsFromResponse({
      usage: {
        prompt_tokens: 2,
        completion_tokens: 3,
        cached_content_tokens: 4,
        cache_read_input_tokens: 5,
      },
    });

    accumulateTokenUsage(tokenCounts, config, 'provider-a', debugLoggerStub());

    expect(tokenCounts).toMatchObject({
      input_token_count: 2,
      output_token_count: 3,
      cached_content_token_count: 4,
      cache_read_input_tokens: 5,
    });
    expect(accumulateSessionTokens).toHaveBeenCalledWith(
      'provider-a',
      expect.objectContaining({
        input: 2,
        output: 3,
        cache: 4,
        cacheReads: 5,
      }),
    );
  });

  it('preserves runtime identity fallback ordering', () => {
    const registry = new Map<string, unknown>([['registered-runtime', {}]]);
    const scopedIdentity = {
      runtimeId: 'scoped-runtime',
      metadata: { scoped: true },
    };
    const settingsService = new SettingsService();
    const config = { getConversationLoggingEnabled: () => false } as Config;

    setActiveProviderRuntimeContext({
      settingsService,
      config,
      runtimeId: 'unregistered-active-runtime',
      metadata: { active: true },
    });

    try {
      expect(resolveFromAsyncLocalStorage(scopedIdentity)).toBe(scopedIdentity);
      expect(resolveFromFirstRegistered(registry)).toStrictEqual({
        runtimeId: 'registered-runtime',
        metadata: {},
      });
      expect(
        resolveFromActiveContext(registry, 'legacy-runtime'),
      ).toStrictEqual({
        runtimeId: 'registered-runtime',
        metadata: { active: true },
      });
    } finally {
      clearActiveProviderRuntimeContext();
    }
  });

  it('preserves provider base-url chain traversal and capability fallbacks', () => {
    const settingsService = new SettingsService();
    settingsService.setProviderSetting('openai', 'toolFormat', 'json_schema');
    const provider = providerStub({
      name: 'openai',
      getDefaultModel: vi.fn().mockReturnValue('gpt-4o'),
      getServerTools: vi.fn().mockReturnValue(['web_search']),
    });
    const capabilitiesMap = new Map();
    const service = new ProviderCapabilitiesService(capabilitiesMap);
    const config = {
      getProvider: () => 'openai',
      getModel: () => 'gpt-4-vision-preview',
    } as unknown as Config;

    const wrapper = {
      name: 'wrapper',
      wrappedProvider: {
        ...providerStub({ name: 'inner' }),
        providerConfig: { baseUrl: ' https://inner.example.test ' },
      },
    } as unknown as IProvider;
    const capabilities = service.captureProviderCapabilities(
      provider,
      settingsService,
      config,
    );
    capabilitiesMap.set('openai', capabilities);

    expect(getBaseUrlFromProvider(wrapper)).toBe('https://inner.example.test');
    expect(capabilities.supportsTools).toBe(true);
    expect(capabilities.supportsVision).toBe(true);
    expect(
      service.createProviderContext(
        provider,
        capabilities,
        settingsService,
        config,
      ),
    ).toMatchObject({
      providerName: 'openai',
      currentModel: 'gpt-4-vision-preview',
      toolFormat: 'json_schema',
      isPaidMode: false,
    });
  });

  it('preserves runtime normalization precedence and invocation snapshot behavior', () => {
    const settingsService = new SettingsService();
    settingsService.set('activeProvider', 'provider-a');
    settingsService.set('temperature', 0.7);
    settingsService.setProviderSetting('provider-a', 'model', 'settings-model');
    settingsService.setProviderSetting(
      'provider-a',
      'base-url',
      'https://settings.example.test',
    );
    const config = {
      getModel: () => 'config-model',
      getEphemeralSetting: (key: string) => {
        if (key === 'auth-key') {
          return 'global-token';
        }
        if (key === 'base-url') {
          return 'https://config.example.test';
        }
        return undefined;
      },
      getSettingsService: () => settingsService,
      getUserMemory: () => 'remember this',
    } as unknown as Config;
    const rawOptions: GenerateChatOptions = {
      contents: [],
      runtime: {
        settingsService,
        config,
        runtimeId: 'runtime-a',
        metadata: { existing: true },
      },
    };

    const normalized = normalizeRuntimeInputs(rawOptions, {
      getActiveProviderName: () => 'provider-a',
      getProvider: () => providerStub(),
    });

    expect(normalized.resolved).toMatchObject({
      model: 'settings-model',
      baseURL: 'https://settings.example.test',
      authToken: 'global-token',
    });
    expect(normalized.userMemory).toBe('remember this');
    expect(normalized.invocation?.runtimeId).toBe('runtime-a');
    expect(normalized.invocation?.ephemerals).toMatchObject({
      'provider-a': {
        model: 'settings-model',
        'base-url': 'https://settings.example.test',
      },
    });
  });

  it('preserves load-balancer resolved delegate option construction', () => {
    const settingsService = new SettingsService();
    const config = { getConversationLoggingEnabled: () => false } as Config;
    const options: GenerateChatOptions = {
      contents: [],
      settings: settingsService,
      runtime: {
        settingsService,
        config,
        runtimeId: 'lb-runtime',
        metadata: { parent: true },
      },
      metadata: { request: true },
      resolved: { telemetry: { trace: 'abc' } },
    };

    const resolved = buildRoundRobinResolvedOptions(
      {
        name: 'primary',
        providerName: 'openai',
        model: 'gpt-4o',
        baseURL: 'https://delegate.example.test',
        authToken: 'delegate-token',
        ephemeralSettings: { streaming: false },
        modelParams: { temperature: 0.2, max_tokens: 1024 },
      },
      options,
      {
        lbProfileEphemeralSettings: { streaming: true, extra: 'value' },
        lbProfileModelParams: { maxTokens: 2048 },
        logger: debugLoggerStub(),
        providerName: 'load-balancer',
        getEffectiveContextLimit: () => 32000,
      },
    );

    expect(resolved.resolved).toMatchObject({
      model: 'gpt-4o',
      baseURL: 'https://delegate.example.test',
      authToken: 'delegate-token',
      temperature: 0.2,
      maxTokens: 2048,
      streaming: true,
    });
    expect(resolved.metadata).toMatchObject({
      request: true,
      loadBalancerDelegate: true,
      ephemeralSettings: {
        streaming: true,
        extra: 'value',
        'context-limit': 32000,
      },
      modelParams: { temperature: 0.2, max_tokens: 1024, maxTokens: 2048 },
    });
    expect(resolved.invocation?.runtimeId).toBe('lb-runtime');
    expect(resolved.invocation?.ephemerals).toMatchObject({
      streaming: true,
      extra: 'value',
      temperature: 0.2,
      max_tokens: 1024,
      maxTokens: 2048,
    });
  });
});
