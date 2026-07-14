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
import { ToolErrorType } from '@vybestack/llxprt-code-tools';
import {
  createMockMessageBus,
  createMockPolicyEngine,
} from './coreToolScheduler-test-helpers.js';

describe('CoreToolScheduler policy decisions', () => {
  it('should reject tool execution when policy denies it', async () => {
    const mockTool = new MockTool();
    mockTool.shouldConfirm = true;
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

    const mockMessageBus = createMockMessageBus();
    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi.fn().mockReturnValue(PolicyDecision.DENY);

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
          callId: 'deny-1',
          name: 'mockTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-deny',
        },
      ],
      new AbortController().signal,
    );

    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCallsDeny = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCallsDeny[0].status).toBe('error');
    expect(completedCallsDeny[0].response?.errorType).toBe(
      ToolErrorType.POLICY_VIOLATION,
    );
    expect(mockMessageBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageBusType.TOOL_POLICY_REJECTION,
      }),
    );
  });

  it('should publish confirmation requests when policy asks the user', async () => {
    const mockTool = new MockTool();
    mockTool.shouldConfirm = true;
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
      getDebugMode: () => true,
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
          callId: 'ask-1',
          name: 'mockTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-ask',
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

    expect(mockMessageBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        correlationId,
      }),
    );

    expect(busHandler).toBeDefined();
    busHandler?.({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId,
      outcome: ToolConfirmationOutcome.ProceedOnce,
    });

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
      const completedCallsAsk = onAllToolCallsComplete.mock.calls.at(
        -1,
      )?.[0] as ToolCall[];
      expect(completedCallsAsk[0]?.status).toBe('success');
    });
  });
});
