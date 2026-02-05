/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { renderHook, cleanup } from '../../test-utils/render.js';
import { act } from 'react';
import {
  useReactToolScheduler,
  mapToDisplay,
} from './useReactToolScheduler.js';
import {
  ApprovalMode,
  AnyDeclarativeTool,
  AnyToolInvocation,
  CompletedToolCall,
  type Config,
  type CoreToolScheduler,
  DebugLogger,
  PolicyDecision,
  type SchedulerCallbacks as SchedulerCallbacksCore,
  type Status as ToolCallStatusType,
  type ToolCall,
  ToolConfirmationOutcome,
  type ToolCallConfirmationDetails,
  type ToolCallRequestInfo,
  type ToolCallResponseInfo,
  type ToolRegistry,
  type ToolResult,
  type WaitingToolCall,
} from '@vybestack/llxprt-code-core';
import { MockTool } from '@vybestack/llxprt-code-core/src/test-utils/mock-tool.js';
import type { HistoryItemWithoutId, HistoryItemToolGroup } from '../types.js';
import { ToolCallStatus } from '../types.js';

const buildRequest = (
  overrides: Partial<ToolCallRequestInfo> = {},
): ToolCallRequestInfo => ({
  callId: overrides.callId ?? 'testCallId',
  name: overrides.name ?? 'testTool',
  args: overrides.args ?? { foo: 'bar' },
  isClientInitiated: overrides.isClientInitiated ?? false,
  prompt_id: overrides.prompt_id ?? 'prompt-id',
  agentId: overrides.agentId ?? 'primary',
});

const mockToolRegistry = {
  getTool: vi.fn(),
  getAllToolNames: vi.fn(() => ['mockTool', 'anotherTool']),
};

const mockMessageBus = {
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  publish: vi.fn(),
};

type SchedulerCallbacks = SchedulerCallbacksCore & { config?: Config };

type MockScheduler = Pick<
  CoreToolScheduler,
  'schedule' | 'cancelAll' | 'dispose' | 'setCallbacks'
> & {
  toolCalls: ToolCall[];
  callbacks: SchedulerCallbacks;
  config: Config;
  toolRegistry: ToolRegistry;
};

const createdSchedulers = new Map<string, MockScheduler>();

const buildMockScheduler = (
  config: Config,
  callbacks: SchedulerCallbacks,
): MockScheduler => {
  const scheduler: MockScheduler = {
    schedule: vi.fn(async (request, _signal) => {
      // IMPORTANT: Use scheduler.callbacks instead of callbacks closure
      // so that callbacks updated via setCallbacks() are used
      const currentCallbacks = scheduler.callbacks;
      const requests = Array.isArray(request) ? request : [request];
      scheduler.toolCalls = requests.map((req) => {
        const tool = scheduler.toolRegistry.getTool(req.name);
        if (tool) {
          const invocation = tool.build(req.args);
          return {
            status: 'scheduled',
            request: req,
            tool,
            invocation,
          } satisfies ToolCall;
        }

        return {
          status: 'error',
          request: req,
          response: {
            callId: req.callId,
            responseParts: [
              {
                functionCall: {
                  id: req.callId,
                  name: req.name,
                  args: req.args,
                },
              },
              {
                functionResponse: {
                  id: req.callId,
                  name: req.name,
                  response: {
                    error: `Tool "${req.name}" could not be loaded. Did you mean one of: "mockTool", "anotherTool"?`,
                  },
                },
              },
            ],
            resultDisplay: `Tool "${req.name}" could not be loaded. Did you mean one of: "mockTool", "anotherTool"?`,
            error: new Error(
              `Tool "${req.name}" could not be loaded. Did you mean one of: "mockTool", "anotherTool"?`,
            ),
            errorType: undefined,
            agentId: req.agentId ?? 'primary',
          },
        } satisfies ToolCall;
      });

      currentCallbacks.onToolCallsUpdate?.(scheduler.toolCalls);

      const completedCalls: CompletedToolCall[] = [];
      const activeCalls: ToolCall[] = [];

      for (const call of scheduler.toolCalls) {
        if (call.status === 'error') {
          completedCalls.push(call as CompletedToolCall);
          continue;
        }

        try {
          const shouldConfirm =
            await call.invocation.shouldConfirmExecute(_signal);
          if (shouldConfirm) {
            const confirmationDetails =
              shouldConfirm as ToolCallConfirmationDetails;
            const waitingCall: WaitingToolCall = {
              status: 'awaiting_approval',
              request: call.request,
              tool: call.tool,
              invocation: call.invocation,
              confirmationDetails,
            };
            activeCalls.push(waitingCall);
            continue;
          }
        } catch (error) {
          completedCalls.push({
            status: 'error',
            request: call.request,
            tool: call.tool,
            response: {
              callId: call.request.callId,
              responseParts: [
                {
                  functionCall: {
                    id: call.request.callId,
                    name: call.request.name,
                    args: call.request.args,
                  },
                },
                {
                  functionResponse: {
                    id: call.request.callId,
                    name: call.request.name,
                    response: {
                      error:
                        error instanceof Error ? error.message : String(error),
                    },
                  },
                },
              ],
              resultDisplay:
                error instanceof Error ? error.message : String(error),
              error: error instanceof Error ? error : new Error(String(error)),
              errorType: undefined,
              agentId: call.request.agentId ?? 'primary',
            },
          });
          continue;
        }

        try {
          const result = await call.invocation.execute(_signal, undefined);
          const response: ToolCallResponseInfo = {
            callId: call.request.callId,
            responseParts: [
              {
                functionCall: {
                  id: call.request.callId,
                  name: call.request.name,
                  args: call.request.args,
                },
              },
              {
                functionResponse: {
                  id: call.request.callId,
                  name: call.request.name,
                  response: { output: result.llmContent },
                },
              },
            ],
            resultDisplay: result.returnDisplay,
            error: undefined,
            errorType: undefined,
            agentId: call.request.agentId ?? 'primary',
          };
          completedCalls.push({
            status: 'success',
            request: call.request,
            tool: call.tool,
            invocation: call.invocation,
            response,
          });
        } catch (error) {
          completedCalls.push({
            status: 'error',
            request: call.request,
            tool: call.tool,
            response: {
              callId: call.request.callId,
              responseParts: [
                {
                  functionCall: {
                    id: call.request.callId,
                    name: call.request.name,
                    args: call.request.args,
                  },
                },
                {
                  functionResponse: {
                    id: call.request.callId,
                    name: call.request.name,
                    response: {
                      error:
                        error instanceof Error ? error.message : String(error),
                    },
                  },
                },
              ],
              resultDisplay:
                error instanceof Error ? error.message : String(error),
              error: error instanceof Error ? error : new Error(String(error)),
              errorType: undefined,
              agentId: call.request.agentId ?? 'primary',
            },
          });
        }
      }

      scheduler.toolCalls = [...activeCalls, ...completedCalls];
      currentCallbacks.onToolCallsUpdate?.(scheduler.toolCalls);
      if (completedCalls.length > 0) {
        await currentCallbacks.onAllToolCallsComplete?.(completedCalls);
        scheduler.toolCalls = activeCalls;
        currentCallbacks.onToolCallsUpdate?.(scheduler.toolCalls);
      }
    }) as unknown as CoreToolScheduler['schedule'],
    cancelAll: vi.fn(),
    dispose: vi.fn(),
    setCallbacks: vi.fn((nextCallbacks) => {
      const nextConfig = nextCallbacks.config ?? config;
      scheduler.callbacks = {
        outputUpdateHandler: nextCallbacks.outputUpdateHandler,
        onAllToolCallsComplete: nextCallbacks.onAllToolCallsComplete,
        onToolCallsUpdate: nextCallbacks.onToolCallsUpdate,
        getPreferredEditor: nextCallbacks.getPreferredEditor,
        onEditorClose: nextCallbacks.onEditorClose,
        onEditorOpen: nextCallbacks.onEditorOpen,
        config: nextConfig,
      };
    }),

    toolCalls: [],
    callbacks,
    config,
    toolRegistry: mockToolRegistry as unknown as ToolRegistry,
  };
  return scheduler;
};

const mockConfig = {
  getToolRegistry: vi.fn(() => mockToolRegistry as unknown as ToolRegistry),
  getApprovalMode: vi.fn(() => ApprovalMode.DEFAULT),
  getSessionId: () => 'test-session-id',
  getUsageStatisticsEnabled: () => true,
  getDebugMode: () => false,
  getAllowedTools: vi.fn(() => []),
  getContentGeneratorConfig: () => ({
    model: 'test-model',
  }),
  getMessageBus: () => mockMessageBus,
  getPolicyEngine: vi.fn(() => ({
    evaluate: vi.fn(() => PolicyDecision.ASK_USER),
  })),
  getOrCreateScheduler: vi.fn(
    (sessionId: string, callbacks: SchedulerCallbacks) => {
      const existing = createdSchedulers.get(sessionId);
      if (existing) {
        existing.setCallbacks({
          ...callbacks,
          config: mockConfig as Config,
        });
        return Promise.resolve(existing);
      }

      const scheduler = buildMockScheduler(mockConfig as Config, callbacks);
      createdSchedulers.set(sessionId, scheduler);
      return Promise.resolve(scheduler);
    },
  ),
  disposeScheduler: vi.fn((sessionId: string) => {
    const scheduler = createdSchedulers.get(sessionId);
    scheduler?.dispose();
    createdSchedulers.delete(sessionId);
  }),
  setInteractiveSubagentSchedulerFactory: vi.fn(),
} as unknown as Config;

const mockTool = new MockTool({
  name: 'mockTool',
  displayName: 'Mock Tool',
  shouldConfirmExecute: vi.fn(),
});
const mockToolWithLiveOutput = new MockTool({
  name: 'mockToolWithLiveOutput',
  displayName: 'Mock Tool With Live Output',
  description: 'A mock tool for testing',
  params: {},
  isOutputMarkdown: true,
  canUpdateOutput: true,
  shouldConfirmExecute: vi.fn(),
});
let mockOnUserConfirmForToolConfirmation: Mock;
const mockToolRequiresConfirmation = new MockTool({
  name: 'mockToolRequiresConfirmation',
  displayName: 'Mock Tool Requires Confirmation',
  shouldConfirmExecute: vi.fn(),
});

describe('useReactToolScheduler in YOLO Mode', () => {
  let onComplete: Mock;
  let setPendingHistoryItem: Mock;

  beforeEach(() => {
    onComplete = vi.fn();
    setPendingHistoryItem = vi.fn();
    mockToolRegistry.getTool.mockClear();
    mockToolRequiresConfirmation.executeFn.mockClear();

    // IMPORTANT: Enable YOLO mode for this test suite
    (mockConfig.getApprovalMode as Mock).mockReturnValue(ApprovalMode.YOLO);

    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    for (const [sessionId, scheduler] of createdSchedulers.entries()) {
      scheduler.dispose();
      createdSchedulers.delete(sessionId);
    }
    DebugLogger.disposeAll();
  });

  const renderScheduler = () =>
    renderHook(() =>
      useReactToolScheduler(
        onComplete,
        mockConfig as unknown as Config,
        setPendingHistoryItem,
        () => undefined,
        () => {},
      ),
    );

  it('defaults agentId to primary when schedule is invoked without one', async () => {
    vi.useRealTimers();
    mockToolRegistry.getTool.mockReturnValue(mockTool);
    mockTool.executeFn.mockResolvedValue({
      llmContent: 'default output',
      returnDisplay: 'default output',
    } as ToolResult);

    const { result } = renderScheduler();
    const schedule = result.current[1];
    const requestWithoutAgent = buildRequest({
      callId: 'no-agent',
      name: 'mockTool',
      args: {},
      agentId: undefined,
    });

    act(() => {
      schedule(requestWithoutAgent, new AbortController().signal);
    });

    await vi.waitFor(
      () =>
        expect(onComplete).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          { isPrimary: true },
        ),
      { interval: 10, timeout: 5000 },
    );

    const completedCalls = onComplete.mock.calls[0][1] as CompletedToolCall[];
    expect(completedCalls[0].request.agentId).toBe('primary');
  });
});

describe('useReactToolScheduler', () => {
  // TODO(ntaylormullen): The following tests are skipped due to difficulties in
  // reliably testing the asynchronous state updates and interactions with timers.
  // These tests involve complex sequences of events, including confirmations,
  // live output updates, and cancellations, which are challenging to assert
  // correctly with the current testing setup. Further investigation is needed
  // to find a robust way to test these scenarios.
  let onComplete: Mock;
  let setPendingHistoryItem: Mock;
  let capturedOnConfirmForTest:
    | ((outcome: ToolConfirmationOutcome) => void | Promise<void>)
    | undefined;

  beforeEach(() => {
    onComplete = vi.fn();
    capturedOnConfirmForTest = undefined;
    // Reset to DEFAULT approval mode (not YOLO from previous test suite)
    (mockConfig.getApprovalMode as Mock).mockReturnValue(ApprovalMode.DEFAULT);
    setPendingHistoryItem = vi.fn((updaterOrValue) => {
      let pendingItem: HistoryItemWithoutId | null = null;
      if (typeof updaterOrValue === 'function') {
        // Loosen the type for prevState to allow for more flexible updates in tests
        const prevState: Partial<HistoryItemToolGroup> = {
          type: 'tool_group', // Still default to tool_group for most cases
          agentId: 'primary',
          tools: [],
        };

        pendingItem = updaterOrValue(prevState as HistoryItemWithoutId);
      } else {
        pendingItem = updaterOrValue;
      }
      // Capture onConfirm if it exists, regardless of the exact type of pendingItem
      // This is a common pattern in these tests.
      if (
        (pendingItem as HistoryItemToolGroup)?.tools?.[0]?.confirmationDetails
          ?.onConfirm
      ) {
        capturedOnConfirmForTest = (pendingItem as HistoryItemToolGroup)
          .tools[0].confirmationDetails?.onConfirm;
      }
    });

    mockToolRegistry.getTool.mockClear();
    mockTool.executeFn.mockClear();
    mockToolWithLiveOutput.executeFn.mockClear();
    mockToolRequiresConfirmation.executeFn.mockClear();

    mockOnUserConfirmForToolConfirmation = vi.fn();
    const confirmationDetails: ToolCallConfirmationDetails = {
      onConfirm: mockOnUserConfirmForToolConfirmation,
      fileName: 'mockToolRequiresConfirmation.ts',
      filePath: 'mockToolRequiresConfirmation.ts',
      fileDiff: 'Mock tool requires confirmation',
      originalContent: 'original',
      newContent: 'updated',
      type: 'edit',
      title: 'Mock Tool Requires Confirmation',
    };
    (
      mockToolRequiresConfirmation.shouldConfirmExecute as Mock
    ).mockImplementation(
      async (): Promise<ToolCallConfirmationDetails | null> =>
        confirmationDetails,
    );

    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    for (const [sessionId, scheduler] of createdSchedulers.entries()) {
      scheduler.dispose();
      createdSchedulers.delete(sessionId);
    }
    DebugLogger.disposeAll();
  });

  const renderScheduler = () =>
    renderHook(() =>
      useReactToolScheduler(
        onComplete,
        mockConfig as unknown as Config,
        setPendingHistoryItem,
        () => undefined,
        () => {},
      ),
    );

  it('initial state should be empty', () => {
    const { result } = renderScheduler();
    expect(result.current[0]).toEqual([]);
  });

  it('should schedule and execute a tool call successfully', async () => {
    vi.useRealTimers();
    mockToolRegistry.getTool.mockReturnValue(mockTool);
    mockTool.executeFn.mockResolvedValue({
      llmContent: 'Tool output',
      returnDisplay: 'Formatted tool output',
    } as ToolResult);
    (mockTool.shouldConfirmExecute as Mock).mockResolvedValue(null);

    const { result } = renderScheduler();
    const schedule = result.current[1];
    const request = buildRequest({
      callId: 'call1',
      name: 'mockTool',
      args: { param: 'value' },
    });

    act(() => {
      schedule(request, new AbortController().signal);
    });

    await vi.waitFor(
      () =>
        expect(mockTool.executeFn).toHaveBeenCalledWith(
          request.args,
          expect.any(AbortSignal),
          undefined /*updateOutputFn*/,
        ),
      { interval: 10, timeout: 5000 },
    );

    await vi.waitFor(
      () =>
        expect(onComplete).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          { isPrimary: true },
        ),
      { interval: 10, timeout: 5000 },
    );

    const completedCalls = onComplete.mock.calls[0][1] as CompletedToolCall[];
    expect(completedCalls).toHaveLength(1);
    const completedCall = completedCalls[0];
    expect(completedCall.status).toBe('success');
    expect(completedCall.request.agentId).toBe('primary');
    expect(completedCall.response?.resultDisplay).toBe('Formatted tool output');
    expect(completedCall.response?.responseParts).toEqual([
      {
        functionCall: {
          id: 'call1',
          name: 'mockTool',
          args: { param: 'value' },
        },
      },
      {
        functionResponse: {
          id: 'call1',
          name: 'mockTool',
          response: { output: 'Tool output' },
        },
      },
    ]);
    expect(result.current[0]).toEqual([]);
  });

  it('should handle tool not found', async () => {
    vi.useRealTimers();
    mockToolRegistry.getTool.mockReturnValue(undefined);
    const { result } = renderScheduler();
    const schedule = result.current[1];
    const request = buildRequest({
      callId: 'call1',
      name: 'nonexistentTool',
      args: {},
    });

    act(() => {
      schedule(request, new AbortController().signal);
    });

    await vi.waitFor(
      () =>
        expect(onComplete).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          { isPrimary: true },
        ),
      { interval: 10, timeout: 5000 },
    );

    const completionArgs = onComplete.mock.calls[0][1] as CompletedToolCall[];
    expect(completionArgs).toHaveLength(1);
    const failedCall = completionArgs[0];
    expect(failedCall.status).toBe('error');
    expect(failedCall.request.agentId).toBe('primary');
    if (!failedCall.response.error) {
      throw new Error('Expected tool response error');
    }
    const errorMessage = failedCall.response.error.message ?? '';
    expect(errorMessage).toContain('could not be loaded');
    expect(errorMessage).toContain('Did you mean one of:');
    expect(errorMessage).toContain('"mockTool"');
    expect(errorMessage).toContain('"anotherTool"');
    expect(result.current[0]).toEqual([]);
  });

  it('should handle error during shouldConfirmExecute', async () => {
    vi.useRealTimers();
    mockToolRegistry.getTool.mockReturnValue(mockTool);
    const confirmError = new Error('Confirmation check failed');
    (mockTool.shouldConfirmExecute as Mock).mockRejectedValue(confirmError);

    const { result } = renderScheduler();
    const schedule = result.current[1];
    const request = buildRequest({
      callId: 'call1',
      name: 'mockTool',
      args: {},
    });

    act(() => {
      schedule(request, new AbortController().signal);
    });

    await vi.waitFor(
      () =>
        expect(onComplete).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          { isPrimary: true },
        ),
      { interval: 10, timeout: 5000 },
    );

    const errorCalls = onComplete.mock.calls[0][1] as CompletedToolCall[];
    expect(errorCalls).toHaveLength(1);
    const errorCall = errorCalls[0];
    expect(errorCall.status).toBe('error');
    expect(errorCall.request.agentId).toBe('primary');
    expect(errorCall.response?.error?.message).toBe(confirmError.message);
    expect(result.current[0]).toEqual([]);
  });

  it('should handle error during execute', async () => {
    vi.useRealTimers();
    mockToolRegistry.getTool.mockReturnValue(mockTool);
    (mockTool.shouldConfirmExecute as Mock).mockResolvedValue(null);
    const execError = new Error('Execution failed');
    mockTool.executeFn.mockRejectedValue(execError);

    const { result } = renderScheduler();
    const schedule = result.current[1];
    const request = buildRequest({
      callId: 'call1',
      name: 'mockTool',
      args: {},
    });

    act(() => {
      schedule(request, new AbortController().signal);
    });

    await vi.waitFor(
      () =>
        expect(onComplete).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          { isPrimary: true },
        ),
      { interval: 10, timeout: 5000 },
    );

    const executeCalls = onComplete.mock.calls[0][1] as CompletedToolCall[];
    expect(executeCalls).toHaveLength(1);
    const execCall = executeCalls[0];
    expect(execCall.status).toBe('error');
    expect(execCall.request.agentId).toBe('primary');
    expect(execCall.response?.error?.message).toBe(execError.message);
    expect(result.current[0]).toEqual([]);
  });

  it.skip('should handle tool requiring confirmation - approved', async () => {
    mockToolRegistry.getTool.mockReturnValue(mockToolRequiresConfirmation);
    const expectedOutput = 'Confirmed output';
    mockToolRequiresConfirmation.executeFn.mockResolvedValue({
      llmContent: expectedOutput,
      returnDisplay: 'Confirmed display',
    } as ToolResult);

    const { result } = renderScheduler();
    const schedule = result.current[1];
    const request = buildRequest({
      callId: 'callConfirm',
      name: 'mockToolRequiresConfirmation',
      args: { data: 'sensitive' },
    });

    act(() => {
      schedule(request, new AbortController().signal);
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(setPendingHistoryItem).toHaveBeenCalled();
    expect(capturedOnConfirmForTest).toBeDefined();

    await act(async () => {
      await capturedOnConfirmForTest?.(ToolConfirmationOutcome.ProceedOnce);
    });

    await act(async () => {
      for (let i = 0; i < 10; i++) {
        await vi.runOnlyPendingTimersAsync();
      }
    });

    expect(mockToolRequiresConfirmation.executeFn).toHaveBeenCalledWith(
      request.args,
      expect.any(AbortSignal),
      undefined /*updateOutputFn*/,
    );

    await act(async () => {
      for (let i = 0; i < 10; i++) {
        await vi.runOnlyPendingTimersAsync();
      }
    });

    expect(onComplete).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { isPrimary: true },
    );

    expect(mockToolRequiresConfirmation.executeFn).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({
        status: 'success',
        request,
        response: expect.objectContaining({
          resultDisplay: 'Confirmed display',
          responseParts: expect.arrayContaining([
            expect.objectContaining({
              functionResponse: expect.objectContaining({
                response: { output: expectedOutput },
              }),
            }),
          ]),
        }),
      }),
    ]);
  });

  it.skip('should handle tool requiring confirmation - cancelled by user', async () => {
    mockToolRegistry.getTool.mockReturnValue(mockToolRequiresConfirmation);
    const { result } = renderScheduler();
    const schedule = result.current[1];
    const request = buildRequest({
      callId: 'callConfirmCancel',
      name: 'mockToolRequiresConfirmation',
      args: {},
    });

    act(() => {
      schedule(request, new AbortController().signal);
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(setPendingHistoryItem).toHaveBeenCalled();
    expect(capturedOnConfirmForTest).toBeDefined();

    await act(async () => {
      await capturedOnConfirmForTest?.(ToolConfirmationOutcome.Cancel);
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(mockOnUserConfirmForToolConfirmation).toHaveBeenCalledWith(
      ToolConfirmationOutcome.Cancel,
    );
    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({
        status: 'cancelled',
        request,
        response: expect.objectContaining({
          responseParts: expect.arrayContaining([
            expect.objectContaining({
              functionResponse: expect.objectContaining({
                response: expect.objectContaining({
                  error: `User did not allow tool call ${request.name}. Reason: User cancelled.`,
                }),
              }),
            }),
          ]),
        }),
      }),
    ]);
  });

  it.skip('should handle live output updates', async () => {
    mockToolRegistry.getTool.mockReturnValue(mockToolWithLiveOutput);
    let liveUpdateFn: ((output: string) => void) | undefined;
    let resolveExecutePromise: (value: ToolResult) => void;
    const executePromise = new Promise<ToolResult>((resolve) => {
      resolveExecutePromise = resolve;
    });

    mockToolWithLiveOutput.executeFn.mockImplementation(
      async (
        _args: Record<string, unknown>,
        _signal: AbortSignal,
        updateFn: ((output: string) => void) | undefined,
      ) => {
        liveUpdateFn = updateFn;
        return executePromise;
      },
    );
    (mockToolWithLiveOutput.shouldConfirmExecute as Mock).mockResolvedValue(
      null,
    );

    const { result } = renderScheduler();
    const schedule = result.current[1];
    const request = buildRequest({
      callId: 'liveCall',
      name: 'mockToolWithLiveOutput',
      args: {},
    });

    act(() => {
      schedule(request, new AbortController().signal);
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(liveUpdateFn).toBeDefined();
    expect(setPendingHistoryItem).toHaveBeenCalled();

    await act(async () => {
      liveUpdateFn?.('Live output 1');
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    await act(async () => {
      liveUpdateFn?.('Live output 2');
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    act(() => {
      resolveExecutePromise({
        llmContent: 'Final output',
        returnDisplay: 'Final display',
      } as ToolResult);
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({
        status: 'success',
        request,
        response: expect.objectContaining({
          resultDisplay: 'Final display',
          responseParts: expect.arrayContaining([
            expect.objectContaining({
              functionResponse: expect.objectContaining({
                response: { output: 'Final output' },
              }),
            }),
          ]),
        }),
      }),
    ]);
    expect(result.current[0]).toEqual([]);
  });

  it('should schedule and execute multiple tool calls', async () => {
    vi.useRealTimers();
    const tool1 = new MockTool({
      name: 'tool1',
      displayName: 'Tool 1',
      execute: vi.fn().mockResolvedValue({
        llmContent: 'Output 1',
        returnDisplay: 'Display 1',
      } as ToolResult),
    });

    const tool2 = new MockTool({
      name: 'tool2',
      displayName: 'Tool 2',
      execute: vi.fn().mockResolvedValue({
        llmContent: 'Output 2',
        returnDisplay: 'Display 2',
      } as ToolResult),
    });

    mockToolRegistry.getTool.mockImplementation((name) => {
      if (name === 'tool1') return tool1;
      if (name === 'tool2') return tool2;
      return undefined;
    });

    const { result } = renderScheduler();
    const schedule = result.current[1];
    const requests = [
      buildRequest({ callId: 'multi1', name: 'tool1', args: { p: 1 } }),
      buildRequest({ callId: 'multi2', name: 'tool2', args: { p: 2 } }),
    ];

    act(() => {
      schedule(requests, new AbortController().signal);
    });

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), {
      interval: 10,
      timeout: 5000,
    });

    const completedCalls = onComplete.mock.calls[0][1] as CompletedToolCall[];
    expect(completedCalls.length).toBe(2);

    const call1Result = completedCalls.find(
      (c) => c.request.callId === 'multi1',
    );
    const call2Result = completedCalls.find(
      (c) => c.request.callId === 'multi2',
    );

    expect(call1Result).toMatchObject({
      status: 'success',
      request: requests[0],
      response: expect.objectContaining({
        resultDisplay: 'Display 1',
        responseParts: [
          {
            functionCall: {
              id: 'multi1',
              name: 'tool1',
              args: { p: 1 },
            },
          },
          {
            functionResponse: {
              id: 'multi1',
              name: 'tool1',
              response: { output: 'Output 1' },
            },
          },
        ],
      }),
    });

    expect(call2Result).toMatchObject({
      status: 'success',
      request: requests[1],
      response: expect.objectContaining({
        resultDisplay: 'Display 2',
        responseParts: [
          {
            functionCall: {
              id: 'multi2',
              name: 'tool2',
              args: { p: 2 },
            },
          },
          {
            functionResponse: {
              id: 'multi2',
              name: 'tool2',
              response: { output: 'Output 2' },
            },
          },
        ],
      }),
    });
    expect(result.current[0]).toEqual([]);
  });

  it.skip('should throw error if scheduling while already running', async () => {
    mockToolRegistry.getTool.mockReturnValue(mockTool);
    const longExecutePromise = new Promise<ToolResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            llmContent: 'done',
            returnDisplay: 'done display',
          }),
        50,
      ),
    );
    mockTool.executeFn.mockReturnValue(longExecutePromise);
    (mockTool.shouldConfirmExecute as Mock).mockResolvedValue(null);

    const { result } = renderScheduler();
    const schedule = result.current[1];
    const request1 = buildRequest({
      callId: 'run1',
      name: 'mockTool',
      args: {},
    });
    const request2 = buildRequest({
      callId: 'run2',
      name: 'mockTool',
      args: {},
    });

    expect(schedule).toBeDefined();
    expect(request1.name).toBe('mockTool');
    expect(request2.callId).toBe('run2');
  });
});

describe('mapToDisplay', () => {
  const baseRequest: ToolCallRequestInfo = buildRequest();

  const baseTool = new MockTool({
    name: 'testTool',
    displayName: 'Test Tool Display',
    execute: vi.fn(),
    shouldConfirmExecute: vi.fn(),
  });

  const baseResponse: ToolCallResponseInfo = {
    callId: 'testCallId',
    responseParts: [
      {
        functionResponse: {
          name: 'testTool',
          id: 'testCallId',
          response: { output: 'Test output' },
        },
      },
    ],
    resultDisplay: 'Test display output',
    error: undefined,
    errorType: undefined,
    agentId: 'primary',
  };

  // Define a more specific type for extraProps for these tests
  // This helps ensure that tool and confirmationDetails are only accessed when they are expected to exist.
  type MapToDisplayExtraProps =
    | {
        tool?: AnyDeclarativeTool;
        invocation?: AnyToolInvocation;
        liveOutput?: string;
        response?: ToolCallResponseInfo;
        confirmationDetails?: ToolCallConfirmationDetails;
      }
    | {
        tool: AnyDeclarativeTool;
        invocation?: AnyToolInvocation;
        response?: ToolCallResponseInfo;
        confirmationDetails?: ToolCallConfirmationDetails;
      }
    | {
        response: ToolCallResponseInfo;
        tool?: undefined;
        confirmationDetails?: ToolCallConfirmationDetails;
      }
    | {
        confirmationDetails: ToolCallConfirmationDetails;
        tool?: AnyDeclarativeTool;
        invocation?: AnyToolInvocation;
        response?: ToolCallResponseInfo;
      };

  const baseInvocation = baseTool.build(baseRequest.args);
  const testCases: Array<{
    name: string;
    status: ToolCallStatusType;
    extraProps?: MapToDisplayExtraProps;
    expectedStatus: ToolCallStatus;
    expectedResultDisplay?: ToolCallResponseInfo['resultDisplay'];
    expectedName?: string;
    expectedDescription?: string;
  }> = [
    {
      name: 'validating',
      status: 'validating',
      extraProps: { tool: baseTool, invocation: baseInvocation },
      expectedStatus: ToolCallStatus.Executing,
      expectedName: baseTool.displayName,
      expectedDescription: baseInvocation.getDescription(),
    },
    {
      name: 'awaiting_approval',
      status: 'awaiting_approval',
      extraProps: {
        tool: baseTool,
        invocation: baseInvocation,
        confirmationDetails: {
          onConfirm: vi.fn(),
          type: 'edit',
          title: 'Test Tool Display',
          serverName: 'testTool',
          toolName: 'testTool',
          toolDisplayName: 'Test Tool Display',
          filePath: 'mock',
          fileName: 'test.ts',
          fileDiff: 'Test diff',
          originalContent: 'Original content',
          newContent: 'New content',
        } as ToolCallConfirmationDetails,
      },
      expectedStatus: ToolCallStatus.Confirming,
      expectedName: baseTool.displayName,
      expectedDescription: baseInvocation.getDescription(),
    },
    {
      name: 'scheduled',
      status: 'scheduled',
      extraProps: { tool: baseTool, invocation: baseInvocation },
      expectedStatus: ToolCallStatus.Pending,
      expectedName: baseTool.displayName,
      expectedDescription: baseInvocation.getDescription(),
    },
    {
      name: 'executing no live output',
      status: 'executing',
      extraProps: { tool: baseTool, invocation: baseInvocation },
      expectedStatus: ToolCallStatus.Executing,
      expectedName: baseTool.displayName,
      expectedDescription: baseInvocation.getDescription(),
    },
    {
      name: 'executing with live output',
      status: 'executing',
      extraProps: {
        tool: baseTool,
        invocation: baseInvocation,
        liveOutput: 'Live test output',
      },
      expectedStatus: ToolCallStatus.Executing,
      expectedResultDisplay: 'Live test output',
      expectedName: baseTool.displayName,
      expectedDescription: baseInvocation.getDescription(),
    },
    {
      name: 'success',
      status: 'success',
      extraProps: {
        tool: baseTool,
        invocation: baseInvocation,
        response: baseResponse,
      },
      expectedStatus: ToolCallStatus.Success,
      expectedResultDisplay: baseResponse.resultDisplay,
      expectedName: baseTool.displayName,
      expectedDescription: baseInvocation.getDescription(),
    },
    {
      name: 'error tool not found',
      status: 'error',
      extraProps: {
        response: {
          ...baseResponse,
          error: new Error('Test error tool not found'),
          resultDisplay: 'Error display tool not found',
        },
      },
      expectedStatus: ToolCallStatus.Error,
      expectedResultDisplay: 'Error display tool not found',
      expectedName: baseRequest.name,
      expectedDescription: JSON.stringify(baseRequest.args),
    },
    {
      name: 'error tool execution failed',
      status: 'error',
      extraProps: {
        tool: baseTool,
        response: {
          ...baseResponse,
          error: new Error('Tool execution failed'),
          resultDisplay: 'Execution failed display',
        },
      },
      expectedStatus: ToolCallStatus.Error,
      expectedResultDisplay: 'Execution failed display',
      expectedName: baseTool.displayName, // Changed from baseTool.name
      expectedDescription: JSON.stringify(baseRequest.args),
    },
    {
      name: 'cancelled',
      status: 'cancelled',
      extraProps: {
        tool: baseTool,
        invocation: baseInvocation,
        response: {
          ...baseResponse,
          resultDisplay: 'Cancelled display',
        },
      },
      expectedStatus: ToolCallStatus.Canceled,
      expectedResultDisplay: 'Cancelled display',
      expectedName: baseTool.displayName,
      expectedDescription: baseInvocation.getDescription(),
    },
  ];

  testCases.forEach(
    ({
      name: testName,
      status,
      extraProps,
      expectedStatus,
      expectedResultDisplay,
      expectedName,
      expectedDescription,
    }) => {
      it(`should map ToolCall with status '${status}' (${testName}) correctly`, () => {
        const toolCall: ToolCall = {
          request: baseRequest,
          status,
          ...(extraProps || {}),
        } as ToolCall;

        const display = mapToDisplay(toolCall);
        expect(display.type).toBe('tool_group');
        expect(display.tools.length).toBe(1);
        const toolDisplay = display.tools[0];

        expect(toolDisplay.callId).toBe(baseRequest.callId);
        expect(toolDisplay.status).toBe(expectedStatus);
        expect(toolDisplay.resultDisplay).toBe(expectedResultDisplay);

        expect(toolDisplay.name).toBe(expectedName);
        expect(toolDisplay.description).toBe(expectedDescription);

        expect(toolDisplay.renderOutputAsMarkdown).toBe(
          extraProps?.tool?.isOutputMarkdown ?? false,
        );
        const isAwaitingApproval = status === 'awaiting_approval';

        // Assert confirmation details based on status
        const hasExpectedConfirmationDetails = isAwaitingApproval
          ? toolDisplay.confirmationDetails === extraProps!.confirmationDetails
          : toolDisplay.confirmationDetails === undefined;
        expect(hasExpectedConfirmationDetails).toBe(true);
      });
    },
  );

  it('should map an array of ToolCalls correctly', () => {
    const toolCall1: ToolCall = {
      request: { ...baseRequest, callId: 'call1' },
      status: 'success',
      tool: baseTool,
      invocation: baseTool.build(baseRequest.args),
      response: { ...baseResponse, callId: 'call1' },
    } as ToolCall;
    const toolForCall2 = new MockTool({
      name: baseTool.name,
      displayName: baseTool.displayName,
      isOutputMarkdown: true,
      execute: vi.fn(),
      shouldConfirmExecute: vi.fn(),
    });
    const toolCall2: ToolCall = {
      request: { ...baseRequest, callId: 'call2' },
      status: 'executing',
      tool: toolForCall2,
      invocation: toolForCall2.build(baseRequest.args),
      liveOutput: 'markdown output',
    } as ToolCall;

    const display = mapToDisplay([toolCall1, toolCall2]);
    expect(display.tools.length).toBe(2);
    expect(display.tools[0].callId).toBe('call1');
    expect(display.tools[0].status).toBe(ToolCallStatus.Success);
    expect(display.tools[0].renderOutputAsMarkdown).toBe(false);
    expect(display.tools[1].callId).toBe('call2');
    expect(display.tools[1].status).toBe(ToolCallStatus.Executing);
    expect(display.tools[1].resultDisplay).toBe('markdown output');
    expect(display.tools[1].renderOutputAsMarkdown).toBe(true);
  });
});
