/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for Phase 4: Tool Executor Unification
 *
 * These tests verify that the unified tool execution behavior works correctly
 * across both interactive (CoreToolScheduler) and non-interactive (executeToolCall)
 * execution paths.
 *
 * Key verifications:
 * 1. Tool governance consistency - both paths use the same governance logic
 * 2. interactiveMode propagation - toolContextInteractiveMode setting controls context
 * 3. agentId preservation - agentId flows correctly through execution paths
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CoreToolScheduler,
  type CompletedToolCall,
} from './coreToolScheduler.js';
import {
  executeToolCall,
  type ToolExecutionConfig,
} from './nonInteractiveToolExecutor.js';
import {
  ApprovalMode,
  Config,
  ToolRegistry,
  DEFAULT_AGENT_ID,
  ToolErrorType,
} from '../index.js';
import { MockTool } from '../test-utils/mock-tool.js';
import type { ContextAwareTool, ToolContext } from '../tools/tool-context.js';
import { PolicyDecision } from '../policy/types.js';
import { PolicyEngine } from '../policy/policy-engine.js';

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

function createAllowPolicyEngine(): PolicyEngine {
  return new PolicyEngine({
    rules: [],
    defaultDecision: PolicyDecision.ALLOW,
    nonInteractive: false,
  });
}

class ContextAwareMockTool extends MockTool implements ContextAwareTool {
  context?: ToolContext;

  constructor(name: string) {
    super(name);
  }
}

function createMockToolRegistry(tool: MockTool): ToolRegistry {
  return {
    getTool: () => tool,
    getToolByName: () => tool,
    getFunctionDeclarations: () => [],
    tools: new Map(),
    discovery: {},
    registerTool: () => {},
    getToolByDisplayName: () => tool,
    getTools: () => [],
    discoverTools: async () => {},
    getAllTools: () => [],
    getAllToolNames: () => [tool.name],
    getToolsByServer: () => [],
  } as unknown as ToolRegistry;
}

function createMockConfig(
  toolRegistry: ToolRegistry,
  options?: {
    approvalMode?: ApprovalMode;
    ephemeralSettings?: Record<string, unknown>;
    policyEngine?: PolicyEngine;
  },
): Config {
  const policyEngine = options?.policyEngine ?? createAllowPolicyEngine();
  const mockMessageBus = createMockMessageBus();

  return {
    getSessionId: () => 'test-session-id',
    getUsageStatisticsEnabled: () => false,
    getDebugMode: () => false,
    getApprovalMode: () => options?.approvalMode ?? ApprovalMode.YOLO,
    getEphemeralSettings: () => options?.ephemeralSettings ?? {},
    getEphemeralSetting: (key: string) =>
      (options?.ephemeralSettings ?? {})[key],
    getAllowedTools: () => [],
    getExcludeTools: () => [],
    getContentGeneratorConfig: () => ({
      model: 'test-model',
      authType: 'oauth-personal',
    }),
    getToolRegistry: () => toolRegistry,
    getMessageBus: () => mockMessageBus,
    getPolicyEngine: () => policyEngine,
    getTelemetryLogPromptsEnabled: () => false,
  } as unknown as Config;
}

function createMockExecutionConfig(
  toolRegistry: ToolRegistry,
  options?: {
    approvalMode?: ApprovalMode;
    ephemeralSettings?: Record<string, unknown>;
    policyEngine?: PolicyEngine;
  },
): ToolExecutionConfig {
  const policyEngine = options?.policyEngine ?? createAllowPolicyEngine();
  const ephemeralSettings = options?.ephemeralSettings ?? {};

  return {
    getSessionId: () => 'test-session-id',
    getTelemetryLogPromptsEnabled: () => false,
    getExcludeTools: () => [],
    getEphemeralSettings: () => ephemeralSettings,
    getEphemeralSetting: (key: string) => ephemeralSettings[key],
    getToolRegistry: () => toolRegistry,
    getPolicyEngine: () => policyEngine,
    getApprovalMode: () => options?.approvalMode ?? ApprovalMode.DEFAULT,
    getAllowedTools: () => undefined,
  };
}

describe('Tool Executor Unification - Integration Tests', () => {
  let abortController: AbortController;

  beforeEach(() => {
    abortController = new AbortController();
  });

  describe('Tool Governance Consistency', () => {
    it('should block the same tools in both CoreToolScheduler and executeToolCall when tools.disabled is set', async () => {
      const blockedTool = new MockTool('blocked_tool');
      blockedTool.executeFn.mockResolvedValue({
        llmContent: 'Should not execute',
        returnDisplay: 'Should not execute',
      });

      const toolRegistry = createMockToolRegistry(blockedTool);

      const ephemeralSettings = {
        'tools.disabled': ['blocked_tool'],
      };

      const schedulerConfig = createMockConfig(toolRegistry, {
        ephemeralSettings,
      });
      const executorConfig = createMockExecutionConfig(toolRegistry, {
        ephemeralSettings,
      });

      const request = {
        callId: 'governance-test-1',
        name: 'blocked_tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      };

      let schedulerCompletionResolver:
        | ((calls: CompletedToolCall[]) => void)
        | null = null;
      const schedulerCompletionPromise = new Promise<CompletedToolCall[]>(
        (resolve) => {
          schedulerCompletionResolver = resolve;
        },
      );

      const scheduler = new CoreToolScheduler({
        config: schedulerConfig,
        toolContextInteractiveMode: false,
        onAllToolCallsComplete: async (calls) => {
          schedulerCompletionResolver?.(calls);
        },
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      });

      await scheduler.schedule([request], abortController.signal);
      const schedulerCalls = await schedulerCompletionPromise;
      const schedulerResponse = schedulerCalls[0].response;

      const executorCompleted = await executeToolCall(
        executorConfig,
        request,
        abortController.signal,
      );
      const executorResponse = executorCompleted.response;

      expect(schedulerResponse.error).toBeDefined();
      expect(schedulerResponse.errorType).toBe(ToolErrorType.TOOL_DISABLED);

      expect(executorResponse.error).toBeDefined();
      expect(executorResponse.errorType).toBe(ToolErrorType.TOOL_DISABLED);

      expect(blockedTool.executeFn).not.toHaveBeenCalled();

      scheduler.dispose();
    });

    it('should allow the same tools in both paths when tools.allowed includes the tool', async () => {
      const allowedTool = new MockTool('allowed_tool');
      allowedTool.executeFn.mockResolvedValue({
        llmContent: 'Executed successfully',
        returnDisplay: 'Success',
      });

      const toolRegistry = createMockToolRegistry(allowedTool);

      const ephemeralSettings = {
        'tools.allowed': ['allowed_tool'],
      };

      const schedulerConfig = createMockConfig(toolRegistry, {
        ephemeralSettings,
      });
      const executorConfig = createMockExecutionConfig(toolRegistry, {
        ephemeralSettings,
      });

      const request = {
        callId: 'governance-test-2',
        name: 'allowed_tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      };

      let schedulerCompletionResolver:
        | ((calls: CompletedToolCall[]) => void)
        | null = null;
      const schedulerCompletionPromise = new Promise<CompletedToolCall[]>(
        (resolve) => {
          schedulerCompletionResolver = resolve;
        },
      );

      const scheduler = new CoreToolScheduler({
        config: schedulerConfig,
        toolContextInteractiveMode: false,
        onAllToolCallsComplete: async (calls) => {
          schedulerCompletionResolver?.(calls);
        },
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      });

      await scheduler.schedule([request], abortController.signal);
      const schedulerCalls = await schedulerCompletionPromise;
      const schedulerResponse = schedulerCalls[0].response;

      const executorCompleted = await executeToolCall(
        executorConfig,
        request,
        abortController.signal,
      );
      const executorResponse = executorCompleted.response;

      expect(schedulerResponse.error).toBeUndefined();
      expect(executorResponse.error).toBeUndefined();

      expect(allowedTool.executeFn).toHaveBeenCalledTimes(2);

      scheduler.dispose();
    });

    it('should block tools not in tools.allowed list in both paths', async () => {
      const disallowedTool = new MockTool('disallowed_tool');
      disallowedTool.executeFn.mockResolvedValue({
        llmContent: 'Should not execute',
        returnDisplay: 'Should not execute',
      });

      const toolRegistry = createMockToolRegistry(disallowedTool);

      const ephemeralSettings = {
        'tools.allowed': ['some_other_tool'],
      };

      const schedulerConfig = createMockConfig(toolRegistry, {
        ephemeralSettings,
      });
      const executorConfig = createMockExecutionConfig(toolRegistry, {
        ephemeralSettings,
      });

      const request = {
        callId: 'governance-test-3',
        name: 'disallowed_tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      };

      let schedulerCompletionResolver:
        | ((calls: CompletedToolCall[]) => void)
        | null = null;
      const schedulerCompletionPromise = new Promise<CompletedToolCall[]>(
        (resolve) => {
          schedulerCompletionResolver = resolve;
        },
      );

      const scheduler = new CoreToolScheduler({
        config: schedulerConfig,
        toolContextInteractiveMode: false,
        onAllToolCallsComplete: async (calls) => {
          schedulerCompletionResolver?.(calls);
        },
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      });

      await scheduler.schedule([request], abortController.signal);
      const schedulerCalls = await schedulerCompletionPromise;
      const schedulerResponse = schedulerCalls[0].response;

      const executorCompleted = await executeToolCall(
        executorConfig,
        request,
        abortController.signal,
      );
      const executorResponse = executorCompleted.response;

      expect(schedulerResponse.error).toBeDefined();
      expect(schedulerResponse.errorType).toBe(ToolErrorType.TOOL_DISABLED);

      expect(executorResponse.error).toBeDefined();
      expect(executorResponse.errorType).toBe(ToolErrorType.TOOL_DISABLED);

      expect(disallowedTool.executeFn).not.toHaveBeenCalled();

      scheduler.dispose();
    });
  });

  describe('interactiveMode Propagation', () => {
    it('should set context.interactiveMode to false when CoreToolScheduler has toolContextInteractiveMode: false', async () => {
      const contextAwareTool = new ContextAwareMockTool('context_tool');
      contextAwareTool.executeFn.mockResolvedValue({
        llmContent: 'Success',
        returnDisplay: 'Success',
      });

      const toolRegistry = createMockToolRegistry(contextAwareTool);
      const config = createMockConfig(toolRegistry);

      let completionResolver: ((calls: CompletedToolCall[]) => void) | null =
        null;
      const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
        completionResolver = resolve;
      });

      const scheduler = new CoreToolScheduler({
        config,
        toolContextInteractiveMode: false,
        onAllToolCallsComplete: async (calls) => {
          completionResolver?.(calls);
        },
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      });

      const request = {
        callId: 'interactive-mode-test-1',
        name: 'context_tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      };

      await scheduler.schedule([request], abortController.signal);
      await completionPromise;

      expect(contextAwareTool.context).toBeDefined();
      expect(contextAwareTool.context?.interactiveMode).toBe(false);

      scheduler.dispose();
    });

    it('should set context.interactiveMode to true by default in CoreToolScheduler', async () => {
      const contextAwareTool = new ContextAwareMockTool('context_tool');
      contextAwareTool.executeFn.mockResolvedValue({
        llmContent: 'Success',
        returnDisplay: 'Success',
      });

      const toolRegistry = createMockToolRegistry(contextAwareTool);
      const config = createMockConfig(toolRegistry);

      let completionResolver: ((calls: CompletedToolCall[]) => void) | null =
        null;
      const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
        completionResolver = resolve;
      });

      const scheduler = new CoreToolScheduler({
        config,
        onAllToolCallsComplete: async (calls) => {
          completionResolver?.(calls);
        },
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      });

      const request = {
        callId: 'interactive-mode-test-2',
        name: 'context_tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      };

      await scheduler.schedule([request], abortController.signal);
      await completionPromise;

      expect(contextAwareTool.context).toBeDefined();
      expect(contextAwareTool.context?.interactiveMode).toBe(true);

      scheduler.dispose();
    });

    it('should allow tools to branch behavior based on interactiveMode', async () => {
      let capturedMode: boolean | undefined;

      const contextAwareTool = new ContextAwareMockTool('branching_tool');
      contextAwareTool.executeFn.mockImplementation(() => {
        capturedMode = contextAwareTool.context?.interactiveMode;
        return Promise.resolve({
          llmContent: `Mode: ${capturedMode}`,
          returnDisplay: `Mode: ${capturedMode}`,
        });
      });

      const toolRegistry = createMockToolRegistry(contextAwareTool);
      const config = createMockConfig(toolRegistry);

      let completionResolver: ((calls: CompletedToolCall[]) => void) | null =
        null;
      const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
        completionResolver = resolve;
      });

      const scheduler = new CoreToolScheduler({
        config,
        toolContextInteractiveMode: false,
        onAllToolCallsComplete: async (calls) => {
          completionResolver?.(calls);
        },
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      });

      const request = {
        callId: 'interactive-mode-test-3',
        name: 'branching_tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      };

      await scheduler.schedule([request], abortController.signal);
      await completionPromise;

      expect(capturedMode).toBe(false);

      scheduler.dispose();
    });
  });

  describe('agentId Preservation', () => {
    it('should preserve custom agentId from request through CoreToolScheduler execution', async () => {
      const tool = new MockTool('test_tool');
      tool.executeFn.mockResolvedValue({
        llmContent: 'Success',
        returnDisplay: 'Success',
      });

      const toolRegistry = createMockToolRegistry(tool);
      const config = createMockConfig(toolRegistry);

      let completionResolver: ((calls: CompletedToolCall[]) => void) | null =
        null;
      const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
        completionResolver = resolve;
      });

      const scheduler = new CoreToolScheduler({
        config,
        toolContextInteractiveMode: false,
        onAllToolCallsComplete: async (calls) => {
          completionResolver?.(calls);
        },
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      });

      const customAgentId = 'subagent-123';
      const request = {
        callId: 'agentid-test-1',
        name: 'test_tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
        agentId: customAgentId,
      };

      await scheduler.schedule([request], abortController.signal);
      const calls = await completionPromise;

      expect(calls[0].response.agentId).toBe(customAgentId);

      scheduler.dispose();
    });

    it('should use DEFAULT_AGENT_ID when no agentId provided in CoreToolScheduler', async () => {
      const tool = new MockTool('test_tool');
      tool.executeFn.mockResolvedValue({
        llmContent: 'Success',
        returnDisplay: 'Success',
      });

      const toolRegistry = createMockToolRegistry(tool);
      const config = createMockConfig(toolRegistry);

      let completionResolver: ((calls: CompletedToolCall[]) => void) | null =
        null;
      const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
        completionResolver = resolve;
      });

      const scheduler = new CoreToolScheduler({
        config,
        toolContextInteractiveMode: false,
        onAllToolCallsComplete: async (calls) => {
          completionResolver?.(calls);
        },
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      });

      const request = {
        callId: 'agentid-test-2',
        name: 'test_tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      };

      await scheduler.schedule([request], abortController.signal);
      const calls = await completionPromise;

      expect(calls[0].response.agentId).toBe(DEFAULT_AGENT_ID);

      scheduler.dispose();
    });

    it('should preserve custom agentId from request through executeToolCall execution', async () => {
      const tool = new MockTool('test_tool');
      tool.executeFn.mockResolvedValue({
        llmContent: 'Success',
        returnDisplay: 'Success',
      });

      const toolRegistry = createMockToolRegistry(tool);
      const executorConfig = createMockExecutionConfig(toolRegistry);

      const customAgentId = 'subagent-456';
      const request = {
        callId: 'agentid-test-3',
        name: 'test_tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
        agentId: customAgentId,
      };

      const completed = await executeToolCall(
        executorConfig,
        request,
        abortController.signal,
      );
      const response = completed.response;

      expect(response.agentId).toBe(customAgentId);
    });

    it('should use DEFAULT_AGENT_ID when no agentId provided in executeToolCall', async () => {
      const tool = new MockTool('test_tool');
      tool.executeFn.mockResolvedValue({
        llmContent: 'Success',
        returnDisplay: 'Success',
      });

      const toolRegistry = createMockToolRegistry(tool);
      const executorConfig = createMockExecutionConfig(toolRegistry);

      const request = {
        callId: 'agentid-test-4',
        name: 'test_tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      };

      const completed = await executeToolCall(
        executorConfig,
        request,
        abortController.signal,
      );
      const response = completed.response;

      expect(response.agentId).toBe(DEFAULT_AGENT_ID);
    });

    it('should preserve agentId through context for ContextAwareTool', async () => {
      const contextAwareTool = new ContextAwareMockTool('context_tool');
      contextAwareTool.executeFn.mockResolvedValue({
        llmContent: 'Success',
        returnDisplay: 'Success',
      });

      const toolRegistry = createMockToolRegistry(contextAwareTool);
      const config = createMockConfig(toolRegistry);

      let completionResolver: ((calls: CompletedToolCall[]) => void) | null =
        null;
      const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
        completionResolver = resolve;
      });

      const scheduler = new CoreToolScheduler({
        config,
        toolContextInteractiveMode: false,
        onAllToolCallsComplete: async (calls) => {
          completionResolver?.(calls);
        },
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      });

      const customAgentId = 'subagent-789';
      const request = {
        callId: 'agentid-test-5',
        name: 'context_tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
        agentId: customAgentId,
      };

      await scheduler.schedule([request], abortController.signal);
      await completionPromise;

      expect(contextAwareTool.context).toBeDefined();
      expect(contextAwareTool.context?.agentId).toBe(customAgentId);

      scheduler.dispose();
    });
  });

  describe('Unified Behavior Cross-Verification', () => {
    it('should produce consistent responses for the same tool call in both paths', async () => {
      const tool = new MockTool('consistent_tool');
      tool.executeFn.mockResolvedValue({
        llmContent: 'Consistent output',
        returnDisplay: 'Consistent display',
      });

      const toolRegistry = createMockToolRegistry(tool);
      const schedulerConfig = createMockConfig(toolRegistry);
      const executorConfig = createMockExecutionConfig(toolRegistry);

      const request = {
        callId: 'unified-test-1',
        name: 'consistent_tool',
        args: { param: 'value' },
        isClientInitiated: false,
        prompt_id: 'test-prompt',
        agentId: 'test-agent',
      };

      let schedulerCompletionResolver:
        | ((calls: CompletedToolCall[]) => void)
        | null = null;
      const schedulerCompletionPromise = new Promise<CompletedToolCall[]>(
        (resolve) => {
          schedulerCompletionResolver = resolve;
        },
      );

      const scheduler = new CoreToolScheduler({
        config: schedulerConfig,
        toolContextInteractiveMode: false,
        onAllToolCallsComplete: async (calls) => {
          schedulerCompletionResolver?.(calls);
        },
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      });

      await scheduler.schedule([request], abortController.signal);
      const schedulerCalls = await schedulerCompletionPromise;
      const schedulerResponse = schedulerCalls[0].response;

      const executorCompleted = await executeToolCall(
        executorConfig,
        request,
        abortController.signal,
      );
      const executorResponse = executorCompleted.response;

      expect(schedulerResponse.callId).toBe(executorResponse.callId);
      expect(schedulerResponse.agentId).toBe(executorResponse.agentId);
      expect(schedulerResponse.error).toBeUndefined();
      expect(executorResponse.error).toBeUndefined();
      expect(schedulerResponse.resultDisplay).toBe(
        executorResponse.resultDisplay,
      );

      expect(tool.executeFn).toHaveBeenCalledTimes(2);

      scheduler.dispose();
    });
  });
});
