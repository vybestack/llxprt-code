/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SubAgentScope buildPartsFromCompletedCalls dedup, hook delegation to parent config.
 */

import type { Mock } from 'vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SubAgentScope } from './subagent.js';
import {
  ContextState,
  type PromptConfig,
  type ToolConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { buildPartsFromCompletedCalls } from './subagentToolProcessing.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { ChatSession } from './chatSession.js';
import {
  createContentGenerator,
  type ContentGenerator,
} from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import { executeToolCall } from './nonInteractiveToolExecutor.js';
import type { Part } from '@google/genai';
import { Type } from '@google/genai';
const { mockReadTodos, TodoStoreMock } = vi.hoisted(() => {
  const mockReadTodos = vi.fn().mockResolvedValue([]);
  const TodoStoreMock = vi
    .fn()
    .mockImplementation(() => ({ readTodos: mockReadTodos }));
  return { mockReadTodos, TodoStoreMock };
});

vi.mock('@vybestack/llxprt-code-tools', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-tools')>();
  return {
    ...actual,
    LocalTodoStore: TodoStoreMock,
  };
});

vi.mock('./chatSession.js');
vi.mock(
  '@vybestack/llxprt-code-core/core/contentGenerator.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@vybestack/llxprt-code-core/core/contentGenerator.js')
      >();
    return {
      ...actual,
      createContentGenerator: vi.fn(),
    };
  },
);
vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js');
vi.mock('./nonInteractiveToolExecutor.js');
vi.mock('@vybestack/llxprt-code-ide-integration', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@vybestack/llxprt-code-ide-integration')
    >();
  return {
    ...actual,
    IdeClient: {
      getInstance: vi.fn().mockResolvedValue({
        getConnectionStatus: vi.fn(),
        initialize: vi.fn(),
        shutdown: vi.fn(),
      }),
    },
  };
});
vi.mock(
  '@vybestack/llxprt-code-core/core/prompts.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@vybestack/llxprt-code-core/core/prompts.js')
      >();
    return {
      ...actual,
      getCoreSystemPromptAsync: vi.fn().mockResolvedValue('Core Prompt'),
    };
  },
);

import {
  createCompletedToolCallResponse,
  createMockConfig,
  createMockStream,
  defaultModelConfig,
  defaultRunConfig,
  createStatelessRuntimeBundle,
  createRuntimeOverrides,
} from './subagent-test-helpers.js';

describe('subagent.ts', () => {
  let mockSendMessageStream: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadTodos.mockResolvedValue([]);
    TodoStoreMock.mockClear();

    vi.mocked(getEnvironmentContext).mockResolvedValue([
      { text: 'Env Context' },
    ]);
    vi.mocked(createContentGenerator).mockResolvedValue({
      getGenerativeModel: vi.fn(),
    } as unknown as ContentGenerator);

    mockSendMessageStream = vi.fn();
    vi.mocked(ChatSession).mockImplementation(
      () =>
        ({
          sendMessageStream: mockSendMessageStream,
          getHistory: vi.fn().mockReturnValue([]),
          getHistoryService: vi.fn().mockReturnValue({
            clear: vi.fn(),
            findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
            getCurated: vi.fn().mockReturnValue([]),
            getTotalTokens: vi.fn().mockReturnValue(0),
          }),
          getConfig: vi.fn().mockReturnValue(undefined),
        }) as unknown as ChatSession,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildPartsFromCompletedCalls output deduplication', () => {
    it('should not call onMessage for tools with canUpdateOutput=true (fixes #898)', async () => {
      const { config } = await createMockConfig();
      const runtimeBundle = createStatelessRuntimeBundle();
      const historyAddSpy = vi.spyOn(runtimeBundle.history, 'add');
      const { overrides } = createRuntimeOverrides({ runtimeBundle });
      const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      // Track onMessage calls
      const onMessageCalls: string[] = [];
      scope.onMessage = (message: string) => {
        onMessageCalls.push(message);
      };

      // Create a mock tool with canUpdateOutput=true (like shell tool)
      const mockStreamingTool = {
        name: 'run_shell_command',
        displayName: 'Shell',
        canUpdateOutput: true,
        schema: { parameters: { type: Type.OBJECT, properties: {} } },
        build: vi.fn(),
      };

      // Simulate completed calls with a streaming tool
      const completedCalls = [
        {
          status: 'success' as const,
          request: {
            callId: 'call-1',
            name: 'run_shell_command',
            args: { command: 'echo hello' },
          },
          tool: mockStreamingTool,
          response: {
            callId: 'call-1',
            responseParts: [{ text: 'hello\n' }],
            resultDisplay: 'hello\n',
          },
          invocation: { execute: vi.fn() },
        },
      ];

      buildPartsFromCompletedCalls(
        completedCalls as Parameters<typeof buildPartsFromCompletedCalls>[0],
        {
          onMessage: scope.onMessage,
          subagentId: scope.getAgentId(),
          logger: new DebugLogger('llxprt:subagent'),
        },
      );

      // For tools with canUpdateOutput=true, onMessage should NOT be called
      // because the output was already streamed live
      expect(onMessageCalls).toHaveLength(0);
      expect(historyAddSpy).not.toHaveBeenCalled();
    });

    it('should call onMessage for tools with canUpdateOutput=false', async () => {
      const { config } = await createMockConfig();
      const { overrides } = createRuntimeOverrides();
      const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      // Track onMessage calls
      const onMessageCalls: string[] = [];
      scope.onMessage = (message: string) => {
        onMessageCalls.push(message);
      };

      // Create a mock tool with canUpdateOutput=false (like read_file)
      const mockNonStreamingTool = {
        name: 'read_file',
        displayName: 'Read File',
        canUpdateOutput: false,
        schema: { parameters: { type: Type.OBJECT, properties: {} } },
        build: vi.fn(),
      };

      // Simulate completed calls with a non-streaming tool
      const completedCalls = [
        {
          status: 'success' as const,
          request: {
            callId: 'call-1',
            name: 'read_file',
            args: { path: '/test.txt' },
          },
          tool: mockNonStreamingTool,
          response: {
            callId: 'call-1',
            responseParts: [{ text: 'file contents' }],
            resultDisplay: 'Read 100 bytes from /test.txt',
          },
          invocation: { execute: vi.fn() },
        },
      ];

      buildPartsFromCompletedCalls(
        completedCalls as Parameters<typeof buildPartsFromCompletedCalls>[0],
        {
          onMessage: scope.onMessage,
          subagentId: scope.getAgentId(),
          logger: new DebugLogger('llxprt:subagent'),
        },
      );

      // For tools with canUpdateOutput=false, onMessage SHOULD be called
      expect(onMessageCalls).toHaveLength(1);
      expect(onMessageCalls[0]).toBe('Read 100 bytes from /test.txt');
    });

    it('should call onMessage for error calls even if tool had canUpdateOutput=true', async () => {
      const { config } = await createMockConfig();
      const { overrides } = createRuntimeOverrides();
      const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      // Track onMessage calls
      const onMessageCalls: string[] = [];
      scope.onMessage = (message: string) => {
        onMessageCalls.push(message);
      };

      // Create a mock tool with canUpdateOutput=true
      const mockStreamingTool = {
        name: 'run_shell_command',
        displayName: 'Shell',
        canUpdateOutput: true,
        schema: { parameters: { type: Type.OBJECT, properties: {} } },
        build: vi.fn(),
      };

      // Simulate an errored call - errors should still display
      const completedCalls = [
        {
          status: 'error' as const,
          request: {
            callId: 'call-1',
            name: 'run_shell_command',
            args: { command: 'invalid-cmd' },
          },
          tool: mockStreamingTool,
          response: {
            callId: 'call-1',
            responseParts: [{ text: 'Command failed' }],
            resultDisplay: 'Error: command not found',
            error: new Error('command not found'),
          },
        },
      ];

      buildPartsFromCompletedCalls(
        completedCalls as Parameters<typeof buildPartsFromCompletedCalls>[0],
        {
          onMessage: scope.onMessage,
          subagentId: scope.getAgentId(),
          logger: new DebugLogger('llxprt:subagent'),
        },
      );

      // For error status, onMessage SHOULD be called to show the error
      expect(onMessageCalls).toHaveLength(1);
      expect(onMessageCalls[0]).toBe('Error: command not found');
    });

    /**
     * @scenario Error responseParts must not contain functionCall parts
     * @given A completed tool call with error status whose responseParts include a functionCall
     * @when buildPartsFromCompletedCalls processes the completed calls
     * @then The resulting parts must contain ONLY functionResponse (no functionCall)
     *       because the functionCall is already in history from the model's assistant message.
     *       Including functionCall in user-role tool results causes Anthropic invalid_request_error.
     */
    it('should produce functionResponse-only parts for error tool calls (Anthropic boundary)', async () => {
      const { config } = await createMockConfig();
      const { overrides } = createRuntimeOverrides();
      const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      // Simulate error completed calls with functionCall in responseParts
      // (this is what coreToolScheduler's createErrorResponse produces)
      const completedCalls = [
        {
          status: 'error' as const,
          request: {
            callId: 'call-err',
            name: 'failing_tool',
            args: { path: '/test' },
          },
          response: {
            callId: 'call-err',
            responseParts: [
              {
                functionCall: {
                  id: 'call-err',
                  name: 'failing_tool',
                  args: { path: '/test' },
                },
              },
              {
                functionResponse: {
                  id: 'call-err',
                  name: 'failing_tool',
                  response: { error: 'Tool execution failed' },
                },
              },
            ],
            resultDisplay: 'Tool execution failed',
            error: new Error('Tool execution failed'),
          },
        },
      ];

      const parts = buildPartsFromCompletedCalls(
        completedCalls as Parameters<typeof buildPartsFromCompletedCalls>[0],
        {
          onMessage: scope.onMessage,
          subagentId: scope.getAgentId(),
          logger: new DebugLogger('llxprt:subagent'),
        },
      );

      // CRITICAL: No part should contain functionCall - only functionResponse
      // functionCall in user-role message causes Anthropic invalid_request_error
      for (const part of parts) {
        expect(part).not.toHaveProperty('functionCall');
      }
      // Should still have a functionResponse
      const hasFunctionResponse = parts.some(
        (p: Part) => 'functionResponse' in p,
      );
      expect(hasFunctionResponse).toBe(true);
    });

    /**
     * @scenario Mixed success+error tool calls in same turn produce valid continuation
     * @given A batch with one successful tool and one errored tool
     * @when buildPartsFromCompletedCalls processes both
     * @then All resulting parts are functionResponse-only (no functionCall),
     *       and each tool_use from the model has exactly one matching tool_result
     */
    it('should produce valid paired parts for mixed success+error calls (Anthropic boundary)', async () => {
      const { config } = await createMockConfig();
      const { overrides } = createRuntimeOverrides();
      const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      const completedCalls = [
        {
          status: 'success' as const,
          request: {
            callId: 'call-ok',
            name: 'read_file',
            args: { path: '/test.txt' },
          },
          tool: { canUpdateOutput: false },
          response: {
            callId: 'call-ok',
            responseParts: [
              {
                functionResponse: {
                  id: 'call-ok',
                  name: 'read_file',
                  response: { output: 'file contents' },
                },
              },
            ],
            resultDisplay: 'file contents',
          },
        },
        {
          status: 'error' as const,
          request: {
            callId: 'call-err',
            name: 'write_file',
            args: { path: '/out.txt', content: 'data' },
          },
          response: {
            callId: 'call-err',
            responseParts: [
              {
                functionCall: {
                  id: 'call-err',
                  name: 'write_file',
                  args: { path: '/out.txt', content: 'data' },
                },
              },
              {
                functionResponse: {
                  id: 'call-err',
                  name: 'write_file',
                  response: { error: 'Permission denied' },
                },
              },
            ],
            resultDisplay: 'Permission denied',
            error: new Error('Permission denied'),
          },
        },
      ];

      const parts = buildPartsFromCompletedCalls(
        completedCalls as Parameters<typeof buildPartsFromCompletedCalls>[0],
        {
          onMessage: scope.onMessage,
          subagentId: scope.getAgentId(),
          logger: new DebugLogger('llxprt:subagent'),
        },
      );

      // No part should contain functionCall
      for (const part of parts) {
        expect(part).not.toHaveProperty('functionCall');
      }

      // Should have functionResponse for both tool calls
      const functionResponses = parts.filter(
        (p: Part) => 'functionResponse' in p,
      );
      expect(functionResponses.length).toBe(2);
    });

    it('should handle calls where tool is undefined gracefully', async () => {
      const { config } = await createMockConfig();
      const { overrides } = createRuntimeOverrides();
      const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      // Track onMessage calls
      const onMessageCalls: string[] = [];
      scope.onMessage = (message: string) => {
        onMessageCalls.push(message);
      };

      // Simulate an errored call where tool is undefined
      const completedCalls = [
        {
          status: 'error' as const,
          request: {
            callId: 'call-1',
            name: 'unknown_tool',
            args: {},
          },
          // tool is undefined
          response: {
            callId: 'call-1',
            responseParts: [{ text: 'Tool not found' }],
            resultDisplay: 'Tool not found',
            error: new Error('Tool not found'),
          },
        },
      ];

      // Should not throw
      const parts = buildPartsFromCompletedCalls(
        completedCalls as Parameters<typeof buildPartsFromCompletedCalls>[0],
        {
          onMessage: scope.onMessage,
          subagentId: scope.getAgentId(),
          logger: new DebugLogger('llxprt:subagent'),
        },
      );

      // Should have produced parts
      expect(parts.length).toBeGreaterThan(0);

      // Should still display the error
      expect(onMessageCalls).toHaveLength(1);
      expect(onMessageCalls[0]).toBe('Tool not found');
    });
  });

  describe('Hook delegation to parent config', () => {
    /**
     * @requirement:HOOK-SUBAGENT-001 - BeforeTool hooks must fire for subagent tool calls
     *
     * This test verifies that when a subagent executes a tool, the BeforeTool hook
     * configured on the parent config is triggered. The bug is that createSchedulerConfig()
     * creates a minimal Config object missing getEnableHooks, getHooks, getHookSystem,
     * getWorkingDir, and getTargetDir methods.
     */
    it('should trigger BeforeTool hook when subagent executes a tool', async () => {
      // Create a mock HookSystem that tracks when BeforeTool is triggered
      const mockHookSystem = {
        initialize: vi.fn().mockResolvedValue(undefined),
        getEventHandler: vi.fn().mockReturnValue({
          fireBeforeToolEvent: vi.fn().mockResolvedValue({ decision: 'allow' }),
          fireAfterToolEvent: vi.fn().mockResolvedValue(undefined),
        }),
      };

      const { config, toolRegistry } = await createMockConfig({
        getTool: vi.fn().mockImplementation((name: string) => {
          if (name === 'read_file') {
            return {
              name: 'read_file',
              displayName: 'Read File',
              schema: {
                name: 'read_file',
                parameters: { type: 'object', properties: {} },
              },
              build: vi.fn(),
            };
          }
          return undefined;
        }),
      });

      // Override config methods to enable hooks
      vi.spyOn(config, 'getEnableHooks' as keyof Config).mockReturnValue(true);
      vi.spyOn(config, 'getHooks' as keyof Config).mockReturnValue({
        BeforeTool: [
          {
            hooks: [{ type: 'command', command: 'echo allow', timeout: 5000 }],
          },
        ],
      });
      vi.spyOn(config, 'getHookSystem' as keyof Config).mockReturnValue(
        mockHookSystem,
      );
      vi.spyOn(config, 'getWorkingDir' as keyof Config).mockReturnValue(
        '/tmp/test',
      );
      vi.spyOn(config, 'getTargetDir' as keyof Config).mockReturnValue(
        '/tmp/test',
      );

      const toolConfig: ToolConfig = { tools: ['read_file'] };

      // Turn 1: Model calls the read_file tool
      // Turn 2: Model stops
      mockSendMessageStream.mockImplementation(
        createMockStream([
          [
            {
              id: 'call_hook_test',
              name: 'read_file',
              args: { path: '/test.txt' },
            },
          ],
          'stop',
        ]),
      );

      // Mock the tool execution result
      vi.mocked(executeToolCall).mockResolvedValue({
        ...createCompletedToolCallResponse({
          callId: 'call_hook_test',
          responseParts: [{ text: 'file contents' }],
          resultDisplay: 'Read file successfully',
        }),
      });

      const runtimeBundle = createStatelessRuntimeBundle({
        toolRegistry,
        toolsView: {
          listToolNames: () => ['read_file'],
          getToolMetadata: () => ({
            name: 'read_file',
            description: 'Reads a file',
            parameterSchema: { type: 'object', properties: {} },
          }),
        },
      });
      const { overrides } = createRuntimeOverrides({
        runtimeBundle,
        toolRegistry,
      });

      const scope = await SubAgentScope.create(
        'hook-test-agent',
        config,
        { systemPrompt: 'Test hooks.' },
        defaultModelConfig,
        defaultRunConfig,
        toolConfig,
        undefined,
        overrides,
      );

      await scope.runNonInteractive(new ContextState());

      // Verify the tool was called
      expect(executeToolCall).toHaveBeenCalled();

      // Verify the config passed to executeToolCall has hook methods
      // The bug is that createSchedulerConfig() doesn't delegate these
      const [toolExecutorConfig] = vi.mocked(executeToolCall).mock.calls[0];

      // These assertions will FAIL until the bug is fixed:
      // createSchedulerConfig() must delegate hook methods to this.config
      expect(typeof toolExecutorConfig.getEnableHooks).toBe('function');
      expect(typeof toolExecutorConfig.getHooks).toBe('function');
      expect(typeof toolExecutorConfig.getHookSystem).toBe('function');
      expect(typeof toolExecutorConfig.getWorkingDir).toBe('function');
      expect(typeof toolExecutorConfig.getTargetDir).toBe('function');

      // When hook methods are properly delegated, they should return the parent config values
      expect(toolExecutorConfig.getEnableHooks?.()).toBe(true);
      expect(toolExecutorConfig.getHookSystem?.()).toBe(mockHookSystem);
    });
  });
});
