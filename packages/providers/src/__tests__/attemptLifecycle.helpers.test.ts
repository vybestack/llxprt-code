/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IModel } from '../IModel.js';
import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { RuntimeSettingsState } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

/**
 * Creates a minimal RuntimeSettingsState stub that returns the given config
 * from getConfig() and no-ops all other SettingsService methods. This is
 * used by test stacks that exercise the LoggingProviderWrapper without
 * needing a full SettingsService instance.
 */
export function createTestSettingsService(
  _config: Config,
): RuntimeSettingsState {
  return {
    get: () => undefined,
    set: () => {},
    getProviderSettings: () => ({}),
    setProviderSetting: () => {},
    getAllGlobalSettings: () => ({}),
    clear: () => {},
    getSettings: () => Promise.resolve({}),
    updateSettings: () => Promise.resolve(),
  };
}

export function createConfig(loggingEnabled = false): Config {
  return {
    getConversationLoggingEnabled: () => loggingEnabled,
    getConversationLogPath: () => '/tmp/test-exact',
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
    getSessionId: () => 'test-session-exact',
    getTelemetryLogPromptsEnabled: () => false,
  } as unknown as Config;
}

export function makeContent(text = 'Hello'): IContent[] {
  return [
    {
      speaker: 'user',
      blocks: [{ type: 'text', text }],
    } as IContent,
  ];
}

export function makeOptions(
  config: Config,
  contents: IContent[],
): GenerateChatOptions {
  return {
    contents,
    invocation: {
      settingsService: createTestSettingsService(config),
      config,
    },
    resolved: { model: 'test-model' },
  };
}

/**
 * Creates options with an already-aborted signal in the runtime metadata
 * where the abort signal is read.
 */
export function makeAbortedOptions(
  config: Config,
  contents: IContent[],
): GenerateChatOptions {
  const controller = new AbortController();
  controller.abort();
  const options = makeOptions(config, contents);
  // The abort signal is read from metadata in the retry/load-balancer paths
  options.metadata = {
    ...(options.metadata ?? {}),
    abortSignal: controller.signal,
  };
  return options;
}

export async function consumeStream(
  stream: AsyncIterableIterator<IContent>,
): Promise<IContent[]> {
  const chunks: IContent[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

export function buildStack(
  transport: IProvider,
  config: Config,
  retryConfig?: { maxAttempts?: number; initialDelayMs?: number },
): LoggingProviderWrapper {
  const retry = new RetryOrchestrator(transport, {
    maxAttempts: retryConfig?.maxAttempts ?? 3,
    initialDelayMs: retryConfig?.initialDelayMs ?? 1,
    maxDelayMs: 10,
  });
  const wrapper = new LoggingProviderWrapper(retry, config);
  wrapper.setRuntimeContextResolver(() => ({
    runtimeId: 'test-exact',
    settingsService: createTestSettingsService(config),
    config,
    metadata: {},
  }));
  return wrapper;
}

export class SuccessProvider implements IProvider {
  name = 'success-provider';
  readonly chunks: IContent[];
  readonly transportAttemptOwnership?: 'provider';

  constructor(chunks: IContent[], ownership?: 'provider') {
    this.chunks = chunks;
    this.transportAttemptOwnership = ownership;
  }

  async getModels(): Promise<IModel[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'success-model';
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
    const chunks = this.chunks;
    return (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();
  }
}

export class SyncThrowProvider implements IProvider {
  name = 'sync-throw-provider';
  readonly error: Error;

  constructor(error?: Error) {
    this.error = error ?? new Error('Synchronous throw');
  }

  async getModels(): Promise<IModel[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'sync-throw-model';
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
    throw this.error;
  }
}

export class FailThenSucceedProvider implements IProvider {
  name = 'fail-then-succeed';
  private callCount = 0;
  readonly succeedOnCall: number;
  readonly successChunks: IContent[];
  readonly failError: Error;

  constructor(
    succeedOnCall: number,
    successChunks: IContent[],
    failError?: Error,
  ) {
    this.succeedOnCall = succeedOnCall;
    this.successChunks = successChunks;
    this.failError =
      failError ??
      (Object.assign(new Error('503 Transient'), {
        status: 503,
        statusCode: 503,
      }) as Error & { status: number; statusCode: number });
  }

  async getModels(): Promise<IModel[]> {
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
      const err = this.failError;
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next() {
          return Promise.reject(err);
        },
        return() {
          return Promise.resolve({ done: true, value: undefined });
        },
        throw(e?: unknown) {
          return Promise.reject(e);
        },
      };
    }
    const chunks = this.successChunks;
    return (async function* () {
      for (const c of chunks) {
        yield c;
      }
    })();
  }
}

export class AlwaysFailProvider implements IProvider {
  name = 'always-fail';
  readonly error: Error;

  constructor(error?: Error) {
    this.error = error ?? new Error('Permanent failure');
  }

  async getModels(): Promise<IModel[]> {
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
      next() {
        return Promise.reject(err);
      },
      return() {
        return Promise.resolve({ done: true, value: undefined });
      },
      throw(e?: unknown) {
        return Promise.reject(e);
      },
    };
  }
}

export class ConsumerAbortedProvider implements IProvider {
  name = 'consumer-aborted';
  readonly chunks: IContent[];

  constructor(chunks: IContent[]) {
    this.chunks = chunks;
  }

  async getModels(): Promise<IModel[]> {
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
    const chunks = this.chunks;
    return (async function* () {
      for (const c of chunks) {
        yield c;
      }
    })();
  }
}

export class MetadataOnlyProvider implements IProvider {
  name = 'metadata-only-provider';
  readonly usageChunk: IContent;
  readonly textChunks: IContent[];

  constructor(usageChunk: IContent, textChunks: IContent[]) {
    this.usageChunk = usageChunk;
    this.textChunks = textChunks;
  }

  async getModels(): Promise<IModel[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'metadata-model';
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
    const usageChunk = this.usageChunk;
    const textChunks = this.textChunks;
    return (async function* () {
      yield usageChunk;
      for (const c of textChunks) {
        yield c;
      }
    })();
  }
}

export const USAGE_WITH_REASONING: UsageStats = {
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
  reasoningTokens: 30,
  toolTokens: 15,
  cachedTokens: 10,
};

export const USAGE_BASIC: UsageStats = {
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
};

export const SUCCESS_CHUNKS: IContent[] = [
  {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'Hello' }],
    metadata: { usage: USAGE_BASIC },
  } as IContent,
];

describe('attemptLifecycle test helpers', () => {
  it('exports valid provider stubs and constants', () => {
    expect(new SuccessProvider(SUCCESS_CHUNKS).name).toBe('success-provider');
    expect(new SyncThrowProvider().name).toBe('sync-throw-provider');
    expect(SUCCESS_CHUNKS).toHaveLength(1);
  });
});
