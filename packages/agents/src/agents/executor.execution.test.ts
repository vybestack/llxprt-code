/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentExecutor } from './executor.js';
import type { AgentInputs } from './types.js';
import { getTestRuntimeMessageBus } from '@vybestack/llxprt-code-core/test-utils/config.js';
import { LSTool } from '@vybestack/llxprt-code-tools';
import { ReadFileTool } from '@vybestack/llxprt-code-tools';
import { ChatSession } from '../core/chatSession.js';
import { type FunctionCall } from '@google/genai';
import { getDirectoryContextString } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import { debugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';
import {
  setupExecutorFixture,
  createTestDefinition,
  getMockMessageParams,
  mockModelResponse,
  createCompletedToolCallResponse,
  TASK_COMPLETE_TOOL_NAME,
  AgentTerminateMode,
  type ExecutorTestFixture,
  type MockFn,
} from './executor-test-helpers.js';

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

describe('AgentExecutor run (Execution Loop and Logic)', () => {
  let fixture: ExecutorTestFixture;

  beforeEach(() => {
    fixture = setupExecutorFixture({
      MockedChatSession,
      mockSendMessageStream: mockSendMessageStream as MockFn,
      mockExecuteToolCall: mockExecuteToolCall as MockFn,
      mockedGetDirectoryContextString:
        mockedGetDirectoryContextString as MockFn,
      vi,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should execute successfully when model calls complete_task with output (Happy Path with Output)', async () => {
    const definition = createTestDefinition();
    const executor = await AgentExecutor.create(
      definition,
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );
    const inputs: AgentInputs = { goal: 'Find files' };

    // Turn 1: Model calls ls
    mockModelResponse(
      mockSendMessageStream,
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
      mockSendMessageStream,
      [
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { finalResult: 'Found file1.txt' },
          id: 'call2',
        },
      ],
      'T2: Done',
    );

    const output = await executor.run(inputs, fixture.signal);

    expect(mockSendMessageStream).toHaveBeenCalledTimes(2);

    const chatConstructorArgs = MockedChatSession.mock.calls[0];
    const chatConfig = chatConstructorArgs[2]; // generationConfig is the 3rd argument (index 2)
    expect(chatConfig?.systemInstruction).toContain(
      `MUST call the \`${TASK_COMPLETE_TOOL_NAME}\` tool`,
    );

    const turn1Params = getMockMessageParams(mockSendMessageStream, 0);
    const firstToolGroup = turn1Params.config?.tools?.[0];
    expect(firstToolGroup).toBeDefined();
    expect('functionDeclarations' in firstToolGroup!).toBeTruthy();
    const sentTools = (firstToolGroup as { functionDeclarations: unknown[] })
      .functionDeclarations;

    expect(sentTools).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: LSTool.Name }),
        expect.objectContaining({ name: TASK_COMPLETE_TOOL_NAME }),
      ]),
    );

    const completeToolDef = sentTools.find(
      (t: { name: string }) => t.name === TASK_COMPLETE_TOOL_NAME,
    );
    expect(completeToolDef?.parameters?.required).toContain('finalResult');

    expect(output.result).toBe('Found file1.txt');
    expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);

    expect(fixture.activities).toStrictEqual(
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockModelResponse(mockSendMessageStream, [
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
      mockSendMessageStream,
      [{ name: TASK_COMPLETE_TOOL_NAME, args: {}, id: 'call2' }],
      'Task finished.',
    );

    const output = await executor.run({ goal: 'Do work' }, fixture.signal);

    const turn1Params = getMockMessageParams(mockSendMessageStream, 0);
    const firstToolGroup = turn1Params.config?.tools?.[0];
    expect(firstToolGroup).toBeDefined();
    expect('functionDeclarations' in firstToolGroup!).toBeTruthy();
    const sentTools = (firstToolGroup as { functionDeclarations: unknown[] })
      .functionDeclarations;

    const completeToolDef = sentTools.find(
      (t: { name: string }) => t.name === TASK_COMPLETE_TOOL_NAME,
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockModelResponse(mockSendMessageStream, [
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
    mockModelResponse(mockSendMessageStream, [], 'I think I am done.');

    // After protocol violation, executor enters recovery and sends a warning.
    mockModelResponse(mockSendMessageStream, [], 'I still cannot complete.');

    const output = await executor.run({ goal: 'Strict test' }, fixture.signal);

    expect(output.terminate_reason).toBe(
      AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
    );

    expect(fixture.activities).toContainEqual(
      expect.objectContaining({
        type: 'RECOVERY_ATTEMPT',
        data: expect.objectContaining({
          originalReason: AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
        }),
      }),
    );

    // 1 normal + 1 warning+recovery attempt + 1 recovery model response
    expect(mockSendMessageStream).toHaveBeenCalledTimes(3);
  });

  it('should report an error if complete_task is called with missing required arguments', async () => {
    const definition = createTestDefinition();
    const executor = await AgentExecutor.create(
      definition,
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockModelResponse(mockSendMessageStream, [
      {
        name: TASK_COMPLETE_TOOL_NAME,
        args: { wrongArg: 'oops' },
        id: 'call1',
      },
    ]);

    mockModelResponse(mockSendMessageStream, [
      {
        name: TASK_COMPLETE_TOOL_NAME,
        args: { finalResult: 'Corrected result' },
        id: 'call2',
      },
    ]);

    const output = await executor.run({ goal: 'Error test' }, fixture.signal);

    expect(mockSendMessageStream).toHaveBeenCalledTimes(2);

    const expectedError =
      "Missing required argument 'finalResult' for completion.";

    expect(fixture.activities).toContainEqual(
      expect.objectContaining({
        type: 'ERROR',
        data: {
          context: 'tool_call',
          name: TASK_COMPLETE_TOOL_NAME,
          error: expectedError,
        },
      }),
    );

    const turn2Params = getMockMessageParams(mockSendMessageStream, 1);
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockModelResponse(mockSendMessageStream, [
      { name: TASK_COMPLETE_TOOL_NAME, args: {}, id: 'call1' },
      { name: TASK_COMPLETE_TOOL_NAME, args: {}, id: 'call2' },
    ]);

    const output = await executor.run({ goal: 'Dup test' }, fixture.signal);

    expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
    expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);

    const completions = fixture.activities.filter(
      (a) =>
        a.type === 'TOOL_CALL_END' &&
        a.data['name'] === TASK_COMPLETE_TOOL_NAME,
    );
    const errors = fixture.activities.filter(
      (a) => a.type === 'ERROR' && a.data['name'] === TASK_COMPLETE_TOOL_NAME,
    );

    expect(completions).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].data['error']).toContain(
      'Task already marked complete in this turn',
    );
  });

  it('should execute parallel tool calls and then complete', async () => {
    const definition = createTestDefinition([LSTool.Name]);
    const executor = await AgentExecutor.create(
      definition,
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
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

    mockModelResponse(mockSendMessageStream, [call1, call2]);

    let callsStarted = 0;
    const resolverHolder: { resolve?: () => void } = {};
    const bothStarted = new Promise<void>((resolve) => {
      resolverHolder.resolve = resolve;
    });

    mockExecuteToolCall.mockImplementation(async (_ctx, reqInfo) => {
      callsStarted++;
      const shouldSignal = callsStarted === 2;
      await vi.advanceTimersByTimeAsync(100);
      // Signal after the await to avoid re-entrancy issues.
      void (shouldSignal && resolverHolder.resolve?.());
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

    mockModelResponse(mockSendMessageStream, [
      {
        name: TASK_COMPLETE_TOOL_NAME,
        args: { finalResult: 'done' },
        id: 'c3',
      },
    ]);

    const runPromise = executor.run({ goal: 'Parallel' }, fixture.signal);

    await vi.advanceTimersByTimeAsync(1);
    await bothStarted;
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(1);

    const output = await runPromise;

    expect(mockExecuteToolCall).toHaveBeenCalledTimes(2);
    expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);

    const turn2Params = getMockMessageParams(mockSendMessageStream, 1);
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    const badCallId = 'bad_call_1';
    mockModelResponse(mockSendMessageStream, [
      {
        name: ReadFileTool.Name,
        args: { path: 'secret.txt' },
        id: badCallId,
      },
    ]);

    mockModelResponse(mockSendMessageStream, [
      {
        name: TASK_COMPLETE_TOOL_NAME,
        args: { finalResult: 'Could not read file.' },
        id: 'c2',
      },
    ]);

    const consoleWarnSpy = vi
      .spyOn(debugLogger, 'warn')
      .mockImplementation(() => {});

    await executor.run({ goal: 'Sec test' }, fixture.signal);

    expect(mockExecuteToolCall).not.toHaveBeenCalled();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[AgentExecutor] Blocked call:`),
    );
    consoleWarnSpy.mockRestore();

    const turn2Params = getMockMessageParams(mockSendMessageStream, 1);
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

    expect(fixture.activities).toContainEqual(
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
