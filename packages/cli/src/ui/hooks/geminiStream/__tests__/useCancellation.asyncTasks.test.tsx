/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- behavioral coverage of async-task cancellation wiring. */

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
});
