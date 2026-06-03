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
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  GeminiEventType,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import type { Part } from '@google/genai';
import { runNonInteractive } from './nonInteractiveCli.js';

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Mock, MockInstance } from 'vitest';
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

describe('runNonInteractive - slash commands and thinking output', () => {
  let mockConfig: Config;
  let mockSettings: LoadedSettings;
  let mockToolRegistry: ToolRegistry;
  let mockCoreExecuteToolCall: Mock;
  let mockShutdownTelemetry: Mock;
  let mockIsTelemetrySdkInitialized: Mock;
  let processStdoutSpy: MockInstance;
  let mockGeminiClient: {
    sendMessageStream: Mock;
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

    vi.spyOn(DebugLogger.prototype, 'error').mockImplementation(() => {});
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
        value: {
          reason: undefined,
          usageMetadata: { totalTokenCount: 10 },
        },
      } as unknown as ServerGeminiStreamEvent,
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
      expect.objectContaining({ messageBus: undefined }),
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('file.txt');
  });

  it('should accumulate multiple Thought events and flush once on content boundary', async () => {
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
    const finishedEvent = {
      type: GeminiEventType.Finished,
      value: {
        reason: undefined,
        usageMetadata: { totalTokenCount: 10 },
      },
    } as unknown as ServerGeminiStreamEvent;

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
      (output: unknown[]) => (output[0] as string).includes('<think>'),
    );

    // Both thought events should be buffered and flushed as a single <think> block
    expect(thinkingOutputs).toHaveLength(1);
    const thinkingText = thinkingOutputs[0][0];
    // Code formats thoughts as "subject: description" when both present
    expect(thinkingText).toContain('First: thought');
    expect(thinkingText).toContain('Second: thought');
  });

  it('should NOT emit pyramid-style repeated prefixes in non-interactive CLI', async () => {
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
    const finishedEvent = {
      type: GeminiEventType.Finished,
      value: {
        reason: undefined,
        usageMetadata: { totalTokenCount: 10 },
      },
    } as unknown as ServerGeminiStreamEvent;

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
      (output: unknown[]) => (output[0] as string).includes('<think>'),
    );

    // All thoughts should be buffered into one <think> block (no pyramid repetition)
    expect(thinkingOutputs).toHaveLength(1);
    const thinkingText = thinkingOutputs[0][0];
    // "Analyzing" should appear exactly once — not repeated for each subsequent thought

    const thoughtCount = (thinkingText.match(/Analyzing/g) ?? []).length;
    expect(thoughtCount).toBe(1);
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

    const thinkOutput = processStdoutSpy.mock.calls.find((value: unknown[]) =>
      (value[0] as string).includes('<think>'),
    );
    expect(thinkOutput).toBeDefined();
    const thinkText = thinkOutput?.[0] as string;
    expect(thinkText).not.toContain('\u{1F914}');
    expect(thinkText).not.toContain('\u{1F4AD}');
    expect(thinkText).toContain('Planning');
    expect(thinkText).toContain('the approach');
    expect(thinkText).toContain('Let me think');
    expect(thinkText).toContain('carefully');
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

    const thinkOutput = processStdoutSpy.mock.calls.find((value: unknown[]) =>
      (value[0] as string).includes('<think>'),
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

    const thinkOutput = processStdoutSpy.mock.calls.find((value: unknown[]) =>
      (value[0] as string).includes('<think>'),
    );
    expect(thinkOutput).toBeDefined();
    const thinkText = thinkOutput?.[0] as string;
    expect(thinkText).toContain('\u{1F914}');
    expect(thinkText).toContain('\u{1F4AD}');
  });
});
