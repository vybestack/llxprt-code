/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Task as SDKTask,
  TaskStatusUpdateEvent,
  SendStreamingMessageSuccessResponse,
} from '@a2a-js/sdk';
import {
  ApprovalMode,
  type ToolCallConfirmationDetails,
} from '@vybestack/llxprt-code-core';
import type {
  Config,
  ToolCallRequestInfo,
  ToolCall,
  CompletedToolCall,
  CoreToolScheduler,
} from '@vybestack/llxprt-code-core';
import type { SchedulerCallbacks } from '@vybestack/llxprt-code-core';

import { expect, vi } from 'vitest';

export function createMockConfig(
  overrides: Partial<Config> = {},
): Partial<Config> {
  const defaultMessageBus = {
    subscribe: vi.fn().mockReturnValue(() => vi.fn()),
    publish: vi.fn(),
    respondToConfirmation: vi.fn(),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    removeAllListeners: vi.fn(),
    listenerCount: vi.fn().mockReturnValue(0),
  };

  const mockConfig = {
    getToolRegistry: vi.fn().mockReturnValue({
      getTool: vi.fn(),
      getAllToolNames: vi.fn().mockReturnValue([]),
      getAllTools: vi.fn().mockReturnValue([]),
    }),
    getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
    getIdeMode: vi.fn().mockReturnValue(false),
    getAllowedTools: vi.fn().mockReturnValue([]),
    getIdeClient: vi.fn(),
    getWorkspaceContext: vi.fn().mockReturnValue({
      isPathWithinWorkspace: () => true,
    }),
    getTargetDir: () => '/test',
    getGeminiClient: vi.fn(),
    getDebugMode: vi.fn().mockReturnValue(false),
    getContentGeneratorConfig: vi.fn().mockReturnValue({ model: 'gemini-pro' }),
    getModel: vi.fn().mockReturnValue('gemini-pro'),
    getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
    getComplexityAnalyzerSettings: vi.fn().mockReturnValue({}),
    initialize: vi.fn().mockResolvedValue(undefined),
    getProxy: vi.fn().mockReturnValue(undefined),
    getHistory: vi.fn().mockReturnValue([]),
    getEmbeddingModel: vi.fn().mockReturnValue('text-embedding-004'),
    getSessionId: vi.fn().mockReturnValue('test-session-id'),
    getUserTier: vi.fn(),
    getEnableMessageBusIntegration: vi.fn().mockReturnValue(false),
    getMessageBus: vi.fn().mockReturnValue(defaultMessageBus),
    getPolicyEngine: vi.fn(),
    getEnableExtensionReloading: vi.fn().mockReturnValue(false),
    disposeScheduler: vi.fn(),
    getOrCreateScheduler: vi
      .fn()
      .mockImplementation(
        async (_sessionId: string, callbacks: SchedulerCallbacks) => {
          type MockToolCall = {
            request: ToolCallRequestInfo;
            status: 'scheduled' | 'awaiting_approval' | 'executing' | 'success';
            confirmationDetails?: ToolCallConfirmationDetails;
            response?: {
              callId: string;
              responseParts: Array<{ text: string }>;
              resultDisplay: string;
              error: undefined;
              errorType: undefined;
            };
          };

          const makeCall = (
            callId: string,
            name: string,
            status: 'scheduled' | 'awaiting_approval' | 'executing' | 'success',
            args: Record<string, unknown>,
            confirmationDetails?: ToolCallConfirmationDetails,
          ): MockToolCall => ({
            request: {
              callId,
              name,
              args,
              isClientInitiated: false,
              prompt_id: 'prompt-id',
            },
            status,
            confirmationDetails,
          });

          const makeResponse = (callId: string, name: string) => ({
            callId,
            responseParts: [{ text: `Mock response from ${name}` }],
            resultDisplay: `Mock response from ${name}`,
            error: undefined,
            errorType: undefined,
          });

          const confirmationDetails: ToolCallConfirmationDetails = {
            type: 'exec',
            title: 'Mock confirmation',
            command: 'mock command',
            rootCommand: 'mock',
            onConfirm: vi.fn(),
          };

          const schedule = vi
            .fn()
            .mockImplementation(
              async (
                request: ToolCallRequestInfo | ToolCallRequestInfo[],
                _signal: AbortSignal,
              ) => {
                const requests = Array.isArray(request) ? request : [request];
                const scheduledCalls = requests.map((requestItem, index) =>
                  makeCall(
                    requestItem.callId ?? `call-${index}`,
                    requestItem.name,
                    'scheduled',
                    requestItem.args,
                  ),
                );
                callbacks.onToolCallsUpdate?.(scheduledCalls as ToolCall[]);

                const approvalMode = mockConfig.getApprovalMode();
                const shouldBypassApproval = approvalMode === ApprovalMode.YOLO;

                const confirmationResults = await Promise.all(
                  scheduledCalls.map(async (call) => {
                    const tool = mockConfig
                      .getToolRegistry?.()
                      ?.getTool?.(call.request.name);
                    if (!tool || typeof tool.build !== 'function') {
                      return false;
                    }
                    const invocation = tool.build(call.request.args);
                    if (
                      !invocation ||
                      typeof invocation.shouldConfirmExecute !== 'function'
                    ) {
                      return false;
                    }
                    return invocation.shouldConfirmExecute(
                      new AbortController().signal,
                    );
                  }),
                );

                const requiresApproval =
                  !shouldBypassApproval && confirmationResults.some(Boolean);

                if (requiresApproval) {
                  const awaitingCalls = scheduledCalls.map((call) =>
                    makeCall(
                      call.request.callId,
                      call.request.name,
                      'awaiting_approval',
                      call.request.args,
                      confirmationDetails,
                    ),
                  );
                  callbacks.onToolCallsUpdate?.(awaitingCalls as ToolCall[]);
                  return;
                }

                const executingCalls = scheduledCalls.map((call) =>
                  makeCall(
                    call.request.callId,
                    call.request.name,
                    'executing',
                    call.request.args,
                  ),
                );
                callbacks.onToolCallsUpdate?.(executingCalls as ToolCall[]);

                const successCalls = scheduledCalls.map((call) => ({
                  ...makeCall(
                    call.request.callId,
                    call.request.name,
                    'success',
                    call.request.args,
                  ),
                  response: makeResponse(
                    call.request.callId,
                    call.request.name,
                  ),
                }));
                callbacks.onToolCallsUpdate?.(successCalls as ToolCall[]);
                await callbacks.onAllToolCallsComplete?.(
                  successCalls as CompletedToolCall[],
                );
              },
            );

          const scheduler = {
            schedule,
            cancelAll: vi.fn(),
            dispose: vi.fn(),
            toolCalls: [],
            getPreferredEditor: callbacks.getPreferredEditor ?? vi.fn(),
            config: mockConfig,
            toolRegistry: mockConfig?.getToolRegistry?.() || {
              getTool: vi.fn(),
            },
          } as unknown as CoreToolScheduler;

          return scheduler;
        },
      ),
    ...overrides,
  };
  return mockConfig;
}

export function createStreamMessageRequest(
  text: string,
  messageId: string,
  taskId?: string,
) {
  const request: {
    jsonrpc: string;
    id: string;
    method: string;
    params: {
      message: {
        kind: string;
        role: string;
        parts: [{ kind: string; text: string }];
        messageId: string;
      };
      metadata: {
        coderAgent: {
          kind: string;
          workspacePath: string;
        };
      };
      taskId?: string;
    };
  } = {
    jsonrpc: '2.0',
    id: '1',
    method: 'message/stream',
    params: {
      message: {
        kind: 'message',
        role: 'user',
        parts: [{ kind: 'text', text }],
        messageId,
      },
      metadata: {
        coderAgent: {
          kind: 'agent-settings',
          workspacePath: '/tmp',
        },
      },
    },
  };

  if (taskId) {
    request.params.taskId = taskId;
  }

  return request;
}

export function assertUniqueFinalEventIsLast(
  events: SendStreamingMessageSuccessResponse[],
) {
  // Final event is input-required & final
  const finalEvent = events[events.length - 1].result as TaskStatusUpdateEvent;
  expect(finalEvent.metadata?.['coderAgent']).toMatchObject({
    kind: 'state-change',
  });
  expect(finalEvent.status?.state).toBe('input-required');
  expect(finalEvent.final).toBe(true);

  // There is only one event with final and its the last
  expect(
    events.filter((e) => (e.result as TaskStatusUpdateEvent).final).length,
  ).toBe(1);
  expect(
    events.findIndex((e) => (e.result as TaskStatusUpdateEvent).final),
  ).toBe(events.length - 1);
}

export function assertTaskCreationAndWorkingStatus(
  events: SendStreamingMessageSuccessResponse[],
) {
  // Initial task creation event
  const taskEvent = events[0].result as SDKTask;
  expect(taskEvent.kind).toBe('task');
  expect(taskEvent.status.state).toBe('submitted');

  // Status update: working
  const workingEvent = events[1].result as TaskStatusUpdateEvent;
  expect(workingEvent.kind).toBe('status-update');
  expect(workingEvent.status.state).toBe('working');
}
