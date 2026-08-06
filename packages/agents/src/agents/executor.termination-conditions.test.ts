/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from '../testApi.js';
import { AgentExecutor } from './executor.js';
import { getTestRuntimeMessageBus } from '@vybestack/llxprt-code-core/test-utils/config.js';
import { LSTool } from '@vybestack/llxprt-code-tools/tools/ls.js';
import {
  StreamEventType,
  type StreamEvent,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { getDirectoryContextString } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import {
  setupExecutorFixture,
  createTestDefinition,
  mockModelResponse,
  createMockResponseChunk,
  createCompletedToolCallResponse,
  mockWorkResponse,
  AgentTerminateMode,
  type ExecutorTestFixture,
  type MockFn,
} from './executor-test-helpers.js';
import { waitForCondition } from '../test-utils/eventLoop.js';

const { MockedChatSession, mockSendMessageStream, mockExecuteToolCall } = {
  MockedChatSession: vi.fn(),
  mockSendMessageStream: vi.fn(),
  mockExecuteToolCall: vi.fn(),
};

vi.mock('../core/chatSession.js', (importOriginal) => {
  const apply = (actual: typeof import('../core/chatSession.js')) => ({
    ...actual,
    ChatSession: MockedChatSession,
  });
  const result = importOriginal() as
    | typeof import('../core/chatSession.js')
    | Promise<typeof import('../core/chatSession.js')>;
  return result instanceof Promise ? result.then(apply) : apply(result);
});

vi.mock('../core/nonInteractiveToolExecutor.js', () => ({
  executeToolCall: mockExecuteToolCall,
}));

vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js');

const mockedGetDirectoryContextString = getDirectoryContextString as Mock<
  typeof getDirectoryContextString
>;

describe('AgentExecutor run (Termination Conditions)', () => {
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

  it('should terminate when max_turns is reached', async () => {
    const MAX = 2;
    const definition = createTestDefinition([LSTool.Name], {
      max_turns: MAX,
    });
    const executor = await AgentExecutor.create(
      definition,
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
    );

    mockWorkResponse(mockSendMessageStream, mockExecuteToolCall, 't1');
    mockWorkResponse(mockSendMessageStream, mockExecuteToolCall, 't2');

    // The recovery turn will also be checked: needs a model response
    mockModelResponse(mockSendMessageStream, [], 'No more calls.');

    const output = await executor.run({ goal: 'Turns test' }, fixture.signal);

    expect(output.terminate_reason).toBe(AgentTerminateMode.MAX_TURNS);
    expect(mockSendMessageStream).toHaveBeenCalledTimes(3);
  });

  it('should terminate if timeout is reached', async () => {
    const definition = createTestDefinition([LSTool.Name], {
      max_time_minutes: 1,
    });
    const executor = await AgentExecutor.create(
      definition,
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
    );

    mockModelResponse(mockSendMessageStream, [
      { name: LSTool.Name, args: { path: '.' }, id: 't1' },
    ]);

    mockExecuteToolCall.mockImplementationOnce(async () => {
      await advanceTimersByTimeAsync(61 * 1000);
      return createCompletedToolCallResponse({
        callId: 't1',
        name: LSTool.Name,
        resultDisplay: 'ok',
        responseParts: [],
      });
    });

    mockModelResponse(mockSendMessageStream, [], 'Recovery fails.');

    const output = await executor.run({ goal: 'Timeout test' }, fixture.signal);

    expect(output.terminate_reason).toBe(AgentTerminateMode.TIMEOUT);
    expect(mockSendMessageStream).toHaveBeenCalledTimes(2);
  });

  it('should actively abort a stalled response stream before the overall timeout expires', async () => {
    const testTimeoutMs = 30_000;
    fixture.mockConfig.setEphemeralSetting(
      'stream-idle-timeout-ms',
      testTimeoutMs,
    );

    const definition = createTestDefinition([LSTool.Name], {
      max_time_minutes: 5,
    });
    const executor = await AgentExecutor.create(
      definition,
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
    );

    let capturedSignal: AbortSignal | undefined;
    mockSendMessageStream.mockImplementationOnce(
      async ({ config: messageConfig }) => {
        const config = messageConfig as
          | { abortSignal?: AbortSignal }
          | undefined;
        capturedSignal = config?.abortSignal;
        return (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: createMockResponseChunk([{ text: 'partial output' }]),
          } as StreamEvent;

          if (!capturedSignal) {
            throw new Error('Abort signal was not provided');
          }
          const signal = capturedSignal;
          // The already-aborted case must be handled before subscribing:
          // adding an `abort` listener to a signal that has already aborted
          // never fires, so waiting on the event alone would hang whenever the
          // idle-timeout wins the race to abort before this line runs.
          if (!signal.aborted) {
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => resolve(), { once: true });
            });
          }
          throw createAbortError();
        })();
      },
    );

    const runPromise = executor.run({ goal: 'Stall test' }, fixture.signal);
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

    // Flush microtasks so the executor's async setup chain registers the
    // stream-idle-timeout timer before we advance fake time.
    expect(await waitForCondition(() => capturedSignal !== undefined)).toBe(
      true,
    );
    await advanceTimersByTimeAsync(testTimeoutMs + 1_000);

    await runRejection;
    expect(capturedSignal?.aborted).toBe(true);
    expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
  });

  it('should terminate when AbortSignal is triggered', async () => {
    const definition = createTestDefinition();
    const executor = await AgentExecutor.create(
      definition,
      fixture.mockConfig,
      getTestRuntimeMessageBus(fixture.mockConfig),
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
  });
});
