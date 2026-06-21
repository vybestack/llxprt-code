/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { CoreToolScheduler } from './coreToolScheduler.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type {
  ContextAwareTool,
  ToolContext,
} from '@vybestack/llxprt-code-tools';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core/config/models.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import {
  createMockMessageBus,
  createMockPolicyEngine,
} from './coreToolScheduler-test-helpers.js';

describe('CoreToolScheduler context-aware tools', () => {
  it('injects agentId into ContextAwareTool context', async () => {
    class ContextAwareMockTool extends MockTool implements ContextAwareTool {
      context?: ToolContext;

      constructor(name: string) {
        super(name);
      }
    }

    const contextAwareTool = new ContextAwareMockTool('context-tool');
    contextAwareTool.executeFn.mockResolvedValue({
      llmContent: 'ok',
      returnDisplay: 'ok',
    });

    const toolRegistry = {
      getTool: () => contextAwareTool,
      getToolByName: () => contextAwareTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByDisplayName: () => contextAwareTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    };

    const mockPolicyEngine = createMockPolicyEngine();

    const mockConfig = {
      getSessionId: () => 'session-123',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getAllowedTools: () => [],
      getToolRegistry: () => toolRegistry,
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete: vi.fn(),
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: 'ctx-1',
      name: 'context-tool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-ctx',
      agentId: 'agent-sub-42',
    };

    await scheduler.schedule([request], abortController.signal);

    expect(contextAwareTool.context).toStrictEqual({
      sessionId: 'session-123',
      agentId: 'agent-sub-42',
      interactiveMode: true,
    });
  });
});
