/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';
import { executeToolCall } from './nonInteractiveToolExecutor.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import {
  type ToolCallRequestInfo,
  type ToolResult,
} from '@vybestack/llxprt-code-tools';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import type {
  ContentBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/tools.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import { createSchedulerRegistryDelegate } from './__tests__/scheduler-registry-test-helpers.js';

describe('executeToolCall', () => {
  let mockToolRegistry: ToolRegistry;
  let mockTool: MockTool;
  let abortController: AbortController;
  let mockConfig: Config;
  let policyEngine: PolicyEngine;
  let messageBus: MessageBus;
  const testSessionId = 'test-session-id';
  // Stable per-suite registry owner: executeToolCall acquires and releases
  // on this same object, so the per-config registry refcount balances.
  const executionOwner = { label: 'non-interactive-executor' };

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

    // Build the config fixture, then attach a per-config scheduler registry
    // delegate: acquisitions key on owner object identity plus purpose, with
    // callbacks refreshed on every acquisition, matching production Config.
    const fixture = {
      getToolRegistry: () => mockToolRegistry,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getAllowedTools: () => [],
      getSessionId: () => testSessionId,
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getEphemeralSetting: vi.fn(),
      getEphemeralSettings: vi.fn().mockReturnValue({}),
      getExcludeTools: () => [],
      getTelemetryLogPromptsEnabled: () => false,
      getPolicyEngine: () => policyEngine,
      getMessageBus: () => messageBus,
      getToolSchedulerFactory:
        () =>
        (
          schedulerOptions: ConstructorParameters<typeof CoreToolScheduler>[0],
        ) =>
          new CoreToolScheduler(schedulerOptions),
    };

    const delegate = createSchedulerRegistryDelegate({
      config: fixture as unknown as Config,
      messageBus,
      toolRegistry: mockToolRegistry,
      createScheduler: (schedulerOptions) =>
        fixture.getToolSchedulerFactory()({
          config: fixture as unknown as Config,
          messageBus,
          toolRegistry: mockToolRegistry,
          toolContextInteractiveMode: schedulerOptions.interactiveMode ?? true,
          getPreferredEditor: () => undefined,
          onEditorClose: () => {},
        }),
    });

    mockConfig = { ...fixture, ...delegate } as unknown as Config;

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
    (
      mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
    ).mockReturnValue(mockTool);
    mockTool.executeFn.mockReturnValue(toolResult);

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
      { owner: executionOwner },
    );

    // Behavior verified via response structure - no mock interaction checks needed
    // responseParts now contains only functionResponse (not functionCall)
    // The functionCall is already recorded in history from the original assistant message.
    // Including it again would create duplicate tool_use blocks for Anthropic. (Issue #1150)
    expect(response).toStrictEqual({
      callId: 'call1',
      agentId: 'primary',
      error: undefined,
      errorType: undefined,
      resultDisplay: 'Success!',
      responseParts: [
        {
          type: 'tool_response',
          callId: 'call1',
          toolName: 'testTool',
          result: { output: 'Tool executed successfully' },
        },
      ],
    });
  });

  it('throws before creating a completed call for hook-restricted requests', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call-hook-blocked',
      name: 'run_shell_command',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-hook-blocked',
      hookRestrictedAllowedTools: ['read_file'],
    };

    await expect(
      executeToolCall(mockConfig, request, abortController.signal, {
        owner: executionOwner,
      }),
    ).rejects.toThrow('disabled by hook restrictions');
    expect(mockToolRegistry.getTool).not.toHaveBeenCalled();
  });

  it('should return an error if tool is not found', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call2',
      name: 'nonexistentTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-2',
    };
    (
      mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
    ).mockReturnValue(undefined);
    (
      mockToolRegistry.getAllToolNames as Mock<
        typeof mockToolRegistry.getAllToolNames
      >
    ).mockReturnValue(['testTool', 'anotherTool']);

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
      { owner: executionOwner },
    );

    expect(response.callId).toBe('call2');
    expect(response.errorType).toBe(ToolErrorType.TOOL_NOT_REGISTERED);
    expect(response.error).toBeInstanceOf(Error);
    expect(response.error?.message).toContain('could not be loaded');
    expect(response.resultDisplay).toContain('could not be loaded');

    const toolResponsePart = response.responseParts.find(
      (part): part is ToolResponseBlock => part.type === 'tool_response',
    );
    const payload = toolResponsePart?.result as { error?: unknown } | undefined;
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
    (
      mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
    ).mockReturnValue(mockTool);
    vi.spyOn(mockTool, 'build').mockImplementation(() => {
      throw new Error('Invalid parameters');
    });

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
      { owner: executionOwner },
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
    (
      mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
    ).mockReturnValue(mockTool);
    mockTool.executeFn.mockReturnValue(executionErrorResult);

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
      { owner: executionOwner },
    );
    expect(response.callId).toBe('call4');
    expect(response.errorType).toBe(ToolErrorType.EXECUTION_FAILED);
    expect(response.error).toBeInstanceOf(Error);
    expect(response.error?.message).toBe('Execution failed');
    expect(response.resultDisplay).toBe('Execution failed');

    const toolResponsePart = response.responseParts.find(
      (part): part is ToolResponseBlock => part.type === 'tool_response',
    );
    const payload = toolResponsePart?.result as
      | { error?: unknown; output?: unknown }
      | undefined;
    expect(payload?.output).toBeUndefined();
    // Issue #3037: the model-facing tool_response carries the remedial
    // llmContent ('Error: Execution failed'), not the terse error.message
    // ('Execution failed'), while error.message/resultDisplay stay terse.
    expect(payload?.error).toBe('Error: Execution failed');
  });

  it('should return an error if execution throws', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call5',
      name: 'testTool',
      args: { param1: 'value1' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-5',
    };
    (
      mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
    ).mockReturnValue(mockTool);
    mockTool.executeFn.mockImplementation(() => {
      throw new Error('Something went very wrong');
    });

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
      { owner: executionOwner },
    );

    expect(response.callId).toBe('call5');
    expect(response.error).toBeInstanceOf(Error);
    expect(response.error?.message).toBe('Something went very wrong');
    expect(response.errorType).toBe(ToolErrorType.UNHANDLED_EXCEPTION);
    expect(response.resultDisplay).toBe('Something went very wrong');

    const toolResponsePart = response.responseParts.find(
      (part): part is ToolResponseBlock => part.type === 'tool_response',
    );
    const payload = toolResponsePart?.result as { error?: unknown } | undefined;
    expect(payload?.error).toBe('Something went very wrong');
  });

  it('should block execution when tool is disabled in settings', async () => {
    const { response, messageObservation } =
      await observeBlockExecutionWhenToolIsDisabledInSettings();
    expect(response.error).toBeInstanceOf(Error);
    expect(messageObservation).toContain('disabled');
    expect(response.errorType).toBe(ToolErrorType.TOOL_DISABLED);
  });

  const observeBlockExecutionWhenToolIsDisabledInSettings = async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call-disabled',
      name: 'testTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-disabled',
    };
    (
      mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
    ).mockReturnValue(mockTool);
    (
      mockToolRegistry.getAllTools as Mock<typeof mockToolRegistry.getAllTools>
    ).mockReturnValue([mockTool] as never[]);
    (
      mockConfig.getEphemeralSetting as Mock<
        typeof mockConfig.getEphemeralSetting
      >
    ).mockImplementation((key) => {
      if (key === 'tools.disabled') {
        return ['testTool'];
      }
      return undefined;
    });
    (
      mockConfig.getEphemeralSettings as Mock<
        typeof mockConfig.getEphemeralSettings
      >
    ).mockReturnValue({
      'tools.disabled': ['testTool'],
    });

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
      { owner: executionOwner },
    );

    // Behavior verified via response structure - tool was blocked

    const messageObservation = response.error?.message;
    return { response, messageObservation };
  };

  it('should report tool as disabled when excluded by approval policy even if not registered', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call-policy-disabled',
      name: 'write_file',
      args: { content: 'example', file_path: 'reports/output.md' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-policy',
    };

    (
      mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
    ).mockReturnValue(undefined);
    (
      mockToolRegistry.getAllTools as Mock<typeof mockToolRegistry.getAllTools>
    ).mockReturnValue([]);
    (
      mockToolRegistry.getAllToolNames as Mock<
        typeof mockToolRegistry.getAllToolNames
      >
    ).mockReturnValue(['read_file', 'glob']);
    (
      mockConfig.getEphemeralSettings as Mock<
        typeof mockConfig.getEphemeralSettings
      >
    ).mockReturnValue({
      'tools.allowed': ['read_file', 'glob'],
    });

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
      { owner: executionOwner },
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
    const imageDataPart: ContentBlock = {
      type: 'media',
      mimeType: 'image/png',
      data: 'base64data',
      encoding: 'base64',
    };
    const toolResult: ToolResult = {
      llmContent: [
        { inlineData: { mimeType: 'image/png', data: 'base64data' } },
      ],
      returnDisplay: 'Image processed',
    };
    (
      mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
    ).mockReturnValue(mockTool);
    mockTool.executeFn.mockReturnValue(toolResult);

    const { response } = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
      { owner: executionOwner },
    );

    expect(response).toStrictEqual({
      callId: 'call6',
      agentId: 'primary',
      error: undefined,
      errorType: undefined,
      resultDisplay: 'Image processed',
      // responseParts now contains only tool_response + media block (not tool_call)
      responseParts: [
        {
          type: 'tool_response',
          callId: 'call6',
          toolName: 'testTool',
          result: {
            output: 'Binary content provided (1 item(s)).',
          },
        },
        imageDataPart,
      ],
    });
  });
});

// Note: The old "policy handling when policyEngine is undefined" tests have been removed.
// They were testing fallback behavior where executeToolCall would create its own PolicyEngine
// when config.getPolicyEngine() returned undefined. This fallback path has been removed -
// all tool execution now goes through the scheduler singleton which uses the parent config's
// PolicyEngine. The parent config is responsible for providing a valid PolicyEngine.
