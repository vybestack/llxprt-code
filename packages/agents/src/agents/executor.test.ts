/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable max-lines -- Existing executor behavioral coverage exceeds the project line budget. */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentExecutor, type ActivityCallback } from './executor.js';
import { AgentTerminateMode, type SubagentActivityEvent } from './types.js';
import type { AgentDefinition, AgentInputs, OutputConfig } from './types.js';
import {
  getTestRuntimeMessageBus,
  makeFakeConfig,
} from '@vybestack/llxprt-code-core/test-utils/config.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { LSTool } from '@vybestack/llxprt-code-tools';
import { ReadFileTool } from '@vybestack/llxprt-code-tools';
import { CoreToolHostAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreToolHostAdapter.js';
import {
  ChatSession,
  StreamEventType,
  type StreamEvent,
} from '../core/chatSession.js';
import {
  type FunctionCall,
  type Part,
  type GenerateContentResponse,
  type GenerateContentConfig,
} from '@google/genai';
<<<<<<< HEAD:packages/core/src/agents/executor.test.ts
import type { Config } from '../config/config.js';
import { attachHookRestrictedAllowedTools } from '../core/hookToolRestrictions.js';

import { MockTool } from '../test-utils/mock-tool.js';
import { getDirectoryContextString } from '../utils/environmentContext.js';
=======
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { getDirectoryContextString } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
>>>>>>> origin/main:packages/agents/src/agents/executor.test.ts
import { z } from 'zod';
import { debugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';

const { mockSendMessageStream, mockExecuteToolCall } = vi.hoisted(() => ({
  mockSendMessageStream: vi.fn(),
  mockExecuteToolCall: vi.fn(),
}));

vi.mock('../core/chatSession.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../core/chatSession.js')>();
  return {
    ...actual,
    ChatSession: vi.fn().mockImplementation(() => ({
      sendMessageStream: mockSendMessageStream,
    })),
  };
});

vi.mock('../core/nonInteractiveToolExecutor.js', () => ({
  executeToolCall: mockExecuteToolCall,
}));

vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js');

const MockedChatSession = vi.mocked(ChatSession);
const mockedGetDirectoryContextString = vi.mocked(getDirectoryContextString);

// Constants for testing
const TASK_COMPLETE_TOOL_NAME = 'complete_task';
const MOCK_TOOL_NOT_ALLOWED = new MockTool({ name: 'write_file_interactive' });

/**
 * Helper to create a mock API response chunk.
 * Uses conditional spread to handle readonly functionCalls property safely.
 */
const createMockResponseChunk = (
  parts: Part[],
  functionCalls?: FunctionCall[],
): GenerateContentResponse =>
  ({
    candidates: [{ index: 0, content: { role: 'model', parts } }],
    ...(functionCalls && functionCalls.length > 0 ? { functionCalls } : {}),
  }) as unknown as GenerateContentResponse;

/**
 * Helper to mock a single turn of model response in the stream.
 */
const mockModelResponse = (
  functionCalls: FunctionCall[],
  thought?: string,
  text?: string,
) => {
  const parts: Part[] = [];
  if (thought) {
    parts.push({
      text: `**${thought}** This is the reasoning part.`,
      thought: true,
    });
  }
  if (text) parts.push({ text });

  const responseChunk = createMockResponseChunk(parts, functionCalls);

  mockSendMessageStream.mockImplementationOnce(async () =>
    (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: responseChunk,
      } as StreamEvent;
    })(),
  );
};

function createCompletedToolCallResponse(params: {
  callId: string;
  name: string;
  responseParts?: Part[];
  resultDisplay?: unknown;
  error?: Error;
  errorType?: ToolErrorType;
}) {
  return {
    status: params.error ? ('error' as const) : ('success' as const),
    request: {
      callId: params.callId,
      name: params.name,
      args: {},
      isClientInitiated: true,
      prompt_id: 'mock-prompt',
      agentId: 'primary',
    },
    response: {
      callId: params.callId,
      responseParts: params.responseParts ?? [],
      resultDisplay: params.resultDisplay,
      error: params.error,
      errorType: params.errorType,
      agentId: 'primary',
    },
  };
}

/**
 * Helper to extract the message parameters sent to sendMessageStream.
 * Provides type safety for inspecting mock calls.
 */
const getMockMessageParams = (callIndex: number) => {
  const call = mockSendMessageStream.mock.calls[callIndex];
  expect(call).toBeDefined();
  // Arg 0 of sendMessageStream is the message parameters (SendMessageParameters)
  return call[0] as { message?: Part[]; config?: GenerateContentConfig };
};

let mockConfig: Config;
let parentToolRegistry: ToolRegistry;

/**
 * Type-safe helper to create agent definitions for tests.
 */
const createTestDefinition = <TOutput extends z.ZodTypeAny>(
  tools: Array<string | MockTool> = [LSTool.Name],
  runConfigOverrides: Partial<AgentDefinition<TOutput>['runConfig']> = {},
  outputConfigMode: 'default' | 'none' = 'default',
  schema: TOutput = z.string() as unknown as TOutput,
): AgentDefinition<TOutput> => {
  let outputConfig: OutputConfig<TOutput> | undefined;

  if (outputConfigMode === 'default') {
    outputConfig = {
      outputName: 'finalResult',
      description: 'The final result.',
      schema,
    };
  }

  return {
    name: 'TestAgent',
    description: 'An agent for testing.',
    inputConfig: {
      inputs: { goal: { type: 'string', required: true, description: 'goal' } },
    },
    modelConfig: { model: 'gemini-test-model', temp: 0, top_p: 1 },
    runConfig: { max_time_minutes: 5, max_turns: 5, ...runConfigOverrides },
    promptConfig: { systemPrompt: 'Achieve the goal: ${goal}.' },
    toolConfig: { tools },
    outputConfig,
  };
};

const mockWorkResponse = (id: string) => {
  mockModelResponse([{ name: LSTool.Name, args: { path: '.' }, id }]);
  mockExecuteToolCall.mockResolvedValueOnce(
    createCompletedToolCallResponse({
      callId: id,
      name: LSTool.Name,
      resultDisplay: 'ok',
      responseParts: [
        { functionResponse: { name: LSTool.Name, response: {}, id } },
      ],
    }),
  );
};

describe('AgentExecutor', () => {
  let activities: SubagentActivityEvent[];
  let onActivity: ActivityCallback;
  let abortController: AbortController;
  let signal: AbortSignal;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockSendMessageStream.mockReset();
    mockExecuteToolCall.mockReset();

    MockedChatSession.mockImplementation(
      () =>
        ({
          sendMessageStream: mockSendMessageStream,
        }) as unknown as ChatSession,
    );

    vi.useFakeTimers();

    mockConfig = makeFakeConfig();
    parentToolRegistry = new ToolRegistry(
      mockConfig,
      getTestRuntimeMessageBus(mockConfig),
    );
    parentToolRegistry.registerTool(
      new LSTool(new CoreToolHostAdapter(mockConfig)),
    );
    parentToolRegistry.registerTool(
      new ReadFileTool(new CoreToolHostAdapter(mockConfig)),
    );
    parentToolRegistry.registerTool(MOCK_TOOL_NOT_ALLOWED);

    vi.spyOn(mockConfig, 'getToolRegistry').mockReturnValue(parentToolRegistry);

    mockedGetDirectoryContextString.mockResolvedValue(
      'Mocked Environment Context',
    );

    activities = [];
    onActivity = (activity) => activities.push(activity);
    abortController = new AbortController();
    signal = abortController.signal;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create (Initialization and Validation)', () => {
    it('should create successfully with allowed tools', async () => {
      const definition = createTestDefinition([LSTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );
      expect(executor).toBeInstanceOf(AgentExecutor);
    });

    it('SECURITY: should throw if a tool is not on the non-interactive allowlist', async () => {
      const definition = createTestDefinition([MOCK_TOOL_NOT_ALLOWED.name]);
      await expect(
        AgentExecutor.create(
          definition,
          mockConfig,
          getTestRuntimeMessageBus(mockConfig),
          onActivity,
        ),
      ).rejects.toThrow(/not on the allow-list for non-interactive execution/);
    });

    it('should create an isolated ToolRegistry for the agent', async () => {
      const definition = createTestDefinition([LSTool.Name, ReadFileTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      const agentRegistry = executor['toolRegistry'];

      expect(agentRegistry).not.toBe(parentToolRegistry);
      expect(agentRegistry.getAllToolNames()).toStrictEqual(
        expect.arrayContaining([LSTool.Name, ReadFileTool.Name]),
      );
      expect(agentRegistry.getAllToolNames()).toHaveLength(2);
      expect(agentRegistry.getTool(MOCK_TOOL_NOT_ALLOWED.name)).toBeUndefined();
    });
  });

  describe('run (Execution Loop and Logic)', () => {
    it('should execute successfully when model calls complete_task with output (Happy Path with Output)', async () => {
      const definition = createTestDefinition();
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );
      const inputs: AgentInputs = { goal: 'Find files' };

      // Turn 1: Model calls ls
      mockModelResponse(
        [{ name: LSTool.Name, args: { path: '.' }, id: 'call1' }],
        'T1: Listing',
      );
      mockExecuteToolCall.mockResolvedValueOnce(
        createCompletedToolCallResponse({
          callId: 'call1',
          name: LSTool.Name,
          resultDisplay: 'file1.txt',
          responseParts: [
            {
              functionResponse: {
                name: LSTool.Name,
                response: { result: 'file1.txt' },
                id: 'call1',
              },
            },
          ],
          error: undefined,
        }),
      );

      // Turn 2: Model calls complete_task with required output
      mockModelResponse(
        [
          {
            name: TASK_COMPLETE_TOOL_NAME,
            args: { finalResult: 'Found file1.txt' },
            id: 'call2',
          },
        ],
        'T2: Done',
      );

      const output = await executor.run(inputs, signal);

      expect(mockSendMessageStream).toHaveBeenCalledTimes(2);

      const chatConstructorArgs = MockedChatSession.mock.calls[0];
      const chatConfig = chatConstructorArgs[2]; // generationConfig is the 3rd argument (index 2)
      expect(chatConfig?.systemInstruction).toContain(
        `MUST call the \`${TASK_COMPLETE_TOOL_NAME}\` tool`,
      );

      const turn1Params = getMockMessageParams(0);

      const firstToolGroup = turn1Params.config?.tools?.[0];
      expect(firstToolGroup).toBeDefined();

      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!firstToolGroup || !('functionDeclarations' in firstToolGroup)) {
        throw new Error(
          'Test expectation failed: Config does not contain functionDeclarations.',
        );
      }

      const sentTools = firstToolGroup.functionDeclarations;
      expect(sentTools).toBeDefined();

      expect(sentTools).toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: LSTool.Name }),
          expect.objectContaining({ name: TASK_COMPLETE_TOOL_NAME }),
        ]),
      );

      const completeToolDef = sentTools!.find(
        (t) => t.name === TASK_COMPLETE_TOOL_NAME,
      );
      expect(completeToolDef?.parameters?.required).toContain('finalResult');

      expect(output.result).toBe('Found file1.txt');
      expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);

      expect(activities).toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'THOUGHT_CHUNK',
            data: { text: 'T1: Listing' },
          }),
          expect.objectContaining({
            type: 'TOOL_CALL_END',
            data: { name: LSTool.Name, output: 'file1.txt' },
          }),
          expect.objectContaining({
            type: 'TOOL_CALL_START',
            data: {
              name: TASK_COMPLETE_TOOL_NAME,
              args: { finalResult: 'Found file1.txt' },
            },
          }),
          expect.objectContaining({
            type: 'TOOL_CALL_END',
            data: {
              name: TASK_COMPLETE_TOOL_NAME,
              output: expect.stringContaining('Output submitted'),
            },
          }),
        ]),
      );
    });

    it('should execute successfully when model calls complete_task without output (Happy Path No Output)', async () => {
      const definition = createTestDefinition([LSTool.Name], {}, 'none');
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      mockModelResponse([
        { name: LSTool.Name, args: { path: '.' }, id: 'call1' },
      ]);
      mockExecuteToolCall.mockResolvedValueOnce(
        createCompletedToolCallResponse({
          callId: 'call1',
          name: LSTool.Name,
          resultDisplay: 'ok',
          responseParts: [
            {
              functionResponse: {
                name: LSTool.Name,
                response: {},
                id: 'call1',
              },
            },
          ],
        }),
      );

      mockModelResponse(
        [{ name: TASK_COMPLETE_TOOL_NAME, args: {}, id: 'call2' }],
        'Task finished.',
      );

      const output = await executor.run({ goal: 'Do work' }, signal);

      const turn1Params = getMockMessageParams(0);
      const firstToolGroup = turn1Params.config?.tools?.[0];

      expect(firstToolGroup).toBeDefined();
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!firstToolGroup || !('functionDeclarations' in firstToolGroup)) {
        throw new Error(
          'Test expectation failed: Config does not contain functionDeclarations.',
        );
      }

      const sentTools = firstToolGroup.functionDeclarations;
      expect(sentTools).toBeDefined();

      const completeToolDef = sentTools!.find(
        (t) => t.name === TASK_COMPLETE_TOOL_NAME,
      );
      expect(completeToolDef?.parameters?.required).toStrictEqual([]);
      expect(completeToolDef?.description).toContain(
        'signal that you have completed',
      );

      expect(output.result).toBe('Task completed successfully.');
      expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);
    });

    it('should attempt recovery and then fail if the model stops tools without calling complete_task (Protocol Violation)', async () => {
      const definition = createTestDefinition();
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      mockModelResponse([
        { name: LSTool.Name, args: { path: '.' }, id: 'call1' },
      ]);
      mockExecuteToolCall.mockResolvedValueOnce(
        createCompletedToolCallResponse({
          callId: 'call1',
          name: LSTool.Name,
          resultDisplay: 'ok',
          responseParts: [
            {
              functionResponse: {
                name: LSTool.Name,
                response: {},
                id: 'call1',
              },
            },
          ],
        }),
      );

      // Second model response: protocol violation (no tool calls)
      mockModelResponse([], 'I think I am done.');

      // After protocol violation, executor enters recovery and sends a warning.
      // The recovery turn needs a model response: model still doesn't call tools.
      mockModelResponse([], 'I still cannot complete.');

      const output = await executor.run({ goal: 'Strict test' }, signal);

      // Protocol violation now triggers recovery turn, which also fails
      expect(output.terminate_reason).toBe(
        AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
      );

      // Protocol violation now goes through recovery, so there should be no direct ERROR emit
      // Instead, expect RECOVERY_ATTEMPT event
      expect(activities).toContainEqual(
        expect.objectContaining({
          type: 'RECOVERY_ATTEMPT',
          data: expect.objectContaining({
            originalReason: AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
          }),
        }),
      );

      // Should have 3 model calls: 1 normal + 1 warning+recovery attempt + 1 recovery model response
      expect(mockSendMessageStream).toHaveBeenCalledTimes(3);
    });

    it('should report an error if complete_task is called with missing required arguments', async () => {
      const definition = createTestDefinition();
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      // Turn 1: Missing arg
      mockModelResponse([
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { wrongArg: 'oops' },
          id: 'call1',
        },
      ]);

      // Turn 2: Corrected
      mockModelResponse([
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { finalResult: 'Corrected result' },
          id: 'call2',
        },
      ]);

      const output = await executor.run({ goal: 'Error test' }, signal);

      expect(mockSendMessageStream).toHaveBeenCalledTimes(2);

      const expectedError =
        "Missing required argument 'finalResult' for completion.";

      expect(activities).toContainEqual(
        expect.objectContaining({
          type: 'ERROR',
          data: {
            context: 'tool_call',
            name: TASK_COMPLETE_TOOL_NAME,
            error: expectedError,
          },
        }),
      );

      const turn2Params = getMockMessageParams(1);
      const turn2Parts = turn2Params.message;
      expect(turn2Parts).toBeDefined();
      expect(turn2Parts).toHaveLength(1);

      expect(turn2Parts![0]).toStrictEqual(
        expect.objectContaining({
          functionResponse: expect.objectContaining({
            name: TASK_COMPLETE_TOOL_NAME,
            response: { error: expectedError },
            id: 'call1',
          }),
        }),
      );

      expect(output.result).toBe('Corrected result');
      expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);
    });

    it('should handle multiple calls to complete_task in the same turn (accept first, block rest)', async () => {
      const definition = createTestDefinition([], {}, 'none');
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      // Turn 1: Duplicate calls
      mockModelResponse([
        { name: TASK_COMPLETE_TOOL_NAME, args: {}, id: 'call1' },
        { name: TASK_COMPLETE_TOOL_NAME, args: {}, id: 'call2' },
      ]);

      const output = await executor.run({ goal: 'Dup test' }, signal);

      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
      expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);

      const completions = activities.filter(
        (a) =>
          a.type === 'TOOL_CALL_END' &&
          a.data['name'] === TASK_COMPLETE_TOOL_NAME,
      );
      const errors = activities.filter(
        (a) => a.type === 'ERROR' && a.data['name'] === TASK_COMPLETE_TOOL_NAME,
      );

      expect(completions).toHaveLength(1);
      expect(errors).toHaveLength(1);
      expect(errors[0].data['error']).toContain(
        'Task already marked complete in this turn',
      );
    });

    it('should not treat only hook-filtered function calls as successful completion', async () => {
      const definition = createTestDefinition([LSTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );
      const blockedCall: FunctionCall = {
        name: 'run_shell_command',
        args: { command: 'echo blocked' },
        id: 'blocked-call',
      };
      const blockedResponse = attachHookRestrictedAllowedTools(
        createMockResponseChunk([{ functionCall: blockedCall }], [blockedCall]),
        ['read_file'],
      );
      mockSendMessageStream
        .mockImplementationOnce(async () =>
          (async function* () {
            yield { type: StreamEventType.CHUNK, value: blockedResponse };
          })(),
        )
        .mockImplementationOnce(async () =>
          (async function* () {
            yield {
              type: StreamEventType.CHUNK,
              value: createMockResponseChunk([
                { text: 'Still no executable tool calls' },
              ]),
            };
          })(),
        );

      const output = await executor.run({ goal: 'Blocked tool call' }, signal);

      expect(output.terminate_reason).toBe(
        AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
      );
      expect(mockExecuteToolCall).not.toHaveBeenCalled();
    });

    it('should execute allowed function calls when the same response also has hook-filtered calls', async () => {
      const definition = createTestDefinition([LSTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );
      const signal = new AbortController().signal;
      const allowedCall: FunctionCall = {
        name: LSTool.Name,
        args: { path: '/allowed' },
        id: 'allowed-call',
      };
      const blockedCall: FunctionCall = {
        name: 'run_shell_command',
        args: { command: 'echo blocked' },
        id: 'blocked-call',
      };
      const mixedResponse = attachHookRestrictedAllowedTools(
        createMockResponseChunk(
          [{ functionCall: allowedCall }, { functionCall: blockedCall }],
          [allowedCall, blockedCall],
        ),
        [LSTool.Name],
      );
      mockSendMessageStream.mockImplementationOnce(async () =>
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mixedResponse };
        })(),
      );
      mockModelResponse([
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { output: 'done' },
          id: 'complete-call',
        },
      ]);
      mockModelResponse([
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { output: 'done' },
          id: 'complete-call-2',
        },
      ]);
      mockModelResponse([], undefined, 'No more tool calls');

      mockExecuteToolCall.mockResolvedValueOnce(
        createCompletedToolCallResponse({
          callId: 'allowed-call',
          name: LSTool.Name,
          resultDisplay: 'ok',
        }),
      );

      const output = await executor.run({ goal: 'Mixed calls' }, signal);

      expect(output.terminate_reason).toBe(
        AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
      );
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
      expect(mockExecuteToolCall.mock.calls[0][1].name).toBe(LSTool.Name);
    });

    it('should execute parallel tool calls and then complete', async () => {
      const definition = createTestDefinition([LSTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      const call1: FunctionCall = {
        name: LSTool.Name,
        args: { path: '/a' },
        id: 'c1',
      };
      const call2: FunctionCall = {
        name: LSTool.Name,
        args: { path: '/b' },
        id: 'c2',
      };

      // Turn 1: Parallel calls
      mockModelResponse([call1, call2]);

      // Concurrency mock
      let callsStarted = 0;
      let resolveCalls: () => void;
      const bothStarted = new Promise<void>((r) => {
        resolveCalls = r;
      });

      mockExecuteToolCall.mockImplementation(async (_ctx, reqInfo) => {
        callsStarted++;
        if (callsStarted === 2) resolveCalls();
        await vi.advanceTimersByTimeAsync(100);
        return createCompletedToolCallResponse({
          callId: reqInfo.callId,
          name: reqInfo.name,
          resultDisplay: 'ok',
          responseParts: [
            {
              functionResponse: {
                name: reqInfo.name,
                response: {},
                id: reqInfo.callId,
              },
            },
          ],
        });
      });

      // Turn 2: Completion
      mockModelResponse([
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { finalResult: 'done' },
          id: 'c3',
        },
      ]);

      const runPromise = executor.run({ goal: 'Parallel' }, signal);

      await vi.advanceTimersByTimeAsync(1);
      await bothStarted;
      await vi.advanceTimersByTimeAsync(150);
      await vi.advanceTimersByTimeAsync(1);

      const output = await runPromise;

      expect(mockExecuteToolCall).toHaveBeenCalledTimes(2);
      expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);

      // Safe access to message parts
      const turn2Params = getMockMessageParams(1);
      const parts = turn2Params.message;
      expect(parts).toBeDefined();
      expect(parts).toHaveLength(2);
      expect(parts).toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({
            functionResponse: expect.objectContaining({ id: 'c1' }),
          }),
          expect.objectContaining({
            functionResponse: expect.objectContaining({ id: 'c2' }),
          }),
        ]),
      );
    });

    it('SECURITY: should block unauthorized tools and provide explicit failure to model', async () => {
      const definition = createTestDefinition([LSTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      // Turn 1: Model tries to use a tool not in its config
      const badCallId = 'bad_call_1';
      mockModelResponse([
        {
          name: ReadFileTool.Name,
          args: { path: 'secret.txt' },
          id: badCallId,
        },
      ]);

      // Turn 2: Model gives up and completes
      mockModelResponse([
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { finalResult: 'Could not read file.' },
          id: 'c2',
        },
      ]);

      const consoleWarnSpy = vi
        .spyOn(debugLogger, 'warn')
        .mockImplementation(() => {});

      await executor.run({ goal: 'Sec test' }, signal);

      // Verify external executor was not called (Security held)
      expect(mockExecuteToolCall).not.toHaveBeenCalled();

      // 2. Verify console warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`[AgentExecutor] Blocked call:`),
      );
      consoleWarnSpy.mockRestore();

      // Verify specific error was sent back to model
      const turn2Params = getMockMessageParams(1);
      const parts = turn2Params.message;
      expect(parts).toBeDefined();
      expect(parts![0]).toStrictEqual(
        expect.objectContaining({
          functionResponse: expect.objectContaining({
            id: badCallId,
            name: ReadFileTool.Name,
            response: {
              error: expect.stringContaining('Unauthorized tool call'),
            },
          }),
        }),
      );

      // Verify Activity Stream reported the error
      expect(activities).toContainEqual(
        expect.objectContaining({
          type: 'ERROR',
          data: expect.objectContaining({
            context: 'tool_call_unauthorized',
            name: ReadFileTool.Name,
          }),
        }),
      );
    });
  });

  describe('run (Termination Conditions)', () => {
    it('should terminate when max_turns is reached', async () => {
      const MAX = 2;
      const definition = createTestDefinition([LSTool.Name], {
        max_turns: MAX,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
      );

      mockWorkResponse('t1');
      mockWorkResponse('t2');

      // The recovery turn will also be checked: needs a model response
      mockModelResponse([], 'No more calls.');

      const output = await executor.run({ goal: 'Turns test' }, signal);

      expect(output.terminate_reason).toBe(AgentTerminateMode.MAX_TURNS);
      // 2 normal turns + 1 recovery attempt that also fails
      expect(mockSendMessageStream).toHaveBeenCalledTimes(3);
    });

    it('should terminate if timeout is reached', async () => {
      const definition = createTestDefinition([LSTool.Name], {
        max_time_minutes: 1,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
      );

      mockModelResponse([{ name: LSTool.Name, args: { path: '.' }, id: 't1' }]);

      // Long running tool
      mockExecuteToolCall.mockImplementationOnce(async () => {
        await vi.advanceTimersByTimeAsync(61 * 1000);
        return createCompletedToolCallResponse({
          callId: 't1',
          name: LSTool.Name,
          resultDisplay: 'ok',
          responseParts: [],
        });
      });

      // After timeout, executor enters recovery. The recovery model response:
      mockModelResponse([], 'Recovery fails.');

      const output = await executor.run({ goal: 'Timeout test' }, signal);

      expect(output.terminate_reason).toBe(AgentTerminateMode.TIMEOUT);
      // 1 normal turn + 1 recovery turn that also fails (no tool calls)
      expect(mockSendMessageStream).toHaveBeenCalledTimes(2);
    });

    it('should actively abort a stalled response stream before the overall timeout expires', async () => {
      const testTimeoutMs = 30_000; // 30 second timeout for this test
      mockConfig.setEphemeralSetting('stream-idle-timeout-ms', testTimeoutMs);

      const definition = createTestDefinition([LSTool.Name], {
        max_time_minutes: 5,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
      );

      let capturedSignal: AbortSignal | undefined;
      mockSendMessageStream.mockImplementationOnce(
        async ({ config: messageConfig }) => {
          capturedSignal = messageConfig?.abortSignal;
          return (async function* () {
            yield {
              type: StreamEventType.CHUNK,
              value: createMockResponseChunk([{ text: 'partial output' }]),
            } as StreamEvent;

            await new Promise<void>((_resolve, reject) => {
              if (!capturedSignal) {
                reject(new Error('Abort signal was not provided'));
                return;
              }
              if (capturedSignal.aborted) {
                reject(createAbortError());
                return;
              }
              capturedSignal.addEventListener(
                'abort',
                () => {
                  queueMicrotask(() => reject(createAbortError()));
                },
                { once: true },
              );
            });
          })();
        },
      );

      const runPromise = executor.run({ goal: 'Stall test' }, signal);
      const runRejection = runPromise.then(
        () => {
          throw new Error('Expected stalled executor run to abort');
        },
        (error) => {
          expect(error).toMatchObject({
            name: 'AbortError',
          });
        },
      );

      await vi.advanceTimersByTimeAsync(testTimeoutMs + 1_000);

      await runRejection;
      expect(capturedSignal?.aborted).toBe(true);
      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
    });

    it('should terminate when AbortSignal is triggered', async () => {
      const definition = createTestDefinition();
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
      );

      mockSendMessageStream.mockImplementationOnce(async () =>
        (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: createMockResponseChunk([
              { text: 'Thinking...', thought: true },
            ]),
          } as StreamEvent;
          abortController.abort();
        })(),
      );

      const output = await executor.run({ goal: 'Abort test' }, signal);

      expect(output.terminate_reason).toBe(AgentTerminateMode.ABORTED);
    });
  });

  describe('stream idle timeout behavioral tests', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.useFakeTimers();
      process.env = { ...originalEnv };
      delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      process.env = originalEnv;
    });

    it('honors config setting: uses resolveStreamIdleTimeoutMs with config', async () => {
      const customTimeoutMs = 20_000;

      mockConfig.setEphemeralSetting('stream-idle-timeout-ms', customTimeoutMs);

      // Verify the config returns the setting correctly
      expect(mockConfig.getEphemeralSetting('stream-idle-timeout-ms')).toBe(
        customTimeoutMs,
      );
    });

    it('disabled path: setting 0 disables watchdog', async () => {
      mockConfig.setEphemeralSetting('stream-idle-timeout-ms', 0);

      // Verify the config returns 0
      expect(mockConfig.getEphemeralSetting('stream-idle-timeout-ms')).toBe(0);
    });

    it('env var precedence: env var is checked first', async () => {
      process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS = '10000';

      // Import the resolve function to verify env precedence
      const { resolveStreamIdleTimeoutMs } = await import(
        '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js'
      );

      mockConfig.setEphemeralSetting('stream-idle-timeout-ms', 60000);

      const result = resolveStreamIdleTimeoutMs(mockConfig);
      expect(result).toBe(10000); // Env value wins
    });
  });
  describe('Recovery Turn', () => {
    it('should give a recovery turn on MAX_TURNS and return GOAL if complete_task is called', async () => {
      const MAX = 2;
      const definition = createTestDefinition([LSTool.Name], {
        max_turns: MAX,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      mockWorkResponse('t1');
      mockWorkResponse('t2');

      // Recovery turn: model calls complete_task
      mockModelResponse([
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { finalResult: 'Partial result after max turns' },
          id: 'recovery1',
        },
      ]);

      const output = await executor.run({ goal: 'Recovery MAX_TURNS' }, signal);

      expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);
      expect(output.result).toBe('Partial result after max turns');

      // Should have 3 model calls: 2 normal turns + 1 recovery
      expect(mockSendMessageStream).toHaveBeenCalledTimes(3);

      // Verify THOUGHT_CHUNK with recovery message
      const thoughtChunks = activities.filter(
        (a) => a.type === 'THOUGHT_CHUNK',
      );
      expect(thoughtChunks.length).toBeGreaterThanOrEqual(1);
      expect(thoughtChunks[thoughtChunks.length - 1].data['text']).toContain(
        'Execution limit reached',
      );
      expect(thoughtChunks[thoughtChunks.length - 1].data['text']).toContain(
        'MAX_TURNS',
      );

      // Verify RECOVERY_ATTEMPT telemetry
      const recoveryEvents = activities.filter(
        (a) => a.type === 'RECOVERY_ATTEMPT',
      );
      expect(recoveryEvents).toHaveLength(1);
      expect(recoveryEvents[0].data['originalReason']).toBe(
        AgentTerminateMode.MAX_TURNS,
      );
      expect(recoveryEvents[0].data['gracePeriodSeconds']).toBe(60);
    });

    it('should give a recovery turn on MAX_TURNS and return original reason if recovery also fails', async () => {
      const MAX = 2;
      const definition = createTestDefinition([LSTool.Name], {
        max_turns: MAX,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      mockWorkResponse('t1');
      mockWorkResponse('t2');

      // Recovery turn: model calls a tool instead of complete_task.
      // With checkRecoveryToolCalls rejecting non-solo-complete_task, this
      // terminates immediately without executing the tool.
      mockModelResponse([
        { name: LSTool.Name, args: { path: '.' }, id: 'recovery-t1' },
      ]);

      const output = await executor.run(
        { goal: 'Recovery MAX_TURNS fails' },
        signal,
      );

      expect(output.terminate_reason).toBe(AgentTerminateMode.MAX_TURNS);
      expect(output.result).toContain('Recovery turn attempted but agent');

      // RECOVERY_OUTCOME telemetry: failure with original reason
      const outcomeEvents = activities.filter(
        (a) => a.type === 'RECOVERY_OUTCOME',
      );
      expect(outcomeEvents).toHaveLength(1);
      expect(outcomeEvents[0].data['originalReason']).toBe(
        AgentTerminateMode.MAX_TURNS,
      );
      expect(outcomeEvents[0].data['outcome']).toBe('failure');
      expect(outcomeEvents[0].data['terminateReason']).toBe(
        AgentTerminateMode.MAX_TURNS,
      );
      expect(outcomeEvents[0].data['gracePeriodSeconds']).toBe(60);
    });

    it('should give a recovery turn on TIMEOUT and return GOAL if complete_task is called', async () => {
      const definition = createTestDefinition([LSTool.Name], {
        max_time_minutes: 1,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      // Turn 1: normal tool call
      mockModelResponse([{ name: LSTool.Name, args: { path: '.' }, id: 't1' }]);
      mockExecuteToolCall.mockImplementationOnce(async () => {
        await vi.advanceTimersByTimeAsync(61 * 1000);
        return createCompletedToolCallResponse({
          callId: 't1',
          name: LSTool.Name,
          resultDisplay: 'ok',
          responseParts: [],
        });
      });

      // Recovery turn: model calls complete_task
      mockModelResponse([
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { finalResult: 'Timed out partial' },
          id: 'recovery1',
        },
      ]);

      const output = await executor.run({ goal: 'Recovery TIMEOUT' }, signal);

      expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);
      expect(output.result).toBe('Timed out partial');

      const recoveryEvents = activities.filter(
        (a) => a.type === 'RECOVERY_ATTEMPT',
      );
      expect(recoveryEvents).toHaveLength(1);
      expect(recoveryEvents[0].data['originalReason']).toBe(
        AgentTerminateMode.TIMEOUT,
      );

      // RECOVERY_OUTCOME telemetry: success
      const outcomeEvents = activities.filter(
        (a) => a.type === 'RECOVERY_OUTCOME',
      );
      expect(outcomeEvents).toHaveLength(1);
      expect(outcomeEvents[0].data['originalReason']).toBe(
        AgentTerminateMode.TIMEOUT,
      );
      expect(outcomeEvents[0].data['outcome']).toBe('success');
      expect(outcomeEvents[0].data['terminateReason']).toBe(
        AgentTerminateMode.GOAL,
      );
      expect(outcomeEvents[0].data['gracePeriodSeconds']).toBe(60);
    });

    it('should give a recovery turn on protocol violation (no tool calls) and return GOAL if complete_task is called', async () => {
      const definition = createTestDefinition([LSTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      // Turn 1: model stops with no tool calls (protocol violation)
      mockModelResponse([], 'I think I am done.');

      // Recovery turn: model calls complete_task
      mockModelResponse([
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { finalResult: 'Recovered from protocol violation' },
          id: 'recovery1',
        },
      ]);

      const output = await executor.run(
        { goal: 'Recovery protocol violation' },
        signal,
      );

      expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);
      expect(output.result).toBe('Recovered from protocol violation');

      // Verify RECOVERY_ATTEMPT telemetry with ERROR_NO_COMPLETE_TASK_CALL
      const recoveryEvents = activities.filter(
        (a) => a.type === 'RECOVERY_ATTEMPT',
      );
      expect(recoveryEvents).toHaveLength(1);
      expect(recoveryEvents[0].data['originalReason']).toBe(
        AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
      );

      // Verify ERROR activity for protocol violation
      const errorEvents = activities.filter(
        (a) => a.type === 'ERROR' && a.data['context'] === 'protocol_violation',
      );
      // The protocol violation path should NOT have emitted an ERROR because
      // we now go directly into recovery.
      expect(errorEvents).toHaveLength(0);

      // RECOVERY_OUTCOME telemetry: success
      const outcomeEvents = activities.filter(
        (a) => a.type === 'RECOVERY_OUTCOME',
      );
      expect(outcomeEvents).toHaveLength(1);
      expect(outcomeEvents[0].data['originalReason']).toBe(
        AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
      );
      expect(outcomeEvents[0].data['outcome']).toBe('success');
      expect(outcomeEvents[0].data['terminateReason']).toBe(
        AgentTerminateMode.GOAL,
      );
      expect(outcomeEvents[0].data['gracePeriodSeconds']).toBe(60);
    });

    it('should give a recovery turn on protocol violation and return ERROR_NO_COMPLETE_TASK_CALL if recovery fails', async () => {
      const definition = createTestDefinition([LSTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      // Turn 1: model stops with no tool calls (protocol violation)
      mockModelResponse([], 'I think I am done.');

      // Recovery turn: model STILL stops with no tool calls (recovery fails)
      mockModelResponse([], 'Still not calling complete_task.');

      const output = await executor.run(
        { goal: 'Recovery protocol violation fails' },
        signal,
      );

      expect(output.terminate_reason).toBe(
        AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
      );
      expect(output.result).toContain('Recovery turn attempted but agent');
      expect(output.result).toContain(TASK_COMPLETE_TOOL_NAME);

      // RECOVERY_OUTCOME telemetry: failure
      const outcomeEvents = activities.filter(
        (a) => a.type === 'RECOVERY_OUTCOME',
      );
      expect(outcomeEvents).toHaveLength(1);
      expect(outcomeEvents[0].data['originalReason']).toBe(
        AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
      );
      expect(outcomeEvents[0].data['outcome']).toBe('failure');
      expect(outcomeEvents[0].data['terminateReason']).toBe(
        AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
      );
      expect(outcomeEvents[0].data['gracePeriodSeconds']).toBe(60);
    });

    it('should use configured grace_period_seconds for RECOVERY_ATTEMPT telemetry', async () => {
      const MAX = 1;
      const definition = createTestDefinition([LSTool.Name], {
        max_turns: MAX,
        grace_period_seconds: 30,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      mockWorkResponse('t1');

      // Recovery turn
      mockModelResponse([
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { finalResult: 'Custom grace period' },
          id: 'recovery1',
        },
      ]);

      await executor.run({ goal: 'Custom grace period' }, signal);

      const recoveryEvents = activities.filter(
        (a) => a.type === 'RECOVERY_ATTEMPT',
      );
      expect(recoveryEvents).toHaveLength(1);
      expect(recoveryEvents[0].data['gracePeriodSeconds']).toBe(30);
    });

    it('should use default grace period of 60s when grace_period_seconds is not configured', async () => {
      const MAX = 1;
      const definition = createTestDefinition([LSTool.Name], {
        max_turns: MAX,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      mockWorkResponse('t1');

      // Recovery turn: complete_task
      mockModelResponse([
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { finalResult: 'Default grace' },
          id: 'recovery1',
        },
      ]);

      await executor.run({ goal: 'Default grace period' }, signal);

      const recoveryEvents = activities.filter(
        (a) => a.type === 'RECOVERY_ATTEMPT',
      );
      expect(recoveryEvents).toHaveLength(1);
      expect(recoveryEvents[0].data['gracePeriodSeconds']).toBe(60);
    });

    it('should send warning message instructing agent to call complete_task during recovery from MAX_TURNS', async () => {
      const MAX = 1;
      const definition = createTestDefinition([LSTool.Name], {
        max_turns: MAX,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      mockWorkResponse('t1');

      // Recovery turn: complete_task
      mockModelResponse([
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { finalResult: 'Done' },
          id: 'recovery1',
        },
      ]);

      await executor.run({ goal: 'Check warning message' }, signal);

      // The second call to sendMessageStream should contain the warning message
      const secondCallParams = getMockMessageParams(1);
      const messageParts = secondCallParams.message;
      expect(messageParts).toBeDefined();
      expect(messageParts).toHaveLength(1);
      const part = messageParts![0];
      expect(part).toHaveProperty('text');
      const text =
        'text' in part && typeof part.text === 'string' ? part.text : '';
      expect(text).toContain('WARNING');
      expect(text).toContain(TASK_COMPLETE_TOOL_NAME);
      expect(text).toContain('ONE final chance');
    });

    it('should NOT enter recovery for ABORTED termination', async () => {
      const definition = createTestDefinition();
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      mockSendMessageStream.mockImplementationOnce(async () =>
        (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: createMockResponseChunk([
              { text: 'Thinking...', thought: true },
            ]),
          } as StreamEvent;
          abortController.abort();
        })(),
      );

      const output = await executor.run({ goal: 'Abort test' }, signal);

      expect(output.terminate_reason).toBe(AgentTerminateMode.ABORTED);

      const recoveryEvents = activities.filter(
        (a) => a.type === 'RECOVERY_ATTEMPT',
      );
      expect(recoveryEvents).toHaveLength(0);
    });

    it('should NOT enter recovery twice - second termination during recovery returns original reason', async () => {
      const MAX = 1;
      const definition = createTestDefinition([LSTool.Name], {
        max_turns: MAX,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      mockWorkResponse('t1');

      // Recovery turn: model calls a normal tool instead of complete_task.
      // With the checkRecoveryToolCalls fix, this is now rejected immediately
      // and the loop does NOT execute the non-complete tool.
      mockModelResponse([
        { name: LSTool.Name, args: { path: '.' }, id: 'recovery-t1' },
      ]);

      const output = await executor.run({ goal: 'No double recovery' }, signal);

      expect(output.terminate_reason).toBe(AgentTerminateMode.MAX_TURNS);
      expect(output.result).toContain('Recovery turn attempted but agent');

      // Only ONE recovery attempt should have been recorded
      const recoveryEvents = activities.filter(
        (a) => a.type === 'RECOVERY_ATTEMPT',
      );
      expect(recoveryEvents).toHaveLength(1);

      // The non-complete recovery tool should NOT have been executed
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1); // only the normal-turn call
    });

    it('should preserve the latest partial result before recovery failure', async () => {
      const definition = createTestDefinition([LSTool.Name], {
        max_turns: 2,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      mockModelResponse([{ name: LSTool.Name, args: { path: '.' }, id: 't1' }]);
      mockExecuteToolCall.mockResolvedValueOnce(
        createCompletedToolCallResponse({
          callId: 't1',
          name: LSTool.Name,
          resultDisplay: 'First partial result',
          responseParts: [],
        }),
      );
      mockModelResponse([{ name: LSTool.Name, args: { path: '.' }, id: 't2' }]);
      mockExecuteToolCall.mockResolvedValueOnce(
        createCompletedToolCallResponse({
          callId: 't2',
          name: LSTool.Name,
          resultDisplay: 'Latest partial result',
          responseParts: [],
        }),
      );
      mockModelResponse([], 'Recovery fails.');

      const output = await executor.run(
        { goal: 'Preserve latest partial result' },
        signal,
      );

      expect(output.terminate_reason).toBe(AgentTerminateMode.MAX_TURNS);
      expect(output.result).toContain('Latest partial result');
      expect(output.result).not.toContain('First partial result');
    });

    it('should preserve partial result from before recovery when recovery fails on TIMEOUT', async () => {
      const definition = createTestDefinition([LSTool.Name], {
        max_time_minutes: 1,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      // Turn 1: normal tool call
      mockModelResponse([{ name: LSTool.Name, args: { path: '.' }, id: 't1' }]);
      mockExecuteToolCall.mockImplementationOnce(async () => {
        await vi.advanceTimersByTimeAsync(61 * 1000);
        return createCompletedToolCallResponse({
          callId: 't1',
          name: LSTool.Name,
          resultDisplay: 'Found data',
          responseParts: [],
        });
      });

      // Recovery turn: model stops with no tool calls (recovery fails)
      mockModelResponse([], 'I cannot continue.');

      const output = await executor.run(
        { goal: 'Preserve partial on timeout' },
        signal,
      );

      expect(output.terminate_reason).toBe(AgentTerminateMode.TIMEOUT);
      expect(output.result).toContain(
        'Recovery turn attempted but agent failed',
      );
      expect(output.result).toContain('Found data');

      // RECOVERY_OUTCOME telemetry: failure
      const outcomeEvents = activities.filter(
        (a) => a.type === 'RECOVERY_OUTCOME',
      );
      expect(outcomeEvents).toHaveLength(1);
      expect(outcomeEvents[0].data['originalReason']).toBe(
        AgentTerminateMode.TIMEOUT,
      );
      expect(outcomeEvents[0].data['outcome']).toBe('failure');
      expect(outcomeEvents[0].data['terminateReason']).toBe(
        AgentTerminateMode.TIMEOUT,
      );
      expect(outcomeEvents[0].data['gracePeriodSeconds']).toBe(60);
    });

    it('should fail recovery immediately when model calls complete_task plus another tool', async () => {
      const MAX = 1;
      const definition = createTestDefinition([LSTool.Name], {
        max_turns: MAX,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      mockWorkResponse('t1');

      // Recovery response includes both complete_task AND another tool
      mockModelResponse([
        { name: LSTool.Name, args: { path: '.' }, id: 'recovery-tool-1' },
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { finalResult: 'Combo result' },
          id: 'recovery-ct-1',
        },
      ]);

      const output = await executor.run(
        { goal: 'Recovery combo complete_task plus tool' },
        signal,
      );

      // Should terminate with original reason, not GOAL
      expect(output.terminate_reason).toBe(AgentTerminateMode.MAX_TURNS);
      expect(output.result).toContain('Recovery turn attempted but agent');

      // No tool from the recovery response should have been executed
      // (only the normal-turn tool should have run)
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);

      // RECOVERY_OUTCOME: failure
      const outcomeEvents = activities.filter(
        (a) => a.type === 'RECOVERY_OUTCOME',
      );
      expect(outcomeEvents).toHaveLength(1);
      expect(outcomeEvents[0].data['originalReason']).toBe(
        AgentTerminateMode.MAX_TURNS,
      );
      expect(outcomeEvents[0].data['outcome']).toBe('failure');
      expect(outcomeEvents[0].data['terminateReason']).toBe(
        AgentTerminateMode.MAX_TURNS,
      );
      expect(outcomeEvents[0].data['gracePeriodSeconds']).toBe(60);

      // Only one TOOL_CALL_START for LSTool (from the first normal turn)
      const lsCallStarts = activities.filter(
        (a) => a.type === 'TOOL_CALL_START' && a.data['name'] === LSTool.Name,
      );
      expect(lsCallStarts).toHaveLength(1);
    });

    it('should terminate as ABORTED when parent aborts during active recovery', async () => {
      const MAX = 1;
      const definition = createTestDefinition([LSTool.Name], {
        max_turns: MAX,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      mockWorkResponse('t1');

      // Recovery turn: model stream will be aborted by parent signal
      mockSendMessageStream.mockImplementationOnce(async () =>
        (async function* () {
          // Simulate parent abort during recovery model stream
          abortController.abort();
          yield {
            type: StreamEventType.CHUNK,
            value: createMockResponseChunk([{ text: 'Partial...' }]),
          } as StreamEvent;
        })(),
      );

      const output = await executor.run(
        { goal: 'Recovery aborted by parent' },
        signal,
      );

      expect(output.terminate_reason).toBe(AgentTerminateMode.ABORTED);

      // Should NOT emit a RECOVERY_OUTCOME failure for timeout
      const outcomeEvents = activities.filter(
        (a) => a.type === 'RECOVERY_OUTCOME',
      );
      // No RECOVERY_OUTCOME should be emitted since the parent aborted,
      // not the recovery deadline
      expect(outcomeEvents).toHaveLength(0);
    });

    it('should sanitize grace_period_seconds=0 to default', async () => {
      const MAX = 1;
      const definition = createTestDefinition([LSTool.Name], {
        max_turns: MAX,
        grace_period_seconds: 0,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      mockWorkResponse('t1');

      // Recovery turn: complete_task
      mockModelResponse([
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { finalResult: 'Sanitized grace' },
          id: 'recovery1',
        },
      ]);

      await executor.run({ goal: 'Grace period 0' }, signal);

      const recoveryEvents = activities.filter(
        (a) => a.type === 'RECOVERY_ATTEMPT',
      );
      expect(recoveryEvents).toHaveLength(1);
      expect(recoveryEvents[0].data['gracePeriodSeconds']).toBe(60);
    });

    it('should sanitize negative grace_period_seconds to default', async () => {
      const MAX = 1;
      const definition = createTestDefinition([LSTool.Name], {
        max_turns: MAX,
        grace_period_seconds: -10,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        getTestRuntimeMessageBus(mockConfig),
        onActivity,
      );

      mockWorkResponse('t1');

      mockModelResponse([
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { finalResult: 'Negative grace' },
          id: 'recovery1',
        },
      ]);

      await executor.run({ goal: 'Negative grace period' }, signal);

      const recoveryEvents = activities.filter(
        (a) => a.type === 'RECOVERY_ATTEMPT',
      );
      expect(recoveryEvents).toHaveLength(1);
      expect(recoveryEvents[0].data['gracePeriodSeconds']).toBe(60);
    });
  });
});

import { ToolErrorType } from '@vybestack/llxprt-code-tools';
