/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Bounded-settlement helpers for Turn's provider stream reads.
 *
 * {@link raceReadWithAbort} lets a pending read settle immediately when the
 * turn's parent abort signal fires, even for transports that ignore the
 * signal (issue #3236), while ensuring the abandoned read can never surface
 * as an unhandled rejection.
 *
 * {@link formatStreamIdleTimeoutMessage} renders the user-facing diagnostic
 * for a watchdog fire. Relocated verbatim from Turn so that file stays under
 * the lint `max-lines` budget; behaviour is unchanged.
 */

import type { StreamWatchdogFire } from '@vybestack/llxprt-code-core/utils/streamWatchdog.js';
import type { StreamEvent } from './chatSession.js';
import { closeIteratorBounded } from './iteratorCleanup.js';

export function formatStreamIdleTimeoutMessage(
  fire: StreamWatchdogFire,
  livenessObserved: boolean,
): string {
  const guardLabel =
    fire.guard === 'first-response'
      ? 'First-response'
      : 'Inter-chunk stream-idle';
  const livenessPart = livenessObserved
    ? '; provider liveness was observed before the timeout'
    : '';
  return `${guardLabel} timeout: no response received within the allowed time (threshold ${fire.thresholdMs}ms) from ${fire.configSource}${livenessPart}.`;
}

/**
 * Attaches no-op handlers to an abandoned read so its eventual settlement —
 * resolve or reject — is observed and can never surface as an unhandled
 * rejection (issue #3236).
 */
function sinkAbandonedRead<T>(read: Promise<T>): void {
  read.then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Races a pending provider read (or first-event acquisition) against the
 * turn's parent abort signal.
 *
 * Some transports ignore the abort signal entirely (issue #3236), so an
 * in-flight read can stay pending forever after cancellation — even when it
 * is already raced against the stream watchdog. Racing it against the parent
 * signal lets the turn settle immediately; the abandoned read is sunk so its
 * eventual settlement can never surface as an unhandled rejection.
 */
export function raceReadWithAbort<T>(
  read: Promise<T>,
  signal: AbortSignal,
): Promise<{ aborted: true } | { aborted: false; value: T }> {
  if (signal.aborted) {
    sinkAbandonedRead(read);
    return Promise.resolve({ aborted: true } as const);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      // No sink needed here: the read.then handlers below already observe
      // the abandoned read's eventual settlement (they attach synchronously
      // in this executor, before any abort event can dispatch). Only the
      // already-aborted fast path above skips that attachment.
      resolve({ aborted: true });
    };
    signal.addEventListener('abort', onAbort, { once: true });
    read.then(
      (value: T) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve({ aborted: false, value });
      },
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener('abort', onAbort);
        // Propagate the provider error so Turn's error handling preserves
        // provider-error semantics, including the already-aborted →
        // UserCancelled mapping.
        reject(error);
      },
    );
  });
}

/** The resolved shape of a first provider stream event acquisition. */
export interface AcquiredFirstEvent {
  readonly iterator: AsyncIterator<StreamEvent>;
  readonly firstResult: IteratorResult<StreamEvent>;
}

/**
 * Live view over a watchdog-bounded first-event acquisition started by Turn.
 * Kept here (not in turn.ts) so Turn stays within its lint `max-lines`
 * budgets; behaviour is unchanged from the inline original.
 */
export interface WatchdogBoundedAcquisition {
  /** Resolves with the iterator and its first read; sunk on rejection. */
  readonly firstEventPromise: Promise<AcquiredFirstEvent>;
  /** Latest iterator handed back by the (still-settling) acquisition. */
  readonly acquiredIterator: () => AsyncIterator<StreamEvent> | undefined;
}

/**
 * Wires the side-effect sinks Turn needs around a first-event acquisition:
 * records the iterator as soon as the acquisition resolves (so an error path
 * can close it) and derives the first-read promise whose rejection is sunk.
 */
export function beginWatchdogBoundedAcquisition(
  acquisitionPromise: Promise<AsyncIterator<StreamEvent>>,
): WatchdogBoundedAcquisition {
  let acquired: AsyncIterator<StreamEvent> | undefined;
  acquisitionPromise.then(
    (iterator) => {
      acquired = iterator;
    },
    () => undefined,
  );
  const firstEventPromise = acquisitionPromise.then(async (iterator) => {
    const firstResult = await iterator.next();
    return { iterator, firstResult };
  });
  firstEventPromise.catch(() => undefined);
  return { firstEventPromise, acquiredIterator: () => acquired };
}

/**
 * Closes an iterator the acquisition hands back AFTER Turn's error path has
 * already run, without waiting for its first next() (issue #3236: transports
 * whose reads never settle must not block cleanup).
 */
export function closeLateAcquiredIterator(
  acquisitionPromise: Promise<AsyncIterator<StreamEvent>>,
  exclude: AsyncIterator<StreamEvent> | undefined,
  timeoutSignal: AbortSignal,
): void {
  acquisitionPromise
    .then((lateIterator) =>
      lateIterator === exclude
        ? undefined
        : closeIteratorBounded(lateIterator, timeoutSignal),
    )
    .catch(() => undefined);
}
