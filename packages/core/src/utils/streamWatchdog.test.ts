/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral unit tests for the two-phase stream watchdog (issue #2607).
 *
 * The watchdog bounds the time-to-first-response window with two phases:
 * - Phase A (first-response): fires after firstResponseMs unless disarmed by
 *   a provider liveness signal.
 * - Phase B (post-liveness idle): armed/rearmed on each liveness ping when
 *   idleMs > 0; covers silence after liveness but before first content.
 *
 * Tests use fake timers for deterministic verification. "Does not fire"
 * assertions advance fake timers past the deadline and inspect state directly
 * rather than racing with setTimeout.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createStreamWatchdog,
  type StreamWatchdogOptions,
} from './streamWatchdog.js';
import type { StreamLivenessEvent } from './streamIdleTimeout.js';

function defaultOpts(
  overrides: Partial<StreamWatchdogOptions> = {},
): StreamWatchdogOptions {
  return {
    firstResponseMs: 100,
    firstResponseSource: 'stream-first-response-timeout-ms',
    idleMs: 0,
    idleSource: 'stream-idle-timeout-ms',
    ...overrides,
  };
}

const livenessPing = (
  sourceEvent = 'response.created',
): StreamLivenessEvent => ({
  sourceEvent,
  sseObserved: true,
});

describe('createStreamWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('disabled state (firstResponseMs <= 0)', () => {
    it('is not active and never fires', () => {
      const wd = createStreamWatchdog(defaultOpts({ firstResponseMs: 0 }));
      expect(wd.isActive).toBe(false);

      vi.advanceTimersByTime(10_000);
      expect(wd.getFire()).toBeUndefined();
    });

    it('onLiveness is a no-op that does not throw', () => {
      const wd = createStreamWatchdog(defaultOpts({ firstResponseMs: 0 }));
      expect(() => wd.onLiveness(livenessPing())).not.toThrow();
    });

    it('cancel does not throw', () => {
      const wd = createStreamWatchdog(defaultOpts({ firstResponseMs: 0 }));
      expect(() => wd.cancel()).not.toThrow();
    });

    it('getFire returns undefined', () => {
      const wd = createStreamWatchdog(defaultOpts({ firstResponseMs: 0 }));
      expect(wd.getFire()).toBeUndefined();
    });
  });

  describe('phase A (first-response)', () => {
    it('fires after firstResponseMs when no liveness arrives', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 50, onFire }),
      );
      expect(wd.isActive).toBe(true);

      const promise = wd.timeoutPromise;
      await vi.advanceTimersByTimeAsync(50);

      await expect(promise).rejects.toThrow('Stream watchdog timeout');
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(wd.getFire()).toStrictEqual({
        guard: 'first-response',
        thresholdMs: 50,
        configSource: 'stream-first-response-timeout-ms',
      });
    });

    it('does not fire before firstResponseMs', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 100, onFire }),
      );

      await vi.advanceTimersByTimeAsync(50);
      expect(onFire).not.toHaveBeenCalled();
      expect(wd.getFire()).toBeUndefined();
    });
  });

  describe('liveness disarm (phase A → phase B)', () => {
    it('a liveness ping before the deadline disarms phase A', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 50, idleMs: 0, onFire }),
      );

      wd.onLiveness(livenessPing());
      await vi.advanceTimersByTimeAsync(10_000);

      expect(onFire).not.toHaveBeenCalled();
      expect(wd.getFire()).toBeUndefined();
    });

    it('arms phase B (idleMs > 0) after liveness, fires on idle silence', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 100, idleMs: 30, onFire }),
      );

      wd.onLiveness(livenessPing());
      await vi.advanceTimersByTimeAsync(30);

      await expect(wd.timeoutPromise).rejects.toThrow(
        'Stream watchdog timeout',
      );
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(wd.getFire()).toStrictEqual({
        guard: 'inter-chunk',
        thresholdMs: 30,
        configSource: 'stream-idle-timeout-ms',
      });
    });

    it('idleMs=0 means phase B is unbounded after liveness', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 50, idleMs: 0, onFire }),
      );

      wd.onLiveness(livenessPing());
      await vi.advanceTimersByTimeAsync(10_000);

      expect(onFire).not.toHaveBeenCalled();
      expect(wd.getFire()).toBeUndefined();
    });

    it('a second liveness ping rearms phase B (resets the idle timer)', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 100, idleMs: 60, onFire }),
      );

      wd.onLiveness(livenessPing());
      await vi.advanceTimersByTimeAsync(40);
      expect(onFire).not.toHaveBeenCalled();

      wd.onLiveness(livenessPing('response.in_progress'));
      await vi.advanceTimersByTimeAsync(40);
      expect(onFire).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(20);
      await expect(wd.timeoutPromise).rejects.toThrow(
        'Stream watchdog timeout',
      );
      expect(wd.getFire()?.guard).toBe('inter-chunk');
    });
  });

  describe('cancel', () => {
    it('prevents the watchdog from firing after cancel', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 50, onFire }),
      );

      wd.cancel();
      await vi.advanceTimersByTimeAsync(100);

      expect(onFire).not.toHaveBeenCalled();
      expect(wd.getFire()).toBeUndefined();
    });

    it('cancel after liveness disarmed prevents phase B from firing', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 100, idleMs: 30, onFire }),
      );

      wd.onLiveness(livenessPing());
      wd.cancel();
      await vi.advanceTimersByTimeAsync(100);

      expect(onFire).not.toHaveBeenCalled();
    });

    it('cancel is idempotent', () => {
      const wd = createStreamWatchdog(defaultOpts({ firstResponseMs: 50 }));
      expect(() => {
        wd.cancel();
        wd.cancel();
        wd.cancel();
      }).not.toThrow();
    });
  });

  describe('onFire callback', () => {
    it('is invoked exactly once when the watchdog fires', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 30, onFire }),
      );

      await vi.advanceTimersByTimeAsync(30);
      await expect(wd.timeoutPromise).rejects.toThrow(
        'Stream watchdog timeout',
      );

      expect(onFire).toHaveBeenCalledTimes(1);
    });

    it('is not invoked when cancelled before firing', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 30, onFire }),
      );
      wd.cancel();
      await vi.advanceTimersByTimeAsync(100);
      expect(onFire).not.toHaveBeenCalled();
    });
  });

  describe('timeoutPromise unhandled-rejection safety', () => {
    it('does not produce an unhandled rejection when cancelled without awaiting', async () => {
      const wd = createStreamWatchdog(defaultOpts({ firstResponseMs: 30 }));
      wd.cancel();
      await vi.advanceTimersByTimeAsync(100);
      // If timeoutPromise had an unhandled rejection, Node/vitest would surface
      // it. Reaching here cleanly is the assertion.
      expect(wd.getFire()).toBeUndefined();
    });
  });

  describe('onFire callback failure isolation (issue #2607 finding 1)', () => {
    it('timeoutPromise rejects even when onFire throws', async () => {
      const onFire = vi.fn(() => {
        throw new Error('callback blew up');
      });
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 30, onFire }),
      );

      await vi.advanceTimersByTimeAsync(30);

      await expect(wd.timeoutPromise).rejects.toThrow(
        'Stream watchdog timeout',
      );
      expect(onFire).toHaveBeenCalledTimes(1);
      // getFire must still be populated regardless of callback success
      expect(wd.getFire()?.guard).toBe('first-response');
    });

    it('a throwing onFire on the inter-chunk guard still rejects timeoutPromise', async () => {
      const onFire = vi.fn(() => {
        throw new Error('callback blew up');
      });
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 100, idleMs: 30, onFire }),
      );

      wd.onLiveness(livenessPing());
      await vi.advanceTimersByTimeAsync(30);

      await expect(wd.timeoutPromise).rejects.toThrow(
        'Stream watchdog timeout',
      );
      expect(wd.getFire()?.guard).toBe('inter-chunk');
    });

    it('a throwing onFire produces no unhandled rejection', async () => {
      const wd = createStreamWatchdog(
        defaultOpts({
          firstResponseMs: 30,
          onFire: () => {
            throw new Error('callback blew up');
          },
        }),
      );

      await vi.advanceTimersByTimeAsync(30);
      await Promise.resolve();
      // Reaching here without vitest surfacing an unhandled rejection is the
      // assertion. Additionally verify state is consistent.
      expect(wd.getFire()).toBeDefined();
    });
  });

  describe('isActive truthfulness (issue #2607 finding 1)', () => {
    it('isActive is true while the first-response guard is armed', () => {
      const wd = createStreamWatchdog(defaultOpts({ firstResponseMs: 100 }));
      expect(wd.isActive).toBe(true);
    });

    it('isActive becomes false after fire', async () => {
      const wd = createStreamWatchdog(defaultOpts({ firstResponseMs: 30 }));
      await vi.advanceTimersByTimeAsync(30);
      await expect(wd.timeoutPromise).rejects.toThrow(
        'Stream watchdog timeout',
      );
      expect(wd.isActive).toBe(false);
    });

    it('isActive becomes false after cancel', () => {
      const wd = createStreamWatchdog(defaultOpts({ firstResponseMs: 30 }));
      wd.cancel();
      expect(wd.isActive).toBe(false);
    });

    it('isActive becomes false after cancel following liveness disarm', async () => {
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 100, idleMs: 30 }),
      );
      wd.onLiveness(livenessPing());
      expect(wd.isActive).toBe(true);
      wd.cancel();
      expect(wd.isActive).toBe(false);
    });

    it('ignores liveness after cancellation', () => {
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 100, idleMs: 30 }),
      );
      wd.cancel();
      wd.onLiveness(livenessPing());
      expect(wd.isActive).toBe(false);
    });
  });

  describe('whole-stream liveness-aware idle (issue #2607 finding 2)', () => {
    it('a semantic event disarms phase A just like a liveness ping', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 50, idleMs: 0, onFire }),
      );

      wd.onSemanticEvent();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(onFire).not.toHaveBeenCalled();
      expect(wd.getFire()).toBeUndefined();
    });

    it('first semantic content, repeated liveness pings spanning longer than idle threshold, then semantic content => no timeout', async () => {
      // idle threshold = 100ms. content arrives, then 3 liveness pings each
      // 40ms apart (total 120ms > 100ms), then more content. Each ping rearms
      // the inter-chunk guard, so no single silent window exceeds 100ms.
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 200, idleMs: 100, onFire }),
      );

      wd.onSemanticEvent();
      await vi.advanceTimersByTimeAsync(10);
      expect(onFire).not.toHaveBeenCalled();

      wd.onLiveness(livenessPing('response.in_progress'));
      await vi.advanceTimersByTimeAsync(40);
      expect(onFire).not.toHaveBeenCalled();

      wd.onLiveness(livenessPing('response.in_progress'));
      await vi.advanceTimersByTimeAsync(40);
      expect(onFire).not.toHaveBeenCalled();

      wd.onLiveness(livenessPing('response.in_progress'));
      await vi.advanceTimersByTimeAsync(40);
      expect(onFire).not.toHaveBeenCalled();

      wd.onSemanticEvent();
      await vi.advanceTimersByTimeAsync(50);
      expect(onFire).not.toHaveBeenCalled();
      expect(wd.getFire()).toBeUndefined();
    });

    it('after pings stop for the idle threshold => precise inter-chunk timeout', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 200, idleMs: 100, onFire }),
      );

      wd.onSemanticEvent();
      wd.onLiveness(livenessPing());
      await vi.advanceTimersByTimeAsync(40);
      expect(onFire).not.toHaveBeenCalled();

      // Pings stop. Exactly at 100ms after the last ping, it should fire.
      await vi.advanceTimersByTimeAsync(100);
      await expect(wd.timeoutPromise).rejects.toThrow(
        'Stream watchdog timeout',
      );
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(wd.getFire()?.guard).toBe('inter-chunk');
      expect(wd.getFire()?.thresholdMs).toBe(100);
    });

    it('default idle=0 behavior preserved: semantic content disarms phase A, phase B unbounded', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 50, idleMs: 0, onFire }),
      );

      wd.onSemanticEvent();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(onFire).not.toHaveBeenCalled();
      expect(wd.getFire()).toBeUndefined();
    });
  });

  describe('isActive means an actual armed guard (issue #2607 OCR finding 1)', () => {
    it('firstResponse=0/idle>0: initially inactive (no timer armed) then active after progress arms phase B', () => {
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 0, idleMs: 30 }),
      );
      expect(wd.isActive).toBe(false);

      wd.onLiveness(livenessPing());
      expect(wd.isActive).toBe(true);

      wd.onSemanticEvent();
      expect(wd.isActive).toBe(true);
    });

    it('firstResponse=0/idle>0 creates no active first-response timer', () => {
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 0, idleMs: 30 }),
      );

      expect(wd.isActive).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });
    it('firstResponse=0/idle>0: fires inter-chunk after progress then silence', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 0, idleMs: 30, onFire }),
      );
      expect(wd.isActive).toBe(false);

      wd.onLiveness(livenessPing());
      expect(wd.isActive).toBe(true);

      await vi.advanceTimersByTimeAsync(30);
      await expect(wd.timeoutPromise).rejects.toThrow(
        'Stream watchdog timeout',
      );
      expect(wd.getFire()?.guard).toBe('inter-chunk');
      expect(wd.isActive).toBe(false);
    });

    it('firstResponse>0/idle=0: becomes inactive after liveness disarms phase A (no phase B to arm)', () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 50, idleMs: 0, onFire }),
      );
      expect(wd.isActive).toBe(true);

      wd.onLiveness(livenessPing());
      expect(wd.isActive).toBe(false);

      wd.onSemanticEvent();
      expect(wd.isActive).toBe(false);
    });

    it('firstResponse>0/idle=0: becomes inactive after semantic event disarms phase A', () => {
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 50, idleMs: 0 }),
      );
      expect(wd.isActive).toBe(true);

      wd.onSemanticEvent();
      expect(wd.isActive).toBe(false);
    });

    it('after fire, isActive is false', async () => {
      const wd = createStreamWatchdog(defaultOpts({ firstResponseMs: 30 }));
      await vi.advanceTimersByTimeAsync(30);
      await expect(wd.timeoutPromise).rejects.toThrow(
        'Stream watchdog timeout',
      );
      expect(wd.isActive).toBe(false);
    });

    it('after cancel, isActive is false', () => {
      const wd = createStreamWatchdog(defaultOpts({ firstResponseMs: 30 }));
      wd.cancel();
      expect(wd.isActive).toBe(false);
    });

    it('cancel after liveness-armed phase B makes it inactive', () => {
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 0, idleMs: 30 }),
      );
      expect(wd.isActive).toBe(false);
      wd.onLiveness(livenessPing());
      expect(wd.isActive).toBe(true);
      wd.cancel();
      expect(wd.isActive).toBe(false);
    });

    it('rearm: second liveness ping keeps phase B active and resets the timer', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 0, idleMs: 60, onFire }),
      );

      wd.onLiveness(livenessPing());
      expect(wd.isActive).toBe(true);
      await vi.advanceTimersByTimeAsync(40);
      expect(onFire).not.toHaveBeenCalled();
      expect(wd.isActive).toBe(true);

      wd.onLiveness(livenessPing('response.in_progress'));
      expect(wd.isActive).toBe(true);
      await vi.advanceTimersByTimeAsync(40);
      expect(onFire).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(20);
      await expect(wd.timeoutPromise).rejects.toThrow(
        'Stream watchdog timeout',
      );
      expect(wd.getFire()?.guard).toBe('inter-chunk');
    });

    it('timer-abort race: aborting a phase B timer via rearm does not fire the old guard', async () => {
      const onFire = vi.fn();
      const wd = createStreamWatchdog(
        defaultOpts({ firstResponseMs: 0, idleMs: 30, onFire }),
      );

      wd.onLiveness(livenessPing());
      await vi.advanceTimersByTimeAsync(20);
      // Rearm before the 30ms deadline — the first timer must be aborted.
      wd.onLiveness(livenessPing('response.in_progress'));
      await vi.advanceTimersByTimeAsync(20);
      // 40ms total since first arm, but only 20ms since rearm; must not fire.
      expect(onFire).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10);
      await expect(wd.timeoutPromise).rejects.toThrow(
        'Stream watchdog timeout',
      );
    });
  });
});
