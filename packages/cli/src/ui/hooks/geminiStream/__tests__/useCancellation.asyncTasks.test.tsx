/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests proving that cancelOngoingRequest (ESC) cancels running
 * async subagent tasks via AsyncTaskManager. Uses a REAL AsyncTaskManager so
 * cancelTask actually aborts the registered AbortController.
 */

import { describe, it, expect } from 'vitest';
import React, { act } from 'react';
import { renderHook } from '../../../../test-utils/render.js';
import { useCancellation } from '../useGeminiStreamLifecycle.js';
import { StreamingState, MessageType } from '../../../types.js';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import { KeypressProvider } from '../../../contexts/KeypressContext.js';
import type { HistoryItemWithoutId } from '../../../types.js';

describe('useCancellation — cancels running async tasks on ESC', () => {
  it('calls cancelTask on all running async tasks when cancelOngoingRequest fires', async () => {
    const asyncTaskManager = new AsyncTaskManager();
    const seededController = new AbortController();
    asyncTaskManager.registerTask({
      id: 'running-async-agent',
      subagentName: 'helper',
      goalPrompt: 'do work',
      abortController: seededController,
    });

    expect(seededController.signal.aborted).toBe(false);
    expect(asyncTaskManager.getTask('running-async-agent')?.status).toBe(
      'running',
    );

    const cancelRunningAsyncTasks = () => {
      const mgr = asyncTaskManager;
      mgr.getRunningTasks().forEach((t) => mgr.cancelTask(t.id));
    };

    const abortControllerRef = { current: new AbortController() };
    const turnCancelledRef = { current: false };
    const pendingHistoryItemRef = { current: null };
    const queuedSubmissionsRef = { current: [] };
    const addedItems: HistoryItemWithoutId[] = [];

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <KeypressProvider>{children}</KeypressProvider>
    );

    const { result } = renderHook(
      () =>
        useCancellation(
          StreamingState.Responding,
          turnCancelledRef,
          abortControllerRef,
          () => {},
          pendingHistoryItemRef,
          () => {},
          (item: HistoryItemWithoutId) => {
            addedItems.push(item);
            return addedItems.length;
          },
          () => {},
          () => {},
          () => {},
          queuedSubmissionsRef,
          cancelRunningAsyncTasks,
        ),
      { wrapper },
    );

    act(() => {
      result.current.cancelOngoingRequest();
    });

    expect(seededController.signal.aborted).toBe(true);
    expect(asyncTaskManager.getTask('running-async-agent')?.status).toBe(
      'cancelled',
    );

    // The standard cancellation side effects still fire.
    expect(addedItems.some((i) => i.type === MessageType.INFO)).toBe(true);
  });

  it('cancels a task launched by a PRIOR (already-settled) turn (issue #2074)', async () => {
    // Locks in the intentional session-wide cancellation: an async task whose
    // own foreground-signal relay was bound to an EARLIER turn (now settled and
    // unable to abort) must still be cancelled by ESC on a LATER turn. This is
    // why cancellation goes through the session-wide AsyncTaskManager rather
    // than relying solely on the per-launch foreground relay.
    const asyncTaskManager = new AsyncTaskManager();

    // Simulate the prior turn's foreground signal: it already aborted/settled
    // and is wired to the task via a relay, but that relay can no longer fire.
    const priorTurnController = new AbortController();
    const taskController = new AbortController();
    const relay = () => taskController.abort();
    priorTurnController.signal.addEventListener('abort', relay, { once: true });
    asyncTaskManager.registerTask({
      id: 'cross-turn-async-agent',
      subagentName: 'helper',
      goalPrompt: 'long-running work from a previous turn',
      abortController: taskController,
    });

    // The prior turn has ended; its relay is detached and will never fire.
    priorTurnController.signal.removeEventListener('abort', relay);
    expect(taskController.signal.aborted).toBe(false);

    const cancelRunningAsyncTasks = () => {
      const mgr = asyncTaskManager;
      mgr.getRunningTasks().forEach((t) => mgr.cancelTask(t.id));
    };

    // A NEW foreground turn with its own (different) abort controller.
    const newTurnAbortRef = { current: new AbortController() };
    const turnCancelledRef = { current: false };
    const pendingHistoryItemRef = { current: null };
    const queuedSubmissionsRef = { current: [] };
    const addedItems: HistoryItemWithoutId[] = [];

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <KeypressProvider>{children}</KeypressProvider>
    );

    const { result } = renderHook(
      () =>
        useCancellation(
          StreamingState.Responding,
          turnCancelledRef,
          newTurnAbortRef,
          () => {},
          pendingHistoryItemRef,
          () => {},
          (item: HistoryItemWithoutId) => {
            addedItems.push(item);
            return addedItems.length;
          },
          () => {},
          () => {},
          () => {},
          queuedSubmissionsRef,
          cancelRunningAsyncTasks,
        ),
      { wrapper },
    );

    act(() => {
      result.current.cancelOngoingRequest();
    });

    // Even though the task's own relay (prior turn) can never fire, the
    // session-wide cancellation aborts it.
    expect(taskController.signal.aborted).toBe(true);
    expect(asyncTaskManager.getTask('cross-turn-async-agent')?.status).toBe(
      'cancelled',
    );
  });
});
