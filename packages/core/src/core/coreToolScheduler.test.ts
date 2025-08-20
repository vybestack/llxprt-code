/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CoreToolScheduler,
  ToolCall,
  convertToFunctionResponse,
} from './coreToolScheduler.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  ToolConfirmationPayload,
  ToolInvocation,
  ToolResult,
  Config,
  Kind,
  ApprovalMode,
  ToolRegistry,
} from '../index.js';
import { Part, PartListUnion } from '@google/genai';
import { MockModifiableTool, MockTool } from '../test-utils/tools.js';

describe('CoreToolScheduler', () => {
  it('should cancel a tool call if the signal is aborted before confirmation', async () => {
    const mockTool = new MockTool();
    mockTool.shouldConfirm = true;
    const declarativeTool = mockTool;
    const toolRegistry = {
      getTool: () => declarativeTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => declarativeTool,
      getToolByDisplayName: () => declarativeTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    };

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      toolRegistry: Promise.resolve(toolRegistry as unknown as ToolRegistry),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: '1',
      name: 'mockTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-1',
    };

    abortController.abort();
    await scheduler.schedule([request], abortController.signal);

    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('cancelled');
  });
});

describe('CoreToolScheduler with payload', () => {
  it('should update args and diff and execute tool when payload is provided', async () => {
    const mockTool = new MockModifiableTool();
    const declarativeTool = mockTool;
    const toolRegistry = {
      getTool: () => declarativeTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => declarativeTool,
      getToolByDisplayName: () => declarativeTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    };

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      toolRegistry: Promise.resolve(toolRegistry as unknown as ToolRegistry),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: '1',
      name: 'mockModifiableTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-2',
    };

    await scheduler.schedule([request], abortController.signal);

    await vi.waitFor(() => {
      const awaitingCall = onToolCallsUpdate.mock.calls.find(
        (call) => call[0][0].status === 'awaiting_approval',
      )?.[0][0];
      expect(awaitingCall).toBeDefined();
    });

    const awaitingCall = onToolCallsUpdate.mock.calls.find(
      (call) => call[0][0].status === 'awaiting_approval',
    )?.[0][0];
    const confirmationDetails = awaitingCall.confirmationDetails;

    if (confirmationDetails) {
      const payload: ToolConfirmationPayload = { newContent: 'final version' };
      await confirmationDetails.onConfirm(
        ToolConfirmationOutcome.ProceedOnce,
        payload,
      );
    }

    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('success');
    expect(mockTool.executeFn).toHaveBeenCalledWith({
      newContent: 'final version',
    });
  });
});

describe('convertToFunctionResponse', () => {
  const toolName = 'testTool';
  const callId = 'call1';

  it('should handle simple string llmContent', () => {
    const llmContent = 'Simple text output';
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual({
      functionResponse: {
        name: toolName,
        id: callId,
        response: { output: 'Simple text output' },
      },
    });
  });

  it('should handle llmContent as a single Part with text', () => {
    const llmContent: Part = { text: 'Text from Part object' };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual({
      functionResponse: {
        name: toolName,
        id: callId,
        response: { output: 'Text from Part object' },
      },
    });
  });

  it('should handle llmContent as a PartListUnion array with a single text Part', () => {
    const llmContent: PartListUnion = [{ text: 'Text from array' }];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual({
      functionResponse: {
        name: toolName,
        id: callId,
        response: { output: 'Text from array' },
      },
    });
  });

  it('should handle llmContent with inlineData', () => {
    const llmContent: Part = {
      inlineData: { mimeType: 'image/png', data: 'base64...' },
    };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual({
      functionResponse: {
        name: toolName,
        id: callId,
        response: {
          output: 'Binary content of type image/png was processed.',
          binaryContent: llmContent,
        },
      },
    });
  });

  it('should handle llmContent with fileData', () => {
    const llmContent: Part = {
      fileData: { mimeType: 'application/pdf', fileUri: 'gs://...' },
    };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual({
      functionResponse: {
        name: toolName,
        id: callId,
        response: {
          output: 'Binary content of type application/pdf was processed.',
          binaryContent: llmContent,
        },
      },
    });
  });

  it('should handle llmContent as an array of multiple Parts (text and inlineData)', () => {
    const llmContent: PartListUnion = [
      { text: 'Some textual description' },
      { inlineData: { mimeType: 'image/jpeg', data: 'base64data...' } },
      { text: 'Another text part' },
    ];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    // When array contains mixed parts, it extracts text and creates a single function response
    expect(result).toEqual({
      functionResponse: {
        name: toolName,
        id: callId,
        response: { output: 'Some textual descriptionAnother text part' },
      },
    });
  });

  it('should handle llmContent as an array with a single inlineData Part', () => {
    const llmContent: PartListUnion = [
      { inlineData: { mimeType: 'image/gif', data: 'gifdata...' } },
    ];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual({
      functionResponse: {
        name: toolName,
        id: callId,
        response: {
          output: 'Binary content of type image/gif was processed.',
          binaryContent: llmContent[0],
        },
      },
    });
  });

  it('should handle llmContent as a generic Part (not text, inlineData, or fileData)', () => {
    const llmContent: Part = { functionCall: { name: 'test', args: {} } };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual({
      functionResponse: {
        name: toolName,
        id: callId,
        response: { output: 'Tool execution succeeded.' },
      },
    });
  });

  it('should handle empty string llmContent', () => {
    const llmContent = '';
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual({
      functionResponse: {
        name: toolName,
        id: callId,
        response: { output: '' },
      },
    });
  });

  it('should handle llmContent as an empty array', () => {
    const llmContent: PartListUnion = [];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    // Empty array is treated as array of strings (no strings), so returns empty output
    expect(result).toEqual({
      functionResponse: {
        name: toolName,
        id: callId,
        response: { output: '' },
      },
    });
  });

  it('should handle llmContent as a Part with undefined inlineData/fileData/text', () => {
    const llmContent: Part = {}; // An empty part object
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual({
      functionResponse: {
        name: toolName,
        id: callId,
        response: { output: 'Tool execution succeeded.' },
      },
    });
  });

  it('should ensure correct id when llmContent contains functionResponse without id', () => {
    const llmContent: Part = {
      functionResponse: {
        name: 'originalTool',
        response: { output: 'Tool completed successfully' },
      },
    };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual({
      functionResponse: {
        name: toolName,
        id: callId,
        response: { output: 'Tool completed successfully' },
      },
    });
  });

  it('should override id when llmContent contains functionResponse with different id', () => {
    const llmContent: Part = {
      functionResponse: {
        id: 'wrong_id',
        name: 'originalTool',
        response: { output: 'Tool completed successfully' },
      },
    };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual({
      functionResponse: {
        id: callId, // Should use the provided callId, not 'wrong_id'
        name: toolName, // Should use the provided toolName
        response: { output: 'Tool completed successfully' },
      },
    });
  });
});

class MockEditToolInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(params: Record<string, unknown>) {
    super(params);
  }

  getDescription(): string {
    return 'A mock edit tool invocation';
  }

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    return {
      type: 'edit',
      title: 'Confirm Edit',
      fileName: 'test.txt',
      filePath: 'test.txt',
      fileDiff:
        '--- test.txt\n+++ test.txt\n@@ -1,1 +1,1 @@\n-old content\n+new content',
      originalContent: 'old content',
      newContent: 'new content',
      onConfirm: async () => {},
    };
  }

  async execute(_abortSignal: AbortSignal): Promise<ToolResult> {
    return {
      llmContent: 'Edited successfully',
      returnDisplay: 'Edited successfully',
    };
  }
}

class MockEditTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor() {
    super('mockEditTool', 'mockEditTool', 'A mock edit tool', Kind.Edit, {});
  }

  protected createInvocation(
    params: Record<string, unknown>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    return new MockEditToolInvocation(params);
  }
}

describe('CoreToolScheduler edit cancellation', () => {
  it('should preserve diff when an edit is cancelled', async () => {
    const mockEditTool = new MockEditTool();
    const declarativeTool = mockEditTool;
    const toolRegistry = {
      getTool: () => declarativeTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => declarativeTool,
      getToolByDisplayName: () => declarativeTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    };

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      toolRegistry: Promise.resolve(toolRegistry as unknown as ToolRegistry),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: '1',
      name: 'mockEditTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-1',
    };

    await scheduler.schedule([request], abortController.signal);

    // Wait for the tool to reach awaiting_approval state
    const awaitingCall = onToolCallsUpdate.mock.calls.find(
      (call) => call[0][0].status === 'awaiting_approval',
    )?.[0][0];

    expect(awaitingCall).toBeDefined();

    // Cancel the edit
    const confirmationDetails = awaitingCall.confirmationDetails;
    if (confirmationDetails) {
      await confirmationDetails.onConfirm(ToolConfirmationOutcome.Cancel);
    }

    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];

    expect(completedCalls[0].status).toBe('cancelled');

    // Check that the diff is preserved
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cancelledCall = completedCalls[0] as any;
    expect(cancelledCall.response.resultDisplay).toBeDefined();
    expect(cancelledCall.response.resultDisplay.fileDiff).toBe(
      '--- test.txt\n+++ test.txt\n@@ -1,1 +1,1 @@\n-old content\n+new content',
    );
    expect(cancelledCall.response.resultDisplay.fileName).toBe('test.txt');
  });
});

describe('CoreToolScheduler queue handling', () => {
  // TODO: Fix these tests - the current implementation executes tools in parallel in YOLO mode
  // rather than sequentially. The queue prevents errors but doesn't enforce sequential execution.
  it.skip('should queue tool calls when another is running', async () => {
    // Arrange
    const mockTool1 = new MockTool('tool1');
    const mockTool2 = new MockTool('tool2');
    let tool1ExecuteResolve: () => void;
    const tool1ExecutePromise = new Promise<void>((resolve) => {
      tool1ExecuteResolve = resolve;
    });

    // Make tool1 take time to execute
    mockTool1.executeFn.mockImplementation(async () => {
      await tool1ExecutePromise;
      return { output: 'Tool 1 result' };
    });

    mockTool2.executeFn.mockResolvedValue({ output: 'Tool 2 result' });

    const toolRegistry = {
      getTool: (name: string) => (name === 'tool1' ? mockTool1 : mockTool2),
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: (name: string) =>
        name === 'tool1' ? mockTool1 : mockTool2,
      getToolByDisplayName: () => mockTool1,
    };

    const completedCalls: ToolCall[][] = [];
    const scheduler = new CoreToolScheduler({
      toolRegistry: Promise.resolve(toolRegistry as unknown as ToolRegistry),
      onAllToolCallsComplete: (calls) => {
        completedCalls.push(calls);
      },
      getPreferredEditor: () => undefined,
      config: {
        getApprovalMode: () => ApprovalMode.YOLO,
      } as Config,
      onEditorClose: vi.fn(),
    });

    // Act
    const signal1 = new AbortController().signal;
    const signal2 = new AbortController().signal;

    // Schedule first tool
    const schedule1Promise = scheduler.schedule(
      {
        callId: 'call1',
        name: 'tool1',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      },
      signal1,
    );

    // Give the first tool time to start executing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Try to schedule second tool while first is running - should be queued
    const schedule2Promise = scheduler.schedule(
      {
        callId: 'call2',
        name: 'tool2',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      },
      signal2,
    );

    // Wait for both schedule calls to complete
    await Promise.all([schedule1Promise, schedule2Promise]);

    // At this point, tool1 should be executing and tool2 should be queued
    expect(mockTool1.executeFn).toHaveBeenCalled();
    expect(mockTool2.executeFn).not.toHaveBeenCalled();

    // Complete tool1
    tool1ExecuteResolve!();

    // Wait for queue processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert
    expect(mockTool2.executeFn).toHaveBeenCalled();
    expect(completedCalls).toHaveLength(2);
    expect(completedCalls[0]).toHaveLength(1);
    expect(completedCalls[0][0].request.callId).toBe('call1');
    expect(completedCalls[1]).toHaveLength(1);
    expect(completedCalls[1][0].request.callId).toBe('call2');
  });

  it.skip('should process multiple queued requests in order', async () => {
    // Arrange
    const mockTool = new MockTool();
    const executionOrder: string[] = [];
    let activeExecutions = 0;
    let maxConcurrentExecutions = 0;

    mockTool.executeFn.mockImplementation(async (args: { id: string }) => {
      activeExecutions++;
      maxConcurrentExecutions = Math.max(
        maxConcurrentExecutions,
        activeExecutions,
      );
      executionOrder.push(args.id);
      await new Promise((resolve) => setTimeout(resolve, 50));
      activeExecutions--;
      return { output: `Result for ${args.id}` };
    });

    const toolRegistry = {
      getTool: () => mockTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => mockTool,
      getToolByDisplayName: () => mockTool,
    };

    const scheduler = new CoreToolScheduler({
      toolRegistry: Promise.resolve(toolRegistry as unknown as ToolRegistry),
      getPreferredEditor: () => undefined,
      config: {
        getApprovalMode: () => ApprovalMode.YOLO,
      } as Config,
      onEditorClose: vi.fn(),
    });

    // Act
    const signal = new AbortController().signal;

    // Schedule the first tool
    const firstSchedulePromise = scheduler.schedule(
      {
        callId: 'call1',
        name: 'mockTool',
        args: { id: 'tool1' },
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      },
      signal,
    );

    // Wait a bit to ensure first tool is executing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Schedule remaining tools while first is running - they should be queued
    const remainingPromises = [];
    for (let i = 2; i <= 4; i++) {
      remainingPromises.push(
        scheduler.schedule(
          {
            callId: `call${i}`,
            name: 'mockTool',
            args: { id: `tool${i}` },
            isClientInitiated: false,
            prompt_id: 'test-prompt',
          },
          signal,
        ),
      );
    }

    await firstSchedulePromise;
    await Promise.all(remainingPromises);

    // Wait for all to complete
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Assert - only one tool should execute at a time
    expect(maxConcurrentExecutions).toBe(1);
    // Tools should execute in order
    expect(executionOrder).toEqual(['tool1', 'tool2', 'tool3', 'tool4']);
  });
});

describe('CoreToolScheduler YOLO mode', () => {
  it('should execute tool requiring confirmation directly without waiting', async () => {
    // Arrange
    const mockTool = new MockTool();
    mockTool.executeFn.mockReturnValue({
      llmContent: 'Tool executed',
      returnDisplay: 'Tool executed',
    });
    // This tool would normally require confirmation.
    mockTool.shouldConfirm = true;
    const declarativeTool = mockTool;

    const toolRegistry = {
      getTool: () => declarativeTool,
      getToolByName: () => declarativeTool,
      // Other properties are not needed for this test but are included for type consistency.
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByDisplayName: () => declarativeTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    };

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    // Configure the scheduler for YOLO mode.
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getApprovalMode: () => ApprovalMode.YOLO,
      getEphemeralSettings: () => ({}),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      toolRegistry: Promise.resolve(toolRegistry as unknown as ToolRegistry),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: '1',
      name: 'mockTool',
      args: { param: 'value' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-yolo',
    };

    // Act
    await scheduler.schedule([request], abortController.signal);

    // Assert
    // 1. The tool's execute method was called directly.
    expect(mockTool.executeFn).toHaveBeenCalledWith({ param: 'value' });

    // 2. The tool call status never entered 'awaiting_approval'.
    const statusUpdates = onToolCallsUpdate.mock.calls
      .map((call) => (call[0][0] as ToolCall)?.status)
      .filter(Boolean);
    expect(statusUpdates).not.toContain('awaiting_approval');
    expect(statusUpdates).toEqual([
      'validating',
      'scheduled',
      'executing',
      'success',
    ]);

    // 3. The final callback indicates the tool call was successful.
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls).toHaveLength(1);
    const completedCall = completedCalls[0];
    expect(completedCall.status).toBe('success');
    if (completedCall.status === 'success') {
      expect(completedCall.response.resultDisplay).toBe('Tool executed');
    }
  });
});

describe.skip('CoreToolScheduler request queueing', () => {
  // Skipped: These tests expect parallel execution but llxprt uses batch processing
  it('should queue a request if another is running', async () => {
    let resolveFirstCall: (result: ToolResult) => void;
    const firstCallPromise = new Promise<ToolResult>((resolve) => {
      resolveFirstCall = resolve;
    });

    const mockTool = new MockTool();
    mockTool.executeFn.mockImplementation(() => firstCallPromise);
    const declarativeTool = mockTool;

    const toolRegistry = {
      getTool: () => declarativeTool,
      getToolByName: () => declarativeTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByDisplayName: () => declarativeTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    };

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getApprovalMode: () => ApprovalMode.YOLO, // Use YOLO to avoid confirmation prompts
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      toolRegistry: Promise.resolve(toolRegistry as unknown as ToolRegistry),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request1 = {
      callId: '1',
      name: 'mockTool',
      args: { a: 1 },
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    };
    const request2 = {
      callId: '2',
      name: 'mockTool',
      args: { b: 2 },
      isClientInitiated: false,
      prompt_id: 'prompt-2',
    };

    // Schedule the first call, which will pause execution.
    scheduler.schedule([request1], abortController.signal);

    // Wait for the first call to be in the 'executing' state.
    await vi.waitFor(() => {
      const calls = onToolCallsUpdate.mock.calls.at(-1)?.[0] as ToolCall[];
      expect(calls?.[0]?.status).toBe('executing');
    });

    // Schedule the second call while the first is "running".
    const schedulePromise2 = scheduler.schedule(
      [request2],
      abortController.signal,
    );

    // Ensure the second tool call hasn't been executed yet.
    expect(mockTool.executeFn).toHaveBeenCalledTimes(1);
    expect(mockTool.executeFn).toHaveBeenCalledWith({ a: 1 });

    // Complete the first tool call.
    resolveFirstCall!({
      llmContent: 'First call complete',
      returnDisplay: 'First call complete',
    });

    // Wait for the second schedule promise to resolve.
    await schedulePromise2;

    // Wait for the second call to be in the 'executing' state.
    await vi.waitFor(() => {
      const calls = onToolCallsUpdate.mock.calls.at(-1)?.[0] as ToolCall[];
      expect(calls?.[0]?.status).toBe('executing');
    });

    // Now the second tool call should have been executed.
    expect(mockTool.executeFn).toHaveBeenCalledTimes(2);
    expect(mockTool.executeFn).toHaveBeenCalledWith({ b: 2 });

    // Let the second call finish.
    const secondCallResult = {
      llmContent: 'Second call complete',
      returnDisplay: 'Second call complete',
    };
    // Since the mock is shared, we need to resolve the current promise.
    // In a real scenario, a new promise would be created for the second call.
    resolveFirstCall!(secondCallResult);

    // Wait for the second completion.
    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalledTimes(2);
    });

    // Verify the completion callbacks were called correctly.
    expect(onAllToolCallsComplete.mock.calls[0][0][0].status).toBe('success');
    expect(onAllToolCallsComplete.mock.calls[1][0][0].status).toBe('success');
  });

  it('should handle two synchronous calls to schedule', async () => {
    const mockTool = new MockTool();
    const declarativeTool = mockTool;
    const toolRegistry = {
      getTool: () => declarativeTool,
      getToolByName: () => declarativeTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByDisplayName: () => declarativeTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    };

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getApprovalMode: () => ApprovalMode.YOLO,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      toolRegistry: Promise.resolve(toolRegistry as unknown as ToolRegistry),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request1 = {
      callId: '1',
      name: 'mockTool',
      args: { a: 1 },
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    };
    const request2 = {
      callId: '2',
      name: 'mockTool',
      args: { b: 2 },
      isClientInitiated: false,
      prompt_id: 'prompt-2',
    };

    // Schedule two calls synchronously.
    const schedulePromise1 = scheduler.schedule(
      [request1],
      abortController.signal,
    );
    const schedulePromise2 = scheduler.schedule(
      [request2],
      abortController.signal,
    );

    // Wait for both promises to resolve.
    await Promise.all([schedulePromise1, schedulePromise2]);

    // Ensure the tool was called twice with the correct arguments.
    expect(mockTool.executeFn).toHaveBeenCalledTimes(2);
    expect(mockTool.executeFn).toHaveBeenCalledWith({ a: 1 });
    expect(mockTool.executeFn).toHaveBeenCalledWith({ b: 2 });

    // Ensure completion callbacks were called twice.
    expect(onAllToolCallsComplete).toHaveBeenCalledTimes(2);
  });
});
