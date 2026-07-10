/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentExecutor } from './executor.js';
import { getTestRuntimeMessageBus } from '@vybestack/llxprt-code-core/test-utils/config.js';
import { LSTool } from '@vybestack/llxprt-code-tools';
import {
  ChatSession,
  StreamEventType,
  type StreamEvent,
} from '../core/chatSession.js';
import { getDirectoryContextString } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import type { Part } from '@google/genai';
import {
  setupExecutorFixture,
  createTestDefinition,
  getMockMessageParams,
  mockModelResponse,
  createMockResponseChunk,
  createCompletedToolCallResponse,
  mockWorkResponse,
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

/**
 * Safely extracts text from a Part, returning empty string when not a text part.
 */
const extractPartText = (part: Part): string =>
  'text' in part && typeof part.text === 'string' ? part.text : '';

describe('AgentExecutor (Recovery Turn)', () => {
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

  it('should give a recovery turn on MAX_TURNS and return GOAL if complete_task is called', async () => {
    const MAX = 2;
    const definition = createTestDefinition([LSTool.Name], {
      max_turns: MAX,
    });
    const executor = await AgentExecutor.create(
      definition,
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockWorkResponse(mockSendMessageStream, mockExecuteToolCall, 't1');
    mockWorkResponse(mockSendMessageStream, mockExecuteToolCall, 't2');

    mockModelResponse(mockSendMessageStream, [
      {
        name: TASK_COMPLETE_TOOL_NAME,
        args: { finalResult: 'Partial result after max turns' },
        id: 'recovery1',
      },
    ]);

    const output = await executor.run(
      { goal: 'Recovery MAX_TURNS' },
      fixture.signal,
    );

    expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);
    expect(output.result).toBe('Partial result after max turns');

    expect(mockSendMessageStream).toHaveBeenCalledTimes(3);

    const thoughtChunks = fixture.activities.filter(
      (a) => a.type === 'THOUGHT_CHUNK',
    );
    expect(thoughtChunks.length).toBeGreaterThanOrEqual(1);
    const lastThought = thoughtChunks[thoughtChunks.length - 1].data[
      'text'
    ] as string;
    expect(lastThought).toContain('Execution limit reached');
    expect(lastThought).toContain('MAX_TURNS');

    const recoveryEvents = fixture.activities.filter(
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockWorkResponse(mockSendMessageStream, mockExecuteToolCall, 't1');
    mockWorkResponse(mockSendMessageStream, mockExecuteToolCall, 't2');

    // Recovery turn: model calls a tool instead of complete_task.
    // With checkRecoveryToolCalls rejecting non-solo-complete_task, this
    // terminates immediately without executing the tool.
    mockModelResponse(mockSendMessageStream, [
      { name: LSTool.Name, args: { path: '.' }, id: 'recovery-t1' },
    ]);

    const output = await executor.run(
      { goal: 'Recovery MAX_TURNS fails' },
      fixture.signal,
    );

    expect(output.terminate_reason).toBe(AgentTerminateMode.MAX_TURNS);
    expect(output.result).toContain('Recovery turn attempted but agent');

    const outcomeEvents = fixture.activities.filter(
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockModelResponse(mockSendMessageStream, [
      { name: LSTool.Name, args: { path: '.' }, id: 't1' },
    ]);
    mockExecuteToolCall.mockImplementationOnce(async () => {
      await vi.advanceTimersByTimeAsync(61 * 1000);
      return createCompletedToolCallResponse({
        callId: 't1',
        name: LSTool.Name,
        resultDisplay: 'ok',
        responseParts: [],
      });
    });

    mockModelResponse(mockSendMessageStream, [
      {
        name: TASK_COMPLETE_TOOL_NAME,
        args: { finalResult: 'Timed out partial' },
        id: 'recovery1',
      },
    ]);

    const output = await executor.run(
      { goal: 'Recovery TIMEOUT' },
      fixture.signal,
    );

    expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);
    expect(output.result).toBe('Timed out partial');

    const recoveryEvents = fixture.activities.filter(
      (a) => a.type === 'RECOVERY_ATTEMPT',
    );
    expect(recoveryEvents).toHaveLength(1);
    expect(recoveryEvents[0].data['originalReason']).toBe(
      AgentTerminateMode.TIMEOUT,
    );

    const outcomeEvents = fixture.activities.filter(
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    // Turn 1: model stops with no tool calls (protocol violation)
    mockModelResponse(mockSendMessageStream, [], 'I think I am done.');

    // Recovery turn: model calls complete_task
    mockModelResponse(mockSendMessageStream, [
      {
        name: TASK_COMPLETE_TOOL_NAME,
        args: { finalResult: 'Recovered from protocol violation' },
        id: 'recovery1',
      },
    ]);

    const output = await executor.run(
      { goal: 'Recovery protocol violation' },
      fixture.signal,
    );

    expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);
    expect(output.result).toBe('Recovered from protocol violation');

    const recoveryEvents = fixture.activities.filter(
      (a) => a.type === 'RECOVERY_ATTEMPT',
    );
    expect(recoveryEvents).toHaveLength(1);
    expect(recoveryEvents[0].data['originalReason']).toBe(
      AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
    );

    // The protocol violation path should NOT have emitted an ERROR because
    // we now go directly into recovery.
    const errorEvents = fixture.activities.filter(
      (a) => a.type === 'ERROR' && a.data['context'] === 'protocol_violation',
    );
    expect(errorEvents).toHaveLength(0);

    const outcomeEvents = fixture.activities.filter(
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    // Turn 1: model stops with no tool calls (protocol violation)
    mockModelResponse(mockSendMessageStream, [], 'I think I am done.');

    // Recovery turn: model STILL stops with no tool calls (recovery fails)
    mockModelResponse(
      mockSendMessageStream,
      [],
      'Still not calling complete_task.',
    );

    const output = await executor.run(
      { goal: 'Recovery protocol violation fails' },
      fixture.signal,
    );

    expect(output.terminate_reason).toBe(
      AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
    );
    expect(output.result).toContain('Recovery turn attempted but agent');
    expect(output.result).toContain(TASK_COMPLETE_TOOL_NAME);

    const outcomeEvents = fixture.activities.filter(
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockWorkResponse(mockSendMessageStream, mockExecuteToolCall, 't1');

    mockModelResponse(mockSendMessageStream, [
      {
        name: TASK_COMPLETE_TOOL_NAME,
        args: { finalResult: 'Custom grace period' },
        id: 'recovery1',
      },
    ]);

    await executor.run({ goal: 'Custom grace period' }, fixture.signal);

    const recoveryEvents = fixture.activities.filter(
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockWorkResponse(mockSendMessageStream, mockExecuteToolCall, 't1');

    mockModelResponse(mockSendMessageStream, [
      {
        name: TASK_COMPLETE_TOOL_NAME,
        args: { finalResult: 'Default grace' },
        id: 'recovery1',
      },
    ]);

    await executor.run({ goal: 'Default grace period' }, fixture.signal);

    const recoveryEvents = fixture.activities.filter(
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockWorkResponse(mockSendMessageStream, mockExecuteToolCall, 't1');

    mockModelResponse(mockSendMessageStream, [
      {
        name: TASK_COMPLETE_TOOL_NAME,
        args: { finalResult: 'Done' },
        id: 'recovery1',
      },
    ]);

    await executor.run({ goal: 'Check warning message' }, fixture.signal);

    // The second call to sendMessageStream should contain the warning message
    const secondCallParams = getMockMessageParams(mockSendMessageStream, 1);
    const messageParts = secondCallParams.message;
    expect(messageParts).toBeDefined();
    expect(messageParts).toHaveLength(1);
    const part = messageParts![0];
    expect(part).toHaveProperty('text');
    const text = extractPartText(part);
    expect(text).toContain('WARNING');
    expect(text).toContain(TASK_COMPLETE_TOOL_NAME);
    expect(text).toContain('ONE final chance');
  });

  it('should NOT enter recovery for ABORTED termination', async () => {
    const definition = createTestDefinition();
    const executor = await AgentExecutor.create(
      definition,
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockSendMessageStream.mockImplementationOnce(async () =>
      (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: createMockResponseChunk([
            { text: 'Thinking...', thought: true },
          ]),
        } as StreamEvent;
        fixture.abortController.abort();
      })(),
    );

    const output = await executor.run({ goal: 'Abort test' }, fixture.signal);

    expect(output.terminate_reason).toBe(AgentTerminateMode.ABORTED);

    const recoveryEvents = fixture.activities.filter(
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockWorkResponse(mockSendMessageStream, mockExecuteToolCall, 't1');

    // Recovery turn: model calls a normal tool instead of complete_task.
    // With the checkRecoveryToolCalls fix, this is now rejected immediately
    // and the loop does NOT execute the non-complete tool.
    mockModelResponse(mockSendMessageStream, [
      { name: LSTool.Name, args: { path: '.' }, id: 'recovery-t1' },
    ]);

    const output = await executor.run(
      { goal: 'No double recovery' },
      fixture.signal,
    );

    expect(output.terminate_reason).toBe(AgentTerminateMode.MAX_TURNS);
    expect(output.result).toContain('Recovery turn attempted but agent');

    // Only ONE recovery attempt should have been recorded
    const recoveryEvents = fixture.activities.filter(
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockModelResponse(mockSendMessageStream, [
      { name: LSTool.Name, args: { path: '.' }, id: 't1' },
    ]);
    mockExecuteToolCall.mockResolvedValueOnce(
      createCompletedToolCallResponse({
        callId: 't1',
        name: LSTool.Name,
        resultDisplay: 'First partial result',
        responseParts: [],
      }),
    );
    mockModelResponse(mockSendMessageStream, [
      { name: LSTool.Name, args: { path: '.' }, id: 't2' },
    ]);
    mockExecuteToolCall.mockResolvedValueOnce(
      createCompletedToolCallResponse({
        callId: 't2',
        name: LSTool.Name,
        resultDisplay: 'Latest partial result',
        responseParts: [],
      }),
    );
    mockModelResponse(mockSendMessageStream, [], 'Recovery fails.');

    const output = await executor.run(
      { goal: 'Preserve latest partial result' },
      fixture.signal,
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    // Turn 1: normal tool call
    mockModelResponse(mockSendMessageStream, [
      { name: LSTool.Name, args: { path: '.' }, id: 't1' },
    ]);
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
    mockModelResponse(mockSendMessageStream, [], 'I cannot continue.');

    const output = await executor.run(
      { goal: 'Preserve partial on timeout' },
      fixture.signal,
    );

    expect(output.terminate_reason).toBe(AgentTerminateMode.TIMEOUT);
    expect(output.result).toContain('Recovery turn attempted but agent failed');
    expect(output.result).toContain('Found data');

    const outcomeEvents = fixture.activities.filter(
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockWorkResponse(mockSendMessageStream, mockExecuteToolCall, 't1');

    // Recovery response includes both complete_task AND another tool
    mockModelResponse(mockSendMessageStream, [
      { name: LSTool.Name, args: { path: '.' }, id: 'recovery-tool-1' },
      {
        name: TASK_COMPLETE_TOOL_NAME,
        args: { finalResult: 'Combo result' },
        id: 'recovery-ct-1',
      },
    ]);

    const output = await executor.run(
      { goal: 'Recovery combo complete_task plus tool' },
      fixture.signal,
    );

    // Should terminate with original reason, not GOAL
    expect(output.terminate_reason).toBe(AgentTerminateMode.MAX_TURNS);
    expect(output.result).toContain('Recovery turn attempted but agent');

    // No tool from the recovery response should have been executed
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);

    const outcomeEvents = fixture.activities.filter(
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
    const lsCallStarts = fixture.activities.filter(
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockWorkResponse(mockSendMessageStream, mockExecuteToolCall, 't1');

    // Recovery turn: model stream will be aborted by parent signal
    mockSendMessageStream.mockImplementationOnce(async () =>
      (async function* () {
        // Simulate parent abort during recovery model stream
        fixture.abortController.abort();
        yield {
          type: StreamEventType.CHUNK,
          value: createMockResponseChunk([{ text: 'Partial...' }]),
        } as StreamEvent;
      })(),
    );

    const output = await executor.run(
      { goal: 'Recovery aborted by parent' },
      fixture.signal,
    );

    expect(output.terminate_reason).toBe(AgentTerminateMode.ABORTED);

    // Should NOT emit a RECOVERY_OUTCOME failure for timeout
    const outcomeEvents = fixture.activities.filter(
      (a) => a.type === 'RECOVERY_OUTCOME',
    );
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockWorkResponse(mockSendMessageStream, mockExecuteToolCall, 't1');

    mockModelResponse(mockSendMessageStream, [
      {
        name: TASK_COMPLETE_TOOL_NAME,
        args: { finalResult: 'Sanitized grace' },
        id: 'recovery1',
      },
    ]);

    await executor.run({ goal: 'Grace period 0' }, fixture.signal);

    const recoveryEvents = fixture.activities.filter(
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
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
      fixture.onActivity,
    );

    mockWorkResponse(mockSendMessageStream, mockExecuteToolCall, 't1');

    mockModelResponse(mockSendMessageStream, [
      {
        name: TASK_COMPLETE_TOOL_NAME,
        args: { finalResult: 'Negative grace' },
        id: 'recovery1',
      },
    ]);

    await executor.run({ goal: 'Negative grace period' }, fixture.signal);

    const recoveryEvents = fixture.activities.filter(
      (a) => a.type === 'RECOVERY_ATTEMPT',
    );
    expect(recoveryEvents).toHaveLength(1);
    expect(recoveryEvents[0].data['gracePeriodSeconds']).toBe(60);
  });
});
