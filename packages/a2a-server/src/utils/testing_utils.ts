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

type MutableMockConfig = Partial<Config> & {
  getApprovalMode: () => ApprovalMode;
  getToolRegistry: () => unknown;
};

function createDefaultMessageBus() {
  return {
    subscribe: vi.fn().mockReturnValue(() => vi.fn()),
    publish: vi.fn(),
    respondToConfirmation: vi.fn(),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    removeAllListeners: vi.fn(),
    listenerCount: vi.fn().mockReturnValue(0),
  };
}

function makeCall(
  callId: string,
  name: string,
  status: MockToolCall['status'],
  args: Record<string, unknown>,
  confirmationDetails?: ToolCallConfirmationDetails,
): MockToolCall {
  return {
    request: {
      callId,
      name,
      args,
      isClientInitiated: false,
      prompt_id: 'prompt-id',
    },
    status,
    confirmationDetails,
  };
}

function makeResponse(callId: string, name: string) {
  return {
    callId,
    responseParts: [{ text: `Mock response from ${name}` }],
    resultDisplay: `Mock response from ${name}`,
    error: undefined,
    errorType: undefined,
  };
}

function createConfirmationDetails(): ToolCallConfirmationDetails {
  return {
    type: 'exec',
    title: 'Mock confirmation',
    command: 'mock command',
    rootCommand: 'mock',
    rootCommands: ['mock'],
    onConfirm: vi.fn(),
  };
}

function createScheduledCalls(requests: ToolCallRequestInfo[]): MockToolCall[] {
  return requests.map((requestItem, index) =>
    makeCall(
      // Test utility mock contract: callId fallback for defensive testing
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Permissive mock contract for test utilities
      requestItem.callId ?? `call-${index}`,
      requestItem.name,
      'scheduled',
      requestItem.args,
    ),
  );
}

async function callRequiresApproval(
  mockConfig: MutableMockConfig,
  call: MockToolCall,
): Promise<boolean> {
  const registry = mockConfig.getToolRegistry() as
    | { getTool?: (name: string) => unknown }
    | null
    | undefined;
  const tool = registry?.getTool?.(call.request.name) as
    | { build?: (args: Record<string, unknown>) => unknown }
    | undefined;
  if (tool == null || typeof tool.build !== 'function') {
    return false;
  }
  const invocation = tool.build(call.request.args) as
    | {
        shouldConfirmExecute?: (
          signal: AbortSignal,
        ) => boolean | Promise<boolean>;
      }
    | undefined;
  if (
    invocation == null ||
    typeof invocation.shouldConfirmExecute !== 'function'
  ) {
    return false;
  }
  return invocation.shouldConfirmExecute(new AbortController().signal);
}

async function requiresApproval(
  mockConfig: MutableMockConfig,
  scheduledCalls: MockToolCall[],
): Promise<boolean> {
  const shouldBypassApproval =
    mockConfig.getApprovalMode() === ApprovalMode.YOLO;
  const confirmationResults = await Promise.all(
    scheduledCalls.map((call) => callRequiresApproval(mockConfig, call)),
  );
  return !shouldBypassApproval && confirmationResults.some(Boolean);
}

function publishAwaitingApproval(
  callbacks: SchedulerCallbacks,
  scheduledCalls: MockToolCall[],
): void {
  const confirmationDetails = createConfirmationDetails();
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
}

async function completeScheduledCalls(
  callbacks: SchedulerCallbacks,
  scheduledCalls: MockToolCall[],
): Promise<void> {
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
    response: makeResponse(call.request.callId, call.request.name),
  }));
  callbacks.onToolCallsUpdate?.(successCalls as ToolCall[]);
  await callbacks.onAllToolCallsComplete?.(successCalls as CompletedToolCall[]);
}

function createSchedulerFactory(mockConfig: MutableMockConfig) {
  return vi
    .fn()
    .mockImplementation(
      async (_sessionId: string, callbacks: SchedulerCallbacks) => {
        const schedule = vi
          .fn()
          .mockImplementation(
            async (
              request: ToolCallRequestInfo | ToolCallRequestInfo[],
              _signal: AbortSignal,
            ) => {
              const requests = Array.isArray(request) ? request : [request];
              const scheduledCalls = createScheduledCalls(requests);
              callbacks.onToolCallsUpdate?.(scheduledCalls as ToolCall[]);

              if (await requiresApproval(mockConfig, scheduledCalls)) {
                publishAwaitingApproval(callbacks, scheduledCalls);
                return;
              }

              await completeScheduledCalls(callbacks, scheduledCalls);
            },
          );

        return {
          schedule,
          cancelAll: vi.fn(),
          dispose: vi.fn(),
          toolCalls: [],
          getPreferredEditor: callbacks.getPreferredEditor,
          config: mockConfig,
          toolRegistry: mockConfig.getToolRegistry(),
        } as unknown as CoreToolScheduler;
      },
    );
}

export function createMockConfig(
  overrides: Partial<Config> = {},
): Partial<Config> {
  const defaultMessageBus = createDefaultMessageBus();
  const mockConfig = {
    getToolRegistry: vi.fn().mockReturnValue({
      getTool: vi.fn(),
      getAllToolNames: vi.fn().mockReturnValue([]),
      getAllTools: vi.fn().mockReturnValue([]),
      getToolsByServer: vi.fn().mockReturnValue([]),
    }),
    getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
    getIdeMode: vi.fn().mockReturnValue(false),
    isInteractive: () => true,
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
    getProvider: vi.fn().mockReturnValue('gemini'),
    getMcpServers: vi.fn().mockReturnValue({}),
    getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
    getComplexityAnalyzerSettings: vi.fn().mockReturnValue({}),
    initialize: vi.fn().mockResolvedValue(undefined),
    getProxy: vi.fn().mockReturnValue(undefined),
    getHistory: vi.fn().mockReturnValue([]),
    getEmbeddingModel: vi.fn().mockReturnValue('text-embedding-004'),
    getSessionId: vi.fn().mockReturnValue('test-session-id'),
    getUserTier: vi.fn(),
    getMessageBus: vi.fn().mockReturnValue(defaultMessageBus),
    getPolicyEngine: vi.fn(),
    getEnableExtensionReloading: vi.fn().mockReturnValue(false),
    disposeScheduler: vi.fn(),
    getCheckpointingEnabled: vi.fn().mockReturnValue(false),
    getGitService: vi.fn().mockResolvedValue({
      restoreProjectFromSnapshot: vi.fn().mockResolvedValue(undefined),
      createFileSnapshot: vi.fn().mockResolvedValue('mock-snapshot-hash'),
      getCurrentCommitHash: vi.fn().mockResolvedValue('mock-commit-hash'),
    }),
    storage: {
      getProjectTempCheckpointsDir: vi
        .fn()
        .mockReturnValue('/tmp/test-checkpoints'),
    } as unknown as Config['storage'],
    ...overrides,
  } as MutableMockConfig;
  if (
    Object.prototype.hasOwnProperty.call(overrides, 'getOrCreateScheduler') ===
    false
  ) {
    mockConfig.getOrCreateScheduler = createSchedulerFactory(mockConfig);
  }
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
  // metadata is optional per SDK type, test contract ensures it's present for final events
  expect(finalEvent.metadata?.['coderAgent']).toMatchObject({
    kind: 'state-change',
  });
  expect(finalEvent.status.state).toBe('input-required');
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
