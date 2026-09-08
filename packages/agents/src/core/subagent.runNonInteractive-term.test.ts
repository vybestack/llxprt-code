/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SubAgentScope termination, recovery, runInteractive, scheduling timeout, dispose.
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import type { Mock } from 'bun:test';
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import { SubAgentScope } from './subagent.js';
import {
  ContextState,
  SubagentTerminateMode,
  type PromptConfig,
  type RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ChatSession, StreamEventType } from './chatSession.js';
import { mockChunk } from './turn-test-helpers.js';
import {
  createContentGenerator,
  type ContentGenerator,
} from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
const realEnvironmentContextModule = {
  ...(await import('@vybestack/llxprt-code-core/utils/environmentContext.js')),
};
const realNonInteractiveToolExecutorModule = {
  ...(await import('./nonInteractiveToolExecutor.js')),
};

const { mockReadTodos, TodoStoreMock } = (() => {
  const mockReadTodos = vi.fn().mockResolvedValue([]);
  const TodoStoreMock = vi
    .fn()
    .mockImplementation(() => ({ readTodos: mockReadTodos }));
  return { mockReadTodos, TodoStoreMock };
})();

const actual = { ...(await import('@vybestack/llxprt-code-tools')) };
void vi.mock('@vybestack/llxprt-code-tools', () => ({
  ...actual,
  LocalTodoStore: TodoStoreMock,
}));

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
void vi.mock('@vybestack/llxprt-code-core/core/contentGenerator.js', () => ({
  ...actual3,
  createContentGenerator: vi.fn(),
}));
void vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js', () =>
  automock(realEnvironmentContextModule),
);
void vi.mock('./nonInteractiveToolExecutor.js', () =>
  automock(realNonInteractiveToolExecutorModule),
);
const actual4 = { ...(await import('@vybestack/llxprt-code-ide-integration')) };
void vi.mock('@vybestack/llxprt-code-ide-integration', () => ({
  ...actual4,
  IdeClient: {
    getInstance: vi.fn().mockResolvedValue({
      getConnectionStatus: vi.fn(),
      initialize: vi.fn(),
      shutdown: vi.fn(),
    }),
  },
}));
const actual5 = {
  ...(await import('@vybestack/llxprt-code-core/core/prompts.js')),
};
void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  ...actual5,
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('Core Prompt'),
}));

import {
  createMockConfig,
  createMockStream,
  defaultModelConfig,
  defaultRunConfig,
  createStatelessRuntimeBundle,
  createRuntimeOverrides,
} from './subagent-test-helpers.js';
import { waitForCondition } from '../test-utils/eventLoop.js';

/**
 * Turn budget for condition waits that gate fake-time advancement or run-entry
 * observation. The 2000-turn default is only ~10ms of wall-clock headroom,
 * which the concurrent agents workspace runner's CPU contention was observed to
 * exhaust; 200_000 turns survives that load while still returning false instead
 * of hanging when the condition genuinely cannot be met.
 */
const CONDITION_WAIT_TURNS = 200_000;

describe('subagent.ts', () => {
  let mockSendMessageStream: Mock;

  beforeEach(() => {
    // Guards against a previous test leaking fake-timer state across test
    // boundaries; throws (rather than a lint-suppressed expect) so a leak fails
    // the next test loudly.
    if (vi.isFakeTimers()) {
      throw new Error(
        'subagent.ts tests: previous test leaked fake timers into this one',
      );
    }

    vi.clearAllMocks();
    mockReadTodos.mockReset();
    mockReadTodos.mockResolvedValue([]);
    TodoStoreMock.mockClear();

    (
      getEnvironmentContext as Mock<typeof getEnvironmentContext>
    ).mockResolvedValue([{ text: 'Env Context' }]);
    (
      createContentGenerator as Mock<typeof createContentGenerator>
    ).mockResolvedValue({
      getGenerativeModel: vi.fn(),
    } as unknown as ContentGenerator);

    mockSendMessageStream = vi.fn();
    (
      ChatSession as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementation(
      () =>
        ({
          sendMessageStream: mockSendMessageStream,
          recordCompletedToolCalls: vi.fn(),
          getHistory: vi.fn().mockReturnValue([]),
          getHistoryService: vi.fn().mockReturnValue({
            clear: vi.fn(),
            findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
            getCurated: vi.fn().mockReturnValue([]),
            getTotalTokens: vi.fn().mockReturnValue(0),
          }),
          getConfig: vi.fn().mockReturnValue(undefined),
        }) as unknown as ChatSession,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('runNonInteractive - Termination and Recovery', () => {
    const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

    it('should terminate with MAX_TURNS if the limit is reached', async () => {
      const { config } = await createMockConfig();
      const runConfig: RunConfig = { ...defaultRunConfig, max_turns: 2 };

      // Model keeps looping by calling emitvalue repeatedly
      mockSendMessageStream.mockImplementation(
        createMockStream([
          [
            {
              name: 'self_emitvalue',
              args: { emit_variable_name: 'loop', emit_variable_value: 'v1' },
            },
          ],
          [
            {
              name: 'self_emitvalue',
              args: { emit_variable_name: 'loop', emit_variable_value: 'v2' },
            },
          ],
          // This turn should not happen
          [
            {
              name: 'self_emitvalue',
              args: { emit_variable_name: 'loop', emit_variable_value: 'v3' },
            },
          ],
        ]),
      );

      const { overrides: maxTurnOverrides } = createRuntimeOverrides();
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        runConfig,
        undefined,
        undefined,
        maxTurnOverrides,
      );

      await scope.runNonInteractive(new ContextState());

      expect(mockSendMessageStream).toHaveBeenCalledTimes(2);
      expect(scope.output.terminate_reason).toBe(
        SubagentTerminateMode.MAX_TURNS,
      );
    });

    it('should terminate with TIMEOUT if the time limit is reached during an LLM call', async () => {
      const { config } = await createMockConfig();
      // Install fake timers after config creation so config/auth setup runs on
      // real timers; fake timers freeze Date.now/performance.now/hrtime and
      // stop Bun's per-test timeout from firing.
      vi.useFakeTimers();
      const runConfig: RunConfig = { max_time_minutes: 5, max_turns: 100 };

      // We need to control the resolution of the sendMessageStream promise to advance the timer during execution.
      let resolveStream: (
        value: AsyncGenerator<unknown, void, unknown>,
      ) => void;
      const streamPromise = new Promise<AsyncGenerator<unknown, void, unknown>>(
        (resolve) => {
          resolveStream = resolve as typeof resolveStream;
        },
      );

      // The LLM call will hang until we resolve the promise.
      mockSendMessageStream.mockReturnValue(streamPromise);

      // Resolved if the stream promise is still pending at cleanup time, to
      // unblock a run orphaned by an earlier assertion failure.
      let streamResolved = false;
      let scope: SubAgentScope | undefined;
      let runPromise: Promise<void> | undefined;
      try {
        const { overrides: timeoutOverrides } = createRuntimeOverrides();
        scope = await SubAgentScope.create(
          'test-agent',
          config,
          promptConfig,
          defaultModelConfig,
          runConfig,
          undefined,
          undefined,
          timeoutOverrides,
        );

        runPromise = scope.runNonInteractive(new ContextState());

        // Advance time beyond the limit (6 minutes) while the agent is awaiting the LLM response.
        // Wait for the executor to enter the LLM call before advancing time.
        expect(
          await waitForCondition(
            () => mockSendMessageStream.mock.calls.length > 0,
            CONDITION_WAIT_TURNS,
          ),
        ).toBe(true);
        // The timeout callback is synchronous. Avoid the async timer helper here:
        // its event-loop flush can stall after Bun advances fake time on Linux.
        vi.advanceTimersByTime(6 * 60 * 1000);

        // Now resolve the stream. The model returns 'stop'.

        resolveStream!(createMockStream(['stop'])());
        streamResolved = true;

        await runPromise;

        expect(scope.output.terminate_reason).toBe(
          SubagentTerminateMode.TIMEOUT,
        );
      } finally {
        vi.useRealTimers();
        // If the run never started (assertion threw first), dispose aborts any
        // active scope work and resolving the held stream unblocks the orphan so
        // no async leak survives into the next test. The rejection absorbers
        // must never be awaited: a stalled chain under fake timers would turn
        // cleanup into a hang.
        if (runPromise !== undefined) {
          runPromise.catch(() => {});
        }
        if (!streamResolved) {
          resolveStream!(createMockStream(['stop'])());
          scope?.dispose();
        }
      }
    });

    it('should actively abort a stalled non-interactive response stream before the overall run timeout expires', async () => {
      const { signalObserved, scope, abortedObservation, abortError } =
        await observeActivelyAbortAStalledNonInteractiveResponseStreamBeforeTheOverallRun();
      expect(signalObserved).toBe(true);
      expect(abortError).toMatchObject({ name: 'AbortError' });
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
      expect(abortedObservation).toBe(true);
      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
    });

    const observeActivelyAbortAStalledNonInteractiveResponseStreamBeforeTheOverallRun =
      async () => {
        const { config } = await createMockConfig();
        const testTimeoutMs = 30_000; // 30 second timeout for this test
        config.setEphemeralSetting('stream-idle-timeout-ms', testTimeoutMs);
        // Install fake timers after config creation so config/auth setup runs
        // on real timers; fake timers freeze Date.now/performance.now/hrtime
        // and stop Bun's per-test timeout from firing.
        vi.useFakeTimers();

        const runConfig: RunConfig = { max_time_minutes: 5, max_turns: 100 };
        let capturedSignal: AbortSignal | undefined;

        mockSendMessageStream.mockImplementation(
          async ({ config: messageConfig }) => {
            capturedSignal = messageConfig.abortSignal;
            return (async function* () {
              yield {
                type: StreamEventType.CHUNK,
                value: mockChunk({ text: 'partial output' }),
              };

              await new Promise<void>((resolve) => {
                if (!capturedSignal) {
                  throw new Error('Abort signal was not provided');
                }
                if (capturedSignal.aborted) {
                  throw createAbortError();
                }
                capturedSignal.addEventListener(
                  'abort',
                  () => {
                    resolve();
                  },
                  { once: true },
                );
              });
              throw createAbortError();
            })();
          },
        );

        const { overrides } = createRuntimeOverrides();
        const scope = await SubAgentScope.create(
          'test-agent',
          config,
          promptConfig,
          defaultModelConfig,
          runConfig,
          undefined,
          undefined,
          overrides,
        );

        const runPromise = scope.runNonInteractive(new ContextState());
        const runRejection = runPromise.then(
          () => {
            throw new Error('Expected stalled subagent stream to abort');
          },
          (error: unknown) => error,
        );

        try {
          // Wait for the executor's async setup chain to register the
          // stream-idle-timeout timer before advancing fake time.
          const signalObserved = await waitForCondition(
            () => capturedSignal !== undefined,
            CONDITION_WAIT_TURNS,
          );

          await advanceTimersByTimeAsync(testTimeoutMs + 1_000);

          const abortError = await runRejection;

          const abortedObservation = capturedSignal?.aborted;
          return { signalObserved, scope, abortedObservation, abortError };
        } finally {
          vi.useRealTimers();
          // If the wait failed, runRejection may be abandoned; dispose
          // aborts the still-in-flight run and the absorbers swallow its
          // rejection so nothing leaks into the next test. Do not await.
          runPromise.catch(() => {});
          runRejection.catch(() => {});
          scope.dispose();
        }
      };

    it('should terminate with ERROR if the model call throws', async () => {
      const { config } = await createMockConfig();
      mockSendMessageStream.mockRejectedValue(new Error('API Failure'));

      const { overrides: errorOverrides } = createRuntimeOverrides();
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        errorOverrides,
      );

      await expect(scope.runNonInteractive(new ContextState())).rejects.toThrow(
        'API Failure',
      );
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
    });

    it('should actively abort a hung non-interactive model call when the time limit expires', async () => {
      const { signalObserved, scope, abortedObservation, abortError } =
        await observeActivelyAbortAHungNonInteractiveModelCallWhenTheTimeLimit();
      expect(signalObserved).toBe(true);
      expect(abortError).toMatchObject({ name: 'AbortError' });
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
      expect(abortedObservation).toBe(true);
    });

    const observeActivelyAbortAHungNonInteractiveModelCallWhenTheTimeLimit =
      async () => {
        const { config } = await createMockConfig();
        const runConfig: RunConfig = {
          max_time_minutes: 0.001,
          max_turns: 100,
        };
        // Install fake timers after config creation so config/auth setup runs
        // on real timers; fake timers freeze Date.now/performance.now/hrtime
        // and stop Bun's per-test timeout from firing.
        vi.useFakeTimers();
        let capturedSignal: AbortSignal | undefined;

        mockSendMessageStream.mockImplementation(
          async ({ config: messageConfig }) => {
            capturedSignal = messageConfig.abortSignal;
            const stall = async function* () {
              await new Promise<void>((resolve) => {
                if (!capturedSignal) {
                  throw new Error('Abort signal was not provided');
                }
                if (capturedSignal.aborted) {
                  throw createAbortError();
                }
                capturedSignal.addEventListener(
                  'abort',
                  () => {
                    resolve();
                  },
                  { once: true },
                );
              });
              yield* [];
              throw createAbortError();
            };
            return stall();
          },
        );

        const { overrides } = createRuntimeOverrides();
        const scope = await SubAgentScope.create(
          'test-agent',
          config,
          promptConfig,
          defaultModelConfig,
          runConfig,
          undefined,
          undefined,
          overrides,
        );

        const runPromise = scope.runNonInteractive(new ContextState());
        const runRejection = runPromise.then(
          () => {
            throw new Error('Expected timed out subagent run to abort');
          },
          (error: unknown) => error,
        );

        try {
          const signalObserved = await waitForCondition(
            () => capturedSignal !== undefined,
            CONDITION_WAIT_TURNS,
          );
          await advanceTimersByTimeAsync(100);

          const abortError = await runRejection;

          const abortedObservation = capturedSignal?.aborted;
          return { signalObserved, scope, abortedObservation, abortError };
        } finally {
          vi.useRealTimers();
          // If the wait failed, runRejection may be abandoned; dispose
          // aborts the still-in-flight run and the absorbers swallow its
          // rejection so nothing leaks into the next test. Do not await.
          runPromise.catch(() => {});
          runRejection.catch(() => {});
          scope.dispose();
        }
      };
  });

  describe('runInteractive - Termination and Recovery', () => {
    const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

    it('should time out while waiting for interactive tool completion', async () => {
      const { config } = await createMockConfig();
      // Install fake timers after config creation so config/auth setup runs on
      // real timers; fake timers freeze Date.now/performance.now/hrtime and
      // stop Bun's per-test timeout from firing.
      vi.useFakeTimers();
      const runConfig: RunConfig = {
        max_time_minutes: 0.001,
        max_turns: 100,
      };
      const schedulerFactory = vi.fn(() => ({
        schedule: vi.fn(),
      }));
      const runtimeBundle = createStatelessRuntimeBundle({
        toolsView: {
          listToolNames: () => ['external_tool'],
          getToolMetadata: () => ({
            name: 'external_tool',
            description: 'External tool',
            parameterSchema: { type: 'object', properties: {} },
          }),
        },
      });
      const { overrides } = createRuntimeOverrides({ runtimeBundle });

      const scope = await SubAgentScope.create(
        'interactive-timeout-agent',
        config,
        promptConfig,
        defaultModelConfig,
        runConfig,
        { tools: ['external_tool'] },
        undefined,
        overrides,
      );

      const interactiveResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({
            toolCalls: [
              { id: 'call-timeout', name: 'external_tool', args: {} },
            ],
          }),
        };
      })();
      mockSendMessageStream.mockResolvedValue(interactiveResponseStream);
      const runPromise = scope.runInteractive(new ContextState(), {
        schedulerFactory,
      });
      const runRejection = runPromise.then(
        () => {
          throw new Error('Expected interactive subagent timeout to abort');
        },
        (error) => {
          expect(error).toMatchObject({
            name: 'AbortError',
          });
        },
      );

      try {
        // Wait for the interactive run to enter the scheduler before advancing
        // time past the timeout.
        expect(
          await waitForCondition(
            () => mockSendMessageStream.mock.calls.length > 0,
            CONDITION_WAIT_TURNS,
          ),
        ).toBe(true);
        await advanceTimersByTimeAsync(100);

        await runRejection;
        expect(scope.output.terminate_reason).toBe(
          SubagentTerminateMode.TIMEOUT,
        );
      } finally {
        vi.useRealTimers();
        // If the wait failed, runRejection may be abandoned; dispose
        // aborts the still-in-flight run and the absorbers swallow its
        // rejection so nothing leaks into the next test. Do not await.
        runPromise.catch(() => {});
        runRejection.catch(() => {});
        scope.dispose();
      }
    });
  });

  it('treats eager completed-tool persistence as best-effort during interactive runs', async () => {
    const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };
    const { config } = await createMockConfig();
    const runConfig: RunConfig = { ...defaultRunConfig, max_turns: 1 };
    const recordCompletedToolCalls = vi.fn(() => {
      throw new Error('history write failed');
    });
    (
      ChatSession as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementationOnce(
      () =>
        ({
          sendMessageStream: mockSendMessageStream,
          recordCompletedToolCalls,
          getHistory: vi.fn().mockReturnValue([]),
          getHistoryService: vi.fn().mockReturnValue({
            clear: vi.fn(),
            findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
            getCurated: vi.fn().mockReturnValue([]),
            getTotalTokens: vi.fn().mockReturnValue(0),
          }),
          getConfig: vi.fn().mockReturnValue(undefined),
        }) as unknown as ChatSession,
    );

    const runtimeBundle = createStatelessRuntimeBundle({
      toolsView: {
        listToolNames: () => ['external_tool'],
        getToolMetadata: () => ({
          name: 'external_tool',
          description: 'External tool',
          parameterSchema: { type: 'object', properties: {} },
        }),
      },
    });
    const { overrides } = createRuntimeOverrides({ runtimeBundle });

    const scope = await SubAgentScope.create(
      'interactive-best-effort-agent',
      config,
      promptConfig,
      defaultModelConfig,
      runConfig,
      { tools: ['external_tool'] },
      undefined,
      overrides,
    );

    mockSendMessageStream.mockImplementation(
      createMockStream([
        [
          {
            id: 'call-best-effort',
            name: 'external_tool',
            args: {},
          },
        ],
      ]),
    );

    const completedCalls = [
      {
        status: 'success' as const,
        request: {
          callId: 'call-best-effort',
          name: 'external_tool',
          args: {},
        },
        tool: {
          name: 'external_tool',
          description: 'External tool',
          canUpdateOutput: false,
          schema: { parameters: { type: 'object', properties: {} } },
          build: vi.fn(),
        },
        response: {
          callId: 'call-best-effort',
          responseParts: [{ text: 'tool output' }],
          resultDisplay: 'tool output',
        },
        invocation: { execute: vi.fn() },
      },
    ];
    const schedulerFactory = vi.fn(({ onAllToolCallsComplete }) => ({
      schedule: vi.fn().mockImplementation(async () => {
        await onAllToolCallsComplete(completedCalls);
      }),
      dispose: vi.fn().mockResolvedValue(undefined),
    }));

    await expect(
      scope.runInteractive(new ContextState(), { schedulerFactory }),
    ).resolves.toBeUndefined();
    expect(recordCompletedToolCalls).toHaveBeenCalledWith(
      defaultModelConfig.model,
      completedCalls,
    );
    expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.MAX_TURNS);
  });

  describe('interactive tool scheduling timeout', () => {
    it('should time out when scheduler.schedule() never resolves after emitting a tool call (#1872)', async () => {
      const { modelCallObserved, scope, abortError } =
        await observeTimeOutWhenSchedulerScheduleNeverResolvesAfterEmittingAToolCall();
      expect(modelCallObserved).toBe(true);
      expect(abortError).toMatchObject({ name: 'AbortError' });
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
    });

    const observeTimeOutWhenSchedulerScheduleNeverResolvesAfterEmittingAToolCall =
      async () => {
        const { config } = await createMockConfig();
        const runConfig: RunConfig = {
          max_time_minutes: 0.001, // 0.06 seconds
          max_turns: 100,
        };
        // Install fake timers after config creation so config/auth setup runs
        // on real timers; fake timers freeze Date.now/performance.now/hrtime
        // and stop Bun's per-test timeout from firing.
        vi.useFakeTimers();

        // schedule() hangs until the AbortSignal fires — matching real
        // scheduler where attemptExecutionOfScheduledCalls propagates abort.
        // awaitCompletedCalls returns a forever-pending promise; since
        // schedule() throws first the completion promise is never awaited.
        const abortAwareHang = (_req: unknown, signal: AbortSignal) =>
          new Promise<never>((_resolve, reject) => {
            const abort = () => {
              const err = new Error('Aborted');
              err.name = 'AbortError';
              reject(err);
            };
            if (signal.aborted) {
              abort();
              return;
            }
            signal.addEventListener('abort', abort, { once: true });
          });
        const schedulerFactory = vi.fn(() => ({
          schedule: vi.fn().mockImplementation(abortAwareHang),
          awaitCompletedCalls: vi
            .fn()
            .mockImplementation((signal?: AbortSignal) => {
              if (signal?.aborted === true) {
                const err = new Error('Aborted');
                err.name = 'AbortError';
                return Promise.reject(err);
              }
              return new Promise<never>((_resolve, reject) => {
                signal?.addEventListener(
                  'abort',
                  () => {
                    const err = new Error('Aborted');
                    err.name = 'AbortError';
                    reject(err);
                  },
                  { once: true },
                );
              });
            }),
        }));

        const runtimeBundle = createStatelessRuntimeBundle({
          toolsView: {
            listToolNames: () => ['hanging_tool'],
            getToolMetadata: () => ({
              name: 'hanging_tool',
              description: 'A tool that triggers a hanging scheduler',
              parameterSchema: { type: 'object', properties: {} },
            }),
          },
        });
        const { overrides } = createRuntimeOverrides({ runtimeBundle });

        const scope = await SubAgentScope.create(
          'hanging-scheduler-agent',
          config,
          { systemPrompt: 'Execute task.' },
          defaultModelConfig,
          runConfig,
          { tools: ['hanging_tool'] },
          undefined,
          overrides,
        );

        // Stream yields a tool call then ends
        const interactiveResponseStream = (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({
              toolCalls: [{ id: 'call-hang', name: 'hanging_tool', args: {} }],
            }),
          };
        })();
        mockSendMessageStream.mockResolvedValue(interactiveResponseStream);

        const runPromise = scope.runInteractive(new ContextState(), {
          schedulerFactory,
        });

        const runRejection = runPromise.then(
          () => {
            throw new Error(
              'Expected subagent to abort when scheduler.schedule() hangs',
            );
          },
          (error: unknown) => error,
        );

        try {
          // Wait for the interactive run to enter the hanging scheduler before
          // advancing time past the timeout.
          const modelCallObserved = await waitForCondition(
            () => mockSendMessageStream.mock.calls.length > 0,
            CONDITION_WAIT_TURNS,
          );

          await advanceTimersByTimeAsync(100);

          const abortError = await runRejection;

          return { modelCallObserved, scope, abortError };
        } finally {
          vi.useRealTimers();
          // If the wait failed, runRejection may be abandoned; dispose
          // aborts the still-in-flight run and the absorbers swallow its
          // rejection so nothing leaks into the next test. Do not await.
          runPromise.catch(() => {});
          runRejection.catch(() => {});
          scope.dispose();
        }
      };
  });

  describe('dispose', () => {
    it('should abort active operations when dispose is called', async () => {
      const { config } = await createMockConfig();

      const runtimeBundle = createStatelessRuntimeBundle();
      const { overrides } = createRuntimeOverrides({ runtimeBundle });

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        { systemPrompt: 'Test agent' },
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      // Model returns stop immediately to complete normally
      mockSendMessageStream.mockImplementation(createMockStream(['stop']));
      await scope.runNonInteractive(new ContextState());

      // Now call dispose - it should clean up
      scope.dispose();

      // Verify disposal was successful by checking cancel is safe
      expect(() => scope.cancel('test')).not.toThrow();
    });

    it('should clean up parent abort signal listener when dispose is called', async () => {
      const { config } = await createMockConfig();

      const parentAbortController = new AbortController();
      const removeEventListenerSpy = vi.spyOn(
        parentAbortController.signal,
        'removeEventListener',
      );

      const runtimeBundle = createStatelessRuntimeBundle();
      const { overrides } = createRuntimeOverrides({ runtimeBundle });

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        { systemPrompt: 'Test agent' },
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
        parentAbortController.signal,
      );

      // Run the agent to bind the parent signal
      mockSendMessageStream.mockImplementation(createMockStream(['stop']));
      await scope.runNonInteractive(new ContextState());

      // Now dispose should clean up listeners
      scope.dispose();

      // Verify removeEventListener was called
      expect(removeEventListenerSpy).toHaveBeenCalled();
    });

    it('should be safe to call dispose multiple times', async () => {
      const { config } = await createMockConfig();

      const runtimeBundle = createStatelessRuntimeBundle();
      const { overrides } = createRuntimeOverrides({ runtimeBundle });

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        { systemPrompt: 'Test agent' },
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      // Should not throw
      expect(() => {
        scope.dispose();
        scope.dispose();
        scope.dispose();
      }).not.toThrow();
    });

    it('should nullify active abort controller reference', async () => {
      const { config } = await createMockConfig();

      const runtimeBundle = createStatelessRuntimeBundle();
      const { overrides } = createRuntimeOverrides({ runtimeBundle });

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        { systemPrompt: 'Test agent' },
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      // Start an operation to create an abort controller
      mockSendMessageStream.mockImplementation(createMockStream(['stop']));
      await scope.runNonInteractive(new ContextState());

      // Dispose
      scope.dispose();

      // Try to access the private activeAbortController through cancel method
      // If it's null, cancel should be safe
      expect(() => scope.cancel('test')).not.toThrow();
    });

    it('unblocks a stalled non-interactive run so no async work leaks between tests', async () => {
      const { config } = await createMockConfig();
      // Install fake timers after config creation so config/auth setup runs on
      // real timers; fake timers freeze Date.now/performance.now/hrtime and
      // stop Bun's per-test timeout from firing.
      vi.useFakeTimers();
      // Keep the idle watchdog from firing during the test window so only dispose
      // can unblock the stalled stream consumption.
      config.setEphemeralSetting('stream-idle-timeout-ms', 60_000);

      let capturedSignal: AbortSignal | undefined;
      mockSendMessageStream.mockImplementation(
        async ({ config: messageConfig }) => {
          capturedSignal = messageConfig.abortSignal;
          return (async function* () {
            yield {
              type: StreamEventType.CHUNK,
              value: mockChunk({ text: 'partial' }),
            };
            await new Promise<void>(() => {});
          })();
        },
      );

      const runConfig: RunConfig = { max_time_minutes: 5, max_turns: 100 };
      let scope: SubAgentScope | undefined;
      let runPromise: Promise<void> | undefined;
      let runRejection: Promise<unknown> | undefined;
      try {
        const runtimeBundle = createStatelessRuntimeBundle();
        const { overrides } = createRuntimeOverrides({ runtimeBundle });

        scope = await SubAgentScope.create(
          'test-agent',
          config,
          { systemPrompt: 'Test agent' },
          defaultModelConfig,
          runConfig,
          undefined,
          undefined,
          overrides,
        );

        runPromise = scope.runNonInteractive(new ContextState());
        runRejection = runPromise.then(
          () => {
            throw new Error('Expected dispose to abort the stalled run');
          },
          (error: unknown) => error,
        );

        // Wait for the run to enter stream consumption so the abort signal is
        // captured against this test's mock before dispose fires.
        expect(
          await waitForCondition(
            () => capturedSignal !== undefined,
            CONDITION_WAIT_TURNS,
          ),
        ).toBe(true);

        let settled = false;
        runRejection.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );

        scope.dispose();

        // The stream is stalled after its first chunk and the idle watchdog is
        // too far out to fire; dispose must abort so the run settles within a
        // bounded wait instead of hanging the file.
        expect(
          await waitForCondition(() => settled, CONDITION_WAIT_TURNS),
        ).toBe(true);

        const runError = await runRejection;
        expect(runError).toMatchObject({ name: 'AbortError' });
      } finally {
        vi.useRealTimers();
        // Absorbers guard a failure path: if the run somehow never settles the
        // bounded wait returns false, the expect throws, and these swallow any late
        // rejection so it cannot surface as an unhandled error in the next test.
        // Do not await — a stalled chain under fake timers must not hang cleanup.
        runPromise?.catch(() => {});
        runRejection?.catch(() => {});
        scope?.dispose();
      }
    });
  });
});
