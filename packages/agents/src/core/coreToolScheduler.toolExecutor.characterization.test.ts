/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createSchedulerPolicyFixture } from './__tests__/scheduler-policy-fixture.js';

/**
 * @plan PLAN-20260302-TOOLSCHEDULER.P03
 * @requirement TS-EXEC-001 through TS-EXEC-007
 *
 * Characterization tests for tool execution behavior in CoreToolScheduler.
 * These tests document EXISTING behavior prior to ToolExecutor extraction.
 */

import { describe, it, expect, vi, type Mock } from 'bun:test';
import type { ToolCall } from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import { expectSuccessful } from './__tests__/coreToolScheduler-test-helpers.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';

// Helper function to create a mock MessageBus
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
  policyDecision: PolicyDecision,
) {
  return createSchedulerPolicyFixture(
    {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,

      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getEnableHooks: () => false,
      getModel: () => 'gemini-2.5-pro',
    },
    policyDecision,
  );
}

function createScheduler(
  mockConfig: Config,
  settingsOwner: ReturnType<
    typeof createSchedulerPolicyFixture
  >['settingsOwner'],
  mockToolRegistry: ToolRegistry,
  runtimeMessageBus: ReturnType<
    typeof createSchedulerPolicyFixture
  >['messageBus'],
  onAllToolCallsComplete: Mock<(...args: unknown[]) => Promise<void>>,
  onToolCallsUpdate: Mock<(...args: unknown[]) => unknown>,
) {
  return new CoreToolScheduler({
    telemetry: settingsOwner.telemetry,
    readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
    getToolGovernance: () =>
      settingsOwner.readToolGovernance(mockConfig.getExcludeTools() ?? []),
    config: mockConfig,
    messageBus: runtimeMessageBus,
    toolRegistry: mockToolRegistry,
    onAllToolCallsComplete,
    onToolCallsUpdate,
    getPreferredEditor: () => 'vscode',
    onEditorClose: vi.fn(),
  });
}

describe('CoreToolScheduler - Tool Execution Characterization', () => {
  describe('TS-EXEC-001: Successful tool execution', () => {
    it('should transition tool through validating → scheduled → executing → success', async () => {
      const mockTool = new MockTool('mockTool');
      const mockToolRegistry = createMockToolRegistry(mockTool);
      const policyDecision = PolicyDecision.ALLOW;
      const {
        config: mockConfig,
        settingsOwner,
        messageBus: runtimeMessageBus,
      } = createMockConfig(mockToolRegistry, policyDecision);

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const scheduler = createScheduler(
        mockConfig,
        settingsOwner,
        mockToolRegistry,
        runtimeMessageBus,
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
      const policyDecision = PolicyDecision.ALLOW;
      const {
        config: mockConfig,
        settingsOwner,
        messageBus: runtimeMessageBus,
      } = createMockConfig(mockToolRegistry, policyDecision);

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const scheduler = createScheduler(
        mockConfig,
        settingsOwner,
        mockToolRegistry,
        runtimeMessageBus,
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
      let policyDecision = PolicyDecision.ALLOW;
      policyDecision = PolicyDecision.ASK_USER;
      const {
        config: mockConfig,
        settingsOwner,
        messageBus: runtimeMessageBus,
      } = createMockConfig(mockToolRegistry, policyDecision);

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const scheduler = createScheduler(
        mockConfig,
        settingsOwner,
        mockToolRegistry,
        runtimeMessageBus,
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
      const policyDecision = PolicyDecision.ALLOW;
      const {
        config: mockConfig,
        settingsOwner,
        messageBus: runtimeMessageBus,
      } = createMockConfig(mockToolRegistry, policyDecision);

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const scheduler = createScheduler(
        mockConfig,
        settingsOwner,
        mockToolRegistry,
        runtimeMessageBus,
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
      const policyDecision = PolicyDecision.ALLOW;
      const {
        config: mockConfig,
        settingsOwner,
        messageBus: runtimeMessageBus,
      } = createMockConfig(mockToolRegistry, policyDecision);

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const scheduler = createScheduler(
        mockConfig,
        settingsOwner,
        mockToolRegistry,
        runtimeMessageBus,
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
      const successResponse = expectSuccessful(successCall).response;
      expect(successResponse).toBeDefined();
      expect(successResponse.responseParts).toBeDefined();
    });
  });

  describe('TS-EXEC-006: Policy-allowed execution skips confirmation', () => {
    it('should execute without confirmation when policy allows', async () => {
      const mockTool = new MockTool('mockTool');
      mockTool.shouldConfirm = true;
      const mockToolRegistry = createMockToolRegistry(mockTool);
      let policyDecision = PolicyDecision.ALLOW;
      // Policy ALLOW means no confirmation dialog
      policyDecision = PolicyDecision.ALLOW;
      const {
        config: mockConfig,
        settingsOwner,
        messageBus: runtimeMessageBus,
      } = createMockConfig(mockToolRegistry, policyDecision);

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const scheduler = createScheduler(
        mockConfig,
        settingsOwner,
        mockToolRegistry,
        runtimeMessageBus,
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
      const policyDecision = PolicyDecision.ALLOW;
      const {
        config: mockConfig,
        settingsOwner,
        messageBus: runtimeMessageBus,
      } = createMockConfig(mockToolRegistry, policyDecision);

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const scheduler = createScheduler(
        mockConfig,
        settingsOwner,
        mockToolRegistry,
        runtimeMessageBus,
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

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools/tools/tool-registry.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
