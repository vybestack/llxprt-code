/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-01
 */

import { describe, expect, it } from 'bun:test';
import { createExitGuard } from './shellExitGuard.js';
import { makeInactivityTimer } from './shellOutputUtils.js';

// Margins chosen to stay reliable under CI load: the wait window is at
// least four times the timeout so a delayed timer callback still lands
// inside it.
const TIMEOUT_MS = 100;
const WAIT_MS = 400;
const PARTIAL_WAIT_MS = 40;

/** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-01 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-01 */
describe('makeInactivityTimer', () => {
  /** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-01 */
  it('aborts its controller when an armed timer expires', async () => {
    const timer = makeInactivityTimer(TIMEOUT_MS, createExitGuard());

    timer.reset();
    await wait(WAIT_MS);

    expect(timer.controller.signal.aborted).toBe(true);
  });

  /** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-01 */
  it('resets a partially elapsed timer back to the full window', async () => {
    const timer = makeInactivityTimer(TIMEOUT_MS, createExitGuard());

    timer.reset();
    await wait(PARTIAL_WAIT_MS);
    timer.reset();
    // Only PARTIAL_WAIT_MS has passed since the second reset; the timer
    // must still be armed (not aborted) until a full window elapses.
    await wait(PARTIAL_WAIT_MS);
    expect(timer.controller.signal.aborted).toBe(false);

    await wait(TIMEOUT_MS);
    expect(timer.controller.signal.aborted).toBe(true);
  });

  /** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-01 */
  it('does not abort after an armed timer is cancelled', async () => {
    const timer = makeInactivityTimer(TIMEOUT_MS, createExitGuard());

    timer.reset();
    timer.cancel();
    await wait(WAIT_MS);

    expect(timer.controller.signal.aborted).toBe(false);
  });

  /** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-01 */
  it('can be cancelled before it is armed', async () => {
    const timer = makeInactivityTimer(TIMEOUT_MS, createExitGuard());

    timer.cancel();
    await wait(WAIT_MS);

    expect(timer.controller.signal.aborted).toBe(false);
  });

  /** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-01 */
  it('does not rearm after cancellation', async () => {
    const timer = makeInactivityTimer(TIMEOUT_MS, createExitGuard());

    timer.cancel();
    timer.reset();
    await wait(WAIT_MS);

    expect(timer.controller.signal.aborted).toBe(false);
  });

  /** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-01 */
  it('does not abort after the execution is marked exited', async () => {
    const exitedGuard = createExitGuard();
    const timer = makeInactivityTimer(TIMEOUT_MS, exitedGuard);

    timer.reset();
    exitedGuard.markExited();
    await wait(WAIT_MS);

    expect(timer.controller.signal.aborted).toBe(false);
  });
});
