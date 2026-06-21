/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SubAgentScope termination, recovery, runInteractive, scheduling timeout, dispose.
 */

import type { Mock } from 'vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import { SubAgentScope } from './subagent.js';
import {
  ContextState,
  SubagentTerminateMode,
  type PromptConfig,
  type RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { GenerateContentResponse } from '@google/genai';
import { ChatSession, StreamEventType } from './chatSession.js';
import {
  createContentGenerator,
  type ContentGenerator,
} from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
const { mockReadTodos, TodoStoreMock } = vi.hoisted(() => {
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

import {
  createMockConfig,
  createMockStream,
  defaultModelConfig,
  defaultRunConfig,
  createStatelessRuntimeBundle,
  createRuntimeOverrides,
} from './subagent-test-helpers.js';

describe('subagent.ts', () => {
  let mockSendMessageStream: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadTodos.mockReset();
    mockReadTodos.mockResolvedValue([]);
    TodoStoreMock.mockClear();

    vi.mocked(getEnvironmentContext).mockResolvedValue([
      { text: 'Env Context' },
    ]);
    vi.mocked(createContentGenerator).mockResolvedValue({
      getGenerativeModel: vi.fn(),
    } as unknown as ContentGenerator);

    mockSendMessageStream = vi.fn();
    vi.mocked(ChatSession).mockImplementation(
      () =>
        ({
          sendMessageStream: mockSendMessageStream,
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
      // Use fake timers to reliably test timeouts
      vi.useFakeTimers();

      const { config } = await createMockConfig();
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

      const { overrides: timeoutOverrides } = createRuntimeOverrides();
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        runConfig,
        undefined,
        undefined,
        timeoutOverrides,
      );

      const runPromise = scope.runNonInteractive(new ContextState());

      // Advance time beyond the limit (6 minutes) while the agent is awaiting the LLM response.
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000);

      // Now resolve the stream. The model returns 'stop'.

      resolveStream!(createMockStream(['stop'])());

      await runPromise;

      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('should actively abort a stalled non-interactive response stream before the overall run timeout expires', async () => {
      vi.useFakeTimers();

      const { config } = await createMockConfig();
      const testTimeoutMs = 30_000; // 30 second timeout for this test
      config.setEphemeralSetting('stream-idle-timeout-ms', testTimeoutMs);

      const runConfig: RunConfig = { max_time_minutes: 5, max_turns: 100 };
      let capturedSignal: AbortSignal | undefined;

      mockSendMessageStream.mockImplementation(
        async ({ config: messageConfig }) => {
          capturedSignal = messageConfig.abortSignal;
          return (async function* () {
            yield {
              type: StreamEventType.CHUNK,
              value: {
                text: 'partial output',
                candidates: [
                  { content: { parts: [{ text: 'partial output' }] } },
                ],
              } as GenerateContentResponse,
            };

            await new Promise<void>((_resolve, reject) => {
              if (!capturedSignal) {
                reject(new Error('Abort signal was not provided'));
                return;
              }
              if (capturedSignal.aborted) {
                reject(createAbortError());
                return;
              }
              capturedSignal.addEventListener(
                'abort',
                () => {
                  queueMicrotask(() => reject(createAbortError()));
                },
                { once: true },
              );
            });
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
        (error) => {
          expect(error).toMatchObject({
            name: 'AbortError',
          });
        },
      );

      await vi.advanceTimersByTimeAsync(testTimeoutMs + 1_000);

      await runRejection;

      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
      expect(capturedSignal?.aborted).toBe(true);
      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

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
      vi.useFakeTimers();

      const { config } = await createMockConfig();
      const runConfig: RunConfig = {
        max_time_minutes: 0.001,
        max_turns: 100,
      };
      let capturedSignal: AbortSignal | undefined;

      mockSendMessageStream.mockImplementation(
        async ({ config: messageConfig }) => {
          capturedSignal = messageConfig.abortSignal;
          return (async function* () {
            await new Promise<void>((resolve, reject) => {
              if (!capturedSignal) {
                reject(new Error('Abort signal was not provided'));
                return;
              }
              if (capturedSignal.aborted) {
                reject(createAbortError());
                return;
              }
              capturedSignal.addEventListener(
                'abort',
                () => {
                  queueMicrotask(() => reject(createAbortError()));
                },
                { once: true },
              );
            });
            yield* [];
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
          throw new Error('Expected timed out subagent run to abort');
        },
        (error) => {
          expect(error).toMatchObject({
            name: 'AbortError',
          });
        },
      );

      await vi.advanceTimersByTimeAsync(100);

      await runRejection;

      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
      expect(capturedSignal?.aborted).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('runInteractive - Termination and Recovery', () => {
    const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

    it('should time out while waiting for interactive tool completion', async () => {
      vi.useFakeTimers();

      const { config } = await createMockConfig();
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
          value: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        id: 'call-timeout',
                        name: 'external_tool',
                        args: {},
                      },
                    },
                  ],
                },
              },
            ],
          },
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

      await vi.advanceTimersByTimeAsync(100);

      await runRejection;
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);

      vi.useRealTimers();
    });
  });

  describe('interactive tool scheduling timeout', () => {
    it('should time out when scheduler.schedule() never resolves after emitting a tool call (#1872)', async () => {
      vi.useFakeTimers();

      const { config } = await createMockConfig();
      const runConfig: RunConfig = {
        max_time_minutes: 0.001, // 0.06 seconds
        max_turns: 100,
      };

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
          value: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        id: 'call-hang',
                        name: 'hanging_tool',
                        args: {},
                      },
                    },
                  ],
                },
              },
            ],
          },
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
        (error) => {
          expect(error).toMatchObject({
            name: 'AbortError',
          });
        },
      );

      await vi.advanceTimersByTimeAsync(100);

      await runRejection;
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);

      vi.useRealTimers();
    });
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
  });
});
