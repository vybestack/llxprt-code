/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Config,
  ToolRegistry,
  ServerGeminiStreamEvent,
} from '@vybestack/llxprt-code-core';
import {
  executeToolCall,
  ToolErrorType,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  GeminiEventType,
  StreamIdleTimeoutError,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import type { Part } from '@google/genai';
import { runNonInteractive } from './nonInteractiveCli.js';

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { LoadedSettings } from './config/settings.js';
import {
  createCompletedToolCallResponse,
  createStreamFromEvents,
} from './nonInteractiveCli.test-helpers.js';

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
    delay: original.delay,
    nextStreamEventWithIdleTimeout: original.nextStreamEventWithIdleTimeout,
    StreamIdleTimeoutError: original.StreamIdleTimeoutError,
  };
});

const mockGetCommands = vi.hoisted(() => vi.fn());
const mockCommandServiceCreate = vi.hoisted(() => vi.fn());
vi.mock('./services/CommandService.js', () => ({
  CommandService: {
    create: mockCommandServiceCreate,
  },
}));

describe('runNonInteractive', () => {
  let mockConfig: Config;
  let mockSettings: LoadedSettings;
  let mockToolRegistry: ToolRegistry;
  let mockCoreExecuteToolCall: vi.Mock;
  let mockShutdownTelemetry: vi.Mock;
  let mockIsTelemetrySdkInitialized: vi.Mock;
  let consoleErrorSpy: vi.SpyInstance;
  let processStdoutSpy: vi.SpyInstance;
  let mockGeminiClient: {
    sendMessageStream: vi.Mock;
  };
  beforeEach(async () => {
    mockCoreExecuteToolCall = vi.mocked(executeToolCall);
    mockShutdownTelemetry = vi.mocked(shutdownTelemetry);
    mockShutdownTelemetry.mockResolvedValue(undefined);
    mockIsTelemetrySdkInitialized = vi.mocked(isTelemetrySdkInitialized);
    mockIsTelemetrySdkInitialized.mockReturnValue(true);

    mockCommandServiceCreate.mockResolvedValue({
      getCommands: mockGetCommands,
    });
    mockGetCommands.mockReturnValue([]);

    consoleErrorSpy = vi
      .spyOn(DebugLogger.prototype, 'error')
      .mockImplementation(() => {});
    processStdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

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
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should cancel the turn when the stream goes idle after partial output with explicit timeout', async () => {
    vi.useFakeTimers();
    const testTimeoutMs = 30_000; // 30 second timeout for this test
    try {
      // Configure mock to return explicit timeout
      const mockGetEphemeralSetting = vi.fn((key: string) => {
        if (key === 'stream-idle-timeout-ms') {
          return testTimeoutMs;
        }
        return undefined;
      });

      let capturedSignal: AbortSignal | undefined;
      mockGeminiClient.sendMessageStream.mockImplementation(
        (_messages: Part[], signal: AbortSignal) => {
          capturedSignal = signal;
          return (async function* (): AsyncGenerator<ServerGeminiStreamEvent> {
            yield { type: GeminiEventType.Content, value: 'Partial output' };
            await new Promise<void>(() => {});
          })();
        },
      );

      const runPromise = runNonInteractive({
        config: {
          ...mockConfig,
          getEphemeralSetting: mockGetEphemeralSetting,
        } as unknown as Config,
        settings: mockSettings,
        input: 'Test input',
        prompt_id: 'prompt-id-idle',
      });

      await vi.advanceTimersByTimeAsync(0);

      // Capture rejection before advancing timers so it doesn't become
      // an unhandled rejection (the promise rejects during timer advance)
      let caughtError: unknown;
      runPromise.catch((err: unknown) => {
        caughtError = err;
      });

      await vi.advanceTimersByTimeAsync(testTimeoutMs + 1);
      await runPromise.catch(() => {});

      expect(caughtError).toBeInstanceOf(StreamIdleTimeoutError);
      expect(capturedSignal?.aborted).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Operation cancelled.');
    } finally {
      vi.useRealTimers();
    }
  });

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
      expect.objectContaining({ messageBus: undefined }),
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

  it('should print successful tool resultDisplay output in text mode', async () => {
    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-display-1',
        name: 'testTool',
        args: { arg1: 'value1' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-display',
      },
    };

    mockCoreExecuteToolCall.mockResolvedValue(
      createCompletedToolCallResponse({
        callId: 'tool-display-1',
        responseParts: [{ text: 'Tool response' }],
        resultDisplay: 'BeforeTool: File operation logged',
      }),
    );

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents([toolCallEvent]))
      .mockReturnValueOnce(
        createStreamFromEvents([
          { type: GeminiEventType.Content, value: 'Final answer' },
        ]),
      );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Use a tool',
      prompt_id: 'prompt-id-display',
    });

    expect(processStdoutSpy).toHaveBeenCalledWith(
      'BeforeTool: File operation logged\n',
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('Final answer');
    expect(processStdoutSpy).toHaveBeenCalledWith('\n');
  });

  it('should not print tool resultDisplay when suppressDisplay is true', async () => {
    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-display-2',
        name: 'testTool',
        args: { arg1: 'value1' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-display-suppress',
      },
    };

    mockCoreExecuteToolCall.mockResolvedValue(
      createCompletedToolCallResponse({
        callId: 'tool-display-2',
        responseParts: [{ text: 'Tool response' }],
        resultDisplay: 'This should not be shown',
        suppressDisplay: true,
      }),
    );

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents([toolCallEvent]))
      .mockReturnValueOnce(
        createStreamFromEvents([
          { type: GeminiEventType.Content, value: 'Final answer' },
        ]),
      );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Use a tool',
      prompt_id: 'prompt-id-display-suppress',
    });

    expect(processStdoutSpy).not.toHaveBeenCalledWith(
      'This should not be shown\n',
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('Final answer');
    expect(processStdoutSpy).toHaveBeenCalledWith('\n');
  });

  it('should execute tool calls in non-interactive mode via GeminiClient stream path', async () => {
    const firstCallEvents: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.ToolCallRequest,
        value: {
          callId: 'call-1',
          name: 'testTool',
          args: { arg: 'value' },
          isClientInitiated: false,
          prompt_id: 'prompt-provider',
        },
      },
    ];
    const secondCallEvents: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'All done' },
    ];

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents(firstCallEvents))
      .mockReturnValueOnce(createStreamFromEvents(secondCallEvents));

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

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(2);
    expect(mockGeminiClient.sendMessageStream).toHaveBeenNthCalledWith(
      1,
      [{ text: 'Use the non-gemini provider' }],
      expect.any(AbortSignal),
      'prompt-provider',
    );
    expect(mockGeminiClient.sendMessageStream).toHaveBeenNthCalledWith(
      2,
      [
        {
          functionResponse: {
            id: 'call-1',
            name: 'testTool',
            response: { output: 'tool result' },
          },
        },
      ],
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
      expect.objectContaining({ messageBus: undefined }),
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('All done');
    expect(processStdoutSpy).toHaveBeenCalledWith('\n');
  });

  it('should count tool-call turns toward max session turns in stream path', async () => {
    vi.mocked(mockConfig.getMaxSessionTurns).mockReturnValue(1);
    const firstCallEvents: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.ToolCallRequest,
        value: {
          callId: 'call-1',
          name: 'testTool',
          args: { arg: 'value' },
          isClientInitiated: false,
          prompt_id: 'prompt-provider',
        },
      },
    ];

    mockGeminiClient.sendMessageStream.mockReturnValueOnce(
      createStreamFromEvents(firstCallEvents),
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

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(1);
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
      expect.objectContaining({ messageBus: undefined }),
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
      expect.objectContaining({ messageBus: undefined }),
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
});
