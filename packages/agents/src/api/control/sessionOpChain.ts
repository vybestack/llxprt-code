/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Promise-chain mutex (FINDING A1) serializing the state-mutating session
 * operations (resume, setRecording enable/disable, dispose) so they never
 * interleave their multi-await recording/integration/lock swaps. Each
 * operation runs strictly after the prior one settles. The chain link always
 * settles (never rejects) so a failed operation cannot poison the chain for
 * the next caller, while the caller still receives its own operation's real
 * result or rejection.
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 */
export class SessionOpChain {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const priorSettled = this.tail;
    const run = (async () => {
      await priorSettled;
      return fn();
    })();
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Settles once every operation admitted so far has settled. */
  settled(): Promise<void> {
    return this.tail;
  }
}
