/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SubAgentScope stream idle timeout behavioral tests.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SubAgentScope } from './subagent.js';
import {
  ContextState,
  SubagentTerminateMode,
  type ModelConfig,
  type RunConfig,
  type SubAgentRuntimeOverrides,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ChatSession, StreamEventType } from './chatSession.js';
import {
  createContentGenerator,
  type ContentGenerator,
} from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeLoaderResult } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core/config/models.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import { initializeTestConfig } from '@vybestack/llxprt-code-core/test-utils/config.js';
const { TodoStoreMock } = vi.hoisted(() => {
  const mockReadTodos = vi.fn().mockResolvedValue([]);
  const TodoStoreMock = vi
    .fn()
    .mockImplementation(() => ({ readTodos: mockReadTodos }));
  return { mockReadTodos, TodoStoreMock };
});

vi.mock('@vybestack/llxprt-code-tools', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-tools')>();
  return {
    ...actual,
    LocalTodoStore: TodoStoreMock,
  };
});

vi.mock('./chatSession.js');
vi.mock(
  '@vybestack/llxprt-code-core/core/contentGenerator.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@vybestack/llxprt-code-core/core/contentGenerator.js')
      >();
    return {
      ...actual,
      createContentGenerator: vi.fn(),
    };
  },
);
vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js');
vi.mock('./nonInteractiveToolExecutor.js');
vi.mock('@vybestack/llxprt-code-ide-integration', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@vybestack/llxprt-code-ide-integration')
    >();
  return {
    ...actual,
    IdeClient: {
      getInstance: vi.fn().mockResolvedValue({
        getConnectionStatus: vi.fn(),
        initialize: vi.fn(),
        shutdown: vi.fn(),
      }),
    },
  };
});
vi.mock(
  '@vybestack/llxprt-code-core/core/prompts.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@vybestack/llxprt-code-core/core/prompts.js')
      >();
    return {
      ...actual,
      getCoreSystemPromptAsync: vi.fn().mockResolvedValue('Core Prompt'),
    };
  },
);

describe('subagent.ts', () => {
  describe('stream idle timeout behavioral tests', () => {
    const originalEnv = process.env;
    const mockMessageBus = {} as MessageBus;

    const localDefaultModelConfig: ModelConfig = {
      model: 'gemini-1.5-flash-latest',
      temp: 0.5,
      top_p: 1,
    };

    const localDefaultRunConfig: RunConfig = {
      max_time_minutes: 5,
      max_turns: 10,
    };

    const createRuntimeBundle = (config: Config): AgentRuntimeLoaderResult => {
      const history = {
        clear: vi.fn(),
        add: vi.fn(),
        getCuratedForProvider: vi.fn(() => []),
        getIdGeneratorCallback: vi.fn(() => vi.fn()),
        findUnmatchedToolCalls: vi.fn(() => []),
        generateTurnKey: vi.fn(() => `turn-${Date.now()}`),
      } as unknown as HistoryService;

      const runtimeContext: AgentRuntimeContext = {
        state: {
          runtimeId: config.getSessionId(),
          provider: config.getProvider(),
          model: config.getModel(),
          sessionId: config.getSessionId(),
          proxyUrl: undefined,
          modelParams: {},
        },
        history,
        ephemerals: {
          compressionThreshold: () => 0.8,
          contextLimit: () => 60_000,
          preserveThreshold: () => 0.2,
          toolFormatOverride: () => undefined,
        },
        telemetry: {
          logApiRequest: vi.fn(),
          logApiResponse: vi.fn(),
          logApiError: vi.fn(),
        },
        provider: {
          getActiveProvider: vi.fn(
            () =>
              ({
                name: config.getProvider(),
                generateChatCompletion: vi.fn(async function* () {}),
                getDefaultModel: () => config.getModel(),
                getServerTools: () => [],
                invokeServerTool: vi.fn(),
              }) as IProvider,
          ),
          setActiveProvider: vi.fn(),
        },
        tools: {
          listToolNames: () => [],
          getToolMetadata: () => undefined,
        },
        providerRuntime: {
          runtimeId: config.getSessionId(),
          metadata: {},
          settingsService: config.getSettingsService(),
          config,
        } as unknown as ProviderRuntimeContext,
      };

      return {
        runtimeContext,
        history,
        providerAdapter: runtimeContext.provider,
        telemetryAdapter: runtimeContext.telemetry,
        toolsView: runtimeContext.tools,
        contentGenerator: {} as ContentGenerator,
        toolRegistry: new ToolRegistry(config, mockMessageBus),
      };
    };

    beforeEach(() => {
      vi.useFakeTimers();
      process.env = { ...originalEnv };
      delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      process.env = originalEnv;
    });

    it('honors config setting: timeout fires after custom timeout value from config.getEphemeralSetting', async () => {
      const customTimeoutMs = 15_000; // 15 seconds

      const settingsService = new SettingsService();
      const configParams: ConfigParameters = {
        sessionId: 'test-session',
        model: DEFAULT_GEMINI_MODEL,
        targetDir: '.',
        debugMode: false,
        cwd: process.cwd(),
        settingsService,
      };
      const configWithTimeout = new Config(configParams);
      configWithTimeout.setEphemeralSetting(
        'stream-idle-timeout-ms',
        customTimeoutMs,
      );
      await initializeTestConfig(configWithTimeout);

      const overrides: SubAgentRuntimeOverrides = {
        runtimeBundle: createRuntimeBundle(configWithTimeout),
        toolRegistry: new ToolRegistry(configWithTimeout, mockMessageBus),
      };

      const scope = await SubAgentScope.create(
        'timeout-test-agent',
        configWithTimeout,
        { systemPrompt: 'Test timeout behavior.' },
        localDefaultModelConfig,
        localDefaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      // Mock a slow stream that yields after the timeout
      vi.mocked(ChatSession).mockImplementationOnce(
        () =>
          ({
            sendMessageStream: vi.fn().mockImplementation(async () => {
              async function* slowStream() {
                yield {
                  type: StreamEventType.CHUNK,
                  value: {
                    candidates: [
                      {
                        content: { parts: [{ text: 'Starting...' }] },
                      },
                    ],
                  },
                };
                // Wait past the custom timeout
                await vi.advanceTimersByTimeAsync(25_000);
                yield {
                  type: StreamEventType.CHUNK,
                  value: {
                    candidates: [
                      {
                        content: { parts: [{ text: 'Late response' }] },
                      },
                    ],
                  },
                };
              }
              return slowStream();
            }),
            getConfig: () => configWithTimeout,
            getHistory: vi.fn().mockReturnValue([]),
            getHistoryService: vi.fn().mockReturnValue({
              clear: vi.fn(),
              findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
              getCurated: vi.fn().mockReturnValue([]),
              getTotalTokens: vi.fn().mockReturnValue(0),
            }),
          }) as unknown as ChatSession,
      );

      vi.mocked(createContentGenerator).mockReturnValue({} as ContentGenerator);
      vi.mocked(getEnvironmentContext).mockResolvedValue('');

      const runPromise = scope.runNonInteractive(new ContextState());

      // Attach catch handler before advancing timers to prevent unhandled rejection
      const resultPromise = runPromise.catch((e) => e);

      // Advance past the custom timeout
      await vi.advanceTimersByTimeAsync(20_000);
      await Promise.resolve();

      // Run to completion
      await vi.runAllTimersAsync();

      // Scope should have timed out
      const _result = await resultPromise;
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
    });

    it('disabled path: no timeout when setting is 0, even after extended period', async () => {
      const settingsService = new SettingsService();
      const configParams: ConfigParameters = {
        sessionId: 'test-session',
        model: DEFAULT_GEMINI_MODEL,
        targetDir: '.',
        debugMode: false,
        cwd: process.cwd(),
        settingsService,
      };
      const configWithTimeout = new Config(configParams);
      configWithTimeout.setEphemeralSetting('stream-idle-timeout-ms', 0); // Disabled
      await initializeTestConfig(configWithTimeout);

      const overrides: SubAgentRuntimeOverrides = {
        runtimeBundle: createRuntimeBundle(configWithTimeout),
        toolRegistry: new ToolRegistry(configWithTimeout, mockMessageBus),
      };

      const scope = await SubAgentScope.create(
        'no-timeout-agent',
        configWithTimeout,
        { systemPrompt: 'Test no timeout behavior.' },
        localDefaultModelConfig,
        { ...localDefaultRunConfig, max_time_minutes: 60 }, // Long enough for test
        undefined,
        undefined,
        overrides,
      );

      let resolveIterator: () => void;
      const iteratorPromise = new Promise<void>((resolve) => {
        resolveIterator = resolve;
      });

      vi.mocked(ChatSession).mockImplementationOnce(
        () =>
          ({
            sendMessageStream: vi.fn().mockImplementation(async () => {
              async function* stalledStream() {
                yield {
                  type: StreamEventType.CHUNK,
                  value: {
                    candidates: [
                      {
                        content: { parts: [{ text: 'Starting...' }] },
                      },
                    ],
                  },
                };
                // Wait indefinitely until manually resolved
                await iteratorPromise;
                yield {
                  type: StreamEventType.CHUNK,
                  value: {
                    candidates: [
                      {
                        content: { parts: [{ text: 'Finally done' }] },
                      },
                    ],
                  },
                };
              }
              return stalledStream();
            }),
            getConfig: () => configWithTimeout,
            getHistory: vi.fn().mockReturnValue([]),
            getHistoryService: vi.fn().mockReturnValue({
              clear: vi.fn(),
              findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
              getCurated: vi.fn().mockReturnValue([]),
              getTotalTokens: vi.fn().mockReturnValue(0),
            }),
          }) as unknown as ChatSession,
      );

      vi.mocked(createContentGenerator).mockReturnValue({} as ContentGenerator);
      vi.mocked(getEnvironmentContext).mockResolvedValue('');

      const runPromise = scope.runNonInteractive(new ContextState());

      // Advance 30 minutes - no timeout because watchdog is disabled
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      await Promise.resolve();

      // No timeout yet
      expect(scope.output.terminate_reason).not.toBe(
        SubagentTerminateMode.TIMEOUT,
      );

      // Resolve the iterator to let the test complete
      resolveIterator!();
      await vi.runAllTimersAsync();

      await runPromise;
      // Should complete normally (not timeout)
      expect(scope.output.terminate_reason).not.toBe(
        SubagentTerminateMode.TIMEOUT,
      );
    });

    it('env var precedence: env var overrides config setting', async () => {
      const envTimeoutMs = 8_000; // 8 seconds from env
      const configTimeoutMs = 45_000; // 45 seconds from config (should be ignored)

      process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS = String(envTimeoutMs);

      const settingsService = new SettingsService();
      const configParams: ConfigParameters = {
        sessionId: 'test-session',
        model: DEFAULT_GEMINI_MODEL,
        targetDir: '.',
        debugMode: false,
        cwd: process.cwd(),
        settingsService,
      };
      const configWithTimeout = new Config(configParams);
      configWithTimeout.setEphemeralSetting(
        'stream-idle-timeout-ms',
        configTimeoutMs,
      );
      await initializeTestConfig(configWithTimeout);

      const overrides: SubAgentRuntimeOverrides = {
        runtimeBundle: createRuntimeBundle(configWithTimeout),
        toolRegistry: new ToolRegistry(configWithTimeout, mockMessageBus),
      };

      const scope = await SubAgentScope.create(
        'env-precedence-agent',
        configWithTimeout,
        { systemPrompt: 'Test env precedence.' },
        localDefaultModelConfig,
        localDefaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      vi.mocked(ChatSession).mockImplementationOnce(
        () =>
          ({
            sendMessageStream: vi.fn().mockImplementation(async () => {
              async function* slowStream() {
                yield {
                  type: StreamEventType.CHUNK,
                  value: {
                    candidates: [
                      {
                        content: { parts: [{ text: 'Starting...' }] },
                      },
                    ],
                  },
                };
                // Wait past the env timeout but before config timeout
                await vi.advanceTimersByTimeAsync(15_000);
                yield {
                  type: StreamEventType.CHUNK,
                  value: {
                    candidates: [
                      {
                        content: { parts: [{ text: 'Late response' }] },
                      },
                    ],
                  },
                };
              }
              return slowStream();
            }),
            getConfig: () => configWithTimeout,
            getHistory: vi.fn().mockReturnValue([]),
            getHistoryService: vi.fn().mockReturnValue({
              clear: vi.fn(),
              findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
              getCurated: vi.fn().mockReturnValue([]),
              getTotalTokens: vi.fn().mockReturnValue(0),
            }),
          }) as unknown as ChatSession,
      );

      vi.mocked(createContentGenerator).mockReturnValue({} as ContentGenerator);
      vi.mocked(getEnvironmentContext).mockResolvedValue('');

      const runPromise = scope.runNonInteractive(new ContextState());

      // Attach catch handler before advancing timers to prevent unhandled rejection
      const resultPromise = runPromise.catch((e) => e);

      // Advance past the env timeout (8s) but before config timeout (45s)
      await vi.advanceTimersByTimeAsync(12_000);
      await Promise.resolve();

      // Run to completion
      await vi.runAllTimersAsync();

      // Should have timed out due to env value (8s), not config (45s)
      const _result = await resultPromise;
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
    });
  });
});
