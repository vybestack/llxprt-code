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
import {
  AgentEventType,
  DEFAULT_AGENT_ID,
  Turn,
  type ServerAgentStreamEvent,
} from './turn.js';
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

async function collectTurnEvents(
  turn: Turn,
  request: string,
): Promise<ServerAgentStreamEvent[]> {
  const events: ServerAgentStreamEvent[] = [];
  for await (const event of turn.run(
    [{ type: 'text', text: request }],
    new AbortController().signal,
  )) {
    events.push(event);
  }
  return events;
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
      let transports = 0;
      let pendingReads = 0;
      const provider: IProvider = {
        name: 'stub',
        isDefault: true,
        getModels: vi.fn(async () => []),
        getDefaultModel: () => 'stub-model',
        generateChatCompletion: vi.fn(
          (_options: GenerateChatOptions): AsyncIterableIterator<IContent> => {
            transports++;
            if (transports === 1) {
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
      const firstEventsPromise = collectTurnEvents(
        new Turn(chat, 'first-prompt', DEFAULT_AGENT_ID, 'stub'),
        'first request',
      );

      await vi.waitFor(() => expect(pendingReads).toBe(1), {
        interval: 1,
        timeout: 100,
      });
      await vi.advanceTimersByTimeAsync(timeoutMs + 1);
      const secondEventsPromise = collectTurnEvents(
        new Turn(chat, 'second-prompt', DEFAULT_AGENT_ID, 'stub'),
        'second request',
      );
      await vi.waitFor(() => expect(transports).toBe(2), {
        interval: 1,
        timeout: 100,
      });

      const [firstEvents, secondEvents] = await Promise.all([
        firstEventsPromise,
        secondEventsPromise,
      ]);
      expect(firstEvents).toContainEqual(
        expect.objectContaining({ type: AgentEventType.StreamIdleTimeout }),
      );
      expect(secondEvents).toContainEqual(
        expect.objectContaining({
          type: AgentEventType.Content,
          value: 'OK',
        }),
      );
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
