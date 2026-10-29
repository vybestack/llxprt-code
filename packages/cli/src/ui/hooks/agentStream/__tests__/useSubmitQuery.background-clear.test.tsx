/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test';
import { act, Suspense, useEffect } from 'react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  setImmediate as nextTurn,
  setTimeout as delay,
} from 'node:timers/promises';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { renderHook, waitFor } from '../../../../__tests__/render.js';
import { drain } from '../../../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { useOwnedCredentials } from '../../../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  buildTaskNotificationAgent,
  launchHeldNotificationTask,
} from '../../../../__tests__/task-notification-agent-fixture.js';
import { useSubmitQuery, type UseSubmitQueryDeps } from '../useSubmitQuery.js';
import { useQueuedSubmissions } from '../useQueuedSubmissions.js';
import { useAgentEventStream } from '../useAgentEventStream.js';
import { StreamingState } from '../../../types.js';
import type { QueuedSubmission } from '../types.js';
import { createDeferred } from './createDeferred.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';
import { streamPolicyOperations } from './stream-policy-operations.js';
import { submissionOperations } from './submission-operations.js';
import { agentStreamOperations } from './helpers/agentStreamOperations.js';
import { observeNotices } from './helpers/notice-gates.js';
import {
  createLoadedSettings,
  createMockOverrides,
  createQueueOperations,
} from './submitQueryTestFixtures.js';

void vi.mock('../useStreamEventHandlers.js', () => ({
  useStreamEventHandlers: () => ({
    displayUserMessage: () => {},
    prepareQueryForAgent: async (query: unknown) => ({
      queryToSend: query,
      shouldProceed: true,
    }),
    handleLoopDetectedEvent: () => {},
  }),
}));
void vi.mock('../../../contexts/SessionContext.js', () => ({
  useSessionStats: () => ({
    startNewPrompt: () => {},
    getPromptCount: () => 0,
  }),
}));
void vi.mock('../turnPreparation.js', () => ({
  prepareTurnForQuery: async () => {},
}));
void vi.mock('../streamUtils.js', () => ({
  handleSubmissionError: () => {},
  processSlashCommandResult: () => {},
}));

function renderNotificationQueue(
  agent: Agent,
  queuedSubmissionsRef: UseSubmitQueryDeps['queuedSubmissionsRef'],
  drainSuppressedRef: UseSubmitQueryDeps['drainSuppressedRef'],
  runStreamRef: UseSubmitQueryDeps['runStreamRef'],
  state: {
    current: StreamingState;
    suspension?: Promise<void>;
    committed?: { current: StreamingState };
  } = { current: StreamingState.Idle },
): ReturnType<
  typeof renderHook<
    ReturnType<typeof useSubmitQuery> & ReturnType<typeof useQueuedSubmissions>,
    undefined
  >
> {
  const noop = (): void => {};
  const streamOperations = agentStreamOperations(agent);
  const deps: UseSubmitQueryDeps = {
    ...{ runtime: createStreamRuntimeForTest({}, createMockOverrides()) },
    ...streamPolicyOperations(
      createStreamRuntimeForTest({}, createMockOverrides()),
    ),
    ...submissionOperations(agent, undefined, undefined),
    addItem: () => 1,
    settings: createLoadedSettings(),
    onDebugMessage: noop,
    onCancelSubmit: noop,
    onAuthError: noop,
    sanitizeContent: (text) => ({ text, blocked: false }),
    flushPendingHistoryItem: noop,

    pendingHistoryItemRef: { current: null },

    turnCancelledRef: { current: false },
    setTurnCancelled: noop,
    queuedSubmissionsRef,
    ...createQueueOperations(queuedSubmissionsRef),
    drainSuppressedRef,
    tryReserveDrain: () => true,
    releaseDrain: noop,
    setPendingHistoryItem: noop,
    setIsResponding: noop,
    setInitError: noop,
    setThought: noop,
    setLastAgentActivityTime: noop,
    scheduleToolCalls: async () => {},
    abortActiveStream: noop,
    handleShellCommand: () => false,
    handleSlashCommand: async () => false,
    logger: null,
    shellModeActive: false,
    loopDetectedRef: { current: false },
    lastProfileNameRef: { current: undefined },
    lastModelInfoRef: { current: null },
    lastModelIdentityRef: { current: null },
    abortControllerRef: { current: null },
    runStreamRef,
    submitQueryRef: { current: null },
    isResponding: false,
    streamingState: StreamingState.Idle,
  };
  return renderHook(
    () => {
      const events = useAgentEventStream({
        ...streamOperations,
        addItem: () => 1,
        processAgentEventRef: { current: null },
        flushPendingHistoryItem: noop,
        clearPendingHistoryItem: noop,
        performMemoryRefresh: async () => {},
      });
      runStreamRef.current ??= events.runStream;
      const queue = useQueuedSubmissions();
      const submit = useSubmitQuery({
        ...deps,
        ...queue,
        streamingState: state.current,
      });
      const streamingState = state.current;
      useEffect(() => {
        if (state.committed) state.committed.current = streamingState;
      }, [streamingState]);
      if (state.suspension) throw state.suspension;
      return { ...submit, ...queue };
    },
    {
      wrapper: ({ children }) => (
        <Suspense fallback={null}>{children}</Suspense>
      ),
    },
  );
}

// The held child fails with this production message, which reaches the agent
// history through the delivered completion notice.
const CHILD_FAILURE = 'Physical child failure';

const SHELL_COMMANDS: Record<string, string> = {
  'shell completed': 'printf idle-recovered-shell',
  // A real program, not a shell builtin: the public tool validates that the
  // command has an identifiable root before running it, and `exit` has none
  // under the PowerShell parser. node exits 7 on POSIX and non-zero on
  // Windows, so the job still reaches the failed state on both.
  'shell failed': 'node -e "process.exit(7)"',
  'shell cancelled': 'sleep 30',
};

/** The hook publishes a held notice to React state after the owner hands it over. */
function awaitQueued(
  rendered: ReturnType<typeof renderNotificationQueue>,
): Promise<void> {
  return waitFor(() =>
    expect(rendered.result.current.queuedSubmissions).toHaveLength(1),
  );
}

/**
 * Runs background work to a terminal state through the public tools: the
 * `task` tool with a scripted held child, or `run_shell_command` with
 * `is_background`. Completion is observed through the notice gates, not here.
 * The returned handle closes the child's HTTP server.
 */
async function finishBackgroundWork(
  agent: Agent,
  outcome: string,
): Promise<{ readonly close: () => Promise<void> }> {
  if (outcome.startsWith('task')) {
    const task = await launchHeldNotificationTask(agent);
    task.release(outcome === 'task failed');
    return task;
  }
  const shellTool = agent.tools.get('run_shell_command');
  if (!shellTool) throw new Error('Missing public shell tool');
  await shellTool.buildAndExecute(
    { command: SHELL_COMMANDS[outcome], is_background: true },
    new AbortController().signal,
  );
  const job = agent.tasks.list().find((item) => item.kind === 'shell');
  if (!job) throw new Error('Missing launched public shell job');
  if (outcome === 'shell cancelled') await agent.tasks.cancel(job.id);
  return { close: async () => {} };
}

async function expectHistoryContains(
  agent: Agent,
  text: string,
): Promise<void> {
  expect(
    JSON.stringify(await Array.fromAsync(agent.streamHistory())),
  ).toContain(text);
}

/**
 * Admission is rejected while any notice is pending, delivery is in flight or
 * shell groups are draining. The owner acknowledges a delivery on the turns
 * that follow the hook's return, so one event-loop turn passes before the
 * single switch.
 */
async function admitNewSession(agent: Agent): Promise<void> {
  await nextTurn();
  await agent.session.startNewSession();
}

/**
 * Disposal reports the delivery failures the task owner recorded. Returns the
 * outcome (null when disposal succeeded) so a scenario can assert it; repeat
 * calls return the same settled outcome.
 */
function settleDisposal(dispose: () => Promise<void>): () => Promise<unknown> {
  let disposal: Promise<unknown> | undefined;
  return () =>
    (disposal ??= dispose().then(
      () => null,
      (error: unknown) => error,
    ));
}

describe('background notification queue ownership', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  // The prompt service initializes once per process from the first caller's
  // directory. Owning it here keeps the physical child launched by the held
  // notification fixture independent of whichever earlier test initialized it.
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  const credentials = useOwnedCredentials();
  it('delivers a pending notice while a busy render is suspended and only idle has committed', async () => {
    const { agent, cleanup: dispose } = await buildTaskNotificationAgent(
      credentials().authority,
    );
    const cleanup = settleDisposal(dispose);
    const notices = observeNotices(agent);
    const suspension = createDeferred<void>();
    const committed = { current: StreamingState.Idle };
    const state: Parameters<typeof renderNotificationQueue>[4] = {
      current: StreamingState.Idle,
      committed,
    };
    let attempts = 0;
    const rendered = renderNotificationQueue(
      agent,
      { current: [] },
      { current: false },
      {
        current: async (query, signal) => {
          attempts++;
          await drain(agent.stream(JSON.stringify(query), { signal }));
        },
      },
      state,
    );
    let work: Awaited<ReturnType<typeof finishBackgroundWork>> | undefined;
    try {
      act(() => {
        state.current = StreamingState.Responding;
        state.suspension = suspension.promise;
        rendered.rerender();
      });
      expect(committed.current).toBe(StreamingState.Idle);
      work = await finishBackgroundWork(agent, 'task failed');
      await notices.delivered(1);
      await expectHistoryContains(agent, CHILD_FAILURE);
      expect(committed.current).toBe(StreamingState.Idle);
      expect(attempts).toBe(1);
      await admitNewSession(agent);
      expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual([]);
    } finally {
      state.current = StreamingState.Idle;
      state.suspension = undefined;
      suspension.resolve();
      rendered.unmount();
      await work?.close();
      await cleanup();
    }
  });

  for (const deferral of ['clear', 'cancel while busy', 'cancel while idle']) {
    it(`recovers after ${deferral} only on a subsequent busy-to-idle opportunity`, async () => {
      const { agent, cleanup: dispose } = await buildTaskNotificationAgent(
        credentials().authority,
      );
      const cleanup = settleDisposal(dispose);
      const notices = observeNotices(agent);
      const state = { current: StreamingState.Idle };
      const suppressed = { current: deferral === 'clear' };
      const entered = createDeferred<void>();
      const release = createDeferred<void>();
      const runner: UseSubmitQueryDeps['runStreamRef'] = { current: null };
      let attempts = 0;
      let runnerReturned = deferral === 'clear';
      if (deferral !== 'clear') {
        runner.current = async () => {
          attempts++;
          entered.resolve();
          await release.promise;
          runnerReturned = true;
          return { status: 'cancelled' };
        };
      }
      const rendered = renderNotificationQueue(
        agent,
        { current: [] },
        suppressed,
        runner,
        state,
      );
      let work: Awaited<ReturnType<typeof finishBackgroundWork>> | undefined;
      try {
        work = await finishBackgroundWork(agent, 'task failed');
        if (deferral === 'clear') {
          await notices.arrived(1);
          await awaitQueued(rendered);
        } else {
          await entered.promise;
        }
        if (deferral === 'cancel while busy') {
          act(() => {
            state.current = StreamingState.Responding;
            rendered.rerender();
          });
        }
        if (deferral === 'clear') {
          act(() => rendered.result.current.clearSubmissions());
          suppressed.current = false;
        }
        release.resolve();
        await waitFor(() => expect(runnerReturned).toBe(true));
        act(() => {
          state.current = StreamingState.Idle;
          rendered.rerender();
        });
        await delay(350);
        expect(attempts).toBe(deferral === 'clear' ? 0 : 1);
        await expect(agent.session.startNewSession()).rejects.toThrow(
          'completion notices',
        );
        runner.current = async (query, signal) => {
          attempts++;
          await drain(agent.stream(JSON.stringify(query), { signal }));
        };
        act(() => {
          state.current = StreamingState.Responding;
          rendered.rerender();
        });
        act(() => {
          state.current = StreamingState.Idle;
          rendered.rerender();
        });
        await notices.delivered(2);
        await expectHistoryContains(agent, CHILD_FAILURE);
        await delay(350);
        expect(attempts).toBe(deferral === 'clear' ? 1 : 2);
        expect(
          JSON.stringify(await Array.fromAsync(agent.streamHistory())),
        ).toContain(CHILD_FAILURE);
        await agent.session.startNewSession();
        expect(await agent.session.getHistory()).toStrictEqual([]);
        rendered.unmount();
      } finally {
        release.resolve();
        rendered.unmount();
        await work?.close();
        await cleanup();
      }
    });
  }

  it('does not retry a failed notice as the submitted turn renders busy then idle', async () => {
    const { agent, cleanup: dispose } = await buildTaskNotificationAgent(
      credentials().authority,
    );
    const cleanup = settleDisposal(dispose);
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const state = { current: StreamingState.Idle };
    let attempts = 0;
    let runnerReturned = false;
    const rendered = renderNotificationQueue(
      agent,
      { current: [] },
      { current: false },
      {
        current: async () => {
          attempts++;
          entered.resolve();
          await release.promise;
          runnerReturned = true;
          throw new Error('notice delivery failed');
        },
      },
      state,
    );
    let work: Awaited<ReturnType<typeof finishBackgroundWork>> | undefined;
    try {
      work = await finishBackgroundWork(agent, 'task failed');
      await entered.promise;
      act(() => {
        state.current = StreamingState.Responding;
        rendered.rerender();
      });
      release.resolve();
      await waitFor(() => expect(runnerReturned).toBe(true));
      act(() => {
        state.current = StreamingState.Idle;
        rendered.rerender();
      });
      await delay(350);
      expect(attempts).toBe(1);
      await expect(agent.session.startNewSession()).rejects.toThrow(
        'completion notices',
      );
    } finally {
      release.resolve();
      rendered.unmount();
      await work?.close();
      await cleanup();
    }
  });

  for (const scenario of ['provider error', 'turn limit']) {
    it(`retains a ${scenario} Agent delivery instead of acknowledging its normal iterator return`, async () => {
      const { agent, cleanup: dispose } = await buildTaskNotificationAgent(
        credentials().authority,
        scenario === 'turn limit' ? { maxSessionTurns: 1 } : {},
      );
      const cleanup = settleDisposal(dispose);
      await drain(agent.stream('exhaust provider fixture'));
      const state = { current: StreamingState.Idle };
      const runner: UseSubmitQueryDeps['runStreamRef'] = { current: null };
      const rendered = renderNotificationQueue(
        agent,
        { current: [] },
        { current: false },
        runner,
        state,
      );
      const runStream = runner.current;
      if (!runStream) throw new Error('Expected production stream runner');
      let attempts = 0;
      let runnerSettled = false;
      const attemptStarted = createDeferred<void>();
      const release = createDeferred<void>();
      runner.current = async (query, signal, promptId) => {
        attempts++;
        attemptStarted.resolve();
        await release.promise;
        try {
          return await runStream(query, signal, promptId);
        } finally {
          runnerSettled = true;
        }
      };
      let work: Awaited<ReturnType<typeof finishBackgroundWork>> | undefined;
      try {
        work = await finishBackgroundWork(agent, 'task failed');
        await attemptStarted.promise;
        act(() => {
          state.current = StreamingState.Responding;
          rendered.rerender();
        });
        release.resolve();
        await waitFor(() => {
          expect(
            JSON.stringify(rendered.result.current.queuedSubmissions),
          ).toBe('[]');
          expect(runnerSettled).toBe(true);
        });
        act(() => {
          state.current = StreamingState.Idle;
          rendered.rerender();
        });
        await delay(350);
        expect(attempts).toBe(1);
        await expect(agent.session.startNewSession()).rejects.toThrow(
          'completion notices',
        );
        rendered.unmount();
        expect((await cleanup()) !== null).toBe(scenario === 'provider error');
      } finally {
        release.resolve();
        rendered.unmount();
        await work?.close();
        await cleanup();
      }
    });
  }

  for (const retirement of [
    'unmount',
    'clear',
    'reserved unmount',
    'stream failure',
  ]) {
    it(`preserves an undelivered failed-task notice after ${retirement} until replacement delivery`, async () => {
      const { agent, cleanup: dispose } = await buildTaskNotificationAgent(
        credentials().authority,
      );
      const cleanup = settleDisposal(dispose);
      const notices = observeNotices(agent);
      const suppressed = { current: retirement !== 'stream failure' };
      let attempts = 0;
      const rendered = renderNotificationQueue(
        agent,
        { current: [] },
        suppressed,
        {
          current: async () => {
            attempts++;
            throw new Error('notice transport unavailable');
          },
        },
      );
      let recovery: ReturnType<typeof renderNotificationQueue> | undefined;
      let work: Awaited<ReturnType<typeof finishBackgroundWork>> | undefined;
      try {
        work = await finishBackgroundWork(agent, 'task failed');
        await notices.arrived(1);
        if (retirement !== 'stream failure') await awaitQueued(rendered);
        if (retirement === 'reserved unmount') {
          act(() => {
            suppressed.current = false;
            rendered.result.current.scheduleNextQueuedSubmission();
          });
          rendered.unmount();
        } else if (retirement === 'unmount') rendered.unmount();
        else if (retirement === 'clear')
          act(() => rendered.result.current.clearSubmissions());
        expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual([]);
        await expect(agent.session.startNewSession()).rejects.toThrow(
          'completion notices',
        );
        await delay(350);
        expect(attempts).toBe(retirement === 'stream failure' ? 1 : 0);
        rendered.unmount();
        let delivered = 0;
        recovery = renderNotificationQueue(
          agent,
          { current: [] },
          { current: false },
          {
            current: async (query) => {
              delivered++;
              await drain(agent.stream(JSON.stringify(query)));
            },
          },
        );
        await notices.delivered(2);
        await expectHistoryContains(agent, CHILD_FAILURE);
        await delay(350);
        expect(delivered).toBe(1);
        expect(
          JSON.stringify(await Array.fromAsync(agent.streamHistory())),
        ).toContain(CHILD_FAILURE);
        await agent.session.startNewSession();
        expect(await agent.session.getHistory()).toStrictEqual([]);
        rendered.unmount();
        expect((await cleanup()) !== null).toBe(
          retirement === 'stream failure',
        );
      } finally {
        rendered.unmount();
        recovery?.unmount();
        await work?.close();
        await cleanup();
      }
    });
  }

  for (const outcome of [
    'task completed',
    'task failed',
    'shell completed',
    'shell failed',
    'shell cancelled',
  ]) {
    it(`delivers ${outcome} on the idle render without another background event`, async () => {
      const { agent, cleanup: dispose } = await buildTaskNotificationAgent(
        credentials().authority,
      );
      const cleanup = settleDisposal(dispose);
      const notices = observeNotices(agent);
      const submissions: React.MutableRefObject<QueuedSubmission[]> = {
        current: [],
      };
      const state = { current: StreamingState.Responding };
      const delivered: string[] = [];
      const rendered = renderNotificationQueue(
        agent,
        submissions,
        { current: false },
        {
          current: async (query) => {
            const text =
              typeof query === 'string' ? query : JSON.stringify(query);
            delivered.push(text);
            await drain(agent.stream(text));
          },
        },
        state,
      );
      let work: Awaited<ReturnType<typeof finishBackgroundWork>> | undefined;
      try {
        // Let the subscription's own startup evaluation pass, so the next one
        // is the owner reacting to the completion.
        await nextTurn();
        const completionSeen = notices.evaluated();
        work = await finishBackgroundWork(agent, outcome);
        await completionSeen;
        await delay(350);
        expect(delivered).toHaveLength(0);
        expect(rendered.result.current.queuedSubmissions).toHaveLength(0);
        await expect(agent.session.startNewSession()).rejects.toThrow(
          'completion notices',
        );
        act(() => {
          state.current = StreamingState.Idle;
          rendered.rerender();
        });
        await notices.delivered(1);
        expect(delivered).toHaveLength(1);
        await admitNewSession(agent);
        expect(delivered).toHaveLength(1);
        expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual([]);
      } finally {
        rendered.unmount();
        await work?.close();
        await cleanup();
      }
    });
  }

  it('aborts an in-flight completion on unmount and retains ownership until it settles', async () => {
    const { agent, cleanup: dispose } = await buildTaskNotificationAgent(
      credentials().authority,
    );
    const cleanup = settleDisposal(dispose);
    const notices = observeNotices(agent);
    let task:
      | Awaited<ReturnType<typeof launchHeldNotificationTask>>
      | undefined;
    const submissions: React.MutableRefObject<QueuedSubmission[]> = {
      current: [],
    };
    const suppressed = { current: true };
    const entered = createDeferred<AbortSignal>();
    const release = createDeferred<void>();
    const finished = createDeferred<void>();
    const runStreamRef: UseSubmitQueryDeps['runStreamRef'] = {
      current: async (query, signal) => {
        entered.resolve(signal);
        await release.promise;
        try {
          signal.throwIfAborted();
          await drain(
            agent.stream(
              typeof query === 'string' ? query : JSON.stringify(query),
              { signal },
            ),
          );
        } finally {
          finished.resolve();
        }
      },
    };
    const rendered = renderNotificationQueue(
      agent,
      submissions,
      suppressed,
      runStreamRef,
    );
    let recovery: ReturnType<typeof renderNotificationQueue> | undefined;
    try {
      task = await launchHeldNotificationTask(agent);
      task.release();
      await notices.arrived(1);
      await awaitQueued(rendered);
      act(() => {
        suppressed.current = false;
        rendered.result.current.scheduleNextQueuedSubmission();
      });
      const signal = await entered.promise;
      rendered.unmount();
      expect(signal.aborted).toBe(true);
      const oldSession = { id: agent.session.getSessionId() };
      await expect(agent.session.startNewSession()).rejects.toThrow(
        'completion notices',
      );
      expect({ id: agent.session.getSessionId() }).toStrictEqual(oldSession);
      release.resolve();
      await finished.promise;
      expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual([]);
      await expect(agent.session.startNewSession()).rejects.toThrow(
        'completion notices',
      );
      recovery = renderNotificationQueue(
        agent,
        { current: [] },
        { current: false },
        {
          current: async (query) => {
            await drain(agent.stream(JSON.stringify(query)));
          },
        },
      );
      await notices.delivered(2);
      await expectHistoryContains(agent, 'OLD_SESSION_OUTPUT');
      await admitNewSession(agent);
      expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual([]);
      recovery.unmount();
    } finally {
      release.resolve();
      rendered.unmount();
      recovery?.unmount();
      await task?.close();
      await cleanup();
    }
  });

  it('blocks clear while a completion is queued and until its submitted turn finishes', async () => {
    const { agent, cleanup: dispose } = await buildTaskNotificationAgent(
      credentials().authority,
    );
    const cleanup = settleDisposal(dispose);
    const notices = observeNotices(agent);
    let task:
      | Awaited<ReturnType<typeof launchHeldNotificationTask>>
      | undefined;
    const submissions: React.MutableRefObject<QueuedSubmission[]> = {
      current: [],
    };
    const suppressed = { current: true };
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const streamed = createDeferred<void>();
    const runStreamRef: UseSubmitQueryDeps['runStreamRef'] = {
      current: async (query) => {
        entered.resolve();
        await release.promise;
        await drain(
          agent.stream(
            typeof query === 'string' ? query : JSON.stringify(query),
          ),
        );
        streamed.resolve();
      },
    };
    const rendered = renderNotificationQueue(
      agent,
      submissions,
      suppressed,
      runStreamRef,
    );
    try {
      task = await launchHeldNotificationTask(agent);
      task.release();
      await notices.arrived(1);
      await awaitQueued(rendered);
      const switchWithQueuedCompletion = agent.session.startNewSession();
      await expect(switchWithQueuedCompletion).rejects.toThrow(
        'completion notices',
      );
      act(() => {
        suppressed.current = false;
        rendered.result.current.scheduleNextQueuedSubmission();
      });
      await entered.promise;
      const switchWithSubmittedCompletion = agent.session.startNewSession();
      await expect(switchWithSubmittedCompletion).rejects.toThrow(
        'completion notices',
      );
      release.resolve();
      await streamed.promise;
      await admitNewSession(agent);
      expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual([]);
    } finally {
      release.resolve();
      rendered.unmount();
      await task?.close();
      await cleanup();
    }
  });
});
