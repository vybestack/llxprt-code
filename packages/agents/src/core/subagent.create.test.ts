/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SubAgentScope create tests: toolConfig preservation, stateless runtime enforcement.
 */

import type { Mock } from 'vitest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
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
import type {
  Content,
  FunctionDeclaration,
  GenerateContentConfig,
} from '@google/genai';
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
  describe('create (Tool Validation)', () => {
    const promptConfig: PromptConfig = { systemPrompt: 'Test prompt' };

    it('should create a SubAgentScope successfully with minimal config', async () => {
      const { config } = await createMockConfig();
      const { overrides } = createRuntimeOverrides();
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
        schema: { parameters: { type: Type.OBJECT, properties: {} } },
        build: vi.fn().mockReturnValue({
          shouldConfirmExecute: vi.fn().mockResolvedValue({
            type: 'exec',
            title: 'Confirm',
            command: 'rm -rf /',
          }),
        }),
      };

      const { config } = await createMockConfig({
        getTool: vi.fn().mockReturnValue(mockTool as never),
      });
      const runtimeBundle = createStatelessRuntimeBundle({
        toolRegistry: config.getToolRegistry(),
        toolsView: {
          listToolNames: () => ['risky_tool'],
          getToolMetadata: () => ({
            name: 'risky_tool',
            description: 'Risky tool',
            parameterSchema: { type: Type.OBJECT, properties: {} },
          }),
        },
      });
      const { overrides } = createRuntimeOverrides({
        runtimeBundle,
        toolRegistry: config.getToolRegistry(),
      });

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
        schema: { parameters: { type: Type.OBJECT, properties: {} } },
        build: vi.fn().mockReturnValue({
          shouldConfirmExecute: vi.fn().mockResolvedValue(null),
        }),
      };
      const { config } = await createMockConfig({
        getTool: vi.fn().mockReturnValue(mockTool as never),
      });
      const runtimeBundle = createStatelessRuntimeBundle({
        toolRegistry: config.getToolRegistry(),
        toolsView: {
          listToolNames: () => ['safe_tool'],
          getToolMetadata: () => ({
            name: 'safe_tool',
            description: 'Safe tool',
            parameterSchema: { type: Type.OBJECT, properties: {} },
          }),
        },
      });
      const { overrides } = createRuntimeOverrides({
        runtimeBundle,
        toolRegistry: config.getToolRegistry(),
      });

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
            type: Type.OBJECT,
            properties: {
              path: { type: Type.STRING },
            },
            required: ['path'],
          },
        },
        // build should not be called, but we mock it to be safe
        build: vi.fn(),
      };

      const { config } = await createMockConfig({
        getTool: vi.fn().mockReturnValue(mockToolWithParams),
      });
      const runtimeBundle = createStatelessRuntimeBundle({
        toolRegistry: config.getToolRegistry(),
        toolsView: {
          listToolNames: () => ['tool_with_params'],
          getToolMetadata: () => ({
            name: 'tool_with_params',
            description: 'Tool with params',
            parameterSchema: {
              type: Type.OBJECT,
              properties: {
                path: { type: Type.STRING },
              },
            },
          }),
        },
      });
      const { overrides } = createRuntimeOverrides({
        runtimeBundle,
        toolRegistry: config.getToolRegistry(),
      });

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
    const getGenerationConfigFromMock = (
      callIndex = 0,
    ): GenerateContentConfig & { systemInstruction?: string | Content } => {
      const callArgs = vi.mocked(ChatSession).mock.calls[callIndex];
      const generationConfig = callArgs[2];
      expect(generationConfig).toBeDefined();
      if (!generationConfig) throw new Error('generationConfig is undefined');
      return generationConfig as GenerateContentConfig & {
        systemInstruction?: string | Content;
      };
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockReadTodos.mockReset();
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

    it('does not access foreground Config tool registry when runtime bundle provided', async () => {
      const { config } = await createMockConfig();
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
      const { overrides } = createRuntimeOverrides({ runtimeBundle });

      vi.spyOn(config, 'getToolRegistry').mockImplementation(() => {
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
        { tools: ['stateless.tool'] },
        undefined,
        overrides,
      );

      await scope.runNonInteractive(new ContextState());

      expect(runtimeToolsView.getToolMetadata).toHaveBeenCalledWith(
        'stateless.tool',
      );
    });

    it('builds tool declarations from runtime tool view metadata', async () => {
      const { config } = await createMockConfig({
        getFunctionDeclarationsFiltered: vi.fn().mockReturnValue([
          {
            name: 'stateless.tool',
            description: 'CONFIG description',
            parameters: {
              type: Type.OBJECT,
              properties: {},
            },
          } as FunctionDeclaration,
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
        { tools: ['stateless.tool'] },
        undefined,
        createRuntimeOverrides({ runtimeBundle }).overrides,
      );

      await scope.runNonInteractive(new ContextState());

      const [messageParams] = mockSendMessageStream.mock.calls[0] ?? [];
      expect(messageParams).toBeDefined();
      const toolGroups = messageParams?.config?.tools ?? [];
      expect(toolGroups).toHaveLength(1);
      const functionDeclarations = toolGroups[0]?.functionDeclarations ?? [];
      expect(functionDeclarations).toHaveLength(1);
      expect(functionDeclarations[0]?.description).toBe(
        'Runtime metadata description',
      );
    });

    it('prefers injected environment context loader over foreground Config', async () => {
      const { config } = await createMockConfig();

      vi.mocked(getEnvironmentContext).mockImplementation(() => {
        throw new Error('REGRESSION: getEnvironmentContext should not be used');
      });

      const runtimeBundle = createStatelessRuntimeBundle();
      const environmentLoader = vi.fn(async (_runtime: AgentRuntimeContext) => [
        { text: 'Runtime Env Context' },
      ]);
      const { overrides } = createRuntimeOverrides({
        runtimeBundle,
        environmentLoader,
      });

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

    it('propagates tool whitelist into tool executor ephemerals', async () => {
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
      const toolConfig: ToolConfig = { tools: ['read_file'] };

      mockSendMessageStream.mockImplementation(
        createMockStream([
          [
            {
              id: 'call1',
              name: 'read_file',
              args: { file_path: 'README.md' },
            },
          ],
          'stop',
        ]),
      );

      vi.mocked(executeToolCall).mockResolvedValue({
        ...createCompletedToolCallResponse({
          callId: 'call1',
          responseParts: [{ text: 'file content' }],
          resultDisplay: 'ok',
          agentId: 'subagent-1',
        }),
      } as Awaited<ReturnType<typeof executeToolCall>>);

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
        'stateless-agent',
        config,
        { systemPrompt: 'Tool whitelist' },
        defaultModelConfig,
        defaultRunConfig,
        toolConfig,
        undefined,
        overrides,
      );

      await scope.runNonInteractive(new ContextState());

      const [toolExecutorConfig] = vi.mocked(executeToolCall).mock.calls[0];
      const ephemerals = toolExecutorConfig.getEphemeralSettings();
      expect(ephemerals['tools.allowed']).toStrictEqual(['read_file']);
    });

    it('never passes foreground Config into executeToolCall', async () => {
      const { config } = await createMockConfig();
      const runtimeBundle = createStatelessRuntimeBundle();
      const { overrides } = createRuntimeOverrides({ runtimeBundle });

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

      vi.mocked(executeToolCall).mockResolvedValue({
        ...createCompletedToolCallResponse({
          callId: 'call-1',
          responseParts: [{ text: 'ok' }],
          resultDisplay: 'ok',
        }),
      } as unknown as Awaited<ReturnType<typeof executeToolCall>>);

      await scope.runNonInteractive(new ContextState());

      for (const call of vi.mocked(executeToolCall).mock.calls) {
        expect(call[0]).not.toBe(config);
      }
    });
  });
});
