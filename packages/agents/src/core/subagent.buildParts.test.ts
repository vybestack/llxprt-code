/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import {
  fixtureHookDefinitions,
  fixtureHookRuntime,
} from '../../../core/src/hooks/__tests__/hook-runtime-fixture.js';
import { createChatPolicyFixture } from './__tests__/session-policy-fixture.js';
import type { CompletedToolCall } from './coreToolScheduler.js';
import type { ToolResultDisplay } from '@vybestack/llxprt-code-tools';
import { HookType } from '@vybestack/llxprt-code-core/hooks/types.js';

/**
 * SubAgentScope buildPartsFromCompletedCalls dedup, hook delegation to parent config.
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';

import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { SubAgentScope } from './subagent.js';
import {
  ContextState,
  type PromptConfig,
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
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
const realEnvironmentContextModule = {
  ...(await import('@vybestack/llxprt-code-core/utils/environmentContext.js')),
};
const realNonInteractiveToolExecutorModule = {
  ...(await import('./nonInteractiveToolExecutor.js')),
};

const { mockReadTodos, TodoStoreMock } = (() => {
  const mockReadTodos = vi.fn().mockResolvedValue([]);
  const TodoStoreMock = vi
    .fn()
    .mockImplementation(() => ({ readTodos: mockReadTodos }));
  return { mockReadTodos, TodoStoreMock };
})();

const actual = { ...(await import('@vybestack/llxprt-code-tools')) };
void vi.mock('@vybestack/llxprt-code-tools', () => ({
  ...actual,
  LocalTodoStore: TodoStoreMock,
}));

const __actual = { ...(await import('./chatSession.js')) };
void vi.mock('./chatSession.js', () => {
  const apply = (actual: typeof import('./chatSession.js')) => ({
    ...actual,
    ChatSession: vi.fn(),
  });
  const result = __actual as
    | typeof import('./chatSession.js')
    | Promise<typeof import('./chatSession.js')>;
  return result instanceof Promise ? result.then(apply) : apply(result);
});
const actual3 = {
  ...(await import('@vybestack/llxprt-code-core/core/contentGenerator.js')),
};
void vi.mock('@vybestack/llxprt-code-core/core/contentGenerator.js', () => ({
  ...actual3,
  createContentGenerator: vi.fn(),
}));
void vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js', () =>
  automock(realEnvironmentContextModule),
);
const toolExecutorMock = vi.fn(
  realNonInteractiveToolExecutorModule.executeToolCall,
);
void vi.mock('./nonInteractiveToolExecutor.js', () => ({
  ...realNonInteractiveToolExecutorModule,
  executeToolCall: toolExecutorMock,
}));
const actual4 = { ...(await import('@vybestack/llxprt-code-ide-integration')) };
void vi.mock('@vybestack/llxprt-code-ide-integration', () => ({
  ...actual4,
  IdeClient: {
    getInstance: vi.fn().mockResolvedValue({
      getConnectionStatus: vi.fn(),
      initialize: vi.fn(),
      shutdown: vi.fn(),
    }),
  },
}));
const actual5 = {
  ...(await import('@vybestack/llxprt-code-core/core/prompts.js')),
};
void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  ...actual5,
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('Core Prompt'),
}));

import {
  createMockConfig,
  createMockStream,
  defaultModelConfig,
  defaultRunConfig,
  createStatelessRuntimeBundle,
  createRuntimeOverrides,
} from './__tests__/subagent-test-helpers.js';

describe('subagent.ts', () => {
  let mockSendMessageStream: Mock<(...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadTodos.mockResolvedValue([]);
    TodoStoreMock.mockClear();

    (
      getEnvironmentContext as Mock<typeof getEnvironmentContext>
    ).mockResolvedValue([{ text: 'Env Context' }]);
    (
      createContentGenerator as Mock<typeof createContentGenerator>
    ).mockResolvedValue({
      getGenerativeModel: vi.fn(),
    } as unknown as ContentGenerator);

    mockSendMessageStream = vi.fn();
    (
      ChatSession as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementation(
      () =>
        ({
          ...createChatPolicyFixture(),
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
      const { config, mcpRuntime } = await createMockConfig();
      const runtimeBundle = createStatelessRuntimeBundle();
      const historyAddSpy = vi.spyOn(runtimeBundle.history, 'add');
      const { overrides } = createRuntimeOverrides(
        mcpRuntime.workspaceFilesystem.paths,
        { runtimeBundle },
      );
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
        schema: { parameters: { type: 'object', properties: {} } },
        build: vi.fn(),
      };

      // Simulate completed calls with a streaming tool
      const completedCalls = makePartsCalls([
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
            responseParts: [{ type: 'text', text: 'hello\n' }],
            resultDisplay: 'hello\n',
          },
          invocation: { execute: vi.fn() },
        },
      ]);

      buildPartsFromCompletedCalls(completedCalls, {
        onMessage: scope.onMessage,
        subagentId: scope.getAgentId(),
        logger: new DebugLogger('llxprt:subagent'),
      });

      // For tools with canUpdateOutput=true, onMessage should NOT be called
      // because the output was already streamed live
      expect(onMessageCalls).toHaveLength(0);
      expect(historyAddSpy).not.toHaveBeenCalled();
    });

    it('should call onMessage for tools with canUpdateOutput=false', async () => {
      const { config, mcpRuntime } = await createMockConfig();
      const { overrides } = createRuntimeOverrides(
        mcpRuntime.workspaceFilesystem.paths,
      );
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
        schema: { parameters: { type: 'object', properties: {} } },
        build: vi.fn(),
      };

      // Simulate completed calls with a non-streaming tool
      const completedCalls = makePartsCalls([
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
            responseParts: [{ type: 'text', text: 'file contents' }],
            resultDisplay: 'Read 100 bytes from /test.txt',
          },
          invocation: { execute: vi.fn() },
        },
      ]);

      buildPartsFromCompletedCalls(completedCalls, {
        onMessage: scope.onMessage,
        subagentId: scope.getAgentId(),
        logger: new DebugLogger('llxprt:subagent'),
      });

      // For tools with canUpdateOutput=false, onMessage SHOULD be called
      expect(onMessageCalls).toHaveLength(1);
      expect(onMessageCalls[0]).toBe('Read 100 bytes from /test.txt');
    });

    it('should call onMessage for error calls even if tool had canUpdateOutput=true', async () => {
      const { config, mcpRuntime } = await createMockConfig();
      const { overrides } = createRuntimeOverrides(
        mcpRuntime.workspaceFilesystem.paths,
      );
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
        schema: { parameters: { type: 'object', properties: {} } },
        build: vi.fn(),
      };

      // Simulate an errored call - errors should still display
      const completedCalls = makePartsCalls([
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
            responseParts: [{ type: 'text', text: 'Command failed' }],
            resultDisplay: 'Error: command not found',
            error: new Error('command not found'),
          },
        },
      ]);

      buildPartsFromCompletedCalls(completedCalls, {
        onMessage: scope.onMessage,
        subagentId: scope.getAgentId(),
        logger: new DebugLogger('llxprt:subagent'),
      });

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
      const responsePartShape =
        await observeProduceFunctionResponseOnlyPartsForErrorToolCallsAnthropicBoundary();
      expect(responsePartShape).toStrictEqual({
        hasToolResponse: true,
        toolCallParts: [],
      });
    });

    const observeProduceFunctionResponseOnlyPartsForErrorToolCallsAnthropicBoundary =
      async () => {
        const { config, mcpRuntime } = await createMockConfig();
        const { overrides } = createRuntimeOverrides(
          mcpRuntime.workspaceFilesystem.paths,
        );
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

        // Simulate error completed calls with tool_call in responseParts
        // (this is what coreToolScheduler's createErrorResponse produces)
        const completedCalls = makePartsCalls([
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
                  type: 'tool_call',
                  id: 'call-err',
                  name: 'failing_tool',
                  parameters: { path: '/test' },
                },
                {
                  type: 'tool_response',
                  callId: 'call-err',
                  toolName: 'failing_tool',
                  result: { error: 'Tool execution failed' },
                },
              ],
              resultDisplay: 'Tool execution failed',
              error: new Error('Tool execution failed'),
            },
          },
        ]);

        const parts = buildPartsFromCompletedCalls(completedCalls, {
          onMessage: scope.onMessage,
          subagentId: scope.getAgentId(),
          logger: new DebugLogger('llxprt:subagent'),
        });

        // CRITICAL: No part should be a tool_call - only tool_response
        // tool_call in user-role message causes Anthropic invalid_request_error
        const toolCallParts = parts.filter(
          (part) => 'type' in part && part.type === 'tool_call',
        );
        // Should still have a tool_response
        const hasToolResponse = parts.some(
          (p: ContentBlock) => 'type' in p && p.type === 'tool_response',
        );

        return { hasToolResponse, toolCallParts };
      };

    /**
     * @scenario Mixed success+error tool calls in same turn produce valid continuation
     * @given A batch with one successful tool and one errored tool
     * @when buildPartsFromCompletedCalls processes both
     * @then All resulting parts are functionResponse-only (no functionCall),
     *       and each tool_use from the model has exactly one matching tool_result
     */
    it('should produce valid paired parts for mixed success+error calls (Anthropic boundary)', async () => {
      const responsePartShape =
        await observeProduceValidPairedPartsForMixedSuccessErrorCallsAnthropicBoundary();
      expect({
        toolCallParts: responsePartShape.toolCallParts,
        toolResponseCount: responsePartShape.toolResponses.length,
      }).toStrictEqual({
        toolCallParts: [],
        toolResponseCount: 2,
      });
    });

    const observeProduceValidPairedPartsForMixedSuccessErrorCallsAnthropicBoundary =
      async () => {
        const { config, mcpRuntime } = await createMockConfig();
        const { overrides } = createRuntimeOverrides(
          mcpRuntime.workspaceFilesystem.paths,
        );
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

        const completedCalls = makePartsCalls([
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
                  type: 'tool_response',
                  callId: 'call-ok',
                  toolName: 'read_file',
                  result: { output: 'file contents' },
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
                  type: 'tool_call',
                  id: 'call-err',
                  name: 'write_file',
                  parameters: { path: '/out.txt', content: 'data' },
                },
                {
                  type: 'tool_response',
                  callId: 'call-err',
                  toolName: 'write_file',
                  result: { error: 'Permission denied' },
                },
              ],
              resultDisplay: 'Permission denied',
              error: new Error('Permission denied'),
            },
          },
        ]);

        const parts = buildPartsFromCompletedCalls(completedCalls, {
          onMessage: scope.onMessage,
          subagentId: scope.getAgentId(),
          logger: new DebugLogger('llxprt:subagent'),
        });

        // No part should be a tool_call
        const toolCallParts = parts.filter(
          (part) => 'type' in part && part.type === 'tool_call',
        );

        // Should have tool_response for both tool calls
        const toolResponses = parts.filter(
          (p: ContentBlock) => 'type' in p && p.type === 'tool_response',
        );

        return { toolResponses, toolCallParts };
      };

    it('should handle calls where tool is undefined gracefully', async () => {
      const { config, mcpRuntime } = await createMockConfig();
      const { overrides } = createRuntimeOverrides(
        mcpRuntime.workspaceFilesystem.paths,
      );
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
      const completedCalls = makePartsCalls([
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
            responseParts: [{ type: 'text', text: 'Tool not found' }],
            resultDisplay: 'Tool not found',
            error: new Error('Tool not found'),
          },
        },
      ]);

      // Should not throw
      const parts = buildPartsFromCompletedCalls(completedCalls, {
        onMessage: scope.onMessage,
        subagentId: scope.getAgentId(),
        logger: new DebugLogger('llxprt:subagent'),
      });

      // Should have produced parts
      expect(parts.length).toBeGreaterThan(0);

      // Should still display the error
      expect(onMessageCalls).toHaveLength(1);
      expect(onMessageCalls[0]).toBe('Tool not found');
    });
  });

  describe('Hook delegation to parent config', () => {
    it('should trigger BeforeTool hook when subagent executes a tool', async () => {
      const effects: string[] = [];
      const tool = new MockTool({
        name: 'read_file',
        execute: async () => {
          effects.push('executed');
          return {
            llmContent: 'unexpected execution',
            returnDisplay: 'unexpected execution',
          };
        },
      });
      const { config, toolRegistry, mcpRuntime } = await createMockConfig({
        getTool: (name) => (name === tool.name ? tool : undefined),
        getEnabledTools: () => [tool],
        getAllTools: () => [tool],
      });
      mcpRuntime.policyOwner.session.confirmation.addRule({
        toolName: '*',
        decision: PolicyDecision.ALLOW,
        priority: 100,
      });
      vi.spyOn(config, 'getEnableHooks').mockReturnValue(true);
      vi.spyOn(config, 'getHooks').mockReturnValue({
        BeforeTool: [
          {
            matcher: 'read_file',
            hooks: [
              {
                type: HookType.Command,
                command: 'echo child-hook-denied >&2; exit 2',
                timeout: 5000,
              },
            ],
          },
        ],
      });
      const messageBus = mcpRuntime.messageBus;
      const hooks = new SessionHookOwner(
        fixtureHookDefinitions(config),
        fixtureHookRuntime(config),
        true,
        messageBus,
      );
      const completed: Array<Awaited<ReturnType<typeof executeToolCall>>> = [];
      toolExecutorMock.mockImplementation(async (...args) => {
        const result =
          await realNonInteractiveToolExecutorModule.executeToolCall(...args);
        completed.push(result);
        return result;
      });
      const runtimeBundle = createStatelessRuntimeBundle({
        toolRegistry,
        toolsView: {
          listToolNames: () => ['read_file'],
          getToolMetadata: () => ({
            name: 'read_file',
            description: 'Reads',
            parameterSchema: { type: 'object', properties: {} },
          }),
        },
      });
      mockSendMessageStream.mockImplementation(
        createMockStream([
          [{ id: 'hooked-read', name: 'read_file', args: {} }],
          'stop',
        ]),
      );
      const scope = await SubAgentScope.create(
        'hook-child',
        config,
        { systemPrompt: 'Read.' },
        defaultModelConfig,
        defaultRunConfig,
        { tools: ['read_file'] },
        undefined,
        {
          ...createRuntimeOverrides(mcpRuntime.workspaceFilesystem.paths, {
            runtimeBundle,
            toolRegistry,
          }).overrides,
          messageBus,
          hookOwner: hooks.execution({
            sessionId: () => 'hook-child',
            transcriptPath: () => undefined,
          }),
        },
      );
      try {
        await scope.runNonInteractive(new ContextState());
        expect(completed).toHaveLength(1);
        expect(completed[0].status).toBe('error');
        expect(completed[0].response.error?.message).toContain(
          'child-hook-denied',
        );
        expect(effects).toStrictEqual([]);
      } finally {
        await hooks.dispose();
        toolExecutorMock.mockReset();
      }
    });
  });
});

function makePartsCalls(
  inputs: ReadonlyArray<{
    status: 'success' | 'error';
    request: { callId: string; name: string; args: Record<string, unknown> };
    tool?: {
      canUpdateOutput?: boolean;
      name?: string;
      displayName?: string;
      schema?: unknown;
      build?: unknown;
    };
    invocation?: unknown;
    response: {
      callId: string;
      responseParts: ContentBlock[];
      resultDisplay: ToolResultDisplay;
      error?: Error;
    };
  }>,
): CompletedToolCall[] {
  return inputs.map((input) => {
    const request = {
      ...input.request,
      isClientInitiated: false,
      prompt_id: 'parts-fixture',
    };
    const response = {
      ...input.response,
      errorType: undefined,
      error: input.response.error,
    };
    if (input.status === 'error') return { status: 'error', request, response };
    const tool = new MockTool({
      name: request.name,
      canUpdateOutput: input.tool?.canUpdateOutput,
    });
    return {
      status: 'success',
      request,
      response,
      tool,
      invocation: tool.build(request.args),
    };
  });
}
