/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolCall, WaitingToolCall } from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core/config/models.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import {
  MessageBusType,
  type ToolConfirmationResponse,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import {
  AbortDuringConfirmationTool,
  createMockMessageBus,
  createMockPolicyEngine,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
} from './coreToolScheduler-test-helpers.js';

describe('CoreToolScheduler suggest edit and abort', () => {
  it('should publish suggest edit response as not confirmed and execute with edited command', async () => {
    const executeFn = vi.fn().mockResolvedValue({
      llmContent: 'Shell command executed',
      returnDisplay: 'Shell command executed',
    });

    const mockShellTool = new MockTool({
      name: 'run_shell_command',
      shouldConfirmExecute: (params) =>
        Promise.resolve({
          type: 'exec',
          title: 'Confirm Shell Command',
          command: String(params['command'] ?? ''),
          rootCommand: 'npm',
          onConfirm: async () => {},
        }),
      execute: (params) => executeFn(params),
    });

    const mockToolRegistry = {
      getTool: () => mockShellTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => mockShellTool,
      getToolByDisplayName: () => mockShellTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockMessageBus = createMockMessageBus();
    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    let busHandler: ((message: ToolConfirmationResponse) => void) | undefined;
    mockMessageBus.subscribe.mockImplementation(
      (type: MessageBusType, handler: unknown) => {
        if (type === MessageBusType.TOOL_CONFIRMATION_RESPONSE) {
          busHandler = handler as (message: ToolConfirmationResponse) => void;
        }
        return () => {};
      },
    );

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: () => mockMessageBus,
      getPolicyEngine: () => mockPolicyEngine,
      getShellExecutionConfig: () => ({
        terminalWidth: 80,
        terminalHeight: 24,
      }),
      getTerminalWidth: vi.fn(() => 80),
      getTerminalHeight: vi.fn(() => 24),
      storage: {
        getProjectTempDir: () => '/tmp',
      },
      getTruncateToolOutputThreshold: () =>
        DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
      getTruncateToolOutputLines: () => DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
      getUseSmartEdit: () => false,
      getUseModelRouter: () => false,
      getAgentClient: () => null,
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    await scheduler.schedule(
      [
        {
          callId: 'ask-suggest-1',
          name: 'run_shell_command',
          args: { command: 'npm instal' },
          isClientInitiated: false,
          prompt_id: 'prompt-ask-suggest',
        },
      ],
      new AbortController().signal,
    );

    const latestUpdate = onToolCallsUpdate.mock.calls.at(-1)?.[0] as ToolCall[];
    const waitingCall = latestUpdate[0] as WaitingToolCall;
    expect(waitingCall.status).toBe('awaiting_approval');
    expect(waitingCall.confirmationDetails.correlationId).toBeDefined();
    const correlationId = waitingCall.confirmationDetails
      .correlationId as string;

    expect(busHandler).toBeDefined();
    busHandler?.({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId,
      outcome: ToolConfirmationOutcome.SuggestEdit,
      payload: {
        editedCommand: 'npm install',
      },
    });

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
      const completedCallsAsk = onAllToolCallsComplete.mock.calls.at(
        -1,
      )?.[0] as ToolCall[];
      expect(completedCallsAsk[0]?.status).toBe('success');
    });

    expect(executeFn).toHaveBeenCalledWith({ command: 'npm install' });

    const messageBusResponses = mockMessageBus.publish.mock.calls
      .map((call) => call[0])
      .filter(
        (message) => message.type === MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      );

    expect(messageBusResponses).toHaveLength(0);
  });

  it('should mark tool call as cancelled when abort happens during confirmation error', async () => {
    const abortController = new AbortController();
    const abortError = new Error('Abort requested during confirmation');
    const declarativeTool = new AbortDuringConfirmationTool(
      abortController,
      abortError,
    );

    const mockToolRegistry = {
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
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getShellExecutionConfig: () => ({
        terminalWidth: 90,
        terminalHeight: 30,
      }),
      storage: {
        getProjectTempDir: () => '/tmp',
      },
      getTruncateToolOutputThreshold: () =>
        DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
      getTruncateToolOutputLines: () => DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
      getToolRegistry: () => mockToolRegistry,
      getUseModelRouter: () => false,
      getAgentClient: () => null,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const request = {
      callId: 'abort-1',
      name: 'abortDuringConfirmationTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-abort',
    };

    await scheduler.schedule([request], abortController.signal);

    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('cancelled');
    const statuses = onToolCallsUpdate.mock.calls.flatMap((call) =>
      (call[0] as ToolCall[]).map((toolCall) => toolCall.status),
    );
    expect(statuses).not.toContain('error');
  });
});
