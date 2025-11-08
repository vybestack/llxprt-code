/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, Mock, afterEach } from 'vitest';
import {
  ContextState,
  SubAgentScope,
  SubagentTerminateMode,
  PromptConfig,
  ModelConfig,
  RunConfig,
  OutputConfig,
  ToolConfig,
  SubAgentRuntimeOverrides,
} from './subagent.js';
import { Config, ConfigParameters } from '../config/config.js';
import { GeminiChat, StreamEventType } from './geminiChat.js';
import {
  createContentGenerator,
  AuthType,
  type ContentGenerator,
} from './contentGenerator.js';
import { SettingsService } from '../settings/SettingsService.js';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import type {
  AgentRuntimeContext,
  AgentRuntimeProviderAdapter,
  AgentRuntimeTelemetryAdapter,
  ToolRegistryView,
} from '../runtime/AgentRuntimeContext.js';
import type { AgentRuntimeLoaderResult } from '../runtime/AgentRuntimeLoader.js';
import type { IProvider } from '../providers/IProvider.js';
import { getEnvironmentContext } from '../utils/environmentContext.js';
import { executeToolCall } from './nonInteractiveToolExecutor.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import {
  Content,
  FunctionCall,
  FunctionDeclaration,
  GenerateContentConfig,
  Type,
  GenerateContentResponse,
  Part,
} from '@google/genai';
import { ToolErrorType } from '../tools/tool-error.js';
import type { HistoryService } from '../services/history/HistoryService.js';
const { mockReadTodos, TodoStoreMock } = vi.hoisted(() => {
  const mockReadTodos = vi.fn().mockResolvedValue([]);
  const TodoStoreMock = vi
    .fn()
    .mockImplementation(() => ({ readTodos: mockReadTodos }));
  return { mockReadTodos, TodoStoreMock };
});

vi.mock('../tools/todo-store.js', () => ({
  TodoStore: TodoStoreMock,
}));

vi.mock('./geminiChat.js');
vi.mock('./contentGenerator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./contentGenerator.js')>();
  return {
    ...actual,
    createContentGenerator: vi.fn(),
  };
});
vi.mock('../utils/environmentContext.js');
vi.mock('./nonInteractiveToolExecutor.js');
vi.mock('../ide/ide-client.js');
vi.mock('./prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('Core Prompt'),
}));

async function createMockConfig(
  toolRegistryMocks = {},
): Promise<{ config: Config; toolRegistry: ToolRegistry }> {
  const settingsService = new SettingsService();
  setActiveProviderRuntimeContext(
    createProviderRuntimeContext({ settingsService }),
  );
  const configParams: ConfigParameters = {
    sessionId: 'test-session',
    model: DEFAULT_GEMINI_MODEL,
    targetDir: '.',
    debugMode: false,
    cwd: process.cwd(),
    settingsService,
  };
  const config = new Config(configParams);
  await config.initialize();
  await config.refreshAuth(AuthType.USE_PROVIDER);

  // Mock getContentGeneratorConfig to return a valid config
  vi.spyOn(config, 'getContentGeneratorConfig').mockReturnValue({
    model: DEFAULT_GEMINI_MODEL,
    authType: AuthType.USE_PROVIDER,
  });

  // Mock ToolRegistry
  const mockToolRegistry = {
    getTool: vi.fn(),
    getFunctionDeclarationsFiltered: vi.fn().mockReturnValue([]),
    ...toolRegistryMocks,
  } as unknown as ToolRegistry;

  vi.spyOn(config, 'getToolRegistry').mockReturnValue(mockToolRegistry);
  return { config, toolRegistry: mockToolRegistry };
}

// Helper to simulate LLM responses (sequence of tool calls over multiple turns)
const createMockStream = (
  functionCallsList: Array<FunctionCall[] | 'stop'>,
) => {
  let index = 0;
  // This mock now returns a Promise that resolves to the async generator,
  // matching the new signature for sendMessageStream.
  return vi.fn().mockImplementation(async () => {
    const response = functionCallsList[index] || 'stop';
    index++;

    return (async function* () {
      let mockResponseValue: Partial<GenerateContentResponse>;

      if (response === 'stop' || response.length === 0) {
        // Simulate a text response for stop/empty conditions.
        mockResponseValue = {
          candidates: [{ content: { parts: [{ text: 'Done.' }] } }],
        };
      } else {
        // Simulate a tool call response.
        mockResponseValue = {
          candidates: [], // Good practice to include for safety.
          functionCalls: response,
        };
      }

      // The stream must now yield a StreamEvent object of type CHUNK.
      yield {
        type: StreamEventType.CHUNK,
        value: mockResponseValue as GenerateContentResponse,
      };
    })();
  });
};

describe('subagent.ts', () => {
  describe('ContextState', () => {
    it('should set and get values correctly', () => {
      const context = new ContextState();
      context.set('key1', 'value1');
      context.set('key2', 123);
      expect(context.get('key1')).toBe('value1');
      expect(context.get('key2')).toBe(123);
      expect(context.get_keys()).toEqual(['key1', 'key2']);
    });

    it('should return undefined for missing keys', () => {
      const context = new ContextState();
      expect(context.get('missing')).toBeUndefined();
    });
  });

  describe('SubAgentScope', () => {
    let mockSendMessageStream: Mock;

    const defaultModelConfig: ModelConfig = {
      model: 'gemini-1.5-flash-latest',
      temp: 0.5, // Specific temp to test override
      top_p: 1,
    };

    const defaultRunConfig: RunConfig = {
      max_time_minutes: 5,
      max_turns: 10,
    };

    const createStatelessRuntimeBundle = (
      options: {
        toolsView?: ToolRegistryView;
        providerAdapter?: AgentRuntimeProviderAdapter;
        telemetryAdapter?: AgentRuntimeTelemetryAdapter;
        contentGenerator?: ContentGenerator;
        toolRegistry?: ToolRegistry;
      } = {},
    ): AgentRuntimeLoaderResult => {
      const toolsView =
        options.toolsView ??
        ({
          listToolNames: vi.fn(() => []),
          getToolMetadata: vi.fn(() => undefined),
        } as ToolRegistryView);

      const providerAdapter =
        options.providerAdapter ??
        ({
          getActiveProvider: vi.fn(
            () =>
              ({
                name: 'gemini',
                generateChatCompletion: vi.fn(async function* () {
                  yield { speaker: 'ai', blocks: [] };
                }),
                getDefaultModel: () => defaultModelConfig.model,
                getServerTools: () => [],
                invokeServerTool: vi.fn(),
              }) as IProvider,
          ),
          setActiveProvider: vi.fn(),
        } as AgentRuntimeProviderAdapter);

      const telemetryAdapter =
        options.telemetryAdapter ??
        ({
          logApiRequest: vi.fn(),
          logApiResponse: vi.fn(),
          logApiError: vi.fn(),
        } as AgentRuntimeTelemetryAdapter);

      const history = {
        clear: vi.fn(),
        add: vi.fn(),
        getCuratedForProvider: vi.fn(() => []),
        getIdGeneratorCallback: vi.fn(() => vi.fn()),
        findUnmatchedToolCalls: vi.fn(() => []),
      } as unknown as HistoryService;

      const toolRegistry =
        options.toolRegistry ??
        ({
          getTool: vi.fn(),
          getFunctionDeclarationsFiltered: vi.fn(() => []),
          getAllTools: vi.fn(() => []),
        } as unknown as ToolRegistry);

      const runtimeContext: AgentRuntimeContext = {
        state: {
          runtimeId: 'runtime-123',
          provider: 'gemini',
          model: defaultModelConfig.model,
          authType: AuthType.USE_PROVIDER,
          sessionId: 'runtime-session',
          authPayload: undefined,
          proxyUrl: undefined,
          modelParams: {
            temperature: defaultModelConfig.temp,
            topP: defaultModelConfig.top_p,
          },
        },
        history,
        ephemerals: {
          compressionThreshold: () => 0.8,
          contextLimit: () => 60_000,
          preserveThreshold: () => 0.2,
          toolFormatOverride: () => undefined,
        },
        telemetry: telemetryAdapter,
        provider: providerAdapter,
        tools: toolsView,
        providerRuntime: {
          runtimeId: 'runtime-123',
          metadata: {},
          settingsService: {
            get: vi.fn(),
            set: vi.fn(),
          },
        } as unknown as ProviderRuntimeContext,
      };

      const contentGenerator =
        options.contentGenerator ??
        ({
          generateContent: vi.fn(),
          generateContentStream: vi.fn(),
          countTokens: vi.fn(),
        } as unknown as ContentGenerator);

      return {
        runtimeContext,
        history,
        providerAdapter,
        telemetryAdapter,
        toolsView,
        contentGenerator,
        toolRegistry,
      };
    };

    type EnvironmentLoader = (runtime: AgentRuntimeContext) => Promise<Part[]>;

    const DEFAULT_ENV_CONTEXT: Part[] = [{ text: 'Env Context' }];

    const defaultEnvironmentLoader = (): EnvironmentLoader =>
      vi.fn(async () => DEFAULT_ENV_CONTEXT);

    const createRuntimeOverrides = (
      options: {
        runtimeBundle?: AgentRuntimeLoaderResult;
        environmentLoader?: EnvironmentLoader;
        toolRegistry?: ToolRegistry;
      } = {},
    ): {
      overrides: SubAgentRuntimeOverrides;
      runtimeBundle: AgentRuntimeLoaderResult;
      environmentLoader: EnvironmentLoader;
    } => {
      const runtimeBundle =
        options.runtimeBundle ??
        createStatelessRuntimeBundle({
          toolRegistry: options.toolRegistry,
        });

      const environmentLoader =
        options.environmentLoader ?? defaultEnvironmentLoader();

      const overrides: SubAgentRuntimeOverrides = {
        runtimeBundle,
        environmentContextLoader: environmentLoader,
      };

      if (options.toolRegistry) {
        overrides.toolRegistry = options.toolRegistry;
      }

      return { overrides, runtimeBundle, environmentLoader };
    };

    describe('Stateless compliance (STATELESS7)', () => {
      it('should not read provider manager directly from Config', async () => {
        const { config } = await createMockConfig();
        const promptConfig: PromptConfig = { systemPrompt: 'Stateless' };
        const getProviderManagerSpy = vi.spyOn(config, 'getProviderManager');

        const providerAdapter: AgentRuntimeProviderAdapter = {
          getActiveProvider: vi.fn(
            () =>
              ({
                name: 'gemini',
                generateChatCompletion: vi.fn(async function* () {
                  yield { speaker: 'ai', blocks: [] };
                }),
                getDefaultModel: () => defaultModelConfig.model,
                getServerTools: () => [],
                invokeServerTool: vi.fn(),
              }) as IProvider,
          ),
          setActiveProvider: vi.fn(),
        };

        const { overrides } = createRuntimeOverrides({
          runtimeBundle: createStatelessRuntimeBundle({
            providerAdapter,
          }),
        });

        await SubAgentScope.create(
          'stateless-agent',
          config,
          promptConfig,
          defaultModelConfig,
          defaultRunConfig,
          undefined,
          undefined,
          overrides,
        );

        expect(getProviderManagerSpy).not.toHaveBeenCalled();
      });
    });

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockSendMessageStream = vi.fn();
      // We mock the implementation of the constructor.
      vi.mocked(GeminiChat).mockImplementation(
        () =>
          ({
            sendMessageStream: mockSendMessageStream,
          }) as unknown as GeminiChat,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // Helper to safely access generationConfig from mock calls
    const getGenerationConfigFromMock = (
      callIndex = 0,
    ): GenerateContentConfig & { systemInstruction?: string | Content } => {
      const callArgs = vi.mocked(GeminiChat).mock.calls[callIndex];
      const generationConfig = callArgs?.[2];
      // Ensure it's defined before proceeding
      expect(generationConfig).toBeDefined();
      if (!generationConfig) throw new Error('generationConfig is undefined');
      return generationConfig as GenerateContentConfig & {
        systemInstruction?: string | Content;
      };
    };

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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getTool: vi.fn().mockReturnValue(mockTool as any),
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getTool: vi.fn().mockReturnValue(mockTool as any),
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
          throw new Error(
            'REGRESSION: getEnvironmentContext should not be used',
          );
        });

        const runtimeBundle = createStatelessRuntimeBundle();
        const environmentLoader = vi.fn(
          async (_runtime: AgentRuntimeContext) => [
            { text: 'Runtime Env Context' },
          ],
        );
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
          callId: 'call1',
          responseParts: [{ text: 'file content' }],
          resultDisplay: 'ok',
          agentId: 'subagent-1',
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
        const ephemerals =
          toolExecutorConfig.getEphemeralSettings?.() ??
          ({} as Record<string, unknown>);
        expect(ephemerals['tools.allowed']).toEqual(['read_file']);
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

        vi.mocked(executeToolCall).mockResolvedValue({
          callId: 'call-1',
          responseParts: [{ text: 'ok' }],
          resultDisplay: 'ok',
        } as unknown as Awaited<ReturnType<typeof executeToolCall>>);

        const fnCalls: FunctionCall[] = [
          {
            id: 'call-1',
            name: 'externalTool',
            args: {},
          } as FunctionCall,
        ];

        const processFunctionCalls = (
          scope as unknown as {
            processFunctionCalls: (
              calls: FunctionCall[],
              abortController: AbortController,
              promptId: string,
            ) => Promise<Content[]>;
          }
        ).processFunctionCalls;

        await processFunctionCalls.call(
          scope,
          fnCalls,
          new AbortController(),
          'prompt-1',
        );

        for (const call of vi.mocked(executeToolCall).mock.calls) {
          expect(call[0]).not.toBe(config);
        }
      });
    });

    describe('runNonInteractive - Initialization and Prompting', () => {
      it('should correctly template the system prompt and initialize GeminiChat', async () => {
        const { config } = await createMockConfig();

        vi.mocked(GeminiChat).mockClear();

        const promptConfig: PromptConfig = {
          systemPrompt: 'Hello ${name}, your task is ${task}.',
        };
        const context = new ContextState();
        context.set('name', 'Agent');
        context.set('task', 'Testing');

        // Model stops immediately
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

        // Check if GeminiChat was initialized correctly by the subagent
        expect(GeminiChat).toHaveBeenCalledTimes(1);
        const callArgs = vi.mocked(GeminiChat).mock.calls[0];

        // Check Generation Config
        const generationConfig = getGenerationConfigFromMock();

        // Check temperature override
        expect(generationConfig.temperature).toBe(defaultModelConfig.temp);
        // Environment context should be prepended to the system instruction
        expect(generationConfig.systemInstruction).toContain('Env Context');
        expect(generationConfig.systemInstruction).toContain(
          'Hello Agent, your task is Testing.',
        );
        expect(generationConfig.systemInstruction).toContain(
          'Important Rules:',
        );

        // Check History (should be empty since environment context is now in system instruction)
        const history = callArgs[3];
        expect(history).toEqual([]);
      });

      it('should include output instructions in the system prompt when outputs are defined', async () => {
        const { config } = await createMockConfig();
        vi.mocked(GeminiChat).mockClear();

        const promptConfig: PromptConfig = { systemPrompt: 'Do the task.' };
        const outputConfig: OutputConfig = {
          outputs: {
            result1: 'The first result',
          },
        };
        const context = new ContextState();

        // Model stops immediately
        mockSendMessageStream.mockImplementation(createMockStream(['stop']));

        const { overrides } = createRuntimeOverrides();
        const scope = await SubAgentScope.create(
          'test-agent',
          config,
          promptConfig,
          defaultModelConfig,
          defaultRunConfig,
          undefined, // ToolConfig
          outputConfig,
          overrides,
        );

        await scope.runNonInteractive(context);

        const generationConfig = getGenerationConfigFromMock();
        const systemInstruction = generationConfig.systemInstruction as string;

        expect(systemInstruction).toContain('Do the task.');
        expect(systemInstruction).toContain(
          'you MUST emit the required output variables',
        );
        expect(systemInstruction).toContain(
          "Use 'self_emitvalue' to emit the 'result1' key",
        );
      });

      it('should use initialMessages instead of systemPrompt if provided', async () => {
        const { config } = await createMockConfig();
        vi.mocked(GeminiChat).mockClear();

        const initialMessages: Content[] = [
          { role: 'user', parts: [{ text: 'Hi' }] },
        ];
        const promptConfig: PromptConfig = { initialMessages };
        const context = new ContextState();

        // Model stops immediately
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

        await scope.runNonInteractive(context);

        const callArgs = vi.mocked(GeminiChat).mock.calls[0];
        const generationConfig = getGenerationConfigFromMock();
        const history = callArgs[3];

        const systemInstruction = generationConfig.systemInstruction as string;
        // Environment context should now be in system instruction
        expect(systemInstruction).toContain('Env Context');
        // History should only contain initialMessages, not environment context
        expect(history).toEqual([...initialMessages]);
      });

      it('should throw an error if template variables are missing', async () => {
        const { config } = await createMockConfig();
        const promptConfig: PromptConfig = {
          systemPrompt: 'Hello ${name}, you are missing ${missing}.',
        };
        const context = new ContextState();
        context.set('name', 'Agent');
        // 'missing' is not set

        const { overrides: missingOverrides } = createRuntimeOverrides();
        const scope = await SubAgentScope.create(
          'test-agent',
          config,
          promptConfig,
          defaultModelConfig,
          defaultRunConfig,
          undefined,
          undefined,
          missingOverrides,
        );

        // The error from templating causes the runNonInteractive to reject and the terminate_reason to be ERROR.
        await expect(scope.runNonInteractive(context)).rejects.toThrow(
          'Missing context values for the following keys: missing',
        );
        expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
      });

      it('should validate that systemPrompt and initialMessages are mutually exclusive', async () => {
        const { config } = await createMockConfig();
        const promptConfig: PromptConfig = {
          systemPrompt: 'System',
          initialMessages: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        };
        const context = new ContextState();

        const { overrides } = createRuntimeOverrides();
        const agent = await SubAgentScope.create(
          'TestAgent',
          config,
          promptConfig,
          defaultModelConfig,
          defaultRunConfig,
          undefined,
          undefined,
          overrides,
        );

        await expect(agent.runNonInteractive(context)).rejects.toThrow(
          'PromptConfig cannot have both `systemPrompt` and `initialMessages` defined.',
        );
        expect(agent.output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
      });
    });

    describe('runNonInteractive - Execution and Tool Use', () => {
      const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

      it('should terminate with GOAL if no outputs are expected and model stops', async () => {
        const { config } = await createMockConfig();
        // Model stops immediately
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
          // No ToolConfig, No OutputConfig
        );

        await scope.runNonInteractive(new ContextState());

        expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
        expect(scope.output.emitted_vars).toEqual({});
        expect(scope.output.final_message).toMatch(
          /Completed the requested task/i,
        );
        expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
        // Check the initial message
        expect(mockSendMessageStream.mock.calls[0][0].message).toEqual([
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
          .mockResolvedValueOnce([]) // agent-scoped store (no todos)
          .mockResolvedValueOnce([
            {
              id: 'todo-1',
              content: 'Complete the technical report',
              status: 'in_progress',
              priority: 'high',
            },
          ])
          .mockResolvedValueOnce([]) // agent-scoped store on second pass
          .mockResolvedValueOnce([
            {
              id: 'todo-1',
              content: 'Complete the technical report',
              status: 'completed',
              priority: 'high',
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

        // Turn 1: Model responds with emitvalue call
        // Turn 2: Model stops after receiving the tool response
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
        expect(scope.output.emitted_vars).toEqual({ result: 'Success!' });
        expect(scope.output.final_message).toContain('result=Success');
        expect(mockSendMessageStream).toHaveBeenCalledTimes(2);

        // Check the tool response sent back in the second call
        const secondCallArgs = mockSendMessageStream.mock.calls[1][0];
        expect(secondCallArgs.message).toEqual([
          { text: 'Emitted variable result successfully' },
        ]);
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

        // Turn 1: Model calls the external tool
        // Turn 2: Model stops
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

        // Mock the tool execution result
        vi.mocked(executeToolCall).mockResolvedValue({
          callId: 'call_1',
          responseParts: [{ text: 'file1.txt\nfile2.ts' }],
          resultDisplay: 'Listed 2 files',
          error: undefined,
          errorType: undefined, // Or ToolErrorType.NONE if available and appropriate
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

        // Check tool execution
        const [toolExecutorConfig, toolRequest, abortSignal] =
          vi.mocked(executeToolCall).mock.calls[0];
        expect(toolRequest).toMatchObject({
          name: 'list_files',
          args: { path: '.' },
        });
        expect(abortSignal).toBeInstanceOf(AbortSignal);
        expect(typeof toolExecutorConfig.getToolRegistry).toBe('function');

        // Check the response sent back to the model
        const secondCallArgs = mockSendMessageStream.mock.calls[1][0];
        expect(secondCallArgs.message).toEqual([
          { text: 'file1.txt\nfile2.ts' },
        ]);

        expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
      });

      it('should provide specific tool error responses to the model', async () => {
        const { config } = await createMockConfig();
        const toolConfig: ToolConfig = { tools: ['failing_tool'] };

        // Turn 1: Model calls the failing tool
        // Turn 2: Model stops after receiving the error response
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

        // Mock the tool execution failure.
        vi.mocked(executeToolCall).mockResolvedValue({
          callId: 'call_fail',
          responseParts: [{ text: 'ERROR: Tool failed catastrophically' }], // This should be sent to the model
          resultDisplay: 'Tool failed catastrophically',
          error: new Error('Failure'),
          errorType: ToolErrorType.INVALID_TOOL_PARAMS,
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

        // The agent should send the specific error message from responseParts.
        const secondCallArgs = mockSendMessageStream.mock.calls[1][0];

        expect(secondCallArgs.message).toEqual([
          {
            text: 'ERROR: Tool failed catastrophically',
          },
        ]);
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
          callId: 'call_write',
          responseParts: [
            {
              functionCall: {
                id: 'call_write',
                name: 'write_file',
                args: {
                  path: 'reports/joetest.md',
                  content: 'hello',
                },
              },
            },
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

        // Turn 1: Model stops prematurely
        // Turn 2: Model responds to the nudge and emits the variable
        // Turn 3: Model stops
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

        // Check the nudge message sent in Turn 2
        const secondCallArgs = mockSendMessageStream.mock.calls[1][0];

        // We check that the message contains the required variable name and the nudge phrasing.
        expect(secondCallArgs.message[0].text).toContain('required_var');
        expect(secondCallArgs.message[0].text).toContain(
          'You have stopped calling tools',
        );

        expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
        expect(scope.output.emitted_vars).toEqual({
          required_var: 'Here it is',
        });
        expect(mockSendMessageStream).toHaveBeenCalledTimes(3);
      });
    });

    describe('runNonInteractive - Termination and Recovery', () => {
      const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

      it('should terminate with MAX_TURNS if the limit is reached', async () => {
        const { config } = await createMockConfig();
        const runConfig: RunConfig = { ...defaultRunConfig, max_turns: 2 };

        // Model keeps looping by calling emitvalue repeatedly
        mockSendMessageStream.mockImplementation(
          createMockStream([
            [
              {
                name: 'self_emitvalue',
                args: { emit_variable_name: 'loop', emit_variable_value: 'v1' },
              },
            ],
            [
              {
                name: 'self_emitvalue',
                args: { emit_variable_name: 'loop', emit_variable_value: 'v2' },
              },
            ],
            // This turn should not happen
            [
              {
                name: 'self_emitvalue',
                args: { emit_variable_name: 'loop', emit_variable_value: 'v3' },
              },
            ],
          ]),
        );

        const { overrides: maxTurnOverrides } = createRuntimeOverrides();
        const scope = await SubAgentScope.create(
          'test-agent',
          config,
          promptConfig,
          defaultModelConfig,
          runConfig,
          undefined,
          undefined,
          maxTurnOverrides,
        );

        await scope.runNonInteractive(new ContextState());

        expect(mockSendMessageStream).toHaveBeenCalledTimes(2);
        expect(scope.output.terminate_reason).toBe(
          SubagentTerminateMode.MAX_TURNS,
        );
      });

      it('should terminate with TIMEOUT if the time limit is reached during an LLM call', async () => {
        // Use fake timers to reliably test timeouts
        vi.useFakeTimers();

        const { config } = await createMockConfig();
        const runConfig: RunConfig = { max_time_minutes: 5, max_turns: 100 };

        // We need to control the resolution of the sendMessageStream promise to advance the timer during execution.
        let resolveStream: (
          value: AsyncGenerator<unknown, void, unknown>,
        ) => void;
        const streamPromise = new Promise<
          AsyncGenerator<unknown, void, unknown>
        >((resolve) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          resolveStream = resolve as any;
        });

        // The LLM call will hang until we resolve the promise.
        mockSendMessageStream.mockReturnValue(streamPromise);

        const { overrides: timeoutOverrides } = createRuntimeOverrides();
        const scope = await SubAgentScope.create(
          'test-agent',
          config,
          promptConfig,
          defaultModelConfig,
          runConfig,
          undefined,
          undefined,
          timeoutOverrides,
        );

        const runPromise = scope.runNonInteractive(new ContextState());

        // Advance time beyond the limit (6 minutes) while the agent is awaiting the LLM response.
        await vi.advanceTimersByTimeAsync(6 * 60 * 1000);

        // Now resolve the stream. The model returns 'stop'.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolveStream!(createMockStream(['stop'])() as any);

        await runPromise;

        expect(scope.output.terminate_reason).toBe(
          SubagentTerminateMode.TIMEOUT,
        );
        expect(mockSendMessageStream).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
      });

      it('should terminate with ERROR if the model call throws', async () => {
        const { config } = await createMockConfig();
        mockSendMessageStream.mockRejectedValue(new Error('API Failure'));

        const { overrides: errorOverrides } = createRuntimeOverrides();
        const scope = await SubAgentScope.create(
          'test-agent',
          config,
          promptConfig,
          defaultModelConfig,
          defaultRunConfig,
          undefined,
          undefined,
          errorOverrides,
        );

        await expect(
          scope.runNonInteractive(new ContextState()),
        ).rejects.toThrow('API Failure');
        expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
      });
    });
  });
});
