/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { delay } from './delay.js';
import type {
  StreamLivenessEvent,
  StreamTimeoutSource,
} from './streamIdleTimeout.js';

export type StreamTimeoutGuard = 'first-response' | 'inter-chunk';

export interface StreamWatchdogFire {
  readonly guard: StreamTimeoutGuard;
  readonly thresholdMs: number;
  readonly configSource: StreamTimeoutSource;
}

export type StreamWatchdogFireCallback = (fire: StreamWatchdogFire) => void;

export interface StreamWatchdogOptions {
  readonly firstResponseMs: number;
  readonly firstResponseSource: StreamTimeoutSource;
  readonly idleMs: number;
  readonly idleSource: StreamTimeoutSource;
  readonly onFire?: StreamWatchdogFireCallback;
}

export interface StreamWatchdog {
  /**
   * Whether a real guard timer is currently armed (first-response or
   * inter-chunk). False when no timer is pending — either disabled from the
   * start, disarmed after progress without phase B arming, fired, or
   * cancelled. When false, the timeoutPromise is guaranteed never to settle,
   * so callers must not race against it.
   */
  readonly isActive: boolean;
  readonly timeoutPromise: Promise<never>;
  onLiveness: (event: StreamLivenessEvent) => void;
  /**
   * Notifies the watchdog that a semantic stream event (IContent-bearing
   * chunk) was consumed. When idleMs > 0, this rearms the inter-chunk guard
   * exactly like a provider liveness ping, so the watchdog stays alive across
   * the entire stream rather than disarming after the first event.
   */
  onSemanticEvent: () => void;
  getFire: () => StreamWatchdogFire | undefined;
  cancel: () => void;
}

const NEVER: Promise<never> = new Promise<never>(() => {});

function createDisabledWatchdog(): StreamWatchdog {
  return {
    isActive: false,
    timeoutPromise: NEVER,
    onLiveness: () => {},
    onSemanticEvent: () => {},
    getFire: () => undefined,
    cancel: () => {},
  };
}

interface WatchdogState {
  readonly timeoutPromise: Promise<never>;
  readonly fireGuard: (
    guard: StreamTimeoutGuard,
    thresholdMs: number,
    configSource: StreamTimeoutSource,
  ) => void;
  readonly armInterChunk: () => void;
  readonly disarmFirstResponse: () => void;
  readonly cancel: () => void;
  readonly isActive: () => boolean;
  readonly getFire: () => StreamWatchdogFire | undefined;
}

function createState(
  firstResponseTimer: AbortController | undefined,
  opts: StreamWatchdogOptions,
): WatchdogState {
  let phaseBTimer: AbortController | undefined;
  let livenessDisarmed = false;
  let settled = false;
  // Track whether a real guard timer is currently armed. isActive must mean an
  // actual guard is pending so callers do not race a never-settling promise.
  let phaseAArmed = opts.firstResponseMs > 0;
  let phaseBArmed = false;
  let fire: StreamWatchdogFire | undefined;

  let rejectTimeout: (error: Error) => void = () => {};
  const timeoutPromise: Promise<never> = new Promise<never>(
    (_resolve, reject) => {
      rejectTimeout = reject;
    },
  );
  timeoutPromise.catch(() => {});

  const fireGuard = (
    guard: StreamTimeoutGuard,
    thresholdMs: number,
    configSource: StreamTimeoutSource,
  ): void => {
    if (settled) return;
    settled = true;
    phaseAArmed = false;
    phaseBArmed = false;
    fire = { guard, thresholdMs, configSource };
    rejectTimeout(new Error('Stream watchdog timeout'));
    try {
      opts.onFire?.(fire);
    } catch {
      // Listener failures cannot change watchdog settlement.
    }
  };

  const armInterChunk = (): void => {
    if (settled) return;
    if (opts.idleMs <= 0) return;
    phaseBTimer?.abort();
    phaseBTimer = new AbortController();
    phaseBArmed = true;
    const timer = phaseBTimer;
    delay(opts.idleMs, timer.signal).then(
      () => fireGuard('inter-chunk', opts.idleMs, opts.idleSource),
      () => {},
    );
  };

  const disarmFirstResponse = (): void => {
    if (settled || livenessDisarmed) return;
    livenessDisarmed = true;
    phaseAArmed = false;
    firstResponseTimer?.abort();
  };

  const cancel = (): void => {
    if (settled) return;
    settled = true;
    phaseAArmed = false;
    phaseBArmed = false;
    firstResponseTimer?.abort();
    phaseBTimer?.abort();
  };

  return {
    timeoutPromise,
    fireGuard,
    armInterChunk,
    disarmFirstResponse,
    cancel,
    isActive: () => !settled && (phaseAArmed || phaseBArmed),
    getFire: () => fire,
  };
}

export function createStreamWatchdog(
  opts: StreamWatchdogOptions,
): StreamWatchdog {
  // When neither guard can ever arm, return the disabled (never-active)
  // watchdog whose timeoutPromise never settles.
  if (opts.firstResponseMs <= 0 && opts.idleMs <= 0) {
    return createDisabledWatchdog();
  }

  const phaseATimer =
    opts.firstResponseMs > 0 ? new AbortController() : undefined;
  const state = createState(phaseATimer, opts);

  if (phaseATimer !== undefined) {
    delay(opts.firstResponseMs, phaseATimer.signal).then(
      () =>
        state.fireGuard(
          'first-response',
          opts.firstResponseMs,
          opts.firstResponseSource,
        ),
      () => {},
    );
  }

  // Liveness/progress disarms phase A (if armed) and arms phase B (when
  // idleMs > 0). We must NOT short-circuit on isActive here: when
  // firstResponseMs <= 0 phase A is never armed (so isActive starts false),
  // yet phase B still needs to arm on the first liveness ping. armInterChunk
  // and disarmFirstResponse are internally idempotent/settled-safe.
  const recordProgress = (): void => {
    state.disarmFirstResponse();
    state.armInterChunk();
  };

  const onLiveness = (_event: StreamLivenessEvent): void => {
    recordProgress();
  };

  return {
    get isActive() {
      return state.isActive();
    },
    timeoutPromise: state.timeoutPromise,
    onLiveness,
    onSemanticEvent: recordProgress,
    getFire: state.getFire,
    cancel: state.cancel,
  };
}
