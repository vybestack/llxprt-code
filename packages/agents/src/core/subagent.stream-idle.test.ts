/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SubAgentScope stream idle timeout behavioral tests.
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import {
  advanceTimersByTimeAsync,
  runAllTimersAsync,
} from '@vybestack/llxprt-code-test-utils';
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from '../testApi.js';
import { SubAgentScope } from './subagent.js';
import {
  ContextState,
  SubagentTerminateMode,
  type ModelConfig,
  type RunConfig,
  type SubAgentRuntimeOverrides,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ChatSession, StreamEventType } from './chatSession.js';
import { mockChunk } from './turn-test-helpers.js';
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
import { ToolRegistry } from '@vybestack/llxprt-code-tools/tools/tool-registry.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import { initializeTestConfig } from '@vybestack/llxprt-code-core/test-utils/config.js';
import {
  waitForCondition,
  waitForConditionInRealTime,
  delayRealTime,
} from '../test-utils/eventLoop.js';
const realEnvironmentContextModule = {
  ...(await import('@vybestack/llxprt-code-core/utils/environmentContext.js')),
};
const realNonInteractiveToolExecutorModule = {
  ...(await import('./nonInteractiveToolExecutor.js')),
};

const { TodoStoreMock } = (() => {
  const mockReadTodos = vi.fn().mockResolvedValue([]);
  const TodoStoreMock = vi
    .fn()
    .mockImplementation(() => ({ readTodos: mockReadTodos }));
  return { mockReadTodos, TodoStoreMock };
})();

const actual = { ...(await import('@vybestack/llxprt-code-tools')) };
void vi.mock('@vybestack/llxprt-code-tools', () => {
  return {
    ...actual,
    LocalTodoStore: TodoStoreMock,
  };
});

const __actual = { ...(await import('./chatSession.js')) };
void vi.mock('./chatSession.js', () => {
  const apply = (actual: typeof import('./chatSession.js')) => ({
    ...actual,
    ChatSession: vi.fn(),
  });
  const result = __actual as
    | typeof import('./chatSession.js')
    | Promise<typeof import('./chatSession.js')>;
  return result instanceof Promise ? result.then(apply) : apply(result);
});
const actual3 = {
  ...(await import('@vybestack/llxprt-code-core/core/contentGenerator.js')),
};
void vi.mock('@vybestack/llxprt-code-core/core/contentGenerator.js', () => {
  return {
    ...actual3,
    createContentGenerator: vi.fn(),
  };
});
void vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js', () =>
  automock(realEnvironmentContextModule),
);
void vi.mock('./nonInteractiveToolExecutor.js', () =>
  automock(realNonInteractiveToolExecutorModule),
);
const actual4 = { ...(await import('@vybestack/llxprt-code-ide-integration')) };
void vi.mock('@vybestack/llxprt-code-ide-integration', () => {
  return {
    ...actual4,
    IdeClient: {
      getInstance: vi.fn().mockResolvedValue({
        getConnectionStatus: vi.fn(),
        initialize: vi.fn(),
        shutdown: vi.fn(),
      }),
    },
  };
});
const actual5 = {
  ...(await import('@vybestack/llxprt-code-core/core/prompts.js')),
};
void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => {
  return {
    ...actual5,
    getCoreSystemPromptAsync: vi.fn().mockResolvedValue('Core Prompt'),
  };
});

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
      (
        ChatSession as unknown as Mock<(...args: never[]) => unknown>
      ).mockImplementationOnce(
        () =>
          ({
            sendMessageStream: vi.fn().mockImplementation(async () => {
              async function* slowStream() {
                yield {
                  type: StreamEventType.CHUNK,
                  value: mockChunk({ text: 'Starting...' }),
                };
                // Wait past the custom timeout
                await advanceTimersByTimeAsync(25_000);
                yield {
                  type: StreamEventType.CHUNK,
                  value: mockChunk({ text: 'Late response' }),
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

      (
        createContentGenerator as Mock<typeof createContentGenerator>
      ).mockReturnValue({} as ContentGenerator);
      (
        getEnvironmentContext as Mock<typeof getEnvironmentContext>
      ).mockResolvedValue('');

      const runPromise = scope.runNonInteractive(new ContextState());

      // Attach catch handler before advancing timers to prevent unhandled rejection
      const resultPromise = runPromise.catch((e) => e);

      // Advance past the custom timeout
      await advanceTimersByTimeAsync(20_000);
      await Promise.resolve();

      // Run to completion
      await runAllTimersAsync();

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
      let stallReached = false;
      const iteratorPromise = new Promise<void>((resolve) => {
        resolveIterator = resolve;
      });

      (
        ChatSession as unknown as Mock<(...args: never[]) => unknown>
      ).mockImplementationOnce(
        () =>
          ({
            sendMessageStream: vi.fn().mockImplementation(async () => {
              async function* stalledStream() {
                yield {
                  type: StreamEventType.CHUNK,
                  value: mockChunk({ text: 'Starting...' }),
                };
                stallReached = true;
                // Wait indefinitely until manually resolved
                await iteratorPromise;
                yield {
                  type: StreamEventType.CHUNK,
                  value: mockChunk({ text: 'Finally done' }),
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

      (
        createContentGenerator as Mock<typeof createContentGenerator>
      ).mockReturnValue({} as ContentGenerator);
      (
        getEnvironmentContext as Mock<typeof getEnvironmentContext>
      ).mockResolvedValue('');

      let runSettled = false;
      const runPromise = scope
        .runNonInteractive(new ContextState())
        .finally(() => {
          runSettled = true;
        });

      // Reach the stall before moving the clock. A real event-loop yield is
      // only reliable while the fake clock is still, so this gate has to come
      // first; without it the advance races the stream start on slower hosts.
      expect(await waitForCondition(() => stallReached)).toBe(true);

      // Hold the stall open in real time to show the idle watchdog never
      // fires. The fake clock is not used for this: draining the pipeline to
      // completion under Bun's fake timers deadlocks, and `runAllTimersAsync`
      // is unusable here regardless because it would fire the 60-minute
      // max_time_minutes watchdog and report the very TIMEOUT this test exists
      // to rule out. (A timer-count assertion would not work either: the
      // max_time_minutes watchdog is legitimately registered.)
      vi.useRealTimers();
      await delayRealTime(250);

      // No timeout yet
      expect(scope.output.terminate_reason).not.toBe(
        SubagentTerminateMode.TIMEOUT,
      );
      expect(runSettled).toBe(false);

      resolveIterator!();
      await runPromise;
      // Should complete normally (not timeout)
      expect(scope.output.terminate_reason).not.toBe(
        SubagentTerminateMode.TIMEOUT,
      );
    });

    it('env var precedence: env var overrides config setting', async () => {
      // Real timers with small real durations. Bun's fake timers deadlock when
      // this pipeline is drained to completion, and the behaviour under test is
      // which of the two configured durations is used — which needs no fake
      // clock, since the config value is orders of magnitude larger and so
      // cannot be what fires inside the wait below.
      vi.useRealTimers();
      const envTimeoutMs = 50; // from env
      const configTimeoutMs = 20_000; // from config (should be ignored)

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

      let gapReached = false;
      let releaseGap: () => void;
      const gapPromise = new Promise<void>((resolve) => {
        releaseGap = resolve;
      });
      (
        ChatSession as unknown as Mock<(...args: never[]) => unknown>
      ).mockImplementationOnce(
        () =>
          ({
            sendMessageStream: vi.fn().mockImplementation(async () => {
              async function* slowStream() {
                yield {
                  type: StreamEventType.CHUNK,
                  value: mockChunk({ text: 'Starting...' }),
                };
                gapReached = true;
                // The gap exceeds the env timeout: the stream produces nothing
                // until the test releases it, so the env-driven watchdog fires
                // first. It must be releasable — an async generator suspended
                // on an await that never resolves cannot be returned, so the
                // consumer could never unwind and the run would hang even after
                // the watchdog fired.
                await gapPromise;
                yield {
                  type: StreamEventType.CHUNK,
                  value: mockChunk({ text: 'Late response' }),
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

      (
        createContentGenerator as Mock<typeof createContentGenerator>
      ).mockReturnValue({} as ContentGenerator);
      (
        getEnvironmentContext as Mock<typeof getEnvironmentContext>
      ).mockResolvedValue('');

      const runPromise = scope.runNonInteractive(new ContextState());

      // Attach catch handler before advancing timers to prevent unhandled rejection
      let resultSettled = false;
      const resultPromise = runPromise
        .catch((e) => e)
        .finally(() => {
          resultSettled = true;
        });

      expect(await waitForCondition(() => gapReached)).toBe(true);

      // The stream stalls after its first chunk, so the env-driven 50ms
      // watchdog fires. Were the 20s config value being used instead, the
      // terminate reason would never become TIMEOUT and this wait would fail.
      expect(
        await waitForConditionInRealTime(
          () => scope.output.terminate_reason === SubagentTerminateMode.TIMEOUT,
        ),
      ).toBe(true);

      // Release the stall so the generator can unwind, then let the run finish.
      releaseGap!();
      const _result = await resultPromise;
      expect(resultSettled).toBe(true);
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
    });
  });
});
