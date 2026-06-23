/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared test helpers for LoggingProviderWrapper telemetry tests.
 */

import type { GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { vi } from 'vitest';

const TOKEN_USAGE = {
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
  cachedTokens: 10,
} as const;

export class StubProvider {
  name = 'stub-provider';

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'stub-model';
  }

  getServerTools(): string[] {
    return [];
  }

  async invokeServerTool(
    _toolName: string,
    _params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    return {};
  }

  async *generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    void options;
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Test response' }],
      metadata: {
        usage: TOKEN_USAGE,
      },
    } as IContent;
  }
}

export class FinishReasonProvider {
  name = 'finish-reason-provider';

  constructor(private finishReason: string) {}

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'stub-model';
  }

  getServerTools(): string[] {
    return [];
  }

  async invokeServerTool(
    _toolName: string,
    _params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    return {};
  }

  async *generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    void options;
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Test response' }],
      metadata: {
        usage: TOKEN_USAGE,
        finishReason: this.finishReason,
      },
    } as IContent;
  }
}

export class ErrorProvider {
  name = 'error-provider';

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'error-model';
  }

  getServerTools(): string[] {
    return [];
  }

  async invokeServerTool(
    _toolName: string,
    _params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    return {};
  }

  /**
   * Async generator that throws immediately without yielding.
   * Implemented as a function returning an async iterator so it
   * does not require a yield in the generator body.
   */
  generateChatCompletion(
    _options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next(): Promise<IteratorResult<IContent>> {
        return Promise.reject(new Error('Simulated API error'));
      },
      return(): Promise<IteratorResult<IContent>> {
        return Promise.resolve({ done: true, value: undefined });
      },
      throw(error?: unknown): Promise<IteratorResult<IContent>> {
        return Promise.reject(error);
      },
    };
  }
}

export class StubRedactor {
  redactMessage(content: IContent): IContent {
    return content;
  }

  redactToolCall(tool: unknown): unknown {
    return tool;
  }

  redactResponseContent(content: string): string {
    return content;
  }
}

export const createConfigStub = (loggingEnabled = false): Config =>
  ({
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
  }) as unknown as Config;

export const createRuntimeContext = (
  settings: SettingsService,
  config: Config,
): ProviderRuntimeContext => ({
  runtimeId: 'test-runtime',
  settingsService: settings,
  config,
  metadata: { source: 'LoggingProviderWrapper.test-helpers' },
});
