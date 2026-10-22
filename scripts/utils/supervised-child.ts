/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChildProcess } from 'node:child_process';

export interface SupervisedChild {
  /**
   * Terminates the child if it is still running and waits until it has
   * closed. A child that never spawned has nothing to terminate. Rejects
   * when a spawned child cannot be terminated.
   */
  stop(): Promise<void>;
}

/**
 * Tracks the lifecycle of a spawned child so shutdown acts only on a
 * process that exists. `pid` is assigned synchronously by a successful
 * spawn, which lets a failed spawn be recognised before its asynchronous
 * `error` event is delivered.
 */
export function superviseChild(child: ChildProcess): SupervisedChild {
  const spawned = child.pid !== undefined;
  let closed = !spawned;
  let failure: Error | undefined;
  const closedSignal = new Promise<void>((resolve) => {
    if (!spawned) {
      resolve();
      return;
    }
    child.once('close', () => {
      closed = true;
      resolve();
    });
  });
  // Without a listener an asynchronous spawn failure would be unhandled.
  // Failures of a spawned child are reported by stop().
  child.on('error', (error) => {
    if (spawned) failure = error;
  });

  return {
    async stop(): Promise<void> {
      if (!closed) {
        child.kill();
        await closedSignal;
      }
      if (failure !== undefined) throw failure;
    },
  };
}
