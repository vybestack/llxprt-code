/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for Phase 2.1: CoreToolScheduler toolContextInteractiveMode option
 *
 * These tests verify the new `toolContextInteractiveMode` option that allows
 * `CoreToolScheduler` to set `ContextAwareTool.context.interactiveMode` correctly
 * when used outside interactive UI flows.
 *
 * Per the plan, the scheduler's `schedule()` method returns BEFORE tool execution
 * completes. Tests MUST use the `onAllToolCallsComplete` callback with a Promise
 * to properly await execution before asserting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CoreToolScheduler,
  type CompletedToolCall,
} from './coreToolScheduler.js';
import { ApprovalMode, Config, ToolRegistry } from '../index.js';
import { MockTool } from '../test-utils/mock-tool.js';
import type { ContextAwareTool, ToolContext } from '../tools/tool-context.js';
import { PolicyDecision } from '../policy/types.js';

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

function createMockPolicyEngine() {
  return {
    evaluate: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
    checkDecision: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
  };
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
  },
): Config {
  const mockPolicyEngine = createMockPolicyEngine();
  const mockMessageBus = createMockMessageBus();

  return {
    getSessionId: () => 'test-session-id',
    getUsageStatisticsEnabled: () => false,
    getDebugMode: () => false,
    getApprovalMode: () => options?.approvalMode ?? ApprovalMode.YOLO,
    getEphemeralSettings: () => options?.ephemeralSettings ?? {},
    getAllowedTools: () => [],
    getExcludeTools: () => [],
    getContentGeneratorConfig: () => ({
      model: 'test-model',
    }),
    getToolRegistry: () => toolRegistry,
    getMessageBus: () => mockMessageBus,
    getPolicyEngine: () => mockPolicyEngine,
  } as unknown as Config;
}

describe('CoreToolScheduler toolContextInteractiveMode option', () => {
  let abortController: AbortController;

  beforeEach(() => {
    abortController = new AbortController();
  });

  describe('default interactiveMode behavior (backward compatibility)', () => {
    it('should default to interactiveMode: true when no toolContextInteractiveMode option provided', async () => {
      const contextAwareTool = new ContextAwareMockTool('context-tool');
      contextAwareTool.executeFn.mockResolvedValue({
        llmContent: 'ok',
        returnDisplay: 'ok',
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
        callId: 'default-mode-call',
        name: 'context-tool',
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
  });

  describe('toolContextInteractiveMode: false', () => {
    it('should set interactiveMode: false when toolContextInteractiveMode option is false', async () => {
      const contextAwareTool = new ContextAwareMockTool('context-tool');
      contextAwareTool.executeFn.mockResolvedValue({
        llmContent: 'ok',
        returnDisplay: 'ok',
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
        callId: 'non-interactive-call',
        name: 'context-tool',
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
  });

  describe('interactiveMode affects tool behavior branching', () => {
    it('should allow ContextAwareTool to branch on interactiveMode when set to false', async () => {
      let executionMode: 'interactive' | 'non-interactive' | undefined;

      const contextAwareTool = new ContextAwareMockTool('branching-tool');
      contextAwareTool.executeFn.mockImplementation(() => {
        executionMode = contextAwareTool.context?.interactiveMode
          ? 'interactive'
          : 'non-interactive';
        return Promise.resolve({
          llmContent: 'Branched execution',
          returnDisplay: 'Branched execution',
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
        callId: 'branching-call',
        name: 'branching-tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      };

      await scheduler.schedule([request], abortController.signal);
      await completionPromise;

      expect(executionMode).toBe('non-interactive');

      scheduler.dispose();
    });

    it('should allow ContextAwareTool to branch on interactiveMode when set to true', async () => {
      let executionMode: 'interactive' | 'non-interactive' | undefined;

      const contextAwareTool = new ContextAwareMockTool('branching-tool');
      contextAwareTool.executeFn.mockImplementation(() => {
        executionMode = contextAwareTool.context?.interactiveMode
          ? 'interactive'
          : 'non-interactive';
        return Promise.resolve({
          llmContent: 'Branched execution',
          returnDisplay: 'Branched execution',
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
        toolContextInteractiveMode: true,
        onAllToolCallsComplete: async (calls) => {
          completionResolver?.(calls);
        },
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      });

      const request = {
        callId: 'branching-call-interactive',
        name: 'branching-tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      };

      await scheduler.schedule([request], abortController.signal);
      await completionPromise;

      expect(executionMode).toBe('interactive');

      scheduler.dispose();
    });
  });

  describe('context injection at multiple code paths', () => {
    it('should set interactiveMode correctly in _schedule method (initial scheduling)', async () => {
      const contextAwareTool = new ContextAwareMockTool('context-tool');
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
        callId: 'schedule-path-call',
        name: 'context-tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      };

      await scheduler.schedule([request], abortController.signal);
      await completionPromise;

      expect(contextAwareTool.context?.interactiveMode).toBe(false);
      expect(contextAwareTool.context?.sessionId).toBe('test-session-id');

      scheduler.dispose();
    });
  });

  describe('multiple tool calls with same interactiveMode setting', () => {
    it('should apply interactiveMode: false to all tools in a batch', async () => {
      const capturedContexts: ToolContext[] = [];

      const contextAwareTool = new ContextAwareMockTool('context-tool');
      contextAwareTool.executeFn.mockImplementation(() => {
        if (contextAwareTool.context) {
          capturedContexts.push({ ...contextAwareTool.context });
        }
        return Promise.resolve({
          llmContent: 'Success',
          returnDisplay: 'Success',
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

      const requests = [
        {
          callId: 'batch-call-1',
          name: 'context-tool',
          args: { id: 1 },
          isClientInitiated: false,
          prompt_id: 'test-prompt',
        },
        {
          callId: 'batch-call-2',
          name: 'context-tool',
          args: { id: 2 },
          isClientInitiated: false,
          prompt_id: 'test-prompt',
        },
        {
          callId: 'batch-call-3',
          name: 'context-tool',
          args: { id: 3 },
          isClientInitiated: false,
          prompt_id: 'test-prompt',
        },
      ];

      await scheduler.schedule(requests, abortController.signal);
      await completionPromise;

      expect(capturedContexts.length).toBeGreaterThanOrEqual(3);
      for (const ctx of capturedContexts) {
        expect(ctx.interactiveMode).toBe(false);
      }

      scheduler.dispose();
    });
  });
});
