/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executeToolCall,
  type ToolExecutionConfig,
} from './nonInteractiveToolExecutor.js';
import {
  ToolRegistry,
  type ToolCallRequestInfo,
  type ToolCallResponseInfo,
  type ToolResult,
  Config,
  ToolErrorType,
  ApprovalMode,
  DEFAULT_AGENT_ID,
} from '../index.js';
import type { Part } from '@google/genai';
import { MockTool } from '../test-utils/tools.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { PolicyDecision } from '../policy/types.js';

describe('executeToolCall', () => {
  let mockToolRegistry: ToolRegistry;
  let mockTool: MockTool;
  let abortController: AbortController;
  let mockConfig: Config;
  let policyEngine: PolicyEngine;
  let messageBus: MessageBus;

  beforeEach(() => {
    policyEngine = new PolicyEngine({
      rules: [],
      defaultDecision: PolicyDecision.ALLOW,
      nonInteractive: false,
    });
    messageBus = new MessageBus(policyEngine, false);

    mockTool = new MockTool('testTool');

    mockToolRegistry = {
      getTool: vi.fn(),
      getAllToolNames: vi.fn().mockReturnValue(['testTool', 'anotherTool']),
      getAllTools: vi.fn().mockReturnValue([]),
    } as unknown as ToolRegistry;

    mockConfig = {
      getToolRegistry: () => mockToolRegistry,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getAllowedTools: () => [],
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getContentGeneratorConfig: () => ({
        model: 'test-model',
        authType: 'oauth-personal',
      }),
      getEphemeralSetting: vi.fn(),
      getEphemeralSettings: vi.fn().mockReturnValue({}),
      getExcludeTools: () => [],
      getTelemetryLogPromptsEnabled: () => false,
      getPolicyEngine: () => policyEngine,
      getMessageBus: () => messageBus,
    } as unknown as Config;

    abortController = new AbortController();
  });

  it('should execute a tool successfully', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call1',
      name: 'testTool',
      args: { param1: 'value1' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-1',
    };
    const toolResult: ToolResult = {
      llmContent: 'Tool executed successfully',
      returnDisplay: 'Success!',
    };
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
    mockTool.executeFn.mockReturnValue(toolResult);

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );

    // Behavior verified via response structure - no mock interaction checks needed
    expect(response).toStrictEqual({
      callId: 'call1',
      agentId: 'primary',
      error: undefined,
      errorType: undefined,
      resultDisplay: 'Success!',
      responseParts: [
        {
          functionCall: {
            name: 'testTool',
            id: 'call1',
            args: { param1: 'value1' },
          },
        },
        {
          functionResponse: {
            name: 'testTool',
            id: 'call1',
            response: { output: 'Tool executed successfully' },
          },
        },
      ],
    });
  });

  it('should return an error if tool is not found', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call2',
      name: 'nonexistentTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-2',
    };
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(undefined);
    vi.mocked(mockToolRegistry.getAllToolNames).mockReturnValue([
      'testTool',
      'anotherTool',
    ]);

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );

    expect(response.callId).toBe('call2');
    expect(response.errorType).toBe(ToolErrorType.TOOL_NOT_REGISTERED);
    expect(response.error).toBeInstanceOf(Error);
    expect(response.error?.message).toContain('could not be loaded');
    expect(response.resultDisplay).toContain('could not be loaded');

    const functionResponsePart = response.responseParts.find(
      (part) => part.functionResponse,
    );
    const payload = functionResponsePart?.functionResponse?.response as
      | { error?: unknown }
      | undefined;
    expect(typeof payload?.error).toBe('string');
    expect(payload?.error).toContain('could not be loaded');
  });

  it('should return an error if tool validation fails', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call3',
      name: 'testTool',
      args: { param1: 'invalid' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-3',
    };
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
    vi.spyOn(mockTool, 'build').mockImplementation(() => {
      throw new Error('Invalid parameters');
    });

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );

    expect(response.callId).toBe('call3');
    expect(response.errorType).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    expect(response.error).toBeInstanceOf(Error);
    expect(response.error?.message).toBe('Invalid parameters');
    expect(response.resultDisplay).toBe('Invalid parameters');
  });

  it('should return an error if tool execution fails', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call4',
      name: 'testTool',
      args: { param1: 'value1' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-4',
    };
    const executionErrorResult: ToolResult = {
      llmContent: 'Error: Execution failed',
      returnDisplay: 'Execution failed',
      error: {
        message: 'Execution failed',
        type: ToolErrorType.EXECUTION_FAILED,
      },
    };
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
    mockTool.executeFn.mockReturnValue(executionErrorResult);

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );
    expect(response.callId).toBe('call4');
    expect(response.errorType).toBe(ToolErrorType.EXECUTION_FAILED);
    expect(response.error).toBeInstanceOf(Error);
    expect(response.error?.message).toBe('Execution failed');
    expect(response.resultDisplay).toBe('Execution failed');

    const functionResponsePart = response.responseParts.find(
      (part) => part.functionResponse,
    );
    const payload = functionResponsePart?.functionResponse?.response as
      | { error?: unknown; output?: unknown }
      | undefined;
    expect(payload?.output).toBeUndefined();
    expect(payload?.error).toBe('Execution failed');
  });

  it('should return an error if execution throws', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call5',
      name: 'testTool',
      args: { param1: 'value1' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-5',
    };
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
    mockTool.executeFn.mockImplementation(() => {
      throw new Error('Something went very wrong');
    });

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );

    expect(response.callId).toBe('call5');
    expect(response.error).toBeInstanceOf(Error);
    expect(response.error?.message).toBe('Something went very wrong');
    expect(response.errorType).toBe(ToolErrorType.UNHANDLED_EXCEPTION);
    expect(response.resultDisplay).toBe('Something went very wrong');

    const functionResponsePart = response.responseParts.find(
      (part) => part.functionResponse,
    );
    const payload = functionResponsePart?.functionResponse?.response as
      | { error?: unknown }
      | undefined;
    expect(payload?.error).toBe('Something went very wrong');
  });

  it('should block execution when tool is disabled in settings', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call-disabled',
      name: 'testTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-disabled',
    };
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
    vi.mocked(mockToolRegistry.getAllTools).mockReturnValue([
      mockTool,
    ] as never[]);
    vi.mocked(mockConfig.getEphemeralSetting).mockImplementation((key) => {
      if (key === 'tools.disabled') {
        return ['testTool'];
      }
      return undefined;
    });
    vi.mocked(mockConfig.getEphemeralSettings).mockReturnValue({
      'tools.disabled': ['testTool'],
    });

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );

    // Behavior verified via response structure - tool was blocked
    expect(response.error).toBeInstanceOf(Error);
    expect(response.error?.message).toContain('disabled');
    expect(response.errorType).toBe(ToolErrorType.TOOL_DISABLED);
  });

  it('should report tool as disabled when excluded by approval policy even if not registered', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call-policy-disabled',
      name: 'write_file',
      args: { content: 'example', file_path: 'reports/output.md' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-policy',
    };

    vi.mocked(mockToolRegistry.getTool).mockReturnValue(undefined);
    vi.mocked(mockToolRegistry.getAllTools).mockReturnValue([]);
    vi.mocked(mockToolRegistry.getAllToolNames).mockReturnValue([
      'read_file',
      'glob',
    ]);
    vi.mocked(mockConfig.getEphemeralSettings).mockReturnValue({
      'tools.allowed': ['read_file', 'glob'],
    });

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );

    // Behavior verified via response structure - tool was blocked by policy
    expect(response.error).toBeInstanceOf(Error);
    expect(response.error?.message).toBe(
      'Tool "write_file" is disabled in the current profile.',
    );
    expect(response.errorType).toBe(ToolErrorType.TOOL_DISABLED);
    expect(response.resultDisplay).toBe(
      'Tool "write_file" is disabled in the current profile.',
    );
  });

  it('should correctly format llmContent with inlineData', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call6',
      name: 'testTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-6',
    };
    const imageDataPart: Part = {
      inlineData: { mimeType: 'image/png', data: 'base64data' },
    };
    const toolResult: ToolResult = {
      llmContent: [imageDataPart],
      returnDisplay: 'Image processed',
    };
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
    mockTool.executeFn.mockReturnValue(toolResult);

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );

    expect(response).toStrictEqual({
      callId: 'call6',
      agentId: 'primary',
      error: undefined,
      errorType: undefined,
      resultDisplay: 'Image processed',
      responseParts: [
        {
          functionCall: {
            name: 'testTool',
            id: 'call6',
            args: {},
          },
        },
        {
          functionResponse: {
            name: 'testTool',
            id: 'call6',
            response: {
              output: 'Binary content of type image/png was processed.',
            },
          },
        },
        imageDataPart,
      ],
    });
  });
});

describe('executeToolCall response structure (Phase 3b.1)', () => {
  let mockToolRegistry: ToolRegistry;
  let mockTool: MockTool;
  let abortController: AbortController;
  let request: ToolCallRequestInfo;

  function createMockConfig(options?: {
    ephemerals?: Record<string, unknown>;
    approvalMode?: ApprovalMode;
    allowedTools?: string[] | undefined;
    policyEngine?: PolicyEngine;
    messageBus?: MessageBus;
    includePolicyEngine?: boolean;
    includeMessageBus?: boolean;
    policyEngineReturnsUndefined?: boolean;
  }): ToolExecutionConfig {
    const ephemerals = options?.ephemerals ?? {};
    const policyEngine =
      options?.policyEngine ??
      new PolicyEngine({
        rules: [],
        defaultDecision: PolicyDecision.ALLOW,
        nonInteractive: false,
      });
    const messageBus =
      options?.messageBus ?? new MessageBus(policyEngine, false);
    const includePolicyEngine = options?.includePolicyEngine ?? true;
    const includeMessageBus = options?.includeMessageBus ?? true;
    const policyEngineReturnsUndefined =
      options?.policyEngineReturnsUndefined ?? false;
    return {
      getToolRegistry: () => mockToolRegistry,
      getSessionId: () => 'test-session-id',
      getTelemetryLogPromptsEnabled: () => false,
      getExcludeTools: () => [],
      getEphemeralSettings: () => ephemerals,
      getEphemeralSetting: (key: string) =>
        ephemerals[key as keyof typeof ephemerals],
      getPolicyEngine: includePolicyEngine
        ? policyEngineReturnsUndefined
          ? () => undefined as unknown as PolicyEngine
          : () => policyEngine
        : undefined,
      getMessageBus: includeMessageBus ? () => messageBus : undefined,
      getApprovalMode: () => options?.approvalMode ?? ApprovalMode.DEFAULT,
      getAllowedTools: () => options?.allowedTools,
    };
  }

  beforeEach(() => {
    mockTool = new MockTool('testTool');

    mockToolRegistry = {
      getTool: vi.fn(),
      getAllToolNames: vi.fn().mockReturnValue(['testTool']),
      getAllTools: vi.fn().mockReturnValue([]),
    } as unknown as ToolRegistry;

    abortController = new AbortController();

    request = {
      callId: 'call1',
      name: 'testTool',
      args: { param1: 'value1' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-1',
    };
  });

  describe('response structure validation', () => {
    it('should return ToolCallResponseInfo with correct structure', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });

      const { response } = await executeToolCall(
        createMockConfig(),
        request,
        abortController.signal,
      );

      expect(response.callId).toBe('call1');
      expect(response.resultDisplay).toBe('Success!');
      expect(response.responseParts).toBeDefined();
      expect(response.responseParts.length).toBeGreaterThanOrEqual(2);
      expect(response.agentId).toBeDefined();
    });

    it('should include functionCall and functionResponse in responseParts', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });

      const { response } = await executeToolCall(
        createMockConfig(),
        request,
        abortController.signal,
      );

      const parts = response.responseParts;
      expect(parts.length).toBeGreaterThanOrEqual(2);

      expect(parts[0].functionCall).toBeDefined();
      expect(parts[0].functionCall?.id).toBe(request.callId);
      expect(parts[0].functionCall?.name).toBe(request.name);

      expect(parts[1].functionResponse).toBeDefined();
      expect(parts[1].functionResponse?.id).toBe(request.callId);
      expect(parts[1].functionResponse?.name).toBe(request.name);
    });
  });

  describe('agentId preservation', () => {
    it('should preserve agentId from request through to response', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });

      const customAgentId = 'custom-agent-123';
      const requestWithAgentId = { ...request, agentId: customAgentId };

      const { response } = await executeToolCall(
        createMockConfig(),
        requestWithAgentId,
        abortController.signal,
      );

      expect(response.agentId).toBe(customAgentId);
    });

    it('should use DEFAULT_AGENT_ID when request has no agentId', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });

      const requestWithoutAgentId = { ...request, agentId: undefined };

      const { response } = await executeToolCall(
        createMockConfig(),
        requestWithoutAgentId,
        abortController.signal,
      );

      expect(response.agentId).toBe(DEFAULT_AGENT_ID);
    });
  });

  describe('resource cleanup', () => {
    it('should allow subsequent executions after completion', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });

      const results: ToolCallResponseInfo[] = [];
      for (let i = 0; i < 3; i++) {
        const { response } = await executeToolCall(
          createMockConfig(),
          { ...request, callId: `call${i}` },
          abortController.signal,
        );
        results.push(response);
      }

      expect(results).toHaveLength(3);
      results.forEach((response) => {
        expect(response.error).toBeUndefined();
      });
    });

    it('should allow subsequent executions after failure', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);

      mockTool.executeFn.mockImplementationOnce(() => {
        throw new Error('Tool failed');
      });
      const { response: failedResult } = await executeToolCall(
        createMockConfig(),
        { ...request, callId: 'fail' },
        abortController.signal,
      );
      expect(failedResult.error).toBeDefined();

      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });
      const { response: successResult } = await executeToolCall(
        createMockConfig(),
        { ...request, callId: 'success' },
        abortController.signal,
      );
      expect(successResult.error).toBeUndefined();
    });
  });

  describe('abort signal propagation', () => {
    it('should handle abort signal during tool execution', async () => {
      const localAbortController = new AbortController();

      let startedResolver: (() => void) | null = null;
      const startedPromise = new Promise<void>((resolve) => {
        startedResolver = resolve;
      });

      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockImplementation(
        async (_args: unknown, signal: AbortSignal) => {
          startedResolver?.();
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          if (signal.aborted) {
            return {
              llmContent: '[Operation Cancelled]',
              returnDisplay: '[Operation Cancelled]',
            };
          }
          return {
            llmContent: 'Should not reach',
            returnDisplay: 'Should not reach',
          };
        },
      );

      const executionPromise = executeToolCall(
        createMockConfig(),
        request,
        localAbortController.signal,
      );
      await startedPromise;
      localAbortController.abort();

      const completed = await executionPromise;
      expect(completed.status).toBe('cancelled');
      expect(getFullResponseText(completed.response)).toContain('Cancelled');
    });
  });

  describe('error response structure', () => {
    it('should include original request info in error response', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockImplementation(() => {
        throw new Error('Execution failed');
      });

      const { response } = await executeToolCall(
        createMockConfig(),
        request,
        abortController.signal,
      );

      expect(response.error).toBeDefined();
      expect(response.callId).toBe(request.callId);
    });

    it('should include functionCall and functionResponse in error responseParts', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockImplementation(() => {
        throw new Error('Execution failed');
      });

      const { response } = await executeToolCall(
        createMockConfig(),
        request,
        abortController.signal,
      );

      const parts = response.responseParts;
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(parts[0].functionCall?.id).toBe(request.callId);
      expect(parts[1].functionResponse?.id).toBe(request.callId);
    });

    it('should return error for tool that does not exist', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(undefined);

      const { response } = await executeToolCall(
        createMockConfig(),
        { ...request, name: 'nonexistent_tool' },
        abortController.signal,
      );

      expect(response.error).toBeDefined();
      expect(response.errorType).toBe(ToolErrorType.TOOL_NOT_REGISTERED);
    });

    it('should return error for invalid tool arguments', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockImplementation(() => {
        throw new Error('Invalid arguments: missing required field "path"');
      });

      const { response } = await executeToolCall(
        createMockConfig(),
        { ...request, args: {} },
        abortController.signal,
      );

      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Invalid arguments');
    });
  });

  describe('emoji filtering with systemFeedback', () => {
    it('should append systemFeedback to successful response when emoji filtering warns', async () => {
      const ephemerals = { emojifilter: 'warn' as const };
      const config = createMockConfig({ ephemerals });

      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Tool completed',
        returnDisplay: 'Success',
      });

      const { response } = await executeToolCall(
        config,
        {
          ...request,
          name: 'write_file',
          args: { content: 'Has content 😀' },
        },
        abortController.signal,
      );

      expect(response.error).toBeUndefined();
      expect(getFullResponseText(response)).toContain('<system-reminder>');
    });

    it('should produce at most one system-reminder per execution', async () => {
      const ephemerals = { emojifilter: 'warn' as const };
      const config = createMockConfig({ ephemerals });

      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Tool completed',
        returnDisplay: 'Success',
      });

      const { response } = await executeToolCall(
        config,
        {
          ...request,
          name: 'write_file',
          args: { content: 'Content here 😀' },
        },
        abortController.signal,
      );

      const responseText = getFullResponseText(response);
      const reminderCount = (responseText.match(/<system-reminder>/g) || [])
        .length;
      expect(reminderCount).toBeLessThanOrEqual(1);
    });
  });
});

function getFullResponseText(response: ToolCallResponseInfo): string {
  const chunks: string[] = [];
  for (const part of response.responseParts ?? []) {
    const payload = part.functionResponse?.response as
      | { output?: unknown; error?: unknown }
      | undefined;
    if (payload) {
      if (typeof payload.output === 'string') chunks.push(payload.output);
      if (typeof payload.error === 'string') chunks.push(payload.error);
    }
    if (typeof part.text === 'string') chunks.push(part.text);
  }
  return chunks.join('\n');
}
