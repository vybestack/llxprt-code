/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { renderHook, cleanup } from '../../test-utils/render.js';
import { act } from 'react';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import {
  ApprovalMode,
  type CompletedToolCall,
  type Config,
  type MessageBus,
  DebugLogger,
  PolicyDecision,
  type SchedulerCallbacks as SchedulerCallbacksCore,
  type ToolCall,
  ToolConfirmationOutcome,
  type ToolCallConfirmationDetails,
  type ToolCallRequestInfo,
  type ToolRegistry,
  type ToolResult,
  type ToolSchedulerContract,
  type WaitingToolCall,
} from '@vybestack/llxprt-code-core';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';

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

const hasOnConfirm = (
  details: WaitingToolCall['confirmationDetails'],
): details is ToolCallConfirmationDetails =>
  'onConfirm' in details && typeof details.onConfirm === 'function';

type ExecutableToolCall = ToolCall & {
  tool: NonNullable<ToolCall['tool']>;
  invocation: NonNullable<ToolCall['invocation']>;
};

function assertExecutableToolCall(
  call: ToolCall,
): asserts call is ExecutableToolCall {
  if (call.tool === undefined || call.invocation === undefined) {
    throw new Error('Expected executable tool call');
  }
}

function buildErrorResponse(call: ToolCall, error: unknown): CompletedToolCall {
  const msg = error instanceof Error ? error.message : String(error);
  return {
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
            response: { error: msg },
          },
        },
      ],
      resultDisplay: msg,
      error: error instanceof Error ? error : new Error(msg),
      errorType: undefined,
      agentId: call.request.agentId ?? 'primary',
    },
  };
}

function buildSuccessResponse(
  call: ExecutableToolCall,
  result: ToolResult,
): CompletedToolCall {
  return {
    status: 'success',
    request: call.request,
    tool: call.tool,
    invocation: call.invocation,
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
            response: { output: result.llmContent },
          },
        },
      ],
      resultDisplay: result.returnDisplay,
      error: undefined,
      errorType: undefined,
      agentId: call.request.agentId ?? 'primary',
    },
  };
}

async function executeAndRecord(
  call: ToolCall,
  signal: AbortSignal,
  completedCalls: CompletedToolCall[],
): Promise<void> {
  assertExecutableToolCall(call);
  try {
    const result = await call.invocation.execute(signal, undefined);
    completedCalls.push(buildSuccessResponse(call, result));
  } catch (error) {
    completedCalls.push(buildErrorResponse(call, error));
  }
}

/**
 * Process a single scheduled tool call.
 */
async function processScheduledCall(
  call: ToolCall,
  completedCalls: CompletedToolCall[],
  activeCalls: ToolCall[],
  _signal: AbortSignal,
  scheduler: MockScheduler,
  currentCallbacks: SchedulerCallbacks,
): Promise<void> {
  if (call.status === 'error') {
    completedCalls.push(call as CompletedToolCall);
    return;
  }

  assertExecutableToolCall(call);

  try {
    const shouldConfirm = await call.invocation.shouldConfirmExecute(_signal);
    if (shouldConfirm !== false) {
      // Create a Promise that resolves when the user calls onConfirm.
      // This allows the test to trigger confirmation and have execution resume.
      let resolveConfirmation!: (outcome: ToolConfirmationOutcome) => void;
      const confirmationPromise = new Promise<ToolConfirmationOutcome>(
        (resolve) => {
          resolveConfirmation = resolve;
        },
      );
      const originalOnConfirm = shouldConfirm.onConfirm;
      const confirmationDetails: ToolCallConfirmationDetails = {
        ...shouldConfirm,
        onConfirm: async (outcome: ToolConfirmationOutcome) => {
          await originalOnConfirm(outcome);
          resolveConfirmation(outcome);
        },
      };
      const waitingCall: WaitingToolCall = {
        status: 'awaiting_approval',
        request: call.request,
        tool: call.tool,
        invocation: call.invocation,
        confirmationDetails,
      };
      activeCalls.push(waitingCall);
      scheduler.toolCalls = [...activeCalls, ...completedCalls];
      currentCallbacks.onToolCallsUpdate?.(scheduler.toolCalls);

      // Wait for user confirmation
      const outcome = await confirmationPromise;

      // Remove from active calls
      const idx = activeCalls.indexOf(waitingCall);
      if (idx !== -1) activeCalls.splice(idx, 1);

      if (outcome !== ToolConfirmationOutcome.Cancel) {
        // Execute the tool after approval
        await executeAndRecord(call, _signal, completedCalls);
      } else {
        // Cancelled
        completedCalls.push({
          status: 'cancelled',
          request: call.request,
          tool: call.tool,
          invocation: call.invocation,
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
                    error: `User did not allow tool call ${call.request.name}. Reason: User cancelled.`,
                  },
                },
              },
            ],
            resultDisplay: `User did not allow tool call ${call.request.name}. Reason: User cancelled.`,
            error: undefined,
            errorType: undefined,
            agentId: call.request.agentId ?? 'primary',
          },
        } as unknown as CompletedToolCall);
      }
      return;
    }
  } catch (error) {
    completedCalls.push(buildErrorResponse(call, error));
    return;
  }

  try {
    // Pass outputUpdateHandler when tool supports live output updates
    const updateFn =
      call.tool.canUpdateOutput && currentCallbacks.outputUpdateHandler
        ? (chunk: Parameters<typeof currentCallbacks.outputUpdateHandler>[1]) =>
            currentCallbacks.outputUpdateHandler!(call.request.callId, chunk)
        : undefined;
    const result = await call.invocation.execute(_signal, updateFn);
    completedCalls.push(buildSuccessResponse(call, result));
  } catch (error) {
    completedCalls.push(buildErrorResponse(call, error));
  }
}

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
  ToolSchedulerContract,
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
        await processScheduledCall(
          call,
          completedCalls,
          activeCalls,
          _signal,
          scheduler,
          currentCallbacks,
        );
      }

      scheduler.toolCalls = [...activeCalls, ...completedCalls];
      currentCallbacks.onToolCallsUpdate?.(scheduler.toolCalls);
      if (completedCalls.length > 0) {
        await currentCallbacks.onAllToolCallsComplete?.(completedCalls);
        scheduler.toolCalls = activeCalls;
        currentCallbacks.onToolCallsUpdate?.(scheduler.toolCalls);
      }
    }) as unknown as ToolSchedulerContract['schedule'],
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
  isInteractive: () => true,
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
          config: mockConfig,
          messageBus: mockMessageBus as unknown as MessageBus,
          toolRegistry: mockToolRegistry as unknown as ToolRegistry,
        });
        return Promise.resolve(existing);
      }

      const scheduler = buildMockScheduler(mockConfig, callbacks);
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

/**
 * Shared helper to render the useReactToolScheduler hook.
 * Used across multiple test suites to avoid sonarjs/no-identical-functions.
 */
const renderScheduler = (
  onComplete: Mock,
  mockConfig: Partial<Config>,
  setPendingHistoryItem: Mock,
) =>
  renderHook(() =>
    useReactToolScheduler(
      onComplete,
      mockConfig as unknown as Config,
      setPendingHistoryItem,
      () => undefined,
      () => {},
    ),
  );

describe('useReactToolScheduler (split)', () => {
  // Note(ntaylormullen): The following tests are skipped due to difficulties in
  // reliably testing the asynchronous state updates and interactions with timers.
  // These tests involve complex sequences of events, including confirmations,
  // live output updates, and cancellations, which are challenging to assert
  // correctly with the current testing setup. Further investigation is needed
  // to find a robust way to test these scenarios.
  let onComplete: Mock;
  let setPendingHistoryItem: Mock;

  beforeEach(() => {
    onComplete = vi.fn();
    // Reset to DEFAULT approval mode (not YOLO from previous test suite)
    (mockConfig.getApprovalMode as Mock).mockReturnValue(ApprovalMode.DEFAULT);
    setPendingHistoryItem = vi.fn();

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

  it('should handle tool requiring confirmation - approved', async () => {
    vi.useRealTimers();
    mockToolRegistry.getTool.mockReturnValue(mockToolRequiresConfirmation);
    const expectedOutput = 'Confirmed output';
    mockToolRequiresConfirmation.executeFn.mockResolvedValue({
      llmContent: expectedOutput,
      returnDisplay: 'Confirmed display',
    } as ToolResult);

    const { result } = renderScheduler(
      onComplete,
      mockConfig,
      setPendingHistoryItem,
    );
    const schedule = result.current[1];
    const request = buildRequest({
      callId: 'callConfirm',
      name: 'mockToolRequiresConfirmation',
      args: { data: 'sensitive' },
    });

    // Start scheduling — the tool will pause at awaiting_approval
    let schedulePromise: Promise<void>;
    await act(async () => {
      schedulePromise = schedule(request, new AbortController().signal);
    });

    // Wait for the tool to reach awaiting_approval state
    await vi.waitFor(
      () => {
        const waitingCall = result.current[0].find(
          (c) => c.status === 'awaiting_approval',
        ) as WaitingToolCall | undefined;
        expect(waitingCall).toBeDefined();
        expect(waitingCall?.confirmationDetails).toBeDefined();
      },
      { interval: 10, timeout: 5000 },
    );

    // Get onConfirm from the live tool state
    const waitingCall = result.current[0].find(
      (c) => c.status === 'awaiting_approval',
    ) as WaitingToolCall;
    const details = waitingCall.confirmationDetails;
    expect(hasOnConfirm(details)).toBe(true);
    const { onConfirm } = details as ToolCallConfirmationDetails;

    // Approve the confirmation
    await act(async () => {
      await onConfirm(ToolConfirmationOutcome.ProceedOnce);
    });

    // Wait for the tool to complete and onComplete to be called
    await vi.waitFor(
      () =>
        expect(onComplete).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          { isPrimary: true },
        ),
      { interval: 10, timeout: 5000 },
    );

    expect(mockToolRequiresConfirmation.executeFn).toHaveBeenCalledWith(
      request.args,
      expect.any(AbortSignal),
      undefined /*updateOutputFn*/,
    );

    const completedCalls = onComplete.mock.calls[0][1] as CompletedToolCall[];
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0].status).toBe('success');
    expect(completedCalls[0].response.resultDisplay).toBe('Confirmed display');
    expect(completedCalls[0].response.responseParts).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          functionResponse: expect.objectContaining({
            response: { output: expectedOutput },
          }),
        }),
      ]),
    );

    await schedulePromise!;
  });
});
