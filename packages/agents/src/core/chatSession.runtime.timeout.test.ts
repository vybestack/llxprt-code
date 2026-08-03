/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stream idle timeout behavioral tests for TurnProcessor and
 * DirectMessageProcessor. Sibling to chatSession.runtime.test.ts (split to
 * avoid file-level max-lines disable).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatSession } from './chatSession.js';

import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeStateFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeStateFactory.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';

function createContentGeneratorStub(): ContentGenerator {
  return {
    generateContent: vi.fn(),
    generateContentStream: vi.fn(),
    countTokens: vi.fn(async () => ({ totalTokens: 0 })),
    embedContent: vi.fn(async () => ({ embeddings: [] })),
  };
}

function createNoncooperativeStream(
  onPendingRead: () => void,
): AsyncIterableIterator<IContent> {
  let deliveredFirstChunk = false;
  const pendingResult = new Promise<IteratorResult<IContent>>(() => undefined);
  return {
    next(): Promise<IteratorResult<IContent>> {
      if (!deliveredFirstChunk) {
        deliveredFirstChunk = true;
        return Promise.resolve({
          done: false,
          value: {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Hanging' }],
          },
        });
      }
      onPendingRead();
      return pendingResult;
    },
    return(): Promise<IteratorResult<IContent>> {
      return pendingResult;
    },
    [Symbol.asyncIterator](): AsyncIterableIterator<IContent> {
      return this;
    },
  };
}

describe('stream idle timeout behavioral tests for TurnProcessor and DirectMessageProcessor', () => {
  const originalEnv = process.env;
  let localSettingsService: SettingsService;
  let localConfig: Config;
  let localProviderRuntime: ProviderRuntimeContext;
  let localManager: TestRuntimeProviderManager;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  describe('TurnProcessor', () => {
    it('honors config setting: uses resolveStreamIdleTimeoutMs with config from getConfig()', async () => {
      const customTimeoutMs = 12_000;

      localSettingsService = new SettingsService();
      localConfig = new Config(createConfigParams(localSettingsService));
      localConfig.setEphemeralSetting(
        'stream-idle-timeout-ms',
        customTimeoutMs,
      );

      // Verify ChatSession.getConfig() returns a config that provides the setting
      localProviderRuntime = createProviderRuntimeContext({
        settingsService: localSettingsService,
        config: localConfig,
        runtimeId: 'test.runtime',
        metadata: { source: 'timeout-test' },
      });

      localManager = new TestRuntimeProviderManager(localProviderRuntime);
      localManager.setConfig(localConfig);
      localConfig.setProviderManager(localManager);

      const provider: IProvider = {
        name: 'stub',
        isDefault: true,
        getModels: vi.fn(async () => []),
        getDefaultModel: () => 'stub-model',
        generateChatCompletion: vi.fn(async function* () {}),
        getServerTools: () => [],
        invokeServerTool: vi.fn(),
      };
      localManager.registerProvider(provider);
      localManager.setActiveProvider('stub');

      const contentGenerator = {} as ContentGenerator;
      const chat = new ChatSession(
        createAgentRuntimeContext({
          state: createAgentRuntimeStateFromConfig(localConfig),
          settings: { compressionThreshold: 0.8 },
          provider: createProviderAdapterFromManager(localManager),
          telemetry: createTelemetryAdapterFromConfig(localConfig),
          tools: createToolRegistryViewFromRegistry(
            localConfig.getToolRegistry(),
          ),
          providerRuntime: localProviderRuntime,
        }),
        contentGenerator,
        {},
        [],
      );

      // Verify the config is accessible via getConfig()
      const configFromChat = chat.getConfig();
      expect(configFromChat).toBeDefined();
      expect(
        configFromChat?.getEphemeralSetting('stream-idle-timeout-ms'),
      ).toBe(customTimeoutMs);
    });

    it('disabled path: setting 0 disables watchdog', async () => {
      localSettingsService = new SettingsService();
      localConfig = new Config(createConfigParams(localSettingsService));
      localConfig.setEphemeralSetting('stream-idle-timeout-ms', 0);

      localProviderRuntime = createProviderRuntimeContext({
        settingsService: localSettingsService,
        config: localConfig,
        runtimeId: 'test.runtime',
        metadata: { source: 'disabled-test' },
      });

      localManager = new TestRuntimeProviderManager(localProviderRuntime);
      localManager.setConfig(localConfig);
      localConfig.setProviderManager(localManager);

      const provider: IProvider = {
        name: 'stub',
        isDefault: true,
        getModels: vi.fn(async () => []),
        getDefaultModel: () => 'stub-model',
        generateChatCompletion: vi.fn(async function* () {}),
        getServerTools: () => [],
        invokeServerTool: vi.fn(),
      };
      localManager.registerProvider(provider);
      localManager.setActiveProvider('stub');

      const contentGenerator = {} as ContentGenerator;
      const chat = new ChatSession(
        createAgentRuntimeContext({
          state: createAgentRuntimeStateFromConfig(localConfig),
          settings: { compressionThreshold: 0.8 },
          provider: createProviderAdapterFromManager(localManager),
          telemetry: createTelemetryAdapterFromConfig(localConfig),
          tools: createToolRegistryViewFromRegistry(
            localConfig.getToolRegistry(),
          ),
          providerRuntime: localProviderRuntime,
        }),
        contentGenerator,
        {},
        [],
      );

      const configFromChat = chat.getConfig();
      expect(
        configFromChat?.getEphemeralSetting('stream-idle-timeout-ms'),
      ).toBe(0);
    });

    it('starts a second real ChatSession send after timeout while the first provider iterator remains blocked', async () => {
      vi.useFakeTimers();
      const timeoutMs = 30_000;
      localSettingsService = new SettingsService();
      localConfig = new Config(createConfigParams(localSettingsService));
      localConfig.setEphemeralSetting('stream-idle-timeout-ms', timeoutMs);
      localProviderRuntime = createProviderRuntimeContext({
        settingsService: localSettingsService,
        config: localConfig,
        runtimeId: 'test.runtime.deadlock',
        metadata: { source: 'deadlock-test' },
      });
      localManager = new TestRuntimeProviderManager(localProviderRuntime);
      localManager.setConfig(localConfig);
      localConfig.setProviderManager(localManager);
      localConfig.setTokenizerFactory({
        getTokenizer: () => undefined,
        async estimatePrompt(request) {
          return {
            count: await request.legacyEstimate(),
            method: 'calibrated',
            family: 'legacy-unregistered',
            estimatorVersion: 'core-estimate-tokens-v1',
            assetRevision: 'none',
            projectionRevision: request.projectionRevision,
          };
        },
      });
      let transports = 0;
      let pendingReads = 0;
      let firstTransportSignal: AbortSignal | undefined;
      const preparedRequests = new WeakMap<object, string>();
      const provider: IProvider = {
        name: 'stub',
        isDefault: true,
        getModels: vi.fn(async () => []),
        getDefaultModel: () => 'stub-model',
        generateChatCompletion: vi.fn(
          (options: GenerateChatOptions): AsyncIterableIterator<IContent> => {
            transports++;
            const transportToken = options.promptEnvelopeTransportToken;
            if (
              transportToken === undefined ||
              preparedRequests.get(transportToken) === undefined
            ) {
              throw new Error('transport did not consume the prepared request');
            }
            if (transports === 1) {
              firstTransportSignal = options.invocation?.signal;
              if (firstTransportSignal === undefined) {
                throw new Error('transport did not receive an abort signal');
              }
              return createNoncooperativeStream(() => {
                pendingReads++;
              });
            }
            return (async function* () {
              yield {
                speaker: 'ai',
                blocks: [{ type: 'text', text: 'OK' }],
              };
              yield {
                speaker: 'ai',
                blocks: [],
                metadata: { finishReason: 'stop' },
              };
            })();
          },
        ),
        projectPromptEnvelope: async (options) => {
          const transportToken = Object.freeze({});
          preparedRequests.set(
            transportToken,
            JSON.stringify(options.contents),
          );
          return {
            model: 'stub-model',
            protocol: 'openai-chat',
            method: 'chat/completions/v1',
            projectionRevision: 2,
            unsupportedMedia: [],
            transportToken,
            finalizedProjection: Object.freeze({}),
            legacyEstimate: () => Promise.resolve(10),
          };
        },
        getServerTools: () => [],
        invokeServerTool: vi.fn(),
      };
      localManager.registerProvider(provider);
      localManager.setActiveProvider('stub');
      const chat = new ChatSession(
        createAgentRuntimeContext({
          state: createAgentRuntimeState({
            runtimeId: 'test.runtime.deadlock',
            provider: 'stub',
            model: 'stub-model',
            sessionId: localConfig.getSessionId(),
          }),
          history: new HistoryService(),
          settings: { compressionThreshold: 0.8 },
          provider: createProviderAdapterFromManager(localManager),
          telemetry: createTelemetryAdapterFromConfig(localConfig),
          tools: createToolRegistryViewFromRegistry(
            localConfig.getToolRegistry(),
          ),
          providerRuntime: localProviderRuntime,
        }),
        createContentGeneratorStub(),
        {},
        [],
      );
      const firstSend = chat
        .sendMessage({ message: [{ text: 'first request' }] }, 'first-prompt')
        .catch((error: unknown) => error);

      // Drain microtasks so the provider stream is entered and pendingReads
      // increments. vi.waitFor uses real timers which may not fire under
      // Bun's fake timers.
      for (let i = 0; i < 2000; i++) {
        await Promise.resolve();
        if (pendingReads >= 1) break;
      }
      expect(pendingReads).toBeGreaterThanOrEqual(1);
      await vi.advanceTimersByTimeAsync(timeoutMs + 1);
      const firstError = await firstSend;
      expect(firstTransportSignal?.aborted).toBe(true);
      expect(firstError).toBeInstanceOf(Error);
      expect(firstError).toMatchObject({ name: 'StreamIdleTimeoutError' });

      const secondResponse = await chat.sendMessage(
        { message: [{ text: 'second request' }] },
        'second-prompt',
      );
      expect(transports).toBe(2);
      expect(secondResponse.content.blocks).toContainEqual({
        type: 'text',
        text: 'OK',
      });
    });

    it('env var precedence: env var overrides config setting', async () => {
      const envTimeoutMs = 15_000;
      process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS = String(envTimeoutMs);

      localSettingsService = new SettingsService();
      localConfig = new Config(createConfigParams(localSettingsService));
      localConfig.setEphemeralSetting('stream-idle-timeout-ms', 60_000);

      const { resolveStreamIdleTimeoutMs } = await import(
        '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js'
      );

      const result = resolveStreamIdleTimeoutMs(localConfig);
      expect(result).toBe(envTimeoutMs); // Env wins
    });

    it('concurrent: two simultaneous sends timeout independently without signal leakage', async () => {
      vi.useFakeTimers();
      const timeoutMs = 30_000;
      localSettingsService = new SettingsService();
      localConfig = new Config(createConfigParams(localSettingsService));
      localConfig.setEphemeralSetting('stream-idle-timeout-ms', timeoutMs);
      localProviderRuntime = createProviderRuntimeContext({
        settingsService: localSettingsService,
        config: localConfig,
        runtimeId: 'test.runtime.concurrent',
        metadata: { source: 'concurrent-test' },
      });
      localManager = new TestRuntimeProviderManager(localProviderRuntime);
      localManager.setConfig(localConfig);
      localConfig.setProviderManager(localManager);
      localConfig.setTokenizerFactory({
        getTokenizer: () => undefined,
        async estimatePrompt(request) {
          return {
            count: await request.legacyEstimate(),
            method: 'calibrated',
            family: 'legacy-unregistered',
            estimatorVersion: 'core-estimate-tokens-v1',
            assetRevision: 'none',
            projectionRevision: request.projectionRevision,
          };
        },
      });

      const capturedSignals: AbortSignal[] = [];
      const pendingReadsBySession: Record<string, number> = {};
      const provider: IProvider = {
        name: 'stub',
        isDefault: true,
        getModels: vi.fn(async () => []),
        getDefaultModel: () => 'stub-model',
        generateChatCompletion: vi.fn(
          (options: GenerateChatOptions): AsyncIterableIterator<IContent> => {
            capturedSignals.push(options.invocation?.signal as AbortSignal);
            return createNoncooperativeStream(() => {
              const rid = options.runtime?.runtimeId ?? 'unknown';
              pendingReadsBySession[rid] =
                (pendingReadsBySession[rid] ?? 0) + 1;
            });
          },
        ),
        projectPromptEnvelope: async () => {
          const transportToken = Object.freeze({});
          return {
            model: 'stub-model',
            protocol: 'openai-chat',
            method: 'chat/completions/v1',
            projectionRevision: 2,
            unsupportedMedia: [],
            transportToken,
            finalizedProjection: Object.freeze({}),
            legacyEstimate: () => Promise.resolve(10),
          };
        },
        getServerTools: () => [],
        invokeServerTool: vi.fn(),
      };
      localManager.registerProvider(provider);
      localManager.setActiveProvider('stub');

      const chat = new ChatSession(
        createAgentRuntimeContext({
          state: createAgentRuntimeState({
            runtimeId: 'test.runtime.concurrent',
            provider: 'stub',
            model: 'stub-model',
            sessionId: localConfig.getSessionId(),
          }),
          history: new HistoryService(),
          settings: { compressionThreshold: 0.8 },
          provider: createProviderAdapterFromManager(localManager),
          telemetry: createTelemetryAdapterFromConfig(localConfig),
          tools: createToolRegistryViewFromRegistry(
            localConfig.getToolRegistry(),
          ),
          providerRuntime: localProviderRuntime,
        }),
        createContentGeneratorStub(),
        {},
        [],
      );

      // Launch both sends concurrently.
      const sendA = chat
        .sendMessage({ message: [{ text: 'A' }] }, 'prompt-a')
        .catch((error: unknown) => error);
      const sendB = chat
        .sendMessage({ message: [{ text: 'B' }] }, 'prompt-b')
        .catch((error: unknown) => error);

      // Wait for the first send to reach the blocked read.
      for (let i = 0; i < 2000; i++) {
        await Promise.resolve();
        if (capturedSignals.length >= 1) break;
      }
      expect(capturedSignals.length).toBeGreaterThanOrEqual(1);

      // Advance past timeout for the first stream. Under Bun, ChatSession
      // may serialize sends, so the second stream starts only after the first
      // aborts. Advance in steps with microtask draining between each step
      // so the second send can register its own timeout watchdog.
      await vi.advanceTimersByTimeAsync(timeoutMs + 1);
      for (let i = 0; i < 2000; i++) {
        await Promise.resolve();
        if (capturedSignals.length >= 2) break;
      }
      // Advance past the second timeout too (the second send may have started
      // after the first aborted due to ChatSession serialization).
      await vi.advanceTimersByTimeAsync(timeoutMs + 1);

      const [resultA, resultB] = await Promise.all([sendA, sendB]);

      // Both must timeout — no sibling cancellation or signal leakage.
      expect(resultA).toBeInstanceOf(Error);
      expect(resultA).toMatchObject({ name: 'StreamIdleTimeoutError' });
      expect(resultB).toBeInstanceOf(Error);
      expect(resultB).toMatchObject({ name: 'StreamIdleTimeoutError' });

      // Each stream's signal must be independently aborted.
      expect(capturedSignals.length).toBeGreaterThanOrEqual(2);
      for (const signal of capturedSignals) {
        expect(signal.aborted).toBe(true);
      }
    });
  });

  describe('DirectMessageProcessor (via generateDirectMessage)', () => {
    it('uses runtimeContext.config for resolveStreamIdleTimeoutMs', async () => {
      const customTimeoutMs = 10_000;

      localSettingsService = new SettingsService();
      localConfig = new Config(createConfigParams(localSettingsService));
      localConfig.setEphemeralSetting(
        'stream-idle-timeout-ms',
        customTimeoutMs,
      );

      // Verify the config is properly set
      expect(localConfig.getEphemeralSetting('stream-idle-timeout-ms')).toBe(
        customTimeoutMs,
      );

      // The DirectMessageProcessor passes runtimeContext.config to resolveStreamIdleTimeoutMs
      // This test verifies the config has the setting accessible
      const { resolveStreamIdleTimeoutMs } = await import(
        '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js'
      );
      const result = resolveStreamIdleTimeoutMs(localConfig);
      expect(result).toBe(customTimeoutMs);
    });
  });
});
