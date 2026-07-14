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
import {
  ToolConfirmationOutcome,
  type ToolConfirmationPayload,
} from '@vybestack/llxprt-code-tools';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core/config/models.js';
import { MockModifiableTool } from '@vybestack/llxprt-code-core/test-utils/tools.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import {
  createMockMessageBus,
  createMockPolicyEngine,
  waitForStatus,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
} from './coreToolScheduler-test-helpers.js';

describe('CoreToolScheduler with payload', () => {
  it('should update args and diff and execute tool when payload is provided', async () => {
    const mockTool = new MockModifiableTool();
    const declarativeTool = mockTool;
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
      getToolRegistry: () => mockToolRegistry,
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

    const abortController = new AbortController();
    const request = {
      callId: '1',
      name: 'mockModifiableTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-2',
    };

    await scheduler.schedule([request], abortController.signal);

    const awaitingCall = (await waitForStatus(
      onToolCallsUpdate,
      'awaiting_approval',
    )) as WaitingToolCall;
    const confirmationDetails = awaitingCall.confirmationDetails;

    expect(confirmationDetails).toBeDefined();
    const payload: ToolConfirmationPayload = { newContent: 'final version' };
    await confirmationDetails.onConfirm(
      ToolConfirmationOutcome.ProceedOnce,
      payload,
    );

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('success');
    const executeCall =
      mockTool.executeFn.mock.calls[mockTool.executeFn.mock.calls.length - 1];
    expect(executeCall[0]).toStrictEqual({ newContent: 'final version' });
    expect(executeCall[1]).toBeInstanceOf(AbortSignal);
  });

  it('should update shell command args and execute when suggest edit payload is provided', async () => {
    const executeFn = vi.fn().mockResolvedValue({
      llmContent: 'Shell command executed',
      returnDisplay: 'Shell command executed',
    });

    const originalOnConfirm = vi.fn(
      async (
        _outcome: ToolConfirmationOutcome,
        _payload?: ToolConfirmationPayload,
      ) => {},
    );

    const mockShellTool = new MockTool({
      name: 'run_shell_command',
      shouldConfirmExecute: (params) =>
        Promise.resolve({
          type: 'exec',
          title: 'Confirm Shell Command',
          command: String(params['command'] ?? ''),
          rootCommand: 'npm',
          onConfirm: originalOnConfirm,
        }),
      execute: (params) => executeFn(params),
    });

    const toolRegistry = {
      getTool: () => mockShellTool,
      getToolByName: () => mockShellTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByDisplayName: () => mockShellTool,
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
      getToolRegistry: () => toolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
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
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: 'shell-suggest-edit',
      name: 'run_shell_command',
      args: { command: 'npm instal' },
      isClientInitiated: false,
      prompt_id: 'prompt-shell-suggest-edit',
    };

    await scheduler.schedule([request], abortController.signal);

    const awaitingCall = (await waitForStatus(
      onToolCallsUpdate,
      'awaiting_approval',
    )) as WaitingToolCall;

    expect(awaitingCall.confirmationDetails).toBeDefined();

    const payload: ToolConfirmationPayload = {
      editedCommand: 'npm install',
    };

    await awaitingCall.confirmationDetails.onConfirm(
      ToolConfirmationOutcome.SuggestEdit,
      payload,
    );

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    expect(originalOnConfirm).toHaveBeenCalledWith(
      ToolConfirmationOutcome.SuggestEdit,
      payload,
    );

    const executeCall = executeFn.mock.calls[executeFn.mock.calls.length - 1];
    expect(executeCall[0]).toStrictEqual({ command: 'npm install' });
  });
});
