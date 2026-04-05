/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Task } from './task.js';
import {
  type Config,
  type ToolCallRequestInfo,
  type CompletedToolCall,
  GeminiEventType,
  ApprovalMode,
  ToolConfirmationOutcome,
  type CoreToolScheduler,
  type ToolCall,
} from '@vybestack/llxprt-code-core';
import { createMockConfig } from '../utils/testing_utils.js';
import type { ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import type { Mock } from 'vitest';

describe('Task', () => {
  it('scheduleToolCalls should not modify the input requests array', async () => {
    const mockConfig = createMockConfig();

    const mockEventBus: ExecutionEventBus = {
      publish: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn(),
      finished: vi.fn(),
    };

    // The Task constructor is private. We'll bypass it for this unit test.
    // @ts-expect-error - Calling private constructor for test purposes.
    const task = new Task(
      'task-id',
      'context-id',
      mockConfig as Config,
      mockEventBus,
    );

    // Create a mock scheduler
    task.scheduler = {
      schedule: vi.fn().mockResolvedValue(undefined),
      cancelAll: vi.fn(),
      dispose: vi.fn(),
      toolCalls: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    task['setTaskStateAndPublishUpdate'] = vi.fn();
    task['getProposedContent'] = vi.fn().mockResolvedValue('new content');

    const requests: ToolCallRequestInfo[] = [
      {
        callId: '1',
        name: 'replace',
        args: {
          file_path: 'test.txt',
          old_string: 'old',
          new_string: 'new',
        },
        isClientInitiated: false,
        prompt_id: 'prompt-id-1',
      },
    ];

    const originalRequests = JSON.parse(JSON.stringify(requests));
    const abortController = new AbortController();

    await task.scheduleToolCalls(requests, abortController.signal);

    expect(requests).toEqual(originalRequests);
  });

  describe('acceptAgentMessage', () => {
    it('should set currentTraceId when event has traceId', async () => {
      const mockConfig = createMockConfig();
      const mockEventBus: ExecutionEventBus = {
        publish: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn(),
        finished: vi.fn(),
      };

      // @ts-expect-error - Calling private constructor for test purposes.
      const task = new Task(
        'task-id',
        'context-id',
        mockConfig as Config,
        mockEventBus,
      );

      const event = {
        type: 'content',
        value: 'test',
        traceId: 'test-trace-id',
      };

      await task.acceptAgentMessage(event);

      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            traceId: 'test-trace-id',
          }),
        }),
      );
    });

    it('handles UserCancelled as explicit user cancel semantics', async () => {
      const mockConfig = createMockConfig();
      const mockEventBus: ExecutionEventBus = {
        publish: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn(),
        finished: vi.fn(),
      };

      // @ts-expect-error - Calling private constructor for test purposes.
      const task = new Task(
        'task-id',
        'context-id',
        mockConfig as Config,
        mockEventBus,
      );

      const cancelPendingToolsSpy = vi.spyOn(task, 'cancelPendingTools');
      const publishSpy = vi.spyOn(task, 'setTaskStateAndPublishUpdate');

      await task.acceptAgentMessage({
        type: GeminiEventType.UserCancelled,
      });

      expect(cancelPendingToolsSpy).toHaveBeenCalledWith(
        'User cancelled via LLM stream event',
      );
      expect(publishSpy).toHaveBeenCalledWith(
        'input-required',
        { kind: 'state-change' },
        'Task cancelled by user',
        undefined,
        true,
        undefined,
        undefined,
      );
    });

    it('handles StreamIdleTimeout as timeout semantics (not user-cancel)', async () => {
      const mockConfig = createMockConfig();
      const mockEventBus: ExecutionEventBus = {
        publish: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn(),
        finished: vi.fn(),
      };

      // @ts-expect-error - Calling private constructor for test purposes.
      const task = new Task(
        'task-id',
        'context-id',
        mockConfig as Config,
        mockEventBus,
      );

      const cancelPendingToolsSpy = vi.spyOn(task, 'cancelPendingTools');
      const publishSpy = vi.spyOn(task, 'setTaskStateAndPublishUpdate');

      await task.acceptAgentMessage({
        type: GeminiEventType.StreamIdleTimeout,
        value: {
          error: {
            message:
              'Stream idle timeout: no response received within the allowed time.',
            status: undefined,
          },
        },
      });

      expect(cancelPendingToolsSpy).toHaveBeenCalledWith(
        'LLM stream idle timeout: Stream idle timeout: no response received within the allowed time.',
      );
      expect(publishSpy).toHaveBeenCalledWith(
        'input-required',
        { kind: 'state-change' },
        'Task timed out waiting for model response.',
        undefined,
        true,
        '[API Error: Stream idle timeout: no response received within the allowed time.]',
        undefined,
      );
      expect(publishSpy).not.toHaveBeenCalledWith(
        'input-required',
        { kind: 'state-change' },
        'Task cancelled by user',
        undefined,
        true,
        undefined,
        undefined,
      );
    });
  });

  describe('modelInfo propagation', () => {
    it('should store modelInfo when ModelInfo event is received', async () => {
      const mockConfig = createMockConfig();
      const mockEventBus: ExecutionEventBus = {
        publish: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn(),
        finished: vi.fn(),
      };

      // @ts-expect-error - Calling private constructor for test purposes.
      const task = new Task(
        'task-id',
        'context-id',
        mockConfig as Config,
        mockEventBus,
      );

      const event = {
        type: GeminiEventType.ModelInfo,
        value: {
          model: 'gemini-2.0-flash-exp',
        },
      } as const;

      await task.acceptAgentMessage(event);

      // Access private field for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((task as any).modelInfo).toEqual({
        model: 'gemini-2.0-flash-exp',
      });
    });

    it('should return updated model name from getMetadata when modelInfo is set', async () => {
      const mockConfig = createMockConfig();
      const mockEventBus: ExecutionEventBus = {
        publish: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn(),
        finished: vi.fn(),
      };

      const task = await Task.create(
        'task-id',
        'context-id',
        mockConfig as Config,
        mockEventBus,
      );

      // Set modelInfo via event
      const event = {
        type: GeminiEventType.ModelInfo,
        value: {
          model: 'gemini-2.0-flash-exp',
        },
      } as const;

      await task.acceptAgentMessage(event);

      const metadata = await task.getMetadata();
      expect(metadata.model).toBe('gemini-2.0-flash-exp');
    });

    it('should use modelInfo in setTaskStateAndPublishUpdate status updates', async () => {
      const mockConfig = createMockConfig();
      const mockEventBus: ExecutionEventBus = {
        publish: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn(),
        finished: vi.fn(),
      };

      // @ts-expect-error - Calling private constructor for test purposes.
      const task = new Task(
        'task-id',
        'context-id',
        mockConfig as Config,
        mockEventBus,
      );

      // Set modelInfo
      const event = {
        type: GeminiEventType.ModelInfo,
        value: {
          model: 'gemini-2.0-flash-exp',
        },
      } as const;

      await task.acceptAgentMessage(event);

      // Trigger a status update
      task.setTaskStateAndPublishUpdate('working', {
        kind: 'state-change' as const,
      });

      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            model: 'gemini-2.0-flash-exp',
          }),
        }),
      );
    });

    it('should use default model name when no modelInfo received', async () => {
      const mockConfig = createMockConfig();
      const mockEventBus: ExecutionEventBus = {
        publish: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn(),
        finished: vi.fn(),
      };

      const task = await Task.create(
        'task-id',
        'context-id',
        mockConfig as Config,
        mockEventBus,
      );

      const metadata = await task.getMetadata();
      expect(metadata.model).toBe('gemini-pro'); // Default from mock config
    });

    it('should overwrite modelInfo when multiple ModelInfo events are received', async () => {
      const mockConfig = createMockConfig();
      const mockEventBus: ExecutionEventBus = {
        publish: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn(),
        finished: vi.fn(),
      };

      // @ts-expect-error - Calling private constructor for test purposes.
      const task = new Task(
        'task-id',
        'context-id',
        mockConfig as Config,
        mockEventBus,
      );

      // First ModelInfo event
      const event1 = {
        type: GeminiEventType.ModelInfo,
        value: {
          model: 'gemini-1.5-pro',
        },
      } as const;
      await task.acceptAgentMessage(event1);

      // Second ModelInfo event
      const event2 = {
        type: GeminiEventType.ModelInfo,
        value: {
          model: 'gemini-2.0-flash-exp',
        },
      } as const;
      await task.acceptAgentMessage(event2);

      // Should have the latest modelInfo
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((task as any).modelInfo).toEqual({
        model: 'gemini-2.0-flash-exp',
      });
    });
  });

  describe('currentPromptId and promptCount', () => {
    it('should correctly initialize and update promptId and promptCount', async () => {
      const mockConfig = createMockConfig();
      mockConfig.getSessionId = () => 'test-session-id';

      const mockEventBus: ExecutionEventBus = {
        publish: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn(),
        finished: vi.fn(),
      };

      const sendMessageStreamMock = vi
        .fn()
        .mockReturnValue((async function* () {})());

      // @ts-expect-error - Calling private constructor
      const task = new Task(
        'task-id',
        'context-id',
        mockConfig as Config,
        mockEventBus,
      );
      // Avoid real GeminiClient initialization path in unit test.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (task as any).geminiClient = {
        sendMessageStream: sendMessageStreamMock,
        getUserTier: vi.fn(),
      };

      // Initial state
      expect(task.currentPromptId).toBeUndefined();
      expect(task.promptCount).toBe(0);

      // First user message should set prompt_id
      const userMessage1 = {
        userMessage: {
          parts: [{ kind: 'text', text: 'hello' }],
        },
      } as RequestContext;
      const abortController1 = new AbortController();
      for await (const _ of task.acceptUserMessage(
        userMessage1,
        abortController1.signal,
      )) {
        // no-op
      }

      const expectedPromptId1 = 'test-session-id########0';
      expect(task.promptCount).toBe(1);
      expect(task.currentPromptId).toBe(expectedPromptId1);
      expect(sendMessageStreamMock).toHaveBeenNthCalledWith(
        1,
        expect.any(Array),
        abortController1.signal,
        expectedPromptId1,
      );

      // A new user message should generate a new prompt_id
      const userMessage2 = {
        userMessage: {
          parts: [{ kind: 'text', text: 'world' }],
        },
      } as RequestContext;
      const abortController2 = new AbortController();
      for await (const _ of task.acceptUserMessage(
        userMessage2,
        abortController2.signal,
      )) {
        // no-op
      }

      const expectedPromptId2 = 'test-session-id########1';
      expect(task.promptCount).toBe(2);
      expect(task.currentPromptId).toBe(expectedPromptId2);
      expect(sendMessageStreamMock).toHaveBeenNthCalledWith(
        2,
        expect.any(Array),
        abortController2.signal,
        expectedPromptId2,
      );

      // Subsequent tool call processing should use the same prompt_id
      const completedTool = {
        request: { callId: 'tool-1', prompt_id: expectedPromptId2 },
        response: { responseParts: [{ text: 'tool output' }] },
      } as CompletedToolCall;
      const abortController3 = new AbortController();
      for await (const _ of task.sendCompletedToolsToLlm(
        [completedTool],
        abortController3.signal,
      )) {
        // no-op
      }

      expect(task.promptCount).toBe(2);
      expect(task.currentPromptId).toBe(expectedPromptId2);
      expect(sendMessageStreamMock).toHaveBeenNthCalledWith(
        3,
        expect.any(Array),
        abortController3.signal,
        expectedPromptId2,
      );
    });
  });

  describe('auto-approval', () => {
    let task: Task;
    let mockConfig: Config;
    let mockEventBus: ExecutionEventBus;

    beforeEach(async () => {
      mockConfig = createMockConfig() as Config;
      mockEventBus = {
        publish: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as ExecutionEventBus;

      // @ts-expect-error - Calling private constructor for test purposes
      task = new Task('task-id', 'context-id', mockConfig, mockEventBus);
      task.scheduler = {
        // Mock scheduler methods if needed
      } as unknown as CoreToolScheduler;
    });

    it('should auto-approve tool calls when autoExecute is true', () => {
      task.autoExecute = true;
      const onConfirmSpy = vi.fn();
      const toolCalls = [
        {
          request: { callId: '1' },
          status: 'awaiting_approval',
          confirmationDetails: { onConfirm: onConfirmSpy },
        },
      ] as unknown as ToolCall[];

      // @ts-expect-error - Calling private method
      task._schedulerToolCallsUpdate(toolCalls);

      expect(onConfirmSpy).toHaveBeenCalledWith(
        ToolConfirmationOutcome.ProceedOnce,
      );
    });

    it('should auto-approve tool calls when approval mode is YOLO', () => {
      (mockConfig.getApprovalMode as Mock).mockReturnValue(ApprovalMode.YOLO);
      task.autoExecute = false;
      const onConfirmSpy = vi.fn();
      const toolCalls = [
        {
          request: { callId: '1' },
          status: 'awaiting_approval',
          confirmationDetails: { onConfirm: onConfirmSpy },
        },
      ] as unknown as ToolCall[];

      // @ts-expect-error - Calling private method
      task._schedulerToolCallsUpdate(toolCalls);

      expect(onConfirmSpy).toHaveBeenCalledWith(
        ToolConfirmationOutcome.ProceedOnce,
      );
    });

    it('should NOT auto-approve when autoExecute is false and mode is not YOLO', () => {
      task.autoExecute = false;
      (mockConfig.getApprovalMode as Mock).mockReturnValue(
        ApprovalMode.DEFAULT,
      );
      const onConfirmSpy = vi.fn();
      const toolCalls = [
        {
          request: { callId: '1' },
          status: 'awaiting_approval',
          confirmationDetails: { onConfirm: onConfirmSpy },
        },
      ] as unknown as ToolCall[];

      // @ts-expect-error - Calling private method
      task._schedulerToolCallsUpdate(toolCalls);

      expect(onConfirmSpy).not.toHaveBeenCalled();
    });
  });
});
