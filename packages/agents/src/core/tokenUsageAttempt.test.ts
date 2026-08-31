/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3130 slice 3b — Attempt-level truth (AC-4).
 *
 * A retry turn (transient transport failure after partial output, followed by
 * a successful restart) must produce TWO token-usage records: one for the
 * abandoned attempt and one for the successful attempt. Each record carries
 * its `attempt_index` and a distinguishable `attempt_outcome`.
 *
 * The test drives the REAL stack (ChatSession → TurnProcessor →
 * StreamProcessor) with a fake provider, using the real network-error
 * classifier so the behavior is end-to-end and faithful to production.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ChatSession } from './chatSession.js';
import type { StreamEvent } from './chatSession.js';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

function makeTempLogPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-attempt-')),
    'usage.jsonl',
  );
}

function readJsonl(filePath: string): Array<Record<string, unknown>> {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (raw.length === 0) return [];
  return raw
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function createConnectionError(): Error {
  const error = new Error('Connection error.') as Error & {
    status?: number;
  };
  error.status = undefined;
  return error;
}

describe('Issue #3130 slice 3b — attempt-level token-usage records', () => {
  let settingsService: SettingsService;
  let config: Config;
  let manager: TestRuntimeProviderManager;
  let providerRuntime: ProviderRuntimeContext;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = new Config(createConfigParams(settingsService));

    settingsService.set('providers.stub.base-url', 'https://stub.example.com');
    settingsService.set('providers.stub.auth-key', 'stub-api-key');
    settingsService.set('providers.stub.model', 'stub-model');

    providerRuntime = createProviderRuntimeContext({
      settingsService,
      config,
      runtimeId: 'test.runtime',
      metadata: { source: 'tokenUsageAttempt.test' },
    });

    manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    config.setProviderManager(manager);
  });

  function buildChatSession(
    logFile: string,
    history?: HistoryService,
  ): { chat: ChatSession; logger: TokenUsageLogger } {
    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-attempt-test',
      provider: 'stub',
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: history ?? new HistoryService(),
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 128000,
        preserveThreshold: 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
        'reasoning.includeInContext': true,
      },
      provider: createProviderAdapterFromManager(config.getProviderManager()),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime: { ...providerRuntime },
    });

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );
    const logger = new TokenUsageLogger(true, logFile);
    chat.setTokenUsageLoggerForTesting(logger);
    return { chat, logger };
  }

  function registerProvider(
    generateChatCompletion: IProvider['generateChatCompletion'],
  ): void {
    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: async () => [],
      getDefaultModel: () => 'stub-model',
      generateChatCompletion,
    };
    manager.registerProvider(provider);
  }

  async function collectEvents(
    stream: AsyncGenerator<StreamEvent>,
  ): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    return events;
  }

  /**
   * @scenario Retry turn yields two token-usage records
   * @given attempt 0 yields partial text + usage metadata, then throws a
   *        transient connection error
   * @when the caller drains chat.sendMessageStream(...)
   * @then exactly TWO records are written, with attempt_index 0 (abandoned)
   *       and attempt_index 1 (success)
   */
  it('AC-12 retry turn: produces two records with attempt_index 0 and 1', async () => {
    const {
      attempt,
      generateChatCompletionMock,
      records,
      abandonedRecord,
      successRecord,
      attempt_outcomeObservation,
      actual_prompt_tokensObservation,
      attempt_outcomeObservation2,
      actual_prompt_tokensObservation2,
      actual_prompt_tokensObservation3,
      actual_prompt_tokensObservation4,
    } = await observeAC12RetryTurnProducesTwoRecordsWithAttemptIndex0And();
    expect(attempt).toBe(2);
    expect(generateChatCompletionMock).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(2);
    expect(abandonedRecord).toBeDefined();
    expect(attempt_outcomeObservation).toBe('abandoned');
    expect(actual_prompt_tokensObservation).toBe(4000);
    expect(successRecord).toBeDefined();
    expect(attempt_outcomeObservation2).toBe('success');
    expect(actual_prompt_tokensObservation2).toBe(4100);
    expect(abandonedRecord).not.toBe(successRecord);
    expect(actual_prompt_tokensObservation3).not.toBe(
      actual_prompt_tokensObservation4,
    );
  });

  const observeAC12RetryTurnProducesTwoRecordsWithAttemptIndex0And =
    async () => {
      const logFile = makeTempLogPath();
      let attempt = 0;
      const generateChatCompletionMock = vi.fn(async function* (
        _options: GenerateChatOptions | IContent[],
      ): AsyncGenerator<IContent> {
        attempt++;
        if (attempt === 1) {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'partial' }],
            metadata: {
              usage: {
                promptTokens: 4000,
                completionTokens: 5,
                totalTokens: 4005,
              },
            },
          };
          throw createConnectionError();
        }
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'recovered response' }],
        };
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: 4100,
              completionTokens: 10,
              totalTokens: 4110,
            },
          },
        };
      });
      registerProvider(generateChatCompletionMock);

      const { chat, logger } = buildChatSession(logFile);
      const promptId = 'prompt-attempt-retry';
      logger.recordEstimate(promptId, {
        provider: 'stub',
        model: 'stub-model',
        estimatedTokens: 200,
        estimator: 'core-fallback',
        tiktokenTokens: 180,
      });

      const stream = await chat.sendMessageStream(
        { message: 'trigger mid-stream connection error' },
        promptId,
      );
      await collectEvents(stream);

      const records = readJsonl(logFile);

      // Attempt 0: abandoned (output was yielded before the failure)
      const abandonedRecord = records.find((r) => r.attempt_index === 0);

      // Attempt 1: success
      const successRecord = records.find((r) => r.attempt_index === 1);

      // The two records must NOT overwrite each other

      // Cleanup
      try {
        fs.rmSync(path.dirname(logFile), { recursive: true, force: true });
      } catch {
        // best-effort
      }

      const attempt_outcomeObservation = abandonedRecord?.attempt_outcome;
      const actual_prompt_tokensObservation =
        abandonedRecord?.actual_prompt_tokens;
      const attempt_outcomeObservation2 = successRecord?.attempt_outcome;
      const actual_prompt_tokensObservation2 =
        successRecord?.actual_prompt_tokens;
      const actual_prompt_tokensObservation3 =
        abandonedRecord?.actual_prompt_tokens;
      const actual_prompt_tokensObservation4 =
        successRecord?.actual_prompt_tokens;
      return {
        attempt,
        generateChatCompletionMock,
        records,
        abandonedRecord,
        successRecord,
        attempt_outcomeObservation,
        actual_prompt_tokensObservation,
        attempt_outcomeObservation2,
        actual_prompt_tokensObservation2,
        actual_prompt_tokensObservation3,
        actual_prompt_tokensObservation4,
      };
    };

  /**
   * @scenario Single-attempt turn records attempt_index 0 with success
   */
  it('records attempt_index 0 and attempt_outcome success for a normal turn', async () => {
    const logFile = makeTempLogPath();
    const generateChatCompletionMock = vi.fn(async function* (
      _options: GenerateChatOptions | IContent[],
    ): AsyncGenerator<IContent> {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'hello' }],
      };
      yield {
        speaker: 'ai',
        blocks: [],
        metadata: {
          usage: {
            promptTokens: 3000,
            completionTokens: 8,
            totalTokens: 3008,
          },
        },
      };
    });
    registerProvider(generateChatCompletionMock);

    const { chat, logger } = buildChatSession(logFile);
    const promptId = 'prompt-attempt-single';
    logger.recordEstimate(promptId, {
      provider: 'stub',
      model: 'stub-model',
      estimatedTokens: 150,
      estimator: 'core-fallback',
      tiktokenTokens: 140,
    });

    const stream = await chat.sendMessageStream(
      { message: 'say hello' },
      promptId,
    );
    await collectEvents(stream);

    const records = readJsonl(logFile);
    expect(records).toHaveLength(1);
    expect(records[0].attempt_index).toBe(0);
    expect(records[0].attempt_outcome).toBe('success');

    try {
      fs.rmSync(path.dirname(logFile), { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
});
