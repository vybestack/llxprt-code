import { useRuntimeTestOwners as installRuntimeTestOwners } from '../runtime/__tests__/runtime-owner-test-helpers.js';
const fixtureOwners = installRuntimeTestOwners();
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared test helpers for LoggingProviderWrapper telemetry tests.
 */

import type { CanonicalFinishReason } from '@vybestack/llxprt-code-core/llm-types/finishReasons.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

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

  constructor(private finishReason: CanonicalFinishReason) {}

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'stub-model';
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
  new Config({
    sessionId: 'wrapper-test',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'stub-model',
    debugMode: false,
    telemetry: { enabled: false, logConversations: loggingEnabled },
  });

export const createRuntimeContext = (
  settings: SettingsService,
  config: Config,
): ProviderRuntimeContext & {
  sessionSettings: ReturnType<typeof fixtureOwners.adopt>['settingsOwner'];
} => ({
  runtimeId: 'test-runtime',
  settingsService: settings,
  config,
  sessionSettings: fixtureOwners.adopt(config, settings).settingsOwner,
  metadata: { source: 'LoggingProviderWrapper.test-helpers' },
});
