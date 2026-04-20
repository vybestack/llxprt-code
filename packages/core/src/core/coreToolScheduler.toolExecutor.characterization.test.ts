/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260302-TOOLSCHEDULER.P03
 * @requirement TS-EXEC-001 through TS-EXEC-007
 *
 * Characterization tests for tool execution behavior in CoreToolScheduler.
 * These tests document EXISTING behavior prior to ToolExecutor extraction.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import type { ToolCall } from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import type { Config, ToolRegistry } from '../index.js';
import { ApprovalMode } from '../index.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { MockTool } from '../test-utils/mock-tool.js';
import { PolicyDecision } from '../policy/types.js';

// Helper function to create a mock MessageBus
function createMockMessageBus() {
  return {
    subscribe: vi.fn().mockReturnValue(() => {}),
    publish: vi.fn(),
    respondToConfirmation: vi.fn(),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    removeAllListeners: vi.fn(),
    listenerCount: vi.fn().mockReturnValue(0),
  };
}

// Helper function to create a mock PolicyEngine
function createMockPolicyEngine() {
  return {
    evaluate: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
    checkDecision: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
  };
}

function createMockToolRegistry(tool: MockTool) {
  return {
    getTool: () => tool,
    getFunctionDeclarations: () => [],
    tools: new Map(),
    discovery: {},
    registerTool: () => {},
    getToolByName: () => tool,
    getToolByDisplayName: () => tool,
    getTools: () => [tool],
    discoverTools: async () => {},
    getAllTools: () => [tool],
    getToolsByServer: () => [],
    getAllToolNames: () => [tool.name],
  } as unknown as ToolRegistry;
}

function createMockConfig(
  mockToolRegistry: ToolRegistry,
  mockPolicyEngine: ReturnType<typeof createMockPolicyEngine>,
  mockMessageBus?: ReturnType<typeof createMockMessageBus>,
) {
  const messageBus = mockMessageBus ?? createMockMessageBus();
  return {
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
    getMessageBus: () => messageBus,
    getEnableHooks: () => false,
    getPolicyEngine: () => mockPolicyEngine,
    getModel: () => DEFAULT_GEMINI_MODEL,
  } as unknown as Config;
}

function createScheduler(
  mockConfig: Config,
  onAllToolCallsComplete: Mock,
  onToolCallsUpdate: Mock,
) {
  return new CoreToolScheduler({
    config: mockConfig,
    messageBus: mockConfig.getMessageBus(),
    toolRegistry: mockConfig.getToolRegistry(),
    onAllToolCallsComplete,
    onToolCallsUpdate,
    getPreferredEditor: () => 'vscode',
    onEditorClose: vi.fn(),
  });
}

async function _waitForStatus(
  onToolCallsUpdate: Mock,
  status: ToolCall['status'],
): Promise<ToolCall | undefined> {
  let matchingCall: ToolCall | undefined;
  await vi.waitFor(() => {
    const latestCalls = onToolCallsUpdate.mock.calls.at(-1)?.[0] as
      | ToolCall[]
      | undefined;
    matchingCall = latestCalls?.find((call) => call.status === status);
    if (!matchingCall) {
      throw new Error(
        `Waiting for status "${status}", latest statuses: ${
          latestCalls?.map((call) => call.status).join(', ') ?? 'none'
        }`,
      );
    }
  });
  return matchingCall;
}

describe('CoreToolScheduler - Tool Execution Characterization', () => {
  describe('TS-EXEC-001: Successful tool execution', () => {
    it('should transition tool through validating → scheduled → executing → success', async () => {
      const mockTool = new MockTool('mockTool');
      const mockToolRegistry = createMockToolRegistry(mockTool);
      const mockPolicyEngine = createMockPolicyEngine();
      const mockConfig = createMockConfig(mockToolRegistry, mockPolicyEngine);

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const scheduler = createScheduler(
        mockConfig,
        onAllToolCallsComplete,
        onToolCallsUpdate,
      );

      const abortController = new AbortController();
      await scheduler.schedule(
        [
          {
            callId: 'exec-1',
            name: 'mockTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        abortController.signal,
      );

      expect(onAllToolCallsComplete).toHaveBeenCalled();
      const completedCalls = onAllToolCallsComplete.mock
        .calls[0][0] as ToolCall[];
      expect(completedCalls).toHaveLength(1);
      expect(completedCalls[0].status).toBe('success');
    });
  });

  describe('TS-EXEC-002: Tool execution error handling', () => {
    it('should transition to error state when tool execution throws', async () => {
      const mockTool = new MockTool({
        name: 'mockTool',
        execute: async () => {
          throw new Error('Tool execution failed');
        },
      });
      const mockToolRegistry = createMockToolRegistry(mockTool);
      const mockPolicyEngine = createMockPolicyEngine();
      const mockConfig = createMockConfig(mockToolRegistry, mockPolicyEngine);

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const scheduler = createScheduler(
        mockConfig,
        onAllToolCallsComplete,
        onToolCallsUpdate,
      );

      const abortController = new AbortController();
      await scheduler.schedule(
        [
          {
            callId: 'error-1',
            name: 'mockTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        abortController.signal,
      );

      expect(onAllToolCallsComplete).toHaveBeenCalled();
      const completedCalls = onAllToolCallsComplete.mock
        .calls[0][0] as ToolCall[];
      expect(completedCalls).toHaveLength(1);
      expect(completedCalls[0].status).toBe('error');
    });
  });

  describe('TS-EXEC-003: Tool cancellation via abort', () => {
    it('should transition to cancelled when signal is aborted before execution', async () => {
      const mockTool = new MockTool('mockTool');
      mockTool.shouldConfirm = true;
      const mockToolRegistry = createMockToolRegistry(mockTool);
      const mockPolicyEngine = createMockPolicyEngine();
      mockPolicyEngine.evaluate = vi
        .fn()
        .mockReturnValue(PolicyDecision.ASK_USER);
      const mockConfig = createMockConfig(mockToolRegistry, mockPolicyEngine);

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const scheduler = createScheduler(
        mockConfig,
        onAllToolCallsComplete,
        onToolCallsUpdate,
      );

      const abortController = new AbortController();
      abortController.abort();

      await scheduler.schedule(
        [
          {
            callId: 'cancel-1',
            name: 'mockTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        abortController.signal,
      );

      expect(onAllToolCallsComplete).toHaveBeenCalled();
      const completedCalls = onAllToolCallsComplete.mock
        .calls[0][0] as ToolCall[];
      expect(completedCalls[0].status).toBe('cancelled');
    });
  });

  describe('TS-EXEC-004: Multiple tool scheduling', () => {
    it('should schedule and execute multiple tools', async () => {
      const mockTool = new MockTool('mockTool');
      const mockToolRegistry = createMockToolRegistry(mockTool);
      const mockPolicyEngine = createMockPolicyEngine();
      const mockConfig = createMockConfig(mockToolRegistry, mockPolicyEngine);

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const scheduler = createScheduler(
        mockConfig,
        onAllToolCallsComplete,
        onToolCallsUpdate,
      );

      const abortController = new AbortController();
      await scheduler.schedule(
        [
          {
            callId: 'multi-1',
            name: 'mockTool',
            args: { id: 1 },
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
          {
            callId: 'multi-2',
            name: 'mockTool',
            args: { id: 2 },
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        abortController.signal,
      );

      expect(onAllToolCallsComplete).toHaveBeenCalled();
      const completedCalls = onAllToolCallsComplete.mock
        .calls[0][0] as ToolCall[];
      expect(completedCalls).toHaveLength(2);
      expect(completedCalls.every((c) => c.status === 'success')).toBe(true);
    });
  });

  describe('TS-EXEC-005: Tool result structure', () => {
    it('should include llmContent in successful tool result', async () => {
      const mockTool = new MockTool('mockTool');
      const mockToolRegistry = createMockToolRegistry(mockTool);
      const mockPolicyEngine = createMockPolicyEngine();
      const mockConfig = createMockConfig(mockToolRegistry, mockPolicyEngine);

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const scheduler = createScheduler(
        mockConfig,
        onAllToolCallsComplete,
        onToolCallsUpdate,
      );

      const abortController = new AbortController();
      await scheduler.schedule(
        [
          {
            callId: 'result-1',
            name: 'mockTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        abortController.signal,
      );

      const completedCalls = onAllToolCallsComplete.mock
        .calls[0][0] as ToolCall[];
      const successCall = completedCalls[0];
      expect(successCall.status).toBe('success');
      if (successCall.status === 'success') {
        expect(successCall.response).toBeDefined();
        expect(successCall.response.responseParts).toBeDefined();
      }
    });
  });

  describe('TS-EXEC-006: Policy-allowed execution skips confirmation', () => {
    it('should execute without confirmation when policy allows', async () => {
      const mockTool = new MockTool('mockTool');
      mockTool.shouldConfirm = true;
      const mockToolRegistry = createMockToolRegistry(mockTool);
      const mockPolicyEngine = createMockPolicyEngine();
      // Policy ALLOW means no confirmation dialog
      mockPolicyEngine.evaluate = vi.fn().mockReturnValue(PolicyDecision.ALLOW);
      const mockConfig = createMockConfig(mockToolRegistry, mockPolicyEngine);

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const scheduler = createScheduler(
        mockConfig,
        onAllToolCallsComplete,
        onToolCallsUpdate,
      );

      const abortController = new AbortController();
      await scheduler.schedule(
        [
          {
            callId: 'policy-1',
            name: 'mockTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        abortController.signal,
      );

      expect(onAllToolCallsComplete).toHaveBeenCalled();
      const completedCalls = onAllToolCallsComplete.mock
        .calls[0][0] as ToolCall[];
      expect(completedCalls[0].status).toBe('success');
    });
  });

  describe('TS-EXEC-007: Duplicate callId prevention', () => {
    it('should not re-execute a tool with the same callId', async () => {
      const mockTool = new MockTool('mockTool');
      const mockToolRegistry = createMockToolRegistry(mockTool);
      const mockPolicyEngine = createMockPolicyEngine();
      const mockConfig = createMockConfig(mockToolRegistry, mockPolicyEngine);

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const scheduler = createScheduler(
        mockConfig,
        onAllToolCallsComplete,
        onToolCallsUpdate,
      );

      const abortController = new AbortController();
      const request = {
        callId: 'dup-1',
        name: 'mockTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      };

      // First schedule
      await scheduler.schedule([request], abortController.signal);
      expect(onAllToolCallsComplete).toHaveBeenCalledTimes(1);

      // Second schedule with same callId
      await scheduler.schedule([request], abortController.signal);
      // Duplicate callIds are ignored rather than producing an empty second batch.
      expect(onAllToolCallsComplete).toHaveBeenCalledTimes(1);
    });
  });
});
