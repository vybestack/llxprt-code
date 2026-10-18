/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { renderHook, waitFor } from '../../../../__tests__/render.js';
import { drain } from '../../../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import { useOwnedCredentials } from '../../../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  buildTaskNotificationAgent,
  launchHeldNotificationTask,
} from '../../../../__tests__/task-notification-fixture.js';
import { useSubmitQuery, type UseSubmitQueryDeps } from '../useSubmitQuery.js';
import { StreamingState } from '../../../types.js';
import type { QueuedSubmission } from '../types.js';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';
import { createDeferred } from './createDeferred.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';
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
  agent: UseSubmitQueryDeps['agent'],
  queuedSubmissionsRef: UseSubmitQueryDeps['queuedSubmissionsRef'],
  drainSuppressedRef: UseSubmitQueryDeps['drainSuppressedRef'],
  runStreamRef: UseSubmitQueryDeps['runStreamRef'],
): ReturnType<typeof renderHook<ReturnType<typeof useSubmitQuery>, undefined>> {
  const noop = (): void => {};
  const deps: UseSubmitQueryDeps = {
    runtime: createStreamRuntimeForTest({}, createMockOverrides()),
    agent,
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
  return renderHook(() => useSubmitQuery(deps));
}

describe('background notification queue ownership', () => {
  const credentials = useOwnedCredentials();
  it('aborts an in-flight completion on unmount and retains ownership until it settles', async () => {
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
    try {
      task = await launchHeldNotificationTask(agent);
      task.release();
      await waitFor(() => expect(submissions.current).toHaveLength(1));
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
      await waitFor(() => expect(submissions.current).toHaveLength(1));
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
