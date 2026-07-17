/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Comprehensive behavioral tests for the attempt lifecycle telemetry pipeline.
 *
 * These tests exercise the full pipeline:
 *   LoggingProviderWrapper → RetryOrchestrator → mock provider transport
 *
 * Only the external transport (the raw provider) is mocked. All telemetry
 * flows through real loggers → real UiTelemetryService → real
 * SessionMetricsAggregator.
 *
 * Verifies: exactly-once terminal records, retry success after failure,
 * consumer abort, conversation logging both ways, errors, cache absent vs
 * reported-zero, provider switch, clear, and canonical reconciliation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry/telemetry/uiTelemetry.js';
import * as sdk from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';

// --- Mock transport providers ---

const TOKEN_USAGE = {
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
  cachedTokens: 10,
} as const;

const TOKEN_USAGE_NO_CACHE = {
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
} as const;

/**
 * Provider that yields a single chunk with token usage on the Nth call.
 * Throws on calls before N.
 */
class RetryThenSucceedProvider implements IProvider {
  name = 'retry-then-succeed';
  private callCount = 0;
  readonly succeedOnCall: number;

  constructor(succeedOnCall: number = 2) {
    this.succeedOnCall = succeedOnCall;
  }

  async getModels(): Promise<never[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'retry-model';
  }
  getServerTools(): string[] {
    return [];
  }
  async invokeServerTool(): Promise<unknown> {
    return {};
  }

  generateChatCompletion(
    _options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.callCount++;
    if (this.callCount < this.succeedOnCall) {
      const err = new Error('Transient 503 error') as Error & {
        status: number;
        statusCode: number;
      };
      err.status = 503;
      err.statusCode = 503;
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next(): Promise<IteratorResult<IContent>> {
          return Promise.reject(err);
        },
        return(): Promise<IteratorResult<IContent>> {
          return Promise.resolve({ done: true, value: undefined });
        },
        throw(e?: unknown): Promise<IteratorResult<IContent>> {
          return Promise.reject(e);
        },
      };
    }

    return (async function* (): AsyncGenerator<IContent> {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Success after retry' }],
        metadata: { usage: TOKEN_USAGE },
      } as IContent;
    })();
  }
}

/**
 * Provider that yields some chunks then the consumer stops iterating.
 */
class AbortableProvider implements IProvider {
  name = 'abortable-provider';
  private aborted = false;

  async getModels(): Promise<never[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'abort-model';
  }
  getServerTools(): string[] {
    return [];
  }
  async invokeServerTool(): Promise<unknown> {
    return {};
  }

  generateChatCompletion(
    _options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const isAborted = () => this.aborted;
    return (async function* (): AsyncGenerator<IContent> {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'chunk1' }],
        metadata: { usage: TOKEN_USAGE },
      } as IContent;
      // If not aborted, yield more
      if (!isAborted()) {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'chunk2' }],
        } as IContent;
      }
    })();
  }

  signalAbort(): void {
    this.aborted = true;
  }
}

/**
 * Provider that always throws without yielding.
 */
class AlwaysErrorProvider implements IProvider {
  name = 'always-error';
  readonly error: Error;

  constructor(error?: Error) {
    this.error = error ?? new Error('Permanent API failure');
  }

  async getModels(): Promise<never[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'error-model';
  }
  getServerTools(): string[] {
    return [];
  }
  async invokeServerTool(): Promise<unknown> {
    return {};
  }

  generateChatCompletion(
    _options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const err = this.error;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next(): Promise<IteratorResult<IContent>> {
        return Promise.reject(err);
      },
      return(): Promise<IteratorResult<IContent>> {
        return Promise.resolve({ done: true, value: undefined });
      },
      throw(e?: unknown): Promise<IteratorResult<IContent>> {
        return Promise.reject(e);
      },
    };
  }
}

/**
 * Provider that yields chunks with specific cache data.
 */
class CacheDataProvider implements IProvider {
  name = 'cache-data-provider';
  readonly cacheReads: number | undefined;
  readonly cacheWrites: number | null;
  readonly includeCacheInUsage: boolean;

  constructor(
    cacheReads: number | undefined,
    cacheWrites: number | null,
    includeCacheInUsage = true,
  ) {
    this.cacheReads = cacheReads;
    this.cacheWrites = cacheWrites;
    this.includeCacheInUsage = includeCacheInUsage;
  }

  async getModels(): Promise<never[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'cache-model';
  }
  getServerTools(): string[] {
    return [];
  }
  async invokeServerTool(): Promise<unknown> {
    return {};
  }

  generateChatCompletion(
    _options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const cacheReads = this.cacheReads;
    const cacheWrites = this.cacheWrites;
    // Build usage using recognized field names so the zero-cache
    // scenario genuinely overrides cachedTokens instead of inheriting 10.
    const usage: Record<string, unknown> = {
      ...(this.includeCacheInUsage ? TOKEN_USAGE : TOKEN_USAGE_NO_CACHE),
    };
    if (this.includeCacheInUsage) {
      if (cacheReads !== undefined) {
        usage.cachedTokens = cacheReads;
      }
      if (cacheWrites !== null) {
        usage.cacheCreationTokens = cacheWrites;
      }
    }
    return (async function* (): AsyncGenerator<IContent> {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Cache test' }],
        metadata: { usage },
      } as IContent;
    })();
  }
}

function makeContent(): IContent[] {
  return [
    { speaker: 'user', blocks: [{ type: 'text', text: 'Hello' }] },
  ] as IContent[];
}

function makeOptions(
  config: Config,
  contents: IContent[],
): GenerateChatOptions {
  return {
    contents,
    invocation: {
      settingsService: {
        getConfig: () => config,
      } as never,
      config,
    },
    resolved: {
      model: 'test-model',
    },
  };
}

function createConfig(loggingEnabled = false): Config {
  return {
    getConversationLoggingEnabled: () => loggingEnabled,
    getConversationLogPath: () => '/tmp/test',
    getRedactionConfig: () => ({
      redactApiKeys: false,
      redactCredentials: false,
      redactFilePaths: false,
      redactUrls: false,
      redactEmails: false,
      redactPersonalInfo: false,
    }),
    getProviderManager: () => ({
      accumulateSessionTokens: vi.fn(),
    }),
    getSessionId: () => 'test-session',
    getTelemetryLogPromptsEnabled: () => false,
  } as unknown as Config;
}

/**
 * Build a full provider stack: LoggingProviderWrapper(RetryOrchestrator(transport)).
 */
function buildStack(
  transport: IProvider,
  config: Config,
  retryConfig?: {
    maxAttempts?: number;
    initialDelayMs?: number;
  },
): LoggingProviderWrapper {
  const retry = new RetryOrchestrator(transport, {
    maxAttempts: retryConfig?.maxAttempts ?? 3,
    initialDelayMs: retryConfig?.initialDelayMs ?? 1,
    maxDelayMs: 10,
  });
  const wrapper = new LoggingProviderWrapper(retry, config);
  wrapper.setRuntimeContextResolver(() => ({
    runtimeId: 'test',
    settingsService: { getConfig: () => config } as never,
    config,
    metadata: {},
  }));
  return wrapper;
}

async function consumeStream(
  stream: AsyncIterableIterator<IContent>,
): Promise<void> {
  for await (const _chunk of stream) {
    void _chunk;
  }
}

describe('Attempt lifecycle telemetry (full pipeline)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
    uiTelemetryService.reset();
  });

  describe('export disabled/enabled parity', () => {
    it('aggregates locally even when SDK is not initialized', async () => {
      vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
      const config = createConfig(false);
      const wrapper = buildStack(new RetryThenSucceedProvider(1), config);
      await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );
      const metrics = uiTelemetryService.getMetrics();
      expect(Object.keys(metrics.models)).toHaveLength(1);
    });

    it('aggregates locally when SDK IS initialized (parity)', async () => {
      vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(true);
      const config = createConfig(false);
      const wrapper = buildStack(new RetryThenSucceedProvider(1), config);
      await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );
      const metrics = uiTelemetryService.getMetrics();
      expect(Object.keys(metrics.models)).toHaveLength(1);
    });
  });

  describe('retry success after failure', () => {
    it('emits one terminal error record + one terminal success record after retry', async () => {
      const config = createConfig(false);
      // Fail first, succeed on second attempt
      const wrapper = buildStack(new RetryThenSucceedProvider(2), config, {
        maxAttempts: 3,
        initialDelayMs: 1,
      });
      await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );
      const snap = uiTelemetryService.getSessionSnapshot();
      // 2 total attempts: 1 error + 1 success
      expect(snap.totalApiRequests).toBe(2);
      expect(snap.totalApiErrors).toBe(1);
    });
  });

  describe('consumer abort', () => {
    it('records aborted attempt without crashing', async () => {
      const config = createConfig(false);
      const provider = new AbortableProvider();
      const wrapper = buildStack(provider, config);
      const stream = wrapper.generateChatCompletion(
        makeOptions(config, makeContent()),
      );
      // Consume first chunk
      const result = await stream.next();
      expect(result.done).toBe(false);
      // Abort by calling return on the iterator
      await stream.return?.(undefined);
      // Deterministically wait for the telemetry pipeline to flush
      await vi.waitFor(() => {
        const snap = uiTelemetryService.getSessionSnapshot();
        // At least 1 request recorded (either success from normal completion
        // or the recorder processed the terminal event)
        expect(snap.totalApiRequests).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('conversation logging both ways', () => {
    it('works with conversation logging disabled (metrics-only path)', async () => {
      const config = createConfig(false);
      const wrapper = buildStack(new RetryThenSucceedProvider(1), config);
      await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );
      const metrics = uiTelemetryService.getMetrics();
      expect(Object.keys(metrics.models)).toHaveLength(1);
    });

    it('works with conversation logging enabled', async () => {
      const config = createConfig(true);
      const wrapper = buildStack(new RetryThenSucceedProvider(1), config);
      await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );
      const metrics = uiTelemetryService.getMetrics();
      expect(Object.keys(metrics.models)).toHaveLength(1);
    });
  });

  describe('errors', () => {
    it('records error when all retries fail', async () => {
      const config = createConfig(false);
      const wrapper = buildStack(new AlwaysErrorProvider(), config, {
        maxAttempts: 2,
        initialDelayMs: 1,
      });
      await expect(
        consumeStream(
          wrapper.generateChatCompletion(makeOptions(config, makeContent())),
        ),
      ).rejects.toThrow('Permanent API failure');
      const snap = uiTelemetryService.getSessionSnapshot();
      // Each retry attempt is recorded
      expect(snap.totalApiRequests).toBeGreaterThanOrEqual(1);
      expect(snap.totalApiErrors).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cache absent vs reported-zero', () => {
    it('hasReliableCacheData=false when cache reads are absent', async () => {
      const config = createConfig(false);
      // Pass false for includeCacheInUsage to avoid cachedTokens flowing through
      const wrapper = buildStack(
        new CacheDataProvider(undefined, null, false),
        config,
      );
      await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );
      const snap = uiTelemetryService.getSessionSnapshot();
      expect(snap.hasReliableCacheData).toBe(false);
      expect(snap.uncachedInputTps).toBeNull();
    });

    it('hasReliableCacheData=true when cache reads are reported (even zero)', async () => {
      const config = createConfig(false);
      const wrapper = buildStack(new CacheDataProvider(0, null), config);
      await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );
      const snap = uiTelemetryService.getSessionSnapshot();
      expect(snap.hasReliableCacheData).toBe(true);
    });
  });

  describe('provider switch preserves totals', () => {
    it('whole-session totals preserved across provider switches', async () => {
      const config = createConfig(false);

      // First provider
      const wrapper1 = buildStack(new RetryThenSucceedProvider(1), config);
      await consumeStream(
        wrapper1.generateChatCompletion(makeOptions(config, makeContent())),
      );

      // Simulate "switch" by using a different provider name
      const wrapper2 = buildStack(new CacheDataProvider(50, 10), config);
      await consumeStream(
        wrapper2.generateChatCompletion(makeOptions(config, makeContent())),
      );

      const snap = uiTelemetryService.getSessionSnapshot();
      // 2 requests across different providers
      expect(snap.totalApiRequests).toBe(2);
    });
  });

  describe('/clear resets all session state', () => {
    it('reset clears models, timing, cache, dedup', async () => {
      const config = createConfig(false);
      const wrapper = buildStack(new RetryThenSucceedProvider(1), config);
      await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );
      expect(
        Object.keys(uiTelemetryService.getMetrics().models).length,
      ).toBeGreaterThan(0);

      uiTelemetryService.reset();

      const metrics = uiTelemetryService.getMetrics();
      expect(Object.keys(metrics.models)).toHaveLength(0);
      expect(metrics.timing.completeTokensPerMinute).toBe(0);
      const snap = uiTelemetryService.getSessionSnapshot();
      expect(snap.totalApiRequests).toBe(0);
    });
  });

  describe('canonical snapshot reconciliation', () => {
    it('timing metrics match aggregator snapshot', async () => {
      const config = createConfig(false);
      const wrapper = buildStack(new RetryThenSucceedProvider(1), config);
      await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );

      const metrics = uiTelemetryService.getMetrics();
      const snap = uiTelemetryService.getSessionSnapshot();
      expect(metrics.timing.completeTokensPerMinute).toBe(
        snap.completeTokensPerMinute,
      );
      expect(metrics.timing.accumulatedApiTimeMs).toBe(
        snap.accumulatedApiTimeMs,
      );
      expect(metrics.timing.agentActiveTimeMs).toBe(snap.agentActiveTimeMs);
    });

    it('cache metrics match aggregator snapshot', async () => {
      const config = createConfig(false);
      const wrapper = buildStack(new CacheDataProvider(100, 50), config);
      await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );

      const metrics = uiTelemetryService.getMetrics();
      const snap = uiTelemetryService.getSessionSnapshot();
      expect(metrics.cache.hasReliableCacheData).toBe(
        snap.hasReliableCacheData,
      );
      expect(metrics.cache.totalCacheReads).toBe(snap.totalCacheReads);
      expect(metrics.cache.totalCacheWrites).toBe(snap.totalCacheWrites);
    });
  });

  describe('exactly-once terminal records', () => {
    it('a single successful attempt records exactly once', async () => {
      const config = createConfig(false);
      const wrapper = buildStack(new RetryThenSucceedProvider(1), config);
      await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );
      const snap = uiTelemetryService.getSessionSnapshot();
      expect(snap.totalApiRequests).toBe(1);
      expect(snap.totalApiErrors).toBe(0);
    });
  });

  describe('fail-open boundaries', () => {
    it('telemetry errors do not break the stream', async () => {
      const config = createConfig(false);
      // Sabotage the aggregator to throw
      const original = uiTelemetryService.addEvent;
      const throwingAddEvent = vi.fn(() => {
        throw new Error('Aggregator internal error');
      });
      uiTelemetryService.addEvent = throwingAddEvent;

      try {
        const wrapper = buildStack(new RetryThenSucceedProvider(1), config);
        // Stream should still complete despite telemetry errors
        await consumeStream(
          wrapper.generateChatCompletion(makeOptions(config, makeContent())),
        );

        // Verify the stream ran through the provider path
        expect(throwingAddEvent).toHaveBeenCalled();
      } finally {
        uiTelemetryService.addEvent = original;
      }
    });
  });
});
