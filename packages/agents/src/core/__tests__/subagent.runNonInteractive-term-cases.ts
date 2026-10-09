/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, type Mock } from 'bun:test';

type StreamMock = Mock<(...args: never[]) => unknown>;
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import { SubAgentScope } from '../subagent.js';
import {
  ContextState,
  SubagentTerminateMode,
  type PromptConfig,
  type RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { StreamEventType } from '../chatSession.js';
import { mockChunk } from './turn-test-helpers.js';
import {
  createMockConfig,
  createMockStream,
  defaultModelConfig,
  defaultRunConfig,
  createRuntimeOverrides,
} from './subagent-test-helpers.js';
import { waitForCondition } from '../../test-utils/eventLoop.js';

/**
 * Turn budget for condition waits that gate fake-time advancement or run-entry
 * observation. The 2000-turn default is only ~10ms of wall-clock headroom,
 * which the concurrent agents workspace runner's CPU contention was observed to
 * exhaust; 200_000 turns survives that load while still returning false instead
 * of hanging when the condition genuinely cannot be met.
 */
const CONDITION_WAIT_TURNS = 200_000;
const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

export function registerTerminationTests(
  getMockSendMessageStream: () => StreamMock,
): void {
  describe('runNonInteractive - Termination and Recovery', () => {
    registerMaxTurns(getMockSendMessageStream);
    registerLlmTimeout(getMockSendMessageStream);
    registerIdleAbort(getMockSendMessageStream);
    registerModelFailure(getMockSendMessageStream);
    registerHungModelAbort(getMockSendMessageStream);
  });
}

function registerMaxTurns(getMockSendMessageStream: () => StreamMock): void {
  it('should terminate with MAX_TURNS if the limit is reached', async () => {
    const { config } = await createMockConfig();
    const runConfig: RunConfig = { ...defaultRunConfig, max_turns: 2 };

    // Model keeps looping by calling emitvalue repeatedly
    getMockSendMessageStream().mockImplementation(
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

    expect(getMockSendMessageStream()).toHaveBeenCalledTimes(2);
    expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.MAX_TURNS);
  });
}

function registerLlmTimeout(getMockSendMessageStream: () => StreamMock): void {
  it('should terminate with TIMEOUT if the time limit is reached during an LLM call', async () => {
    const { config } = await createMockConfig();
    // Install fake timers after config creation so config/auth setup runs on
    // real timers; fake timers freeze Date.now/performance.now/hrtime and
    // stop Bun's per-test timeout from firing.
    vi.useFakeTimers();
    const runConfig: RunConfig = { max_time_minutes: 5, max_turns: 100 };

    // We need to control the resolution of the sendMessageStream promise to advance the timer during execution.
    let resolveStream: (value: AsyncGenerator<unknown, void, unknown>) => void;
    const streamPromise = new Promise<AsyncGenerator<unknown, void, unknown>>(
      (resolve) => {
        resolveStream = resolve as typeof resolveStream;
      },
    );

    // The LLM call will hang until we resolve the promise.
    getMockSendMessageStream().mockReturnValue(streamPromise);

    // Resolved if the stream promise is still pending at cleanup time, to
    // unblock a run orphaned by an earlier assertion failure.
    let streamResolved = false;
    let scope: SubAgentScope | undefined;
    let runPromise: Promise<void> | undefined;
    try {
      const { overrides: timeoutOverrides } = createRuntimeOverrides();
      scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        runConfig,
        undefined,
        undefined,
        timeoutOverrides,
      );

      runPromise = scope.runNonInteractive(new ContextState());

      // Advance time beyond the limit (6 minutes) while the agent is awaiting the LLM response.
      // Wait for the executor to enter the LLM call before advancing time.
      expect(
        await waitForCondition(
          () => getMockSendMessageStream().mock.calls.length > 0,
          CONDITION_WAIT_TURNS,
        ),
      ).toBe(true);
      // The timeout callback is synchronous. Avoid the async timer helper here:
      // its event-loop flush can stall after Bun advances fake time on Linux.
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Now resolve the stream. The model returns 'stop'.

      resolveStream!(createMockStream(['stop'])());
      streamResolved = true;

      await runPromise;

      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
    } finally {
      vi.useRealTimers();
      // If the run never started (assertion threw first), dispose aborts any
      // active scope work and resolving the held stream unblocks the orphan so
      // no async leak survives into the next test. The rejection absorbers
      // must never be awaited: a stalled chain under fake timers would turn
      // cleanup into a hang.
      if (runPromise !== undefined) {
        runPromise.catch(() => {});
      }
      if (!streamResolved) {
        resolveStream!(createMockStream(['stop'])());
        scope?.dispose();
      }
    }
  });
}

function registerIdleAbort(getMockSendMessageStream: () => StreamMock): void {
  it('should actively abort a stalled non-interactive response stream before the overall run timeout expires', async () => {
    const { signalObserved, scope, abortedObservation, abortError } =
      await observeActivelyAbortAStalledNonInteractiveResponseStreamBeforeTheOverallRun(
        getMockSendMessageStream,
      );
    expect(signalObserved).toBe(true);
    expect(abortError).toMatchObject({ name: 'AbortError' });
    expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
    expect(abortedObservation).toBe(true);
    expect(getMockSendMessageStream()).toHaveBeenCalledTimes(1);
  });
}

function registerModelFailure(
  getMockSendMessageStream: () => StreamMock,
): void {
  it('should terminate with ERROR if the model call throws', async () => {
    const { config } = await createMockConfig();
    getMockSendMessageStream().mockImplementation(() =>
      Promise.reject(new Error('API Failure')),
    );

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

    await expect(scope.runNonInteractive(new ContextState())).rejects.toThrow(
      'API Failure',
    );
    expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
  });
}

function registerHungModelAbort(
  getMockSendMessageStream: () => StreamMock,
): void {
  it('should actively abort a hung non-interactive model call when the time limit expires', async () => {
    const { signalObserved, scope, abortedObservation, abortError } =
      await observeActivelyAbortAHungNonInteractiveModelCallWhenTheTimeLimit(
        getMockSendMessageStream,
      );
    expect(signalObserved).toBe(true);
    expect(abortError).toMatchObject({ name: 'AbortError' });
    expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.TIMEOUT);
    expect(abortedObservation).toBe(true);
  });
}

const observeActivelyAbortAStalledNonInteractiveResponseStreamBeforeTheOverallRun =
  async (getMockSendMessageStream: () => StreamMock) => {
    const { config } = await createMockConfig();
    const testTimeoutMs = 30_000; // 30 second timeout for this test
    config.setEphemeralSetting('stream-idle-timeout-ms', testTimeoutMs);
    // Install fake timers after config creation so config/auth setup runs
    // on real timers; fake timers freeze Date.now/performance.now/hrtime
    // and stop Bun's per-test timeout from firing.
    vi.useFakeTimers();

    const runConfig: RunConfig = { max_time_minutes: 5, max_turns: 100 };
    let capturedSignal: AbortSignal | undefined;

    installStalledResponseStream(getMockSendMessageStream, (signal) => {
      capturedSignal = signal;
    });

    const { overrides } = createRuntimeOverrides();
    const scope = await SubAgentScope.create(
      'test-agent',
      config,
      promptConfig,
      defaultModelConfig,
      runConfig,
      undefined,
      undefined,
      overrides,
    );

    const runPromise = scope.runNonInteractive(new ContextState());
    const runRejection = runPromise.then(
      () => {
        throw new Error('Expected stalled subagent stream to abort');
      },
      (error: unknown) => error,
    );

    try {
      // Wait for the executor's async setup chain to register the
      // stream-idle-timeout timer before advancing fake time.
      const signalObserved = await waitForCondition(
        () => capturedSignal !== undefined,
        CONDITION_WAIT_TURNS,
      );

      await advanceTimersByTimeAsync(testTimeoutMs + 1_000);

      const abortError = await runRejection;

      const abortedObservation = capturedSignal?.aborted;
      return { signalObserved, scope, abortedObservation, abortError };
    } finally {
      vi.useRealTimers();
      // If the wait failed, runRejection may be abandoned; dispose
      // aborts the still-in-flight run and the absorbers swallow its
      // rejection so nothing leaks into the next test. Do not await.
      runPromise.catch(() => {});
      runRejection.catch(() => {});
      scope.dispose();
    }
  };

const observeActivelyAbortAHungNonInteractiveModelCallWhenTheTimeLimit = async (
  getMockSendMessageStream: () => StreamMock,
) => {
  const { config } = await createMockConfig();
  const runConfig: RunConfig = {
    max_time_minutes: 0.001,
    max_turns: 100,
  };
  // Install fake timers after config creation so config/auth setup runs
  // on real timers; fake timers freeze Date.now/performance.now/hrtime
  // and stop Bun's per-test timeout from firing.
  vi.useFakeTimers();
  let capturedSignal: AbortSignal | undefined;

  installHungModelStream(getMockSendMessageStream, (signal) => {
    capturedSignal = signal;
  });

  const { overrides } = createRuntimeOverrides();
  const scope = await SubAgentScope.create(
    'test-agent',
    config,
    promptConfig,
    defaultModelConfig,
    runConfig,
    undefined,
    undefined,
    overrides,
  );

  const runPromise = scope.runNonInteractive(new ContextState());
  const runRejection = runPromise.then(
    () => {
      throw new Error('Expected timed out subagent run to abort');
    },
    (error: unknown) => error,
  );

  try {
    const signalObserved = await waitForCondition(
      () => capturedSignal !== undefined,
      CONDITION_WAIT_TURNS,
    );
    await advanceTimersByTimeAsync(100);

    const abortError = await runRejection;

    const abortedObservation = capturedSignal?.aborted;
    return { signalObserved, scope, abortedObservation, abortError };
  } finally {
    vi.useRealTimers();
    // If the wait failed, runRejection may be abandoned; dispose
    // aborts the still-in-flight run and the absorbers swallow its
    // rejection so nothing leaks into the next test. Do not await.
    runPromise.catch(() => {});
    runRejection.catch(() => {});
    scope.dispose();
  }
};

function installStalledResponseStream(
  getMockSendMessageStream: () => StreamMock,
  onSignal: (signal: AbortSignal) => void,
): void {
  let capturedSignal: AbortSignal | undefined;
  getMockSendMessageStream().mockImplementation(
    async ({
      config: messageConfig,
    }: {
      config: { abortSignal: AbortSignal };
    }) => {
      capturedSignal = messageConfig.abortSignal;
      onSignal(capturedSignal);
      return (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: 'partial output' }),
        };

        await new Promise<void>((resolve) => {
          if (!capturedSignal) {
            throw new Error('Abort signal was not provided');
          }
          if (capturedSignal.aborted) {
            throw createAbortError();
          }
          capturedSignal.addEventListener(
            'abort',
            () => {
              resolve();
            },
            { once: true },
          );
        });
        throw createAbortError();
      })();
    },
  );
}

function installHungModelStream(
  getMockSendMessageStream: () => StreamMock,
  onSignal: (signal: AbortSignal) => void,
): void {
  let capturedSignal: AbortSignal | undefined;
  getMockSendMessageStream().mockImplementation(
    async ({
      config: messageConfig,
    }: {
      config: { abortSignal: AbortSignal };
    }) => {
      capturedSignal = messageConfig.abortSignal;
      onSignal(capturedSignal);
      const stall = async function* () {
        await new Promise<void>((resolve) => {
          if (!capturedSignal) {
            throw new Error('Abort signal was not provided');
          }
          if (capturedSignal.aborted) {
            throw createAbortError();
          }
          capturedSignal.addEventListener(
            'abort',
            () => {
              resolve();
            },
            { once: true },
          );
        });
        yield* [];
        throw createAbortError();
      };
      return stall();
    },
  );
}
