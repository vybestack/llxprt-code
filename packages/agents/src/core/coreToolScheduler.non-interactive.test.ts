/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolCall, ErroredToolCall } from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core/config/models.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import {
  createMockMessageBus,
  createMockPolicyEngine,
} from './coreToolScheduler-test-helpers.js';

describe('CoreToolScheduler non-interactive mode', () => {
  it('should error when tool requires confirmation in non-interactive mode', async () => {
    // ARRANGE
    const mockTool = new MockTool({ name: 'confirmTool' });
    mockTool.shouldConfirm = true; // Tool requires confirmation

    const mockToolRegistry = {
      getTool: () => mockTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => mockTool,
      getToolByDisplayName: () => mockTool,
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
      isInteractive: () => false, // NON-INTERACTIVE MODE
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({ model: 'test-model' }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
    });

    const request = {
      callId: 'non-interactive-confirm',
      name: 'confirmTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    };

    // ACT
    await scheduler.schedule([request], new AbortController().signal);

    // ASSERT
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0].status).toBe('error');

    const erroredCall = completedCalls[0] as ErroredToolCall;
    const errorResponse = erroredCall.response;
    const errorParts = errorResponse.responseParts;
    const errorMessage = errorParts[0].functionResponse.response.error;
    expect(errorMessage).toContain(
      'Tool execution for "confirmTool" requires user confirmation, which is not supported in non-interactive mode.',
    );
  });

  it('should not error in non-interactive mode with YOLO approval', async () => {
    // ARRANGE
    const mockTool = new MockTool({ name: 'yoloTool' });
    mockTool.shouldConfirm = true;

    const mockToolRegistry = {
      getTool: () => mockTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => mockTool,
      getToolByDisplayName: () => mockTool,
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
      isInteractive: () => false, // Non-interactive
      getApprovalMode: () => ApprovalMode.YOLO, // But YOLO mode
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({ model: 'test-model' }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
    });

    // ACT
    await scheduler.schedule(
      [
        {
          callId: 'yolo-1',
          name: 'yoloTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
      ],
      new AbortController().signal,
    );

    // ASSERT
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('success'); // Not error
  });

  it('should not error in non-interactive mode for allowed tools', async () => {
    // ARRANGE
    const mockTool = new MockTool({ name: 'allowedTool' });
    mockTool.shouldConfirm = true;

    const mockToolRegistry = {
      getTool: () => mockTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => mockTool,
      getToolByDisplayName: () => mockTool,
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
      isInteractive: () => false, // Non-interactive
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => ['allowedTool'], // Tool is in allowed list
      getContentGeneratorConfig: () => ({ model: 'test-model' }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
    });

    // ACT
    await scheduler.schedule(
      [
        {
          callId: 'allowed-1',
          name: 'allowedTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
      ],
      new AbortController().signal,
    );

    // ASSERT
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('success'); // Not error
  });

  it('should handle mixed batch: safe tool executes, dangerous tool errors in non-interactive', async () => {
    // ARRANGE
    const safeTool = new MockTool({ name: 'safeTool' });
    safeTool.shouldConfirm = false; // No confirmation needed

    const dangerousTool = new MockTool({ name: 'dangerousTool' });
    dangerousTool.shouldConfirm = true; // Requires confirmation

    const mockToolRegistry = {
      getTool: (name: string) =>
        name === 'safeTool' ? safeTool : dangerousTool,
      getFunctionDeclarations: () => [],
      tools: new Map([
        ['safeTool', safeTool],
        ['dangerousTool', dangerousTool],
      ]),
      discovery: {},
      registerTool: () => {},
      getToolByName: (name: string) =>
        name === 'safeTool' ? safeTool : dangerousTool,
      getToolByDisplayName: (name: string) =>
        name === 'safeTool' ? safeTool : dangerousTool,
      getTools: () => [safeTool, dangerousTool],
      discoverTools: async () => {},
      getAllTools: () => [safeTool, dangerousTool],
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
      isInteractive: () => false, // Non-interactive
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({ model: 'test-model' }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
    });

    // ACT - Schedule both tools in a batch
    await scheduler.schedule(
      [
        {
          callId: 'safe-call',
          name: 'safeTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
        {
          callId: 'dangerous-call',
          name: 'dangerousTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
      ],
      new AbortController().signal,
    );

    // ASSERT
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls).toHaveLength(2);

    const safeCall = completedCalls.find(
      (c) => c.request.callId === 'safe-call',
    );
    const dangerousCall = completedCalls.find(
      (c) => c.request.callId === 'dangerous-call',
    );

    expect(safeCall?.status).toBe('success');
    expect(dangerousCall?.status).toBe('error');

    const erroredCall = dangerousCall as ErroredToolCall;
    const errorParts = erroredCall.response.responseParts;
    const errorMessage = errorParts[0].functionResponse.response.error;
    expect(errorMessage).toContain('requires user confirmation');
    expect(errorMessage).toContain('non-interactive mode');
  });
});
