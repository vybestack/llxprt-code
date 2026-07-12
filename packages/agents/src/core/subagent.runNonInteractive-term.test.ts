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
import type { CreateChatSession } from './subagentRuntimeSetup.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import {
  ContextState,
  SubagentTerminateMode,
  type PromptConfig,
  type RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ChatSession, StreamEventType } from './chatSession.js';
import { mockResponseToChunk } from './turn-test-helpers.js';
import {
  createMockConfig,
  createMockStream,
  defaultModelConfig,
  defaultRunConfig,
  createStatelessRuntimeBundle,
  createRuntimeOverrides,
} from './subagent-test-helpers.js';

const { SubAgentScope } = await import(
  './subagent.ts?termination-recovery-behavior'
);

describe('subagent.ts', () => {
  let mockSendMessageStream: Mock;

  const createChatSession: CreateChatSession = () =>
    ({
      sendMessageStream: mockSendMessageStream,
      recordCompletedToolCalls: vi.fn(),
      getHistory: () => [],
      getHistoryService: () => ({
        clear: vi.fn(),
        findUnmatchedToolCalls: () => [],
        getCurated: () => [],
        getTotalTokens: () => 0,
      }),
      getConfig: () => undefined,
    }) as unknown as ChatSession;

  beforeEach(() => {
    mockSendMessageStream = vi.fn();
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
        undefined,
        { createChatSession },
      );

      await scope.runNonInteractive(new ContextState());

      expect(mockSendMessageStream).toHaveBeenCalledTimes(2);
      expect(scope.output.terminate_reason).toBe(
        SubagentTerminateMode.MAX_TURNS,
      );
    });

    it('should terminate with TIMEOUT if the time limit is reached during an LLM call', async () => {
      const { config } = await createMockConfig();
      const runConfig: RunConfig = {
        max_time_minutes: 0.001,
        max_turns: 100,
      };

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
        undefined,
        { createChatSession },
      );

      const runPromise = scope.runNonInteractive(new ContextState());

      while (mockSendMessageStream.mock.calls.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Resolve the provider promise after the timeout has aborted the run.
      resolveStream!(createMockStream(['stop'])());

      await runPromise;

      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
    });

    it('should actively abort a stalled non-interactive response stream before the overall run timeout expires', async () => {
      const { config } = await createMockConfig();
      const testTimeoutMs = 20;
      config.setEphemeralSetting('stream-idle-timeout-ms', testTimeoutMs);

      const runConfig: RunConfig = { max_time_minutes: 5, max_turns: 100 };
      let capturedSignal: AbortSignal | undefined;

      mockSendMessageStream.mockImplementation(
        async ({ config: messageConfig }) => {
          capturedSignal = messageConfig.abortSignal;
          return (async function* () {
            yield {
              type: StreamEventType.CHUNK,
              value: mockResponseToChunk({
                candidates: [
                  { content: { parts: [{ text: 'partial output' }] } },
                ],
              }),
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
        undefined,
        { createChatSession },
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

      await runRejection;

      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
      expect(capturedSignal?.aborted).toBe(true);
      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
      scope.dispose();
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
        undefined,
        { createChatSession },
      );

      await expect(scope.runNonInteractive(new ContextState())).rejects.toThrow(
        'API Failure',
      );
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
    });

    it('should actively abort a hung non-interactive model call when the time limit expires', async () => {
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
        undefined,
        { createChatSession },
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

      await runRejection;

      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
      expect(capturedSignal?.aborted).toBe(true);
    });
  });

  describe('runInteractive - Termination and Recovery', () => {
    const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

    it('should time out while waiting for interactive tool completion', async () => {
      const { config } = await createMockConfig();
      const runConfig: RunConfig = {
        max_time_minutes: 0.001,
        max_turns: 100,
      };
      const schedulerFactory = vi.fn(() => ({
        schedule: vi.fn(),
        awaitCompletedCalls: vi.fn(
          (signal?: AbortSignal) =>
            new Promise<never>((_resolve, reject) => {
              const abort = () => reject(createAbortError());
              if (signal?.aborted === true) {
                abort();
                return;
              }
              signal?.addEventListener('abort', abort, { once: true });
            }),
        ),
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
        undefined,
        {
          createChatSession,
          createTurn: () => ({
            pendingToolCalls: [
              {
                callId: 'call-timeout',
                name: 'external_tool',
                args: {},
                isClientInitiated: false,
                promptId: 'interactive-timeout',
              },
            ],
            run: () => interactiveResponseStream,
          }),
        },
      );

      const interactiveResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: mockResponseToChunk({
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

      await runRejection;
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
    });
  });

  it('treats eager completed-tool persistence as best-effort during interactive runs', async () => {
    const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };
    const { config } = await createMockConfig();
    const runConfig: RunConfig = { ...defaultRunConfig, max_turns: 1 };
    const recordCompletedToolCalls = vi.fn(() => {
      throw new Error('history write failed');
    });
    const createBestEffortChatSession: CreateChatSession = () =>
      ({
        sendMessageStream: mockSendMessageStream,
        recordCompletedToolCalls,
        getHistory: () => [],
        getHistoryService: () => ({
          clear: vi.fn(),
          findUnmatchedToolCalls: () => [],
          getCurated: () => [],
          getTotalTokens: () => 0,
        }),
        getConfig: () => undefined,
      }) as unknown as ChatSession;

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
      undefined,
      {
        createChatSession: createBestEffortChatSession,
        createTurn: () => ({
          pendingToolCalls: [
            {
              callId: 'call-best-effort',
              name: 'external_tool',
              args: {},
              isClientInitiated: false,
              promptId: 'interactive-best-effort',
            },
          ],
          run: async function* () {},
        }),
      },
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
        undefined,
        {
          createChatSession,
          createTurn: () => ({
            pendingToolCalls: [
              {
                callId: 'call-hang',
                name: 'hanging_tool',
                args: {},
                isClientInitiated: false,
                promptId: 'hanging-scheduler',
              },
            ],
            run: () => interactiveResponseStream,
          }),
        },
      );

      // Stream yields a tool call then ends
      const interactiveResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: mockResponseToChunk({
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
        (error) => {
          expect(error).toMatchObject({
            name: 'AbortError',
          });
        },
      );

      await runRejection;
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
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
        undefined,
        { createChatSession },
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
        { createChatSession },
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
        undefined,
        { createChatSession },
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
        undefined,
        { createChatSession },
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
