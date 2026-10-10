import { createChatPolicyFixture } from './__tests__/session-policy-fixture.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ToolRegistryView } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';

/**
 * SubAgentScope create tests: toolConfig preservation, stateless runtime enforcement.
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import { vi, describe, it, expect, beforeEach, type Mock } from 'bun:test';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';

import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { SubAgentScope } from './subagent.js';
import {
  ContextState,
  type PromptConfig,
  type ToolConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import { executeToolCall } from './nonInteractiveToolExecutor.js';
import { ChatSession } from './chatSession.js';
import {
  createContentGenerator,
  type ContentGenerator,
} from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ChatSessionConfig } from './chatSession.js';
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
  createCompletedToolCallResponse,
  createMockConfig,
  createMockStream,
  defaultModelConfig,
  defaultRunConfig,
  createStatelessRuntimeBundle,
  createRuntimeOverrides,
} from './__tests__/subagent-test-helpers.js';

describe('subagent.ts', () => {
  let mockSendMessageStream: Mock<
    (
      ...args: Array<{
        config?: {
          tools?: Array<{
            functionDeclarations?: Array<{ description?: string }>;
          }>;
        };
      }>
    ) => unknown
  >;
  describe('create (Tool Validation)', () => {
    const promptConfig: PromptConfig = { systemPrompt: 'Test prompt' };

    it('should create a SubAgentScope successfully with minimal config', async () => {
      const { config, mcpRuntime } = await createMockConfig();
      const { overrides } = createRuntimeOverrides(
        mcpRuntime.workspaceFilesystem.paths,
      );
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
      expect(scope).toBeInstanceOf(SubAgentScope);
    });

    it('does not preflight tools even when they request confirmation', async () => {
      const mockTool = {
        schema: { parameters: { type: 'object', properties: {} } },
        build: vi.fn().mockReturnValue({
          shouldConfirmExecute: vi.fn().mockResolvedValue({
            type: 'exec',
            title: 'Confirm',
            command: 'rm -rf /',
          }),
        }),
      };

      const { config, mcpRuntime } = await createMockConfig({
        getTool: vi.fn().mockReturnValue(mockTool as never),
      });
      const runtimeBundle = createStatelessRuntimeBundle({
        toolRegistry: mcpRuntime.toolSelection,
        toolsView: {
          listToolNames: () => ['risky_tool'],
          getToolMetadata: () => ({
            name: 'risky_tool',
            description: 'Risky tool',
            parameterSchema: { type: 'object', properties: {} },
          }),
        },
      });
      const { overrides } = createRuntimeOverrides(
        mcpRuntime.workspaceFilesystem.paths,
        {
          runtimeBundle,
          toolRegistry: mcpRuntime.toolSelection,
        },
      );

      const toolConfig: ToolConfig = { tools: ['risky_tool'] };

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        toolConfig,
        undefined,
        overrides,
      );

      expect(scope).toBeInstanceOf(SubAgentScope);
      expect(mockTool.build).not.toHaveBeenCalled();
    });

    it('avoids eagerly building tools when confirmation is not required', async () => {
      const mockTool = {
        schema: { parameters: { type: 'object', properties: {} } },
        build: vi.fn().mockReturnValue({
          shouldConfirmExecute: vi.fn().mockResolvedValue(null),
        }),
      };
      const { config, mcpRuntime } = await createMockConfig({
        getTool: vi.fn().mockReturnValue(mockTool as never),
      });
      const runtimeBundle = createStatelessRuntimeBundle({
        toolRegistry: mcpRuntime.toolSelection,
        toolsView: {
          listToolNames: () => ['safe_tool'],
          getToolMetadata: () => ({
            name: 'safe_tool',
            description: 'Safe tool',
            parameterSchema: { type: 'object', properties: {} },
          }),
        },
      });
      const { overrides } = createRuntimeOverrides(
        mcpRuntime.workspaceFilesystem.paths,
        {
          runtimeBundle,
          toolRegistry: mcpRuntime.toolSelection,
        },
      );

      const toolConfig: ToolConfig = { tools: ['safe_tool'] };

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        toolConfig,
        undefined,
        overrides,
      );

      expect(scope).toBeInstanceOf(SubAgentScope);
      expect(mockTool.build).not.toHaveBeenCalled();
    });

    it('should skip interactivity check and warn for tools with required parameters', async () => {
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const mockToolWithParams = {
        schema: {
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
          },
        },
        // build should not be called, but we mock it to be safe
        build: vi.fn(),
      };

      const { config, mcpRuntime } = await createMockConfig({
        getTool: vi.fn().mockReturnValue(mockToolWithParams),
      });
      const runtimeBundle = createStatelessRuntimeBundle({
        toolRegistry: mcpRuntime.toolSelection,
        toolsView: {
          listToolNames: () => ['tool_with_params'],
          getToolMetadata: () => ({
            name: 'tool_with_params',
            description: 'Tool with params',
            parameterSchema: {
              type: 'object',
              properties: {
                path: { type: 'string' },
              },
            },
          }),
        },
      });
      const { overrides } = createRuntimeOverrides(
        mcpRuntime.workspaceFilesystem.paths,
        {
          runtimeBundle,
          toolRegistry: mcpRuntime.toolSelection,
        },
      );

      const toolConfig: ToolConfig = { tools: ['tool_with_params'] };

      // The creation should succeed without throwing
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        toolConfig,
        undefined,
        overrides,
      );

      expect(scope).toBeInstanceOf(SubAgentScope);

      // Ensure no warnings were emitted for parameterised tool checks
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      // Ensure build was never called
      expect(mockToolWithParams.build).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('stateless runtime enforcement', () => {
    const getGenerationConfigFromMock = (callIndex = 0): ChatSessionConfig => {
      const callArgs = (
        ChatSession as unknown as Mock<(...args: never[]) => unknown>
      ).mock.calls[callIndex];
      const generationConfig = callArgs[2] as ChatSessionConfig | undefined;
      expect(generationConfig).toBeDefined();
      if (generationConfig === undefined)
        throw new Error('generationConfig is undefined');
      return generationConfig;
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockReadTodos.mockReset();
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

    it('does not access foreground Config tool registry when runtime bundle provided', async () => {
      const { config, mcpRuntime } = await createMockConfig();
      const runtimeToolsView: ToolRegistryView = {
        listToolNames: vi.fn(() => ['stateless.tool']),
        getToolMetadata: vi.fn(() => ({
          name: 'stateless.tool',
          description: 'Runtime-only tool',
          parameterSchema: {
            type: 'object',
            properties: {},
          },
        })),
      };

      const runtimeBundle = createStatelessRuntimeBundle({
        toolsView: runtimeToolsView,
      });
      const { overrides } = createRuntimeOverrides(
        mcpRuntime.workspaceFilesystem.paths,
        { runtimeBundle },
      );

      vi.spyOn(mcpRuntime.toolSelection, 'getTool').mockImplementation(() => {
        throw new Error(
          'REGRESSION: foreground Config tool registry should not be used',
        );
      });

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const scope = await SubAgentScope.create(
        'stateless-agent',
        config,
        { systemPrompt: 'Runtime only' },
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      await scope.runNonInteractive(new ContextState());

      expect(runtimeToolsView.getToolMetadata).toHaveBeenCalledWith(
        'stateless.tool',
      );
    });

    it('builds tool declarations from runtime tool view metadata', async () => {
      const {
        messageParams,
        toolGroups,
        functionDeclarations,
        descriptionObservation,
      } = await observeBuildsToolDeclarationsFromRuntimeToolViewMetadata();
      expect(messageParams).toBeDefined();
      expect(toolGroups).toHaveLength(1);
      expect(functionDeclarations).toHaveLength(1);
      expect(descriptionObservation).toBe('Runtime metadata description');
    });

    const observeBuildsToolDeclarationsFromRuntimeToolViewMetadata =
      async () => {
        const { config, mcpRuntime } = await createMockConfig({
          getFunctionDeclarationsFiltered: vi.fn().mockReturnValue([
            {
              name: 'stateless.tool',
              description: 'Foreground registry description',
              parameters: { type: 'object', properties: {} },
            },
          ]),
        });

        const runtimeToolsView: ToolRegistryView = {
          listToolNames: vi.fn(() => ['stateless.tool']),
          getToolMetadata: vi.fn(() => ({
            name: 'stateless.tool',
            description: 'Runtime metadata description',
            parameterSchema: {
              type: 'object',
              properties: {
                sample: { type: 'string' },
              },
            },
          })),
        };

        const runtimeBundle = createStatelessRuntimeBundle({
          toolsView: runtimeToolsView,
        });

        mockSendMessageStream.mockImplementation(createMockStream(['stop']));

        const scope = await SubAgentScope.create(
          'stateless-agent',
          config,
          { systemPrompt: 'Use runtime tools' },
          defaultModelConfig,
          defaultRunConfig,
          undefined,
          undefined,
          createRuntimeOverrides(mcpRuntime.workspaceFilesystem.paths, {
            runtimeBundle,
          }).overrides,
        );

        await scope.runNonInteractive(new ContextState());

        const [messageParams] = mockSendMessageStream.mock.calls[0] ?? [];

        const toolGroups = messageParams.config?.tools ?? [];

        const functionDeclarations = toolGroups;

        const descriptionObservation = functionDeclarations[0]?.description;
        return {
          messageParams,
          toolGroups,
          functionDeclarations,
          descriptionObservation,
        };
      };

    it('prefers injected environment context loader over foreground Config', async () => {
      const { config, mcpRuntime } = await createMockConfig();

      (
        getEnvironmentContext as Mock<typeof getEnvironmentContext>
      ).mockImplementation(() => {
        throw new Error('REGRESSION: getEnvironmentContext should not be used');
      });

      const runtimeBundle = createStatelessRuntimeBundle();
      const environmentLoader = vi.fn(async (_runtime: AgentRuntimeContext) => [
        { text: 'Runtime Env Context' },
      ]);
      const { overrides } = createRuntimeOverrides(
        mcpRuntime.workspaceFilesystem.paths,
        {
          runtimeBundle,
          environmentLoader,
        },
      );

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const scope = await SubAgentScope.create(
        'stateless-agent',
        config,
        { systemPrompt: 'Stateless env' },
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      await scope.runNonInteractive(new ContextState());

      expect(environmentLoader).toHaveBeenCalledTimes(1);
      expect(environmentLoader).toHaveBeenCalledWith(
        runtimeBundle.runtimeContext,
      );

      const generationConfig = getGenerationConfigFromMock();
      expect(generationConfig.systemInstruction).toContain(
        'Runtime Env Context',
      );
    });

    it.each(['headless', 'interactive'])(
      'enforces the child tool whitelist through the %s scheduler owner',
      async (mode) => {
        const effects: string[] = [];
        const readTool = new MockTool({
          name: 'read_file',
          execute: async () => {
            effects.push('read');
            return {
              llmContent: 'read completed',
              returnDisplay: 'read completed',
            };
          },
        });
        const writeTool = new MockTool({
          name: 'write_file',
          execute: async () => {
            effects.push('write');
            return {
              llmContent: 'write completed',
              returnDisplay: 'write completed',
            };
          },
        });
        const { config, toolRegistry, mcpRuntime } = await createMockConfig({
          getTool: (name) =>
            [readTool, writeTool].find((tool) => tool.name === name),
          getEnabledTools: () => [readTool, writeTool],
          getAllTools: () => [readTool, writeTool],
        });
        mcpRuntime.policyOwner.session.confirmation.addRule({
          toolName: '*',
          decision: PolicyDecision.ALLOW,
          priority: 100,
        });
        const messageBus = mcpRuntime.messageBus;
        const completed: Array<Awaited<ReturnType<typeof executeToolCall>>> =
          [];
        toolExecutorMock.mockImplementation(async (...args) => {
          const result =
            await realNonInteractiveToolExecutorModule.executeToolCall(...args);
          completed.push(result);
          return result;
        });
        const runtimeBundle = createStatelessRuntimeBundle({
          toolRegistry,
          toolsView: {
            listToolNames: () => ['read_file', 'write_file'],
            getToolMetadata: (name) => ({
              name,
              description: name,
              parameterSchema: { type: 'object', properties: {} },
            }),
          },
        });
        mockSendMessageStream.mockImplementation(
          createMockStream([
            [{ id: 'read', name: 'read_file', args: {} }],
            [{ id: 'write', name: 'write_file', args: {} }],
            'stop',
          ]),
        );
        const scope = await SubAgentScope.create(
          'whitelisted-child',
          config,
          { systemPrompt: 'Only read.' },
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
          },
        );
        try {
          if (mode === 'interactive') {
            await scope.runInteractive(new ContextState());
          } else {
            await scope.runNonInteractive(new ContextState());
          }
          expect(effects).toStrictEqual(['read']);
          expect(scope.output.final_message).toContain('write_file');
          const expectedCompletions =
            mode === 'headless'
              ? [
                  ['read_file', 'success', undefined],
                  ['write_file', 'error', 'tool_disabled'],
                ]
              : [];
          expect(
            completed.map((call) => [
              call.request.name,
              call.status,
              call.response.errorType,
            ]),
          ).toStrictEqual(expectedCompletions);
        } finally {
          toolExecutorMock.mockReset();
        }
      },
    );

    it('never passes foreground Config into executeToolCall', async () => {
      const { config, mcpRuntime } = await createMockConfig();
      const runtimeBundle = createStatelessRuntimeBundle();
      const { overrides } = createRuntimeOverrides(
        mcpRuntime.workspaceFilesystem.paths,
        { runtimeBundle },
      );

      const scope = await SubAgentScope.create(
        'stateless-agent',
        config,
        { systemPrompt: 'Tool execution' },
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      mockSendMessageStream.mockImplementation(
        createMockStream([
          [{ id: 'call-1', name: 'externalTool', args: {} }],
          'stop',
        ]),
      );

      (executeToolCall as Mock<typeof executeToolCall>).mockResolvedValue({
        ...createCompletedToolCallResponse({
          callId: 'call-1',
          responseParts: [{ type: 'text', text: 'ok' }],
          resultDisplay: 'ok',
        }),
      } as unknown as Awaited<ReturnType<typeof executeToolCall>>);

      await scope.runNonInteractive(new ContextState());

      for (const call of (executeToolCall as Mock<typeof executeToolCall>).mock
        .calls) {
        expect(call[0]).not.toBe(config);
      }
    });
  });
});
