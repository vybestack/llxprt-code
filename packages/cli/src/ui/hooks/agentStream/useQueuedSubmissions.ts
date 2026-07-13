/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef } from 'react';
import { useStateAndRef } from '../useStateAndRef.js';
import type { QueuedSubmission } from './types.js';

/**
 * State-backed queued-submissions store with serialized drain ownership.
 *
 * Provides:
 * - `queuedSubmissions` (reactive state for rendering)
 * - `queuedSubmissionsRef` (stable ref for callback access)
 * - `enqueueSubmission` (immutable append — updates both ref and state)
 * - `requeueSubmission` (immutable front insertion for retry)
 * - `dequeueSubmission` (FIFO shift — updates both ref and state)
 * - `clearSubmissions` (clear — updates both ref and state)
 *
 * All mutations go through `setStateInternal` from useStateAndRef, which
 * synchronously updates the ref AND schedules a React state update. This
 * eliminates stale-closure/race conditions between the ref reads in
 * scheduleNextQueuedSubmission/submitQuery and the reactive state that
 * drives the QueuedMessagesPanel.
 *
 * Serialized draining: `tryReserveDrain` / `releaseDrain` provide a canonical
 * ownership token that ensures exactly one drain attempt is in-flight at any
 * time, preventing the double-drain race between the idle-effect trigger and
 * the runSubmitQueryCore finally-block trigger (issue #2296).
 */
export function useQueuedSubmissions() {
  const [queuedSubmissions, queuedSubmissionsRef, setQueuedSubmissions] =
    useStateAndRef<QueuedSubmission[]>([]);

  // Canonical drain owner: true while a scheduleNextQueuedSubmission call has
  // dequeued an item but the resulting submitQuery hasn't had a chance to set
  // isResponding(true) yet. Prevents concurrent triggers from each dequeuing
  // a separate item.
  const drainInFlightRef = useRef(false);

  const enqueueSubmission = useCallback(
    (submission: QueuedSubmission): void => {
      setQueuedSubmissions((prev) => [...prev, submission]);
    },
    [setQueuedSubmissions],
  );

  const requeueSubmission = useCallback(
    (submission: QueuedSubmission): void => {
      setQueuedSubmissions((prev) => [submission, ...prev]);
    },
    [setQueuedSubmissions],
  );

  const dequeueSubmission = useCallback((): QueuedSubmission | undefined => {
    let dequeued: QueuedSubmission | undefined;
    setQueuedSubmissions((current) => {
      if (current.length === 0) {
        return current;
      }
      const [first, ...rest] = current;
      dequeued = first;
      return rest;
    });
    return dequeued;
  }, [setQueuedSubmissions]);

  const clearSubmissions = useCallback((): void => {
    setQueuedSubmissions([]);
  }, [setQueuedSubmissions]);

  const tryReserveDrain = useCallback((): boolean => {
    if (drainInFlightRef.current) {
      return false;
    }
    drainInFlightRef.current = true;
    return true;
  }, []);

  const releaseDrain = useCallback((): void => {
    drainInFlightRef.current = false;
  }, []);

  return {
    queuedSubmissions,
    queuedSubmissionsRef,
    enqueueSubmission,
    requeueSubmission,
    dequeueSubmission,
    clearSubmissions,
    tryReserveDrain,
    releaseDrain,
  };
}

export type UseQueuedSubmissionsReturn = ReturnType<
  typeof useQueuedSubmissions
>;
