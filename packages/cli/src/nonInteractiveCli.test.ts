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
      getFullContext: vi.fn().mockReturnValue(false),
      getContentGeneratorConfig: vi.fn().mockReturnValue({}),
      getDebugMode: vi.fn().mockReturnValue(false),
      getProviderManager: vi.fn().mockReturnValue(undefined),
      getOutputFormat: vi.fn().mockReturnValue('text'),
      getFolderTrust: vi.fn().mockReturnValue(false),
      isTrustedFolder: vi.fn().mockReturnValue(false),
      getProjectRoot: vi.fn().mockReturnValue('/tmp/test-project'),
      getSessionId: vi.fn().mockReturnValue('test-session'),
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

    const { handleAtCommand } =
      await import('./ui/hooks/atCommandProcessor.js');
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

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'Test input',
      'prompt-id-1',
    );

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

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'Use a tool',
      'prompt-id-2',
    );

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
    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'call-1',
        name: 'testTool',
        args: { arg: 'value' },
        isClientInitiated: false,
        prompt_id: 'prompt-provider',
      },
    };
    const finalResponse: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'All done' },
    ];

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents([toolCallEvent]))
      .mockReturnValueOnce(createStreamFromEvents(finalResponse));

    const providerManager = {
      getActiveProvider: vi.fn().mockReturnValue({ name: 'openai' }),
    };
    (mockConfig.getProviderManager as unknown as vi.Mock).mockReturnValue(
      providerManager,
    );

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

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'Use the non-gemini provider',
      'prompt-provider',
    );

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(2);
    expect(mockGeminiClient.sendMessageStream).toHaveBeenNthCalledWith(
      1,
      [{ text: 'Use the non-gemini provider' }],
      expect.any(AbortSignal),
      'prompt-provider',
    );
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

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'Trigger tool error',
      'prompt-id-3',
    );

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
      runNonInteractive(
        mockConfig,
        mockSettings,
        'Initial fail',
        'prompt-id-4',
      ),
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

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'Trigger tool not found',
      'prompt-id-5',
    );

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
      runNonInteractive(
        mockConfig,
        mockSettings,
        'Trigger loop',
        'prompt-id-6',
      ),
    ).rejects.toThrow(
      'Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
    );
  });

  it('should preprocess @include commands before sending to the model', async () => {
    // 1. Mock the imported atCommandProcessor
    const { handleAtCommand } =
      await import('./ui/hooks/atCommandProcessor.js');
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
    await runNonInteractive(mockConfig, mockSettings, rawInput, 'prompt-id-7');

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

    await runNonInteractive(
      mockConfig,
      mockSettings,
      '/testcommand',
      'prompt-id-slash',
    );

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
      runNonInteractive(
        mockConfig,
        mockSettings,
        '/confirm',
        'prompt-id-confirm',
      ),
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

    await runNonInteractive(
      mockConfig,
      mockSettings,
      '/unknowncommand',
      'prompt-id-unknown',
    );

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
      runNonInteractive(
        mockConfig,
        mockSettings,
        '/noaction',
        'prompt-id-unhandled',
      ),
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

    await runNonInteractive(
      mockConfig,
      mockSettings,
      '/testargs arg1 arg2',
      'prompt-id-args',
    );

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

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'List the files',
      'prompt-id-allowed',
    );

    expect(mockCoreExecuteToolCall).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({ name: 'ShellTool' }),
      expect.any(AbortSignal),
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('file.txt');
  });
});
