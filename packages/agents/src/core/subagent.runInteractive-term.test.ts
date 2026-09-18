/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SubAgentScope runInteractive termination, recovery, and scheduling timeout.
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
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
  createStatelessRuntimeBundle,
  createRuntimeOverrides,
  defaultModelConfig,
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
  let mockSendMessageStream: Mock<(...args: never[]) => Promise<unknown>>;

  beforeEach(() => {
    // Guards against a previous test leaking fake-timer state across test
    // boundaries. Restore real timers before failing so a leak fails exactly
    // one test instead of poisoning every later one.
    if (vi.isFakeTimers()) {
      vi.useRealTimers();
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
});
