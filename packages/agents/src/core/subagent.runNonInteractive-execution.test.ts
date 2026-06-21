/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SubAgentScope runNonInteractive: execution and tool use.
 */

import type { Mock } from 'vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SubAgentScope } from './subagent.js';
import {
  ContextState,
  SubagentTerminateMode,
  type PromptConfig,
  type OutputConfig,
  type ToolConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ChatSession } from './chatSession.js';
import {
  createContentGenerator,
  type ContentGenerator,
} from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import { executeToolCall } from './nonInteractiveToolExecutor.js';
import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';
import { ToolErrorType } from '@vybestack/llxprt-code-tools';
import type { Part } from '@google/genai';
import {
  createCompletedToolCallResponse,
  createMockConfig,
  createMockStream,
  defaultModelConfig,
  defaultRunConfig,
  createStatelessRuntimeBundle,
  createRuntimeOverrides,
} from './subagent-test-helpers.js';

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

describe('subagent.ts', () => {
  let mockSendMessageStream: Mock;

  describe('runNonInteractive - Execution and Tool Use', () => {
    const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

    beforeEach(async () => {
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

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should terminate with GOAL if no outputs are expected and model stops', async () => {
      const { config } = await createMockConfig();
      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

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

      await scope.runNonInteractive(new ContextState());

      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
      expect(scope.output.emitted_vars).toStrictEqual({});
      expect(scope.output.final_message).toMatch(
        /Completed the requested task/i,
      );
      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
      expect(mockSendMessageStream.mock.calls[0][0].message).toStrictEqual([
        {
          text: 'Follow the task directives provided in the system prompt.',
        },
      ]);
    });

    it('prompts the model to finish outstanding todos before completing', async () => {
      const { config } = await createMockConfig();

      mockSendMessageStream.mockImplementation(
        createMockStream(['stop', 'stop']),
      );

      mockReadTodos
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'todo-1',
            content: 'Complete the technical report',
            status: 'in_progress',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'todo-1',
            content: 'Complete the technical report',
            status: 'completed',
          },
        ]);

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

      await scope.runNonInteractive(new ContextState());

      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
      const firstCallMessage =
        mockSendMessageStream.mock.calls[0]?.[0]?.message;
      expect(firstCallMessage?.[0]?.text ?? '').toContain(
        'Follow the task directives provided in the system prompt.',
      );
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
    });

    it('should handle self_emitvalue and terminate with GOAL when outputs are met', async () => {
      const { config } = await createMockConfig();
      const outputConfig: OutputConfig = {
        outputs: { result: 'The final result' },
      };

      mockSendMessageStream.mockImplementation(
        createMockStream([
          [
            {
              name: 'self_emitvalue',
              args: {
                emit_variable_name: 'result',
                emit_variable_value: 'Success!',
              },
            },
          ],
          'stop',
        ]),
      );

      const { overrides: emitOverrides } = createRuntimeOverrides();
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        outputConfig,
        emitOverrides,
      );

      await scope.runNonInteractive(new ContextState());

      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
      expect(scope.output.emitted_vars).toStrictEqual({ result: 'Success!' });
      expect(scope.output.final_message).toContain('result=Success');
      expect(mockSendMessageStream).toHaveBeenCalledTimes(2);

      const secondCallArgs = mockSendMessageStream.mock.calls[1][0];
      expect(secondCallArgs.message).toHaveLength(1);
      expect(secondCallArgs.message[0]).toHaveProperty('functionResponse');
      expect(secondCallArgs.message[0].functionResponse.name).toBe(
        'self_emitvalue',
      );
      expect(secondCallArgs.message[0].functionResponse.response.message).toBe(
        'Emitted variable result successfully',
      );
    });

    it('should execute external tools and provide the response to the model', async () => {
      const listFilesToolDef: FunctionDeclaration = {
        name: 'list_files',
        description: 'Lists files',
        parameters: { type: Type.OBJECT, properties: {} },
      };

      const { config } = await createMockConfig({
        getFunctionDeclarationsFiltered: vi
          .fn()
          .mockReturnValue([listFilesToolDef]),
      });
      const toolConfig: ToolConfig = { tools: ['list_files'] };

      mockSendMessageStream.mockImplementation(
        createMockStream([
          [
            {
              id: 'call_1',
              name: 'list_files',
              args: { path: '.' },
            },
          ],
          'stop',
        ]),
      );

      vi.mocked(executeToolCall).mockResolvedValue({
        ...createCompletedToolCallResponse({
          callId: 'call_1',
          responseParts: [{ text: 'file1.txt\nfile2.ts' }],
          resultDisplay: 'Listed 2 files',
        }),
      });

      const runtimeBundle = createStatelessRuntimeBundle({
        toolRegistry: config.getToolRegistry(),
        toolsView: {
          listToolNames: () => ['list_files'],
          getToolMetadata: () => ({
            name: 'list_files',
            description: 'Lists files',
            parameterSchema: {
              type: 'object',
              properties: {
                path: { type: 'string' },
              },
            },
          }),
        },
      });
      const historyAddSpy = vi.spyOn(runtimeBundle.history, 'add');
      const { overrides } = createRuntimeOverrides({
        runtimeBundle,
        toolRegistry: config.getToolRegistry(),
      });

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

      await scope.runNonInteractive(new ContextState());

      const [toolExecutorConfig, toolRequest, abortSignal] =
        vi.mocked(executeToolCall).mock.calls[0];
      expect(toolRequest).toMatchObject({
        name: 'list_files',
        args: { path: '.' },
      });
      expect(abortSignal).toBeInstanceOf(AbortSignal);
      expect(typeof toolExecutorConfig.getToolRegistry).toBe('function');

      const secondCallArgs = mockSendMessageStream.mock.calls[1][0];
      expect(secondCallArgs.message).toStrictEqual([
        { text: 'file1.txt\nfile2.ts' },
      ]);

      expect(historyAddSpy).not.toHaveBeenCalled();
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
    });

    it('should provide specific tool error responses to the model', async () => {
      const { config } = await createMockConfig();
      const toolConfig: ToolConfig = { tools: ['failing_tool'] };

      mockSendMessageStream.mockImplementation(
        createMockStream([
          [
            {
              id: 'call_fail',
              name: 'failing_tool',
              args: {},
            },
          ],
          'stop',
        ]),
      );

      vi.mocked(executeToolCall).mockResolvedValue({
        ...createCompletedToolCallResponse({
          callId: 'call_fail',
          responseParts: [{ text: 'ERROR: Tool failed catastrophically' }],
          resultDisplay: 'Tool failed catastrophically',
          error: new Error('Failure'),
          errorType: ToolErrorType.INVALID_TOOL_PARAMS,
        }),
      });

      const runtimeBundle = createStatelessRuntimeBundle({
        toolRegistry: config.getToolRegistry(),
        toolsView: {
          listToolNames: () => ['failing_tool'],
          getToolMetadata: () => ({
            name: 'failing_tool',
            description: 'Fails',
            parameterSchema: { type: 'object', properties: {} },
          }),
        },
      });
      const { overrides } = createRuntimeOverrides({
        runtimeBundle,
        toolRegistry: config.getToolRegistry(),
      });

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

      await scope.runNonInteractive(new ContextState());

      const secondCallArgs = mockSendMessageStream.mock.calls[1][0];
      expect(secondCallArgs.message).toStrictEqual([
        {
          text: 'ERROR: Tool failed catastrophically',
        },
      ]);
    });

    it('should filter functionCall from error responseParts in non-interactive flow (Anthropic boundary)', async () => {
      const { config } = await createMockConfig();
      const toolConfig: ToolConfig = { tools: ['erroring_tool'] };

      mockSendMessageStream.mockImplementation(
        createMockStream([
          [
            {
              id: 'call_err',
              name: 'erroring_tool',
              args: {},
            },
          ],
          'stop',
        ]),
      );

      vi.mocked(executeToolCall).mockResolvedValue({
        ...createCompletedToolCallResponse({
          callId: 'call_err',
          responseParts: [
            {
              functionCall: {
                id: 'call_err',
                name: 'erroring_tool',
                args: {},
              },
            },
            {
              functionResponse: {
                id: 'call_err',
                name: 'erroring_tool',
                response: { error: 'Tool crashed' },
              },
            },
          ],
          resultDisplay: 'Tool crashed',
          error: new Error('Tool crashed'),
          errorType: ToolErrorType.UNHANDLED_EXCEPTION,
        }),
      });

      const runtimeBundle = createStatelessRuntimeBundle({
        toolRegistry: config.getToolRegistry(),
        toolsView: {
          listToolNames: () => ['erroring_tool'],
          getToolMetadata: () => ({
            name: 'erroring_tool',
            description: 'Tool that errors',
            parameterSchema: { type: 'object', properties: {} },
          }),
        },
      });
      const { overrides } = createRuntimeOverrides({
        runtimeBundle,
        toolRegistry: config.getToolRegistry(),
      });

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

      await scope.runNonInteractive(new ContextState());

      const secondCallArgs = mockSendMessageStream.mock.calls[1][0];
      for (const part of secondCallArgs.message) {
        expect(part).not.toHaveProperty('functionCall');
      }
      const hasFR = secondCallArgs.message.some(
        (p: Part) => 'functionResponse' in p,
      );
      expect(hasFR).toBe(true);
    });

    it('fails fast when a tool is disabled in the current profile', async () => {
      const listToolNames = () => ['write_file'];
      const getToolMetadata = () => ({
        name: 'write_file',
        description: 'Write files to disk',
        parameterSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
        },
      });

      const { config } = await createMockConfig({
        getFunctionDeclarationsFiltered: vi.fn().mockReturnValue([
          {
            name: 'write_file',
            description: 'Write files to disk',
            parameters: {
              type: Type.OBJECT,
              properties: {
                path: { type: Type.STRING },
                content: { type: Type.STRING },
              },
            },
          } as FunctionDeclaration,
        ]),
        getTool: vi.fn().mockReturnValue({}),
      });

      const runtimeBundle = createStatelessRuntimeBundle({
        toolRegistry: config.getToolRegistry(),
        toolsView: {
          listToolNames,
          getToolMetadata,
        },
      });
      const { overrides } = createRuntimeOverrides({
        runtimeBundle,
        toolRegistry: config.getToolRegistry(),
      });

      mockSendMessageStream.mockImplementation(
        createMockStream([
          [
            {
              id: 'call_write',
              name: 'write_file',
              args: {
                path: 'reports/joetest.md',
                content: 'hello',
              },
            },
          ],
          'stop',
        ]),
      );

      vi.mocked(executeToolCall).mockResolvedValue({
        ...createCompletedToolCallResponse({
          callId: 'call_write',
          responseParts: [
            {
              functionResponse: {
                id: 'call_write',
                name: 'write_file',
                response: {
                  error:
                    'Tool "write_file" is disabled in the current profile.',
                },
              },
            },
          ],
          resultDisplay:
            'Tool "write_file" is disabled in the current profile.',
          error: new Error(
            'Tool "write_file" is disabled in the current profile.',
          ),
          errorType: ToolErrorType.TOOL_DISABLED,
          agentId: 'test-agent',
        }),
      });

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        { tools: ['write_file'] },
        undefined,
        overrides,
      );

      await scope.runNonInteractive(new ContextState());
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
      expect(scope.output.final_message).toContain(
        'Tool "write_file" is not available',
      );
    });

    it('should nudge the model if it stops before emitting all required variables', async () => {
      const { config } = await createMockConfig();
      const outputConfig: OutputConfig = {
        outputs: { required_var: 'Must be present' },
      };

      mockSendMessageStream.mockImplementation(
        createMockStream([
          'stop',
          [
            {
              name: 'self_emitvalue',
              args: {
                emit_variable_name: 'required_var',
                emit_variable_value: 'Here it is',
              },
            },
          ],
          'stop',
        ]),
      );

      const { overrides: nudgeOverrides } = createRuntimeOverrides();
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        outputConfig,
        nudgeOverrides,
      );

      await scope.runNonInteractive(new ContextState());

      const secondCallArgs = mockSendMessageStream.mock.calls[1][0];
      expect(secondCallArgs.message[0].text).toContain('required_var');
      expect(secondCallArgs.message[0].text).toContain(
        'You have stopped calling tools',
      );

      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
      expect(scope.output.emitted_vars).toStrictEqual({
        required_var: 'Here it is',
      });
      expect(mockSendMessageStream).toHaveBeenCalledTimes(3);
    });
  });
});
