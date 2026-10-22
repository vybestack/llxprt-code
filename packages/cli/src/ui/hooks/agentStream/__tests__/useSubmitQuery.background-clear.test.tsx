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
import { setTimeout as delay } from 'node:timers/promises';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { ShellJobOwner } from '../../../../../../agents/src/session/shell-job-owner.js';
import { TaskLaunchOwner } from '../../../../../../agents/src/session/task-launch-owner.js';
import { renderHook, waitFor } from '../../../../__tests__/render.js';
import {
  buildAgent,
  drain,
  fixtureAgentResources,
} from '../../../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { useOwnedCredentials } from '../../../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  buildTaskNotificationAgent,
  launchHeldNotificationTask,
} from '../../../../__tests__/task-notification-fixture.js';
import { useSubmitQuery, type UseSubmitQueryDeps } from '../useSubmitQuery.js';
import { useQueuedSubmissions } from '../useQueuedSubmissions.js';
import { useAgentEventStream } from '../useAgentEventStream.js';
import { StreamingState } from '../../../types.js';
import type { QueuedSubmission } from '../types.js';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';
import { createDeferred } from './createDeferred.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';
import { streamPolicyOperations } from './stream-policy-operations.js';
import { submissionOperations } from './submission-operations.js';
import { agentStreamOperations } from './helpers/agentStreamOperations.js';
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
    pendingResponse: new PendingResponseBuffer(undefined),
    pendingHistoryItemRef: { current: null },
    thinkingBlocksRef: { current: [] },
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

function backgroundOwners(agent: Agent): {
  tasks: TaskLaunchOwner;
  shell: ShellJobOwner;
} {
  const { taskOwner, shellOwner } = fixtureAgentResources(agent);
  if (!(taskOwner instanceof TaskLaunchOwner))
    throw new Error('Expected task owner');
  if (!(shellOwner instanceof ShellJobOwner))
    throw new Error('Expected shell owner');
  return { tasks: taskOwner, shell: shellOwner };
}

async function finishBackgroundWork(
  tasks: TaskLaunchOwner,
  shell: ShellJobOwner,
  outcome: string,
): Promise<void> {
  if (outcome.startsWith('task')) {
    await tasks.start(async (launch, publish) => {
      tasks.manager.registerTask({
        id: 'busy-ui-task',
        subagentName: 'worker',
        goalPrompt: 'work',
        abortController: launch.controller,
      });
      launch.register('busy-ui-task');
      publish({ llmContent: '', returnDisplay: '' });
    });
    if (outcome === 'task completed')
      tasks.manager.completeTask('busy-ui-task', {
        terminate_reason: SubagentTerminateMode.GOAL,
        emitted_vars: { result: 'idle-recovered-output' },
      });
    else tasks.manager.failTask('busy-ui-task', 'idle-recovered-failure');
    return;
  }
  const terminal = createDeferred<void>();
  const events: Record<string, (listener: () => void) => () => void> = {
    'shell completed': shell.onJobCompleted.bind(shell),
    'shell failed': shell.onJobFailed.bind(shell),
    'shell cancelled': shell.onJobCancelled.bind(shell),
  };
  const commands: Record<string, string> = {
    'shell completed': 'printf idle-recovered-shell',
    'shell failed': 'exit 7',
    'shell cancelled': 'sleep 30',
  };
  const off = events[outcome](() => terminal.resolve());
  try {
    const job = shell.launch({
      command: commands[outcome],
      cwd: process.cwd(),
    });
    if (outcome === 'shell cancelled') await shell.current()?.cancel(job.id);
    await terminal.promise;
  } finally {
    off();
  }
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
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    const { tasks, shell } = backgroundOwners(agent);
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
    try {
      act(() => {
        state.current = StreamingState.Responding;
        state.suspension = suspension.promise;
        rendered.rerender();
      });
      expect(committed.current).toBe(StreamingState.Idle);
      await finishBackgroundWork(tasks, shell, 'task failed');
      await waitFor(() => {
        expect(tasks.getPendingNotifications()).toHaveLength(0);
        expect(tasks.hasPendingWork()).toBe(false);
      });
      expect(committed.current).toBe(StreamingState.Idle);
      expect(attempts).toBe(1);
      expect(JSON.stringify(await agent.getHistory())).toContain(
        'idle-recovered-failure',
      );
      await agent.session.startNewSession();
      expect(await agent.getHistory()).toStrictEqual([]);
    } finally {
      state.current = StreamingState.Idle;
      state.suspension = undefined;
      suspension.resolve();
      rendered.unmount();
      await cleanup();
    }
  });

  for (const deferral of ['clear', 'cancel while busy', 'cancel while idle']) {
    it(`recovers after ${deferral} only on a subsequent busy-to-idle opportunity`, async () => {
      const { agent, cleanup } = await buildAgent('plain-text.jsonl');
      const { tasks, shell } = backgroundOwners(agent);
      const state = { current: StreamingState.Idle };
      const suppressed = { current: deferral === 'clear' };
      const entered = createDeferred<void>();
      const release = createDeferred<void>();
      const runner: UseSubmitQueryDeps['runStreamRef'] = { current: null };
      let attempts = 0;
      if (deferral !== 'clear') {
        runner.current = async () => {
          attempts++;
          entered.resolve();
          await release.promise;
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
      try {
        await finishBackgroundWork(tasks, shell, 'task failed');
        await waitFor(() => {
          const ready =
            deferral === 'clear'
              ? rendered.result.current.queuedSubmissions.length === 1
              : attempts === 1;
          expect(ready).toBe(true);
        });
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
        await waitFor(() => expect(tasks.hasPendingWork()).toBe(false));
        act(() => {
          state.current = StreamingState.Idle;
          rendered.rerender();
        });
        await delay(350);
        expect(attempts).toBe(deferral === 'clear' ? 0 : 1);
        expect(tasks.getPendingNotifications()).toHaveLength(1);
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
        await waitFor(() => {
          expect(tasks.getPendingNotifications()).toHaveLength(0);
          expect(tasks.hasPendingWork()).toBe(false);
        });
        await delay(350);
        expect(attempts).toBe(deferral === 'clear' ? 1 : 2);
        expect(JSON.stringify(await agent.getHistory())).toContain(
          'idle-recovered-failure',
        );
        await agent.session.startNewSession();
        expect(await agent.getHistory()).toStrictEqual([]);
        rendered.unmount();
        await tasks.join();
      } finally {
        release.resolve();
        rendered.unmount();
        await cleanup();
      }
    });
  }

  it('does not retry a failed notice as the submitted turn renders busy then idle', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    const { tasks, shell } = backgroundOwners(agent);
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const state = { current: StreamingState.Idle };
    let attempts = 0;
    const rendered = renderNotificationQueue(
      agent,
      { current: [] },
      { current: false },
      {
        current: async () => {
          attempts++;
          entered.resolve();
          await release.promise;
          throw new Error('notice delivery failed');
        },
      },
      state,
    );
    try {
      await finishBackgroundWork(tasks, shell, 'task failed');
      await entered.promise;
      act(() => {
        state.current = StreamingState.Responding;
        rendered.rerender();
      });
      release.resolve();
      await waitFor(() => expect(tasks.hasPendingWork()).toBe(false));
      act(() => {
        state.current = StreamingState.Idle;
        rendered.rerender();
      });
      await delay(350);
      expect(attempts).toBe(1);
      expect(tasks.getPendingNotifications()).toHaveLength(1);
      await expect(agent.session.startNewSession()).rejects.toThrow(
        'completion notices',
      );
    } finally {
      release.resolve();
      rendered.unmount();
      await cleanup();
    }
  });

  for (const scenario of ['provider error', 'turn limit']) {
    it(`retains a ${scenario} Agent delivery instead of acknowledging its normal iterator return`, async () => {
      const { agent, cleanup } = await buildAgent(
        'plain-text.jsonl',
        scenario === 'turn limit' ? { maxSessionTurns: 1 } : {},
      );
      const { tasks, shell } = backgroundOwners(agent);
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
      const release = createDeferred<void>();
      runner.current = async (query, signal, promptId) => {
        attempts++;
        await release.promise;
        return runStream(query, signal, promptId);
      };
      try {
        await finishBackgroundWork(tasks, shell, 'task failed');
        await waitFor(() => expect(attempts).toBe(1));
        act(() => {
          state.current = StreamingState.Responding;
          rendered.rerender();
        });
        release.resolve();
        await waitFor(() => {
          expect(
            JSON.stringify(rendered.result.current.queuedSubmissions),
          ).toBe('[]');
          expect(tasks.hasPendingWork()).toBe(false);
        });
        act(() => {
          state.current = StreamingState.Idle;
          rendered.rerender();
        });
        await delay(350);
        expect(attempts).toBe(1);
        expect(tasks.getPendingNotifications()).toHaveLength(1);
        expect(tasks.getTask('busy-ui-task')?.notifiedAt).toBeUndefined();
        await expect(agent.session.startNewSession()).rejects.toThrow(
          'completion notices',
        );
        rendered.unmount();
        const joinFailure = await tasks.join().then(
          () => null,
          (error: unknown) => error,
        );
        expect(joinFailure instanceof AggregateError).toBe(
          scenario === 'provider error',
        );
      } finally {
        release.resolve();
        rendered.unmount();
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
      const { agent, cleanup } = await buildAgent('plain-text.jsonl');
      const { tasks, shell } = backgroundOwners(agent);
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
      try {
        await finishBackgroundWork(tasks, shell, 'task failed');
        await waitFor(() => {
          const ready =
            retirement === 'stream failure'
              ? attempts === 1
              : rendered.result.current.queuedSubmissions.length === 1;
          expect(ready).toBe(true);
        });
        if (retirement === 'reserved unmount') {
          act(() => {
            suppressed.current = false;
            rendered.result.current.scheduleNextQueuedSubmission();
          });
          rendered.unmount();
        } else if (retirement === 'unmount') rendered.unmount();
        else if (retirement === 'clear')
          act(() => rendered.result.current.clearSubmissions());
        await waitFor(() => expect(tasks.hasPendingWork()).toBe(false));
        expect(tasks.getPendingNotifications()).toHaveLength(1);
        expect(tasks.getTask('busy-ui-task')?.notifiedAt).toBeUndefined();
        expect(await agent.getHistory()).toStrictEqual([]);
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
        await waitFor(() => {
          expect(tasks.getPendingNotifications()).toHaveLength(0);
          expect(tasks.hasPendingWork()).toBe(false);
        });
        await delay(350);
        expect(delivered).toBe(1);
        expect(JSON.stringify(await agent.getHistory())).toContain(
          'idle-recovered-failure',
        );
        await agent.session.startNewSession();
        expect(await agent.getHistory()).toStrictEqual([]);
        rendered.unmount();
        const joinFailure = await tasks.join().then(
          () => null,
          (error: unknown) => error,
        );
        expect(joinFailure instanceof AggregateError).toBe(
          retirement === 'stream failure',
        );
      } finally {
        rendered.unmount();
        recovery?.unmount();
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
      const { agent, cleanup } = await buildAgent('plain-text.jsonl');
      const { tasks, shell } = backgroundOwners(agent);
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
      try {
        await finishBackgroundWork(tasks, shell, outcome);
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
        await waitFor(() => {
          expect(tasks.getPendingNotifications()).toHaveLength(0);
          expect(shell.getPendingNotifications()).toHaveLength(0);
          expect(tasks.hasPendingWork()).toBe(false);
          expect(shell.hasPendingWork()).toBe(false);
        });
        expect(delivered).toHaveLength(1);
        await agent.session.startNewSession();
        expect(await agent.getHistory()).toStrictEqual([]);
      } finally {
        rendered.unmount();
        await cleanup();
      }
    });
  }

  it('aborts an in-flight completion on unmount and retains ownership until it settles', async () => {
    const manager = new AsyncTaskManager();
    const { agent, cleanup } = await buildTaskNotificationAgent(
      manager,
      credentials().authority,
    );
    const { tasks: owner } = backgroundOwners(agent);
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
      await waitFor(() =>
        expect(rendered.result.current.queuedSubmissions).toHaveLength(1),
      );
      act(() => {
        suppressed.current = false;
        rendered.result.current.scheduleNextQueuedSubmission();
      });
      const signal = await entered.promise;
      rendered.unmount();
      expect(signal.aborted).toBe(true);
      expect(manager.getPendingNotifications()).toHaveLength(1);
      const oldSession = { id: agent.session.getSessionId() };
      await expect(agent.session.startNewSession()).rejects.toThrow(
        'completion notices',
      );
      expect({ id: agent.session.getSessionId() }).toStrictEqual(oldSession);
      release.resolve();
      await finished.promise;
      await waitFor(() => expect(owner.hasPendingWork()).toBe(false));
      expect(manager.getPendingNotifications()).toHaveLength(1);
      expect(await agent.getHistory()).toStrictEqual([]);
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
      await waitFor(() => expect(owner.hasPendingWork()).toBe(false));
      await waitFor(() =>
        expect(manager.getPendingNotifications()).toStrictEqual([]),
      );
      expect(JSON.stringify(await agent.getHistory())).toContain(
        'OLD_SESSION_OUTPUT',
      );
      await agent.session.startNewSession();
      expect(await agent.getHistory()).toStrictEqual([]);
      recovery.unmount();
      await owner.join();
    } finally {
      release.resolve();
      rendered.unmount();
      recovery?.unmount();
      await task?.close();
      await cleanup();
    }
  });

  it('blocks clear while a completion is queued and until its submitted turn finishes', async () => {
    const manager = new AsyncTaskManager();
    const { agent, cleanup } = await buildTaskNotificationAgent(
      manager,
      credentials().authority,
    );
    let task:
      | Awaited<ReturnType<typeof launchHeldNotificationTask>>
      | undefined;
    const submissions: React.MutableRefObject<QueuedSubmission[]> = {
      current: [],
    };
    const suppressed = { current: true };
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const runStreamRef: UseSubmitQueryDeps['runStreamRef'] = {
      current: async (query) => {
        entered.resolve();
        await release.promise;
        await drain(
          agent.stream(
            typeof query === 'string' ? query : JSON.stringify(query),
          ),
        );
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
      await waitFor(() =>
        expect(rendered.result.current.queuedSubmissions).toHaveLength(1),
      );
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
      await waitFor(() =>
        expect(manager.getPendingNotifications()).toStrictEqual([]),
      );
      await agent.session.startNewSession();
      expect(await agent.getHistory()).toStrictEqual([]);
    } finally {
      release.resolve();
      rendered.unmount();
      await task?.close();
      await cleanup();
    }
  });
});
