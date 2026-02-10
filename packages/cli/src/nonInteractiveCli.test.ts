/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  executeToolCall,
  ToolRegistry,
  ToolErrorType,
  shutdownTelemetry,
  GeminiEventType,
  ServerGeminiStreamEvent,
  OutputFormat,
  type IContent,
} from '@vybestack/llxprt-code-core';
import { Part } from '@google/genai';
import { runNonInteractive } from './nonInteractiveCli.js';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { LoadedSettings } from './config/settings.js';

// Mock core modules
vi.mock('./ui/hooks/atCommandProcessor.js');
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...original,
    executeToolCall: vi.fn(),
    shutdownTelemetry: vi.fn(),
    isTelemetrySdkInitialized: vi.fn().mockReturnValue(true),
  };
});

const mockGetCommands = vi.hoisted(() => vi.fn());
const mockCommandServiceCreate = vi.hoisted(() => vi.fn());
vi.mock('./services/CommandService.js', () => ({
  CommandService: {
    create: mockCommandServiceCreate,
  },
}));

function createCompletedToolCallResponse(params: {
  callId: string;
  responseParts?: Part[];
  resultDisplay?: unknown;
  error?: Error;
  errorType?: ToolErrorType;
  agentId?: string;
}) {
  return {
    status: params.error ? ('error' as const) : ('success' as const),
    request: {
      callId: params.callId,
      name: 'mock_tool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'mock-prompt',
      agentId: params.agentId ?? 'primary',
    },
    response: {
      callId: params.callId,
      responseParts: params.responseParts ?? [],
      resultDisplay: params.resultDisplay,
      error: params.error,
      errorType: params.errorType,
      agentId: params.agentId ?? 'primary',
    },
  };
}

describe('runNonInteractive', () => {
  let mockConfig: Config;
  let mockSettings: LoadedSettings;
  let mockToolRegistry: ToolRegistry;
  let mockCoreExecuteToolCall: vi.Mock;
  let mockShutdownTelemetry: vi.Mock;
  let consoleErrorSpy: vi.SpyInstance;
  let processStdoutSpy: vi.SpyInstance;
  let mockGeminiClient: {
    sendMessageStream: vi.Mock;
  };
  let processStderrSpy: vi.SpyInstance;

  beforeEach(async () => {
    mockCoreExecuteToolCall = vi.mocked(executeToolCall);
    mockShutdownTelemetry = vi.mocked(shutdownTelemetry);

    mockCommandServiceCreate.mockResolvedValue({
      getCommands: mockGetCommands,
    });
    mockGetCommands.mockReturnValue([]);

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processStdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    processStderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    mockToolRegistry = {
      getTool: vi.fn(),
      getFunctionDeclarations: vi.fn().mockReturnValue([]),
    } as unknown as ToolRegistry;

    mockGeminiClient = {
      sendMessageStream: vi.fn(),
    };

    mockConfig = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getGeminiClient: vi.fn().mockReturnValue(mockGeminiClient),
      getToolRegistry: vi.fn().mockReturnValue(mockToolRegistry),
      getMaxSessionTurns: vi.fn().mockReturnValue(10),
      getIdeMode: vi.fn().mockReturnValue(false),

      getContentGeneratorConfig: vi.fn().mockReturnValue({}),
      getDebugMode: vi.fn().mockReturnValue(false),
      getProviderManager: vi.fn().mockReturnValue(undefined),
      getOutputFormat: vi.fn().mockReturnValue('text'),
      getFolderTrust: vi.fn().mockReturnValue(false),
      isTrustedFolder: vi.fn().mockReturnValue(false),
      getProjectRoot: vi.fn().mockReturnValue('/tmp/test-project'),
      getSessionId: vi.fn().mockReturnValue('test-session'),
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
      getSettingsService: vi
        .fn()
        .mockReturnValue({ get: vi.fn(), set: vi.fn() }),
      storage: {
        getDir: vi.fn().mockReturnValue('/tmp/.llxprt'),
      },
    } as unknown as Config;

    mockSettings = {
      system: { path: '', settings: {} },
      systemDefaults: { path: '', settings: {} },
      user: { path: '', settings: {} },
      workspace: { path: '', settings: {} },
      errors: [],
      setValue: vi.fn(),
      merged: {
        security: {
          auth: {
            enforcedType: undefined,
          },
        },
      },
      isTrusted: true,
      migratedInMemorScopes: new Set(),
      forScope: vi.fn(),
      computeMergedSettings: vi.fn(),
    } as unknown as LoadedSettings;

    const { handleAtCommand } = await import(
      './ui/hooks/atCommandProcessor.js'
    );
    vi.mocked(handleAtCommand).mockImplementation(async ({ query }) => ({
      processedQuery: [{ text: query }],
      shouldProceed: true,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function* createStreamFromEvents(
    events: ServerGeminiStreamEvent[],
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    for (const event of events) {
      yield event;
    }
  }

  it('should process input and write text output', async () => {
    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Hello' },
      { type: GeminiEventType.Content, value: ' World' },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-1',
    });

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: 'Test input' }],
      expect.any(AbortSignal),
      'prompt-id-1',
    );
    const meaningfulWrites = processStdoutSpy.mock.calls
      .map(([value]) => value)
      .filter((value) => value !== '');

    // Content may be buffered/processed, check total output
    expect(meaningfulWrites.join('')).toBe('Hello World\n');
    expect(mockShutdownTelemetry).toHaveBeenCalled();
  });

  it('should coalesce thought output before content', async () => {
    mockConfig.getEphemeralSetting = vi
      .fn<(key: string) => boolean | undefined>()
      .mockReturnValue(true);

    const events: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Thought,
        value: { subject: 'First', description: '' },
      },
      {
        type: GeminiEventType.Thought,
        value: { subject: 'Second', description: '' },
      },
      { type: GeminiEventType.Content, value: 'Content' },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-thought',
    });

    const writes = processStdoutSpy.mock.calls.map(([value]) => value);
    const output = writes.join('');
    expect(output).toContain('<think>First Second</think>');
  });

  it('should stream provider responses via provider manager', async () => {
    const providerStream: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Hello' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: ' World' }] },
    ];
    const provider = {
      name: 'openai',
      generateChatCompletion: vi.fn(async function* () {
        for (const chunk of providerStream) {
          yield chunk;
        }
      }),
    };
    const providerManager = {
      getActiveProvider: vi.fn().mockReturnValue(provider),
    };
    (mockConfig.getToolRegistry as unknown as vi.Mock).mockReturnValue({
      getFunctionDeclarations: vi.fn().mockReturnValue([]),
    });
    (mockConfig.getProviderManager as unknown as vi.Mock).mockReturnValue(
      providerManager,
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Provider input',
      prompt_id: 'prompt-id-provider-stream',
    });

    expect(provider.generateChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.arrayContaining([
          expect.objectContaining({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Provider input' }],
          }),
        ]),
        config: mockConfig,
      }),
    );
    expect(mockGeminiClient.sendMessageStream).not.toHaveBeenCalled();
    const meaningfulWrites = processStdoutSpy.mock.calls
      .map(([value]) => value)
      .filter((value) => value !== '');
    expect(meaningfulWrites.join('')).toBe('Hello World\n');
  });

  it('should coerce non-text parts before provider runs', async () => {
    const providerStream: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Done' }] },
    ];
    const provider = {
      name: 'openai',
      generateChatCompletion: vi.fn(async function* () {
        for (const chunk of providerStream) {
          yield chunk;
        }
      }),
    };
    const providerManager = {
      getActiveProvider: vi.fn().mockReturnValue(provider),
    };
    (mockConfig.getToolRegistry as unknown as vi.Mock).mockReturnValue({
      getFunctionDeclarations: vi.fn().mockReturnValue([]),
    });
    (mockConfig.getProviderManager as unknown as vi.Mock).mockReturnValue(
      providerManager,
    );

    const { handleAtCommand } = await import(
      './ui/hooks/atCommandProcessor.js'
    );
    vi.mocked(handleAtCommand).mockResolvedValue({
      processedQuery: [
        { inlineData: { mimeType: 'image/png', data: '' } },
        { text: 'Follow-up' },
      ],
      shouldProceed: true,
    });

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Provider input',
      prompt_id: 'prompt-id-provider-nontext',
    });

    expect(provider.generateChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.arrayContaining([
          expect.objectContaining({
            speaker: 'human',
            blocks: [{ type: 'text', text: '<image/png>' }],
          }),
          expect.objectContaining({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Follow-up' }],
          }),
        ]),
        config: mockConfig,
      }),
    );
  });

  it('should handle a single tool call and respond', async () => {
    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-1',
        name: 'testTool',
        args: { arg1: 'value1' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-2',
      },
    };
    const toolResponse: Part[] = [{ text: 'Tool response' }];
    mockCoreExecuteToolCall.mockResolvedValue(
      createCompletedToolCallResponse({
        callId: 'tool-1',
        responseParts: toolResponse,
      }),
    );

    const firstCallEvents: ServerGeminiStreamEvent[] = [toolCallEvent];
    const secondCallEvents: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Final answer' },
    ];

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents(firstCallEvents))
      .mockReturnValueOnce(createStreamFromEvents(secondCallEvents));

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Use a tool',
      prompt_id: 'prompt-id-2',
    });

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(2);
    expect(mockCoreExecuteToolCall).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({ name: 'testTool', agentId: 'primary' }),
      expect.any(AbortSignal),
    );
    expect(mockGeminiClient.sendMessageStream).toHaveBeenNthCalledWith(
      2,
      [{ text: 'Tool response' }],
      expect.any(AbortSignal),
      'prompt-id-2',
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('Final answer');
    expect(processStdoutSpy).toHaveBeenCalledWith('\n');
  });

  it('should execute tool calls when using a non-gemini provider', async () => {
    let providerCallCount = 0;
    const provider = {
      name: 'openai',
      generateChatCompletion: vi.fn(async function* () {
        if (providerCallCount === 0) {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'call-1',
                name: 'testTool',
                parameters: { arg: 'value' },
              },
            ],
          } as IContent;
          providerCallCount += 1;
          return;
        }
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'All done' }],
        } as IContent;
      }),
    };
    const providerManager = {
      getActiveProvider: vi.fn().mockReturnValue(provider),
    };
    (mockConfig.getProviderManager as unknown as vi.Mock).mockReturnValue(
      providerManager,
    );
    (mockConfig.getToolRegistry as unknown as vi.Mock).mockReturnValue({
      getFunctionDeclarations: vi.fn().mockReturnValue([{ name: 'testTool' }]),
    });

    mockCoreExecuteToolCall.mockResolvedValue({
      response: {
        callId: 'call-1',
        responseParts: [
          {
            functionResponse: {
              id: 'call-1',
              name: 'testTool',
              response: { output: 'tool result' },
            },
          },
        ],
        resultDisplay: undefined,
        error: undefined,
        errorType: undefined,
        agentId: 'primary',
      },
    });

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Use the non-gemini provider',
      prompt_id: 'prompt-provider',
    });

    expect(provider.generateChatCompletion).toHaveBeenCalled();
    expect(mockCoreExecuteToolCall).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({
        name: 'testTool',
        callId: 'call-1',
        agentId: 'primary',
      }),
      expect.any(AbortSignal),
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('All done');
    expect(processStdoutSpy).toHaveBeenCalledWith('\n');
  });

  it('should count provider tool calls toward max session turns', async () => {
    vi.mocked(mockConfig.getMaxSessionTurns).mockReturnValue(1);
    let providerCallCount = 0;
    const provider = {
      name: 'openai',
      generateChatCompletion: vi.fn(async function* () {
        if (providerCallCount === 0) {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'call-1',
                name: 'testTool',
                parameters: { arg: 'value' },
              },
            ],
          } as IContent;
          providerCallCount += 1;
          return;
        }
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'All done' }],
        } as IContent;
      }),
    };
    const providerManager = {
      getActiveProvider: vi.fn().mockReturnValue(provider),
    };
    (mockConfig.getProviderManager as unknown as vi.Mock).mockReturnValue(
      providerManager,
    );
    (mockConfig.getToolRegistry as unknown as vi.Mock).mockReturnValue({
      getFunctionDeclarations: vi.fn().mockReturnValue([{ name: 'testTool' }]),
    });

    mockCoreExecuteToolCall.mockResolvedValue({
      response: {
        callId: 'call-1',
        responseParts: [
          {
            functionResponse: {
              id: 'call-1',
              name: 'testTool',
              response: { output: 'tool result' },
            },
          },
        ],
        resultDisplay: undefined,
        error: undefined,
        errorType: undefined,
        agentId: 'primary',
      },
    });

    await expect(
      runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'Use the non-gemini provider',
        prompt_id: 'prompt-provider',
      }),
    ).rejects.toThrow(
      'Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
    );

    expect(provider.generateChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('should handle error during tool execution and should send error back to the model', async () => {
    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-1',
        name: 'errorTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-3',
      },
    };
    mockCoreExecuteToolCall.mockResolvedValue({
      response: {
        callId: 'tool-1',
        responseParts: [
          {
            functionResponse: {
              name: 'errorTool',
              response: {
                output: 'Error: Execution failed',
              },
            },
          },
        ],
        resultDisplay: 'Execution failed',
        error: new Error('Execution failed'),
        errorType: ToolErrorType.EXECUTION_FAILED,
        agentId: 'primary',
      },
    });
    const finalResponse: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Content,
        value: 'Sorry, let me try again.',
      },
    ];
    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents([toolCallEvent]))
      .mockReturnValueOnce(createStreamFromEvents(finalResponse));

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Trigger tool error',
      prompt_id: 'prompt-id-3',
    });

    expect(mockCoreExecuteToolCall).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({ name: 'errorTool', agentId: 'primary' }),
      expect.any(AbortSignal),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error executing tool errorTool: Execution failed',
    );
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(2);
    expect(mockGeminiClient.sendMessageStream).toHaveBeenNthCalledWith(
      2,
      [
        {
          functionResponse: {
            name: 'errorTool',
            response: {
              output: 'Error: Execution failed',
            },
          },
        },
      ],
      expect.any(AbortSignal),
      'prompt-id-3',
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('Sorry, let me try again.');
  });

  it('should exit with error if sendMessageStream throws initially', async () => {
    const apiError = new Error('API connection failed');
    mockGeminiClient.sendMessageStream.mockImplementation(() => {
      throw apiError;
    });

    await expect(
      runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'Initial fail',
        prompt_id: 'prompt-id-4',
      }),
    ).rejects.toThrow(apiError);
  });

  it('should not exit if a tool is not found, and should send error back to model', async () => {
    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-1',
        name: 'nonexistentTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-5',
      },
    };
    mockCoreExecuteToolCall.mockResolvedValue({
      response: {
        callId: 'tool-1',
        responseParts: [],
        resultDisplay: 'Tool "nonexistentTool" not found in registry.',
        error: new Error('Tool "nonexistentTool" not found in registry.'),
        errorType: ToolErrorType.TOOL_NOT_REGISTERED,
        agentId: 'primary',
      },
    });
    const finalResponse: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Content,
        value: "Sorry, I can't find that tool.",
      },
    ];

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents([toolCallEvent]))
      .mockReturnValueOnce(createStreamFromEvents(finalResponse));

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Trigger tool not found',
      prompt_id: 'prompt-id-5',
    });

    expect(mockCoreExecuteToolCall).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({ name: 'nonexistentTool', agentId: 'primary' }),
      expect.any(AbortSignal),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error executing tool nonexistentTool: Tool "nonexistentTool" not found in registry.',
    );
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(2);
    expect(processStdoutSpy).toHaveBeenCalledWith(
      "Sorry, I can't find that tool.",
    );
  });

  it('should exit when max session turns are exceeded', async () => {
    vi.mocked(mockConfig.getMaxSessionTurns).mockReturnValue(0);
    await expect(
      runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'Trigger loop',
        prompt_id: 'prompt-id-6',
      }),
    ).rejects.toThrow(
      'Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
    );
  });

  it('should preprocess @include commands before sending to the model', async () => {
    // 1. Mock the imported atCommandProcessor
    const { handleAtCommand } = await import(
      './ui/hooks/atCommandProcessor.js'
    );
    const mockHandleAtCommand = vi.mocked(handleAtCommand);

    // 2. Define the raw input and the expected processed output
    const rawInput = 'Summarize @file.txt';
    const processedParts: Part[] = [
      { text: 'Summarize @file.txt' },
      { text: '\n--- Content from referenced files ---\n' },
      { text: 'This is the content of the file.' },
      { text: '\n--- End of content ---' },
    ];

    // 3. Setup the mock to return the processed parts
    mockHandleAtCommand.mockResolvedValue({
      processedQuery: processedParts,
      shouldProceed: true,
    });

    // Mock a simple stream response from the Gemini client
    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Summary complete.' },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    // 4. Run the non-interactive mode with the raw input
    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: rawInput,
      prompt_id: 'prompt-id-7',
    });

    // 5. Assert that sendMessageStream was called with the PROCESSED parts, not the raw input
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      processedParts,
      expect.any(AbortSignal),
      'prompt-id-7',
    );

    // 6. Assert the final output is correct
    expect(processStdoutSpy).toHaveBeenCalledWith('Summary complete.');
  });

  it('should execute a slash command that returns a prompt', async () => {
    const mockCommand = {
      name: 'testcommand',
      description: 'a test command',
      action: vi.fn().mockResolvedValue({
        type: 'submit_prompt',
        content: [{ text: 'Prompt from command' }],
      }),
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Response from command' },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: '/testcommand',
      prompt_id: 'prompt-id-slash',
    });

    // Ensure the prompt sent to the model is from the command, not the raw input
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: 'Prompt from command' }],
      expect.any(AbortSignal),
      'prompt-id-slash',
    );

    expect(processStdoutSpy).toHaveBeenCalledWith('Response from command');
  });

  it('should throw FatalInputError if a command requires confirmation', async () => {
    const mockCommand = {
      name: 'confirm',
      description: 'a command that needs confirmation',
      action: vi.fn().mockResolvedValue({
        type: 'confirm_shell_commands',
        commands: ['rm -rf /'],
      }),
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    await expect(
      runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: '/confirm',
        prompt_id: 'prompt-id-confirm',
      }),
    ).rejects.toThrow(
      'Exiting due to a confirmation prompt requested by the command.',
    );
  });

  it('should treat an unknown slash command as a regular prompt', async () => {
    // No commands are mocked, so any slash command is "unknown"
    mockGetCommands.mockReturnValue([]);

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Response to unknown' },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: '/unknowncommand',
      prompt_id: 'prompt-id-unknown',
    });

    // Ensure the raw input is sent to the model
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: '/unknowncommand' }],
      expect.any(AbortSignal),
      'prompt-id-unknown',
    );

    expect(processStdoutSpy).toHaveBeenCalledWith('Response to unknown');
  });

  it('should throw for unhandled command result types', async () => {
    const mockCommand = {
      name: 'noaction',
      description: 'unhandled type',
      action: vi.fn().mockResolvedValue({
        type: 'unhandled',
      }),
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    await expect(
      runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: '/noaction',
        prompt_id: 'prompt-id-unhandled',
      }),
    ).rejects.toThrow(
      'Exiting due to command result that is not supported in non-interactive mode.',
    );
  });

  it('should pass arguments to the slash command action', async () => {
    const mockAction = vi.fn().mockResolvedValue({
      type: 'submit_prompt',
      content: [{ text: 'Prompt from command' }],
    });
    const mockCommand = {
      name: 'testargs',
      description: 'a test command',
      action: mockAction,
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Acknowledged' },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: '/testargs arg1 arg2',
      prompt_id: 'prompt-id-args',
    });

    expect(mockAction).toHaveBeenCalledWith(expect.any(Object), 'arg1 arg2');

    expect(processStdoutSpy).toHaveBeenCalledWith('Acknowledged');
  });

  it('should allow a normally-excluded tool when --allowed-tools is set', async () => {
    // By default, ShellTool is excluded in non-interactive mode.
    // This test ensures that --allowed-tools overrides this exclusion.
    vi.mocked(mockConfig.getToolRegistry).mockReturnValue({
      getTool: vi.fn().mockReturnValue({
        name: 'ShellTool',
        description: 'A shell tool',
        run: vi.fn(),
      }),
      getFunctionDeclarations: vi.fn().mockReturnValue([{ name: 'ShellTool' }]),
    } as unknown as ToolRegistry);

    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-shell-1',
        name: 'ShellTool',
        args: { command: 'ls' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-allowed',
      },
    };
    const toolResponse: Part[] = [{ text: 'file.txt' }];
    mockCoreExecuteToolCall.mockResolvedValue(
      createCompletedToolCallResponse({
        callId: 'tool-shell-1',
        responseParts: toolResponse,
      }),
    );

    const firstCallEvents: ServerGeminiStreamEvent[] = [toolCallEvent];
    const secondCallEvents: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'file.txt' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents(firstCallEvents))
      .mockReturnValueOnce(createStreamFromEvents(secondCallEvents));

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'List the files',
      prompt_id: 'prompt-id-allowed',
    });

    expect(mockCoreExecuteToolCall).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({ name: 'ShellTool' }),
      expect.any(AbortSignal),
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('file.txt');
  });

  // Skipped tests from issue922 branch - thought buffering tests for deduplication
  it.skip('should accumulate multiple Thought events and flush once on content boundary', async () => {
    const thoughtEvent1: ServerGeminiStreamEvent = {
      type: GeminiEventType.Thought,
      value: {
        subject: 'First',
        description: 'thought',
      },
    };
    const thoughtEvent2: ServerGeminiStreamEvent = {
      type: GeminiEventType.Thought,
      value: {
        subject: 'Second',
        description: 'thought',
      },
    };
    const contentEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.Content,
      value: 'Response text',
    };
    const finishedEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.Finished,
      value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
    };

    mockGeminiClient.sendMessageStream.mockReturnValueOnce(
      createStreamFromEvents([
        thoughtEvent1,
        thoughtEvent2,
        contentEvent,
        finishedEvent,
      ]),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'test query',
      prompt_id: 'test-prompt-id',
    });

    const thinkingOutputs = processStdoutSpy.mock.calls.filter(
      ([output]: [string]) => output.includes('<think>'),
    );

    expect(thinkingOutputs).toHaveLength(1);
    const thinkingText = thinkingOutputs[0][0];
    expect(thinkingText).toContain('First thought');
    expect(thinkingText).toContain('Second thought');
  });

  it.skip('should NOT emit pyramid-style repeated prefixes in non-interactive CLI', async () => {
    const thoughtEvent1: ServerGeminiStreamEvent = {
      type: GeminiEventType.Thought,
      value: {
        subject: 'Analyzing',
        description: '',
      },
    };
    const thoughtEvent2: ServerGeminiStreamEvent = {
      type: GeminiEventType.Thought,
      value: {
        subject: 'request',
        description: '',
      },
    };
    const contentEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.Content,
      value: 'Response',
    };
    const finishedEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.Finished,
      value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
    };

    mockGeminiClient.sendMessageStream.mockReturnValueOnce(
      createStreamFromEvents([
        thoughtEvent1,
        thoughtEvent2,
        contentEvent,
        finishedEvent,
      ]),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'test query',
      prompt_id: 'test-prompt-id',
    });

    const thinkingOutputs = processStdoutSpy.mock.calls.filter(
      ([output]: [string]) => output.includes('<think>'),
    );

    expect(thinkingOutputs).toHaveLength(1);
    const thinkingText = thinkingOutputs[0][0];
    const thoughtCount = (thinkingText.match(/Analyzing/g) || []).length;
    expect(thoughtCount).toBe(1);
  });

  // Tests from main branch
  it('should display a deprecation warning if hasDeprecatedPromptArg is true', async () => {
    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Final Answer' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-deprecated',
      hasDeprecatedPromptArg: true,
    });

    expect(processStderrSpy).toHaveBeenCalledWith(
      'The --prompt (-p) flag has been deprecated and will be removed in a future version. Please use a positional argument for your prompt. See gemini --help for more information.\n',
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('Final Answer');
  });

  it('should display a deprecation warning for JSON format', async () => {
    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Final Answer' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );
    vi.mocked(mockConfig.getOutputFormat).mockReturnValue(OutputFormat.JSON);

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-deprecated-json',
      hasDeprecatedPromptArg: true,
    });

    const deprecateText =
      'The --prompt (-p) flag has been deprecated and will be removed in a future version. Please use a positional argument for your prompt. See gemini --help for more information.\n';
    expect(processStderrSpy).toHaveBeenCalledWith(deprecateText);
  });

  it('should filter emojis from thinking blocks in auto mode', async () => {
    const mockGetEphemeralSetting = vi.fn((key: string) => {
      if (key === 'emojifilter') return 'auto';
      if (key === 'reasoning.includeInResponse') return true;
      return undefined;
    });
    vi.mocked(mockConfig.getEphemeralSetting).mockImplementation(
      mockGetEphemeralSetting,
    );

    const events: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Thought,
        value: {
          subject: 'Planning \u{1F914} the approach',
          description: 'Let me think \u{1F4AD} carefully',
        },
      },
      { type: GeminiEventType.Content, value: 'Here is my answer' },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-emoji-think',
    });

    const thinkOutput = processStdoutSpy.mock.calls.find(([value]) =>
      value.includes('<think>'),
    );
    expect(thinkOutput).toBeDefined();
    const thinkText = thinkOutput?.[0] as string;
    expect(thinkText).not.toContain('\u{1F914}');
    expect(thinkText).not.toContain('\u{1F4AD}');
    expect(thinkText).toMatch(
      /Planning.*the approach.*Let me think.*carefully/,
    );
  });

  it('should suppress thinking blocks with emojis in error mode', async () => {
    const mockGetEphemeralSetting = vi.fn((key: string) => {
      if (key === 'emojifilter') return 'error';
      if (key === 'reasoning.includeInResponse') return true;
      return undefined;
    });
    vi.mocked(mockConfig.getEphemeralSetting).mockImplementation(
      mockGetEphemeralSetting,
    );

    const events: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Thought,
        value: {
          subject: 'Planning \u{1F914}',
          description: 'Think carefully \u{1F4AD}',
        },
      },
      { type: GeminiEventType.Content, value: 'Here is my answer' },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-emoji-error',
    });

    const thinkOutput = processStdoutSpy.mock.calls.find(([value]) =>
      value.includes('<think>'),
    );
    expect(thinkOutput).toBeUndefined();
  });

  it('should pass through thinking blocks when emojifilter is allowed', async () => {
    const mockGetEphemeralSetting = vi.fn((key: string) => {
      if (key === 'emojifilter') return 'allowed';
      if (key === 'reasoning.includeInResponse') return true;
      return undefined;
    });
    vi.mocked(mockConfig.getEphemeralSetting).mockImplementation(
      mockGetEphemeralSetting,
    );

    const events: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Thought,
        value: {
          subject: 'Planning \u{1F914}',
          description: 'Think carefully \u{1F4AD}',
        },
      },
      { type: GeminiEventType.Content, value: 'Here is my answer' },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-emoji-allowed',
    });

    const thinkOutput = processStdoutSpy.mock.calls.find(([value]) =>
      value.includes('<think>'),
    );
    expect(thinkOutput).toBeDefined();
    const thinkText = thinkOutput?.[0] as string;
    expect(thinkText).toContain('\u{1F914}');
    expect(thinkText).toContain('\u{1F4AD}');
  });
});
