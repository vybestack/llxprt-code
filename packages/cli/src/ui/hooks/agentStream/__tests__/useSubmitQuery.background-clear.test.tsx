/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { renderHook, waitFor } from '../../../../__tests__/render.js';
import {
  buildAgent,
  drain,
} from '../../../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { TaskLaunchOwner } from '../../../../../../agents/src/session/task-launch-owner.js';
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
  it('blocks clear while a completion is queued and until its submitted turn finishes', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    if (
      !('deps' in agent) ||
      typeof agent.deps !== 'object' ||
      agent.deps === null
    )
      throw new Error('Expected agent dependencies');
    if (
      !('taskLaunchOwner' in agent.deps) ||
      !(agent.deps.taskLaunchOwner instanceof TaskLaunchOwner)
    )
      throw new Error('Expected task owner');
    const owner = agent.deps.taskLaunchOwner;
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
      await owner.start(async (launch, publish) => {
        owner.manager.registerTask({
          id: 'ui-old-task',
          subagentName: 'worker',
          goalPrompt: 'work',
          abortController: launch.controller,
        });
        launch.register('ui-old-task');
        publish({ llmContent: '', returnDisplay: '' });
      });
      owner.manager.completeTask('ui-old-task', {
        terminate_reason: SubagentTerminateMode.GOAL,
        emitted_vars: { result: 'OLD_SESSION_OUTPUT' },
      });
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
        expect(owner.getPendingNotifications()).toStrictEqual([]),
      );
      await agent.session.startNewSession();
      expect(await agent.getHistory()).toStrictEqual([]);
    } finally {
      release.resolve();
      rendered.unmount();
      await cleanup();
    }
  });
});
