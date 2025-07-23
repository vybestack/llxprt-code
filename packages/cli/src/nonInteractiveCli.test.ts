/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runNonInteractive } from './nonInteractiveCli';
import {
  Config,
  GeminiClient,
  ToolRegistry,
} from '@llxprt/core';
import { Part, FunctionCall } from '@google/genai';

// Mock dependencies
vi.mock('@llxprt/core', async () => {
  const actualCore = await vi.importActual<
    typeof import('@llxprt/core')
  >('@llxprt/core');
  return {
    ...actualCore,
    GeminiClient: vi.fn(),
    ToolRegistry: vi.fn(),
    executeToolCall: vi.fn(),
  };
});

describe('runNonInteractive', () => {
  let mockConfig: Config;
  let mockGeminiClient: GeminiClient;
  let mockToolRegistry: ToolRegistry;
  let mockProcessStdoutWrite: ReturnType<typeof vi.fn>;
  let mockProcessExit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockGeminiClient = {
      sendMessageStream: vi.fn(),
    } as unknown as GeminiClient;
    mockToolRegistry = {
      getFunctionDeclarations: vi.fn().mockReturnValue([]),
      getTool: vi.fn(),
    } as unknown as ToolRegistry;

    vi.mocked(GeminiClient).mockImplementation(() => mockGeminiClient);
    vi.mocked(ToolRegistry).mockImplementation(() => mockToolRegistry);

    mockConfig = {
      getToolRegistry: vi.fn().mockReturnValue(mockToolRegistry),
      getGeminiClient: vi.fn().mockReturnValue(mockGeminiClient),
      getContentGeneratorConfig: vi.fn().mockReturnValue({}),
      getMaxSessionTurns: vi.fn().mockReturnValue(10),
      initialize: vi.fn(),
    } as unknown as Config;

    mockProcessStdoutWrite = vi.fn().mockImplementation(() => true);
    process.stdout.write = mockProcessStdoutWrite as any; // Use any to bypass strict signature matching for mock
    mockProcessExit = vi
      .fn()
      .mockImplementation((_code?: number) => undefined as never);
    process.exit = mockProcessExit as any; // Use any for process.exit mock
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore original process methods if they were globally patched
    // This might require storing the original methods before patching them in beforeEach
  });

  it('should process input and write text output', async () => {
    const inputStream = (async function* () {
      yield { type: 'content', value: 'Hello' };
      yield { type: 'content', value: ' World' };
    })();
    vi.mocked(mockGeminiClient.sendMessageStream).mockReturnValue(inputStream);

    await runNonInteractive(mockConfig, 'Test input', 'prompt-id-1');

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [
        {
          text: `The current working directory is: ${process.cwd()}\n\nTest input`,
        },
      ],
      expect.any(AbortSignal),
      'prompt-id-1',
    );
    expect(mockProcessStdoutWrite).toHaveBeenCalledWith('Hello');
    expect(mockProcessStdoutWrite).toHaveBeenCalledWith(' World');
    expect(mockProcessStdoutWrite).toHaveBeenCalledWith('\n');
  });

  it('should handle a single tool call and respond', async () => {
    const _functionCall: FunctionCall = {
      id: 'fc1',
      name: 'testTool',
      args: { p: 'v' },
    };
    const toolResponsePart: Part = {
      functionResponse: {
        name: 'testTool',
        id: 'fc1',
        response: { result: 'tool success' },
      },
    };

    const { executeToolCall: mockCoreExecuteToolCall } = await import(
      '@llxprt/core'
    );
    vi.mocked(mockCoreExecuteToolCall).mockResolvedValue({
      callId: 'fc1',
      responseParts: [toolResponsePart],
      resultDisplay: 'Tool success display',
      error: undefined,
    });

    const stream1 = (async function* () {
      yield {
        type: 'tool_call_request',
        value: { name: 'testTool', args: { p: 'v' }, callId: 'fc1' },
      };
    })();
    const stream2 = (async function* () {
      yield { type: 'content', value: 'Final answer' };
    })();
    vi.mocked(mockGeminiClient.sendMessageStream)
      .mockReturnValueOnce(stream1)
      .mockReturnValueOnce(stream2);

    await runNonInteractive(mockConfig, 'Use a tool', 'prompt-id-2');

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(2);
    expect(mockCoreExecuteToolCall).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({ callId: 'fc1', name: 'testTool' }),
      mockToolRegistry,
      expect.any(AbortSignal),
    );
    expect(mockGeminiClient.sendMessageStream).toHaveBeenLastCalledWith(
      [toolResponsePart],
      expect.any(AbortSignal),
      'prompt-id-2',
    );
    expect(mockProcessStdoutWrite).toHaveBeenCalledWith('Final answer');
  });

  it('should handle error during tool execution', async () => {
    const _functionCall: FunctionCall = {
      id: 'fcError',
      name: 'errorTool',
      args: {},
    };
    const errorResponsePart: Part = {
      functionResponse: {
        name: 'errorTool',
        id: 'fcError',
        response: { error: 'Tool failed' },
      },
    };

    const { executeToolCall: mockCoreExecuteToolCall } = await import(
      '@llxprt/core'
    );
    vi.mocked(mockCoreExecuteToolCall).mockResolvedValue({
      callId: 'fcError',
      responseParts: [errorResponsePart],
      resultDisplay: 'Tool execution failed badly',
      error: new Error('Tool failed'),
    });

    const stream1 = (async function* () {
      yield {
        type: 'tool_call_request',
        value: { name: 'errorTool', args: {}, callId: 'fcError' },
      };
    })();

    const stream2 = (async function* () {
      yield { type: 'content', value: 'Could not complete request.' };
    })();
    vi.mocked(mockGeminiClient.sendMessageStream)
      .mockReturnValueOnce(stream1)
      .mockReturnValueOnce(stream2);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await runNonInteractive(mockConfig, 'Trigger tool error', 'prompt-id-3');

    expect(mockCoreExecuteToolCall).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error executing tool errorTool: Tool execution failed badly',
    );
    expect(mockGeminiClient.sendMessageStream).toHaveBeenLastCalledWith(
      [errorResponsePart],
      expect.any(AbortSignal),
      'prompt-id-3',
    );
    expect(mockProcessStdoutWrite).toHaveBeenCalledWith(
      'Could not complete request.',
    );
  });

  it('should exit with error if sendMessageStream throws initially', async () => {
    // Create a mock that throws immediately when accessed
    vi.mocked(mockGeminiClient.sendMessageStream).mockImplementation(() => {
      throw new Error('API connection failed');
    });
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await runNonInteractive(mockConfig, 'Initial fail', 'prompt-id-4');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[API Error: API connection failed]',
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('should not exit if a tool is not found, and should send error back to model', async () => {
    const _functionCall: FunctionCall = {
      id: 'fcNotFound',
      name: 'nonExistentTool',
      args: {},
    };
    const errorResponsePart: Part = {
      functionResponse: {
        name: 'nonExistentTool',
        id: 'fcNotFound',
        response: { error: 'Tool "nonExistentTool" not found in registry.' },
      },
    };

    const { executeToolCall: mockCoreExecuteToolCall } = await import(
      '@llxprt/core'
    );
    vi.mocked(mockCoreExecuteToolCall).mockResolvedValue({
      callId: 'fcNotFound',
      responseParts: [errorResponsePart],
      resultDisplay: 'Tool "nonExistentTool" not found in registry.',
      error: new Error('Tool "nonExistentTool" not found in registry.'),
    });

    const stream1 = (async function* () {
      yield {
        type: 'tool_call_request',
        value: { name: 'nonExistentTool', args: {}, callId: 'fcNotFound' },
      };
    })();
    const stream2 = (async function* () {
      yield {
        type: 'content',
        value: 'Unfortunately the tool does not exist.',
      };
    })();
    vi.mocked(mockGeminiClient.sendMessageStream)
      .mockReturnValueOnce(stream1)
      .mockReturnValueOnce(stream2);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await runNonInteractive(
      mockConfig,
      'Trigger tool not found',
      'prompt-id-5',
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error executing tool nonExistentTool: Tool "nonExistentTool" not found in registry.',
    );

    expect(mockProcessExit).not.toHaveBeenCalled();

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(2);
    expect(mockGeminiClient.sendMessageStream).toHaveBeenLastCalledWith(
      [errorResponsePart],
      expect.any(AbortSignal),
      'prompt-id-5',
    );

    expect(mockProcessStdoutWrite).toHaveBeenCalledWith(
      'Unfortunately the tool does not exist.',
    );
  });

  it('should exit when max session turns are exceeded', async () => {
    const _functionCall: FunctionCall = {
      id: 'fcLoop',
      name: 'loopTool',
      args: {},
    };
    const toolResponsePart: Part = {
      functionResponse: {
        name: 'loopTool',
        id: 'fcLoop',
        response: { result: 'still looping' },
      },
    };

    // Config with a max turn of 1
    vi.mocked(mockConfig.getMaxSessionTurns).mockReturnValue(1);

    const { executeToolCall: mockCoreExecuteToolCall } = await import(
      '@llxprt/core'
    );
    vi.mocked(mockCoreExecuteToolCall).mockResolvedValue({
      callId: 'fcLoop',
      responseParts: [toolResponsePart],
      resultDisplay: 'Still looping',
      error: undefined,
    });

    const stream = (async function* () {
      yield {
        type: 'tool_call_request',
        value: { name: 'loopTool', args: {}, callId: 'fcLoop' },
      };
    })();

    vi.mocked(mockGeminiClient.sendMessageStream).mockReturnValue(stream);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await runNonInteractive(mockConfig, 'Trigger loop');

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      `
 Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.`,
    );
    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});
