/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolCall } from './coreToolScheduler.js';
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

describe('CoreToolScheduler YOLO mode', () => {
  it('should execute tool requiring confirmation directly without waiting', async () => {
    // Arrange
    const mockTool = new MockTool();
    mockTool.executeFn.mockResolvedValue({
      llmContent: 'Tool executed',
      returnDisplay: 'Tool executed',
    });
    // This tool would normally require confirmation.
    mockTool.shouldConfirm = true;
    const declarativeTool = mockTool;

    const mockToolRegistry = {
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
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    // Configure the scheduler for YOLO mode.
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getApprovalMode: () => ApprovalMode.YOLO,
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
      name: 'mockTool',
      args: { param: 'value' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-yolo',
    };

    // Act
    await scheduler.schedule([request], abortController.signal);
    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    // Assert
    // 1. The tool's execute method was called directly.
    const executeCall =
      mockTool.executeFn.mock.calls[mockTool.executeFn.mock.calls.length - 1];
    expect(executeCall[0]).toStrictEqual({ param: 'value' });
    expect(executeCall[1]).toBeInstanceOf(AbortSignal);

    // 2. The tool call status never entered 'awaiting_approval'.
    const statusUpdates = onToolCallsUpdate.mock.calls
      .flatMap((call) => (call[0] as ToolCall[]).map(({ status }) => status))
      .filter(Boolean);
    expect(statusUpdates).not.toContain('awaiting_approval');
    expect(statusUpdates).toStrictEqual([
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
    expect(completedCall.response.resultDisplay).toBe('Tool executed');
  });
});
