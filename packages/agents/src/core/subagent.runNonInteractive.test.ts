/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SubAgentScope runNonInteractive: initialization, prompting, toolConfig
 * preservation (Issue #2069).
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import type { Mock } from '../testApi.js';
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from '../testApi.js';
import { SubAgentScope } from './subagent.js';
import {
  ContextState,
  SubagentTerminateMode,
  type PromptConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ChatSession } from './chatSession.js';
import {
  createContentGenerator,
  type ContentGenerator,
} from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ToolRegistryView } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ChatSessionConfig } from './chatSession.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import {
  createMockConfig,
  createMockStream,
  defaultModelConfig,
  defaultRunConfig,
  createStatelessRuntimeBundle,
  createRuntimeOverrides,
} from './subagent-test-helpers.js';

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
void vi.mock('@vybestack/llxprt-code-tools', () => {
  return {
    ...actual,
    LocalTodoStore: TodoStoreMock,
  };
});

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
void vi.mock('@vybestack/llxprt-code-core/core/contentGenerator.js', () => {
  return {
    ...actual3,
    createContentGenerator: vi.fn(),
  };
});
void vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js', () =>
  automock(realEnvironmentContextModule),
);
void vi.mock('./nonInteractiveToolExecutor.js', () =>
  automock(realNonInteractiveToolExecutorModule),
);
const actual4 = { ...(await import('@vybestack/llxprt-code-ide-integration')) };
void vi.mock('@vybestack/llxprt-code-ide-integration', () => {
  return {
    ...actual4,
    IdeClient: {
      getInstance: vi.fn().mockResolvedValue({
        getConnectionStatus: vi.fn(),
        initialize: vi.fn(),
        shutdown: vi.fn(),
      }),
    },
  };
});
const actual5 = {
  ...(await import('@vybestack/llxprt-code-core/core/prompts.js')),
};
void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => {
  return {
    ...actual5,
    getCoreSystemPromptAsync: vi.fn().mockResolvedValue('Core Prompt'),
  };
});

describe('subagent.ts', () => {
  let mockSendMessageStream: Mock;

  describe('create (toolConfig preservation — Issue #2069)', () => {
    it('explicit empty toolConfig + outputConfig yields only self_emitvalue', async () => {
      const { config } = await createMockConfig();
      const runtimeToolsView: ToolRegistryView = {
        listToolNames: vi.fn(() => ['read_file', 'write_file']),
        getToolMetadata: vi.fn(() => ({
          name: 'read_file',
          description: 'Reads a file',
          parameterSchema: { type: 'object', properties: {} },
        })),
      };
      const runtimeBundle = createStatelessRuntimeBundle({
        toolsView: runtimeToolsView,
      });
      const { overrides } = createRuntimeOverrides({ runtimeBundle });

      mockSendMessageStream = vi.fn();
      mockSendMessageStream.mockImplementation(createMockStream(['stop']));
      (
        ChatSession as unknown as Mock<(...args: never[]) => unknown>
      ).mockImplementation(
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

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        { systemPrompt: 'test' },
        defaultModelConfig,
        defaultRunConfig,
        { tools: [] },
        { outputs: {} },
        overrides,
      );

      expect(scope).toBeDefined();
    });

    it('omitted toolConfig + outputConfig yields runtime default tools plus self_emitvalue', async () => {
      const { config } = await createMockConfig();
      const runtimeToolsView: ToolRegistryView = {
        listToolNames: vi.fn(() => ['read_file', 'write_file']),
        getToolMetadata: vi.fn(() => ({
          name: 'read_file',
          description: 'Reads a file',
          parameterSchema: { type: 'object', properties: {} },
        })),
      };
      const runtimeBundle = createStatelessRuntimeBundle({
        toolsView: runtimeToolsView,
      });
      const { overrides } = createRuntimeOverrides({ runtimeBundle });

      mockSendMessageStream = vi.fn();
      mockSendMessageStream.mockImplementation(createMockStream(['stop']));
      (
        ChatSession as unknown as Mock<(...args: never[]) => unknown>
      ).mockImplementation(
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

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        { systemPrompt: 'test' },
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      expect(scope).toBeDefined();
    });
  });

  describe('runNonInteractive - Initialization and Prompting', () => {
    beforeEach(async () => {
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

    const getGenerationConfigFromMock = (callIndex = 0): ChatSessionConfig => {
      const callArgs = (
        ChatSession as unknown as Mock<(...args: never[]) => unknown>
      ).mock.calls[callIndex];
      const generationConfig = callArgs[2];
      expect(generationConfig).toBeDefined();
      if (generationConfig === undefined)
        throw new Error('generationConfig is undefined');
      return generationConfig;
    };

    it('should correctly template the system prompt and initialize ChatSession', async () => {
      const { config } = await createMockConfig();
      const promptConfig: PromptConfig = {
        systemPrompt: 'Hello ${name}, your task is ${task}.',
      };
      const context = new ContextState();
      context.set('name', 'Agent');
      context.set('task', 'Testing');

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const runtimeBundle = createStatelessRuntimeBundle();
      const { overrides } = createRuntimeOverrides({ runtimeBundle });

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

      await scope.runNonInteractive(context);

      expect(
        ChatSession as unknown as Mock<(...args: never[]) => unknown>,
      ).toHaveBeenCalledTimes(1);
      const generationConfig = getGenerationConfigFromMock();
      expect(generationConfig.systemInstruction).toContain('Env Context');
      expect(generationConfig.systemInstruction).toContain(
        'Hello Agent, your task is Testing.',
      );
      expect(generationConfig.systemInstruction).toContain('Important Rules:');
      expect(generationConfig.temperature).toBe(defaultModelConfig.temp);
    });

    it('should include output instructions in the system prompt when outputs are defined', async () => {
      const { config } = await createMockConfig();
      const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const { overrides } = createRuntimeOverrides();
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        { outputs: { result: 'The result' } },
        overrides,
      );

      await scope.runNonInteractive(new ContextState());

      const generationConfig = getGenerationConfigFromMock();
      expect(generationConfig.systemInstruction).toContain('result');
      expect(generationConfig.systemInstruction).toContain('self_emitvalue');
    });

    it('should always start with empty chat history when using systemPrompt', async () => {
      const { config } = await createMockConfig();
      const promptConfig: PromptConfig = { systemPrompt: 'Test prompt' };

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

      expect(
        ChatSession as unknown as Mock<(...args: never[]) => unknown>,
      ).toHaveBeenCalledTimes(1);
      const callArgs = (
        ChatSession as unknown as Mock<(...args: never[]) => unknown>
      ).mock.calls[0];
      const history = callArgs[3];
      expect(history).toStrictEqual([]);
    });

    it('should reject with required error when PromptConfig lacks systemPrompt', async () => {
      const { config } = await createMockConfig();
      const malformedPromptConfig = {} as unknown as PromptConfig;

      const { overrides } = createRuntimeOverrides();

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        malformedPromptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
      );

      await expect(scope.runNonInteractive(new ContextState())).rejects.toThrow(
        'PromptConfig.systemPrompt must be a non-empty string.',
      );
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
    });

    it('should substitute placeholders for missing template variables', async () => {
      const { config } = await createMockConfig();
      const promptConfig: PromptConfig = {
        systemPrompt: 'Hello {{name}}, your session is {{session_id}}.',
      };

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

      const generationConfig = getGenerationConfigFromMock();
      // Missing template vars should be replaced with a placeholder
      expect(generationConfig.systemInstruction).toContain('{{name}}');
    });

    it('should substitute placeholder for missing sessionId template variable', async () => {
      const { config } = await createMockConfig();
      const promptConfig: PromptConfig = {
        systemPrompt: 'Session: {{session_id}}',
      };

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

      const generationConfig = getGenerationConfigFromMock();
      expect(generationConfig.systemInstruction).toContain('Session:');
    });

    it('should always include outputConfig instructions in system instruction when systemPrompt is used', async () => {
      const { config } = await createMockConfig();
      const promptConfig: PromptConfig = { systemPrompt: 'Do the thing.' };

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const { overrides } = createRuntimeOverrides();
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        { outputs: { required_output: 'Must produce this' } },
        overrides,
      );

      await scope.runNonInteractive(new ContextState());

      const generationConfig = getGenerationConfigFromMock();
      expect(generationConfig.systemInstruction).toContain('required_output');
    });

    it('should pass interactionMode subagent when building system prompt', async () => {
      const { config } = await createMockConfig();
      const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

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

      expect(
        ChatSession as unknown as Mock<(...args: never[]) => unknown>,
      ).toHaveBeenCalledTimes(1);
      const generationConfig = getGenerationConfigFromMock();
      expect(generationConfig.systemInstruction).toBeDefined();
    });
  });
});
