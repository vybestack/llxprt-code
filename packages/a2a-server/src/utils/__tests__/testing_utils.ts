/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Task as SDKTask,
  TaskStatusUpdateEvent,
  SendStreamingMessageSuccessResponse,
} from '@a2a-js/sdk';
import { expect } from 'bun:test';

export function createStreamMessageRequest(
  text: string,
  messageId: string,
  taskId?: string,
  workspacePath?: string,
) {
  const request: {
    jsonrpc: string;
    id: string;
    method: string;
    params: {
      message: {
        kind: string;
        role: string;
        parts: Array<{ kind: string; text?: string; data?: unknown }>;
        messageId: string;
        metadata: {
          coderAgent: {
            kind: string;
            workspacePath: string;
            autoExecute?: boolean;
          };
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
        metadata: {
          coderAgent: {
            kind: 'agent-settings',
            workspacePath: workspacePath ?? '/tmp',
          },
        },
      },
    },
  };

  if (taskId) {
    request.params.taskId = taskId;
  }

  return request;
}

/**
 * Builds a message/stream request body carrying ONLY a tool-confirmation
 * data part resolving `callId` with `outcome` (the a2a wire shape Task's
 * confirmation resolver consumes).
 */
export function createConfirmationMessageRequest(
  callId: string,
  outcome: string,
  messageId: string,
  taskId: string,
  contextId?: string,
) {
  const request = {
    jsonrpc: '2.0' as const,
    id: '1',
    method: 'message/stream',
    params: {
      message: {
        kind: 'message' as const,
        role: 'user' as const,
        parts: [{ kind: 'data' as const, data: { callId, outcome } }],
        messageId,
        metadata: {
          coderAgent: { kind: 'agent-settings', workspacePath: '/tmp' },
        },
        taskId,
        ...(contextId ? { contextId } : {}),
      },
      taskId,
    },
  };
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

export function assertTaskCreation(
  events: SendStreamingMessageSuccessResponse[],
) {
  // Initial task creation event
  const taskEvent = events[0].result as SDKTask;
  expect(taskEvent.kind).toBe('task');
  expect(taskEvent.status.state).toBe('submitted');
}
