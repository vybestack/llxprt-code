/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

interface StubRecord {
  descriptor?: PropertyDescriptor;
}

export interface WaitForOptions {
  interval?: number;
  timeout?: number;
}

const DEFAULT_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 1000;
const WAIT_FOR_TIMEOUT_MESSAGE = 'Timed out in waitFor!';
const safeSetTimeout = globalThis.setTimeout.bind(globalThis);
const safeSetInterval = globalThis.setInterval.bind(globalThis);
const safeClearTimeout = globalThis.clearTimeout.bind(globalThis);
const safeClearInterval = globalThis.clearInterval.bind(globalThis);

export interface WaitForScheduler {
  isFakeTimers(): boolean;
  advanceTimersByTime(milliseconds: number): void;
}

let activeScheduler: WaitForScheduler | null = null;
let defaultScheduler: WaitForScheduler | null = null;

export function setWaitForScheduler(scheduler: WaitForScheduler | null): void {
  activeScheduler = scheduler;
}

/**
 * Installs a fallback scheduler used when `activeScheduler` is null (e.g.
 * after a test calls `setWaitForScheduler(null)` in cleanup). This lets
 * `waitFor` detect fake timers without an explicitly installed scheduler,
 * which is needed under Bun where `vi.waitFor` IS this shim and must work
 * even when the test temporarily clears the active scheduler.
 */
export function setDefaultWaitForScheduler(
  scheduler: WaitForScheduler | null,
): void {
  defaultScheduler = scheduler;
}

/**
 * Error thrown when an attempt is made to stub a non-configurable accessor
 * property. Non-configurable accessors cannot be restored by
 * `Object.defineProperty` (it throws `TypeError`), and the only alternative —
 * restoring via the setter with the getter's observed value — is unsound for
 * transforming setters (those whose stored value is not identical to their
 * input). Rather than silently claiming a restoration that may not round-trip
 * correctly, StubRegistry rejects such properties so the caller gets an
 * immediate, honest signal.
 */
class NonConfigurableAccessorError extends TypeError {
  readonly key: string | symbol;

  constructor(key: string | symbol) {
    super(
      `Cannot stub non-configurable accessor property ${String(key)}: ` +
        'restoration would require an unsafe getter-to-setter value ' +
        'round-trip that cannot be guaranteed. Use a configurable property ' +
        'or restore manually.',
    );
    this.name = 'NonConfigurableAccessorError';
    this.key = key;
  }
}

/**
 * Returns `true` when `descriptor` describes a non-configurable accessor
 * (i.e. it has get/set, is not configurable). These descriptors cannot be
 * safely stubbed and restored.
 */
function isNonConfigurableAccessor(
  descriptor: PropertyDescriptor | undefined,
): boolean {
  return (
    descriptor !== undefined &&
    !descriptor.configurable &&
    !('value' in descriptor)
  );
}

/**
 * Snapshots and restores properties on a target object (e.g. process.env or
 * globalThis) so that stubs can be automatically rolled back after each test.
 *
 * Safe contract:
 * - Normal data properties and configurable accessors are snapshotted by
 *   descriptor and restored via `Object.defineProperty`, which is exact.
 * - Non-configurable accessor properties are **rejected** because restoration
 *   via the setter cannot be guaranteed to round-trip (transforming setters
 *   store a derived value, so passing the getter's output back through the
 *   setter may not reproduce the original state). Rejecting prevents silent
 *   leaks or corrupted state.
 */
export class StubRegistry {
  private readonly target: Record<string | symbol, unknown>;
  private readonly snapshots = new Map<string | symbol, StubRecord>();

  constructor(target: Record<string | symbol, unknown>) {
    this.target = target;
  }

  stub(key: string | symbol, value: unknown): void {
    const isFirstStub = !this.snapshots.has(key);

    // Re-read the descriptor on every call so we catch a property that
    // transitioned from configurable to non-configurable between stubs.
    const descriptor = Object.getOwnPropertyDescriptor(this.target, key);
    if (isNonConfigurableAccessor(descriptor)) {
      throw new NonConfigurableAccessorError(key);
    }

    // Reject any current descriptor transition that makes original restoration
    // impossible. If the property transitioned to non-configurable (data or
    // accessor) after the first stub, and the original snapshot was configurable
    // or absent, defineProperty cannot restore it (non-configurable properties
    // cannot be made configurable again, and absent properties cannot be
    // re-deleted once non-configurable). This covers non-configurable writable
    // data properties, which are stubbable via assignment but whose original
    // configurable snapshot cannot be restored via defineProperty.
    if (!isFirstStub && descriptor && !descriptor.configurable) {
      const original = this.snapshots.get(key)?.descriptor;
      if (!original || original.configurable) {
        throw new TypeError(
          `Cannot restub property ${String(key)}: it transitioned to ` +
            'non-configurable, making original restoration impossible',
        );
      }
    }

    if (isFirstStub) {
      this.snapshots.set(key, { descriptor });
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(this.target, key);
      if (descriptor && !descriptor.configurable) {
        if ('value' in descriptor && !descriptor.writable) {
          throw new TypeError(`Cannot stub readonly property ${String(key)}`);
        }
        if ('set' in descriptor && descriptor.set === undefined) {
          throw new TypeError(`Cannot stub readonly property ${String(key)}`);
        }
        this.target[key] = value;
        return;
      }
      Object.defineProperty(this.target, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
    } catch (error) {
      if (isFirstStub) {
        this.snapshots.delete(key);
      }
      throw error;
    }
  }

  restoreAll(): void {
    const errors: unknown[] = [];
    for (const [key, record] of this.snapshots) {
      try {
        if (record.descriptor) {
          Object.defineProperty(this.target, key, record.descriptor);
        } else if (!Reflect.deleteProperty(this.target, key)) {
          throw new TypeError(
            `Failed to delete stubbed property ${String(key)}`,
          );
        }
        // Remove only after a successful restoration so that failed records
        // are retained for a subsequent retry once the underlying cause is fixed.
        this.snapshots.delete(key);
      } catch (error: unknown) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        'Failed to restore all stubbed properties',
      );
    }
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  if (typeof value !== 'object' || value === null) return false;
  return typeof Reflect.get(value, 'then') === 'function';
}

/**
 * Async polling helper matching Vitest 3.2.6's waitFor state machine.
 *
 * Under real timers, Vitest and Bun both use setInterval polling — the
 * interval fires on real time and checkCallback runs periodically. Under
 * fake timers, Vitest auto-advances timers internally so the interval fires
 * without manual intervention. Bun's fake timers, however, intercept the
 * captured `safeSetInterval` reference but do NOT auto-advance — the
 * interval callback only fires when someone explicitly calls
 * `vi.advanceTimersByTime()`. Since the waitFor implementation itself owns
 * the scheduler advancement, the interval callback and the timer advancement
 * form a circular dependency that deadlocks under Bun.
 *
 * The fix: when fake timers are active, use a synchronous polling loop that
 * advances timers by `interval` and checks the callback, repeating until the
 * callback resolves or the total elapsed time reaches `timeout`. This matches
 * Vitest's observable behavior (callback attempts at t=0, interval, 2*interval,
 * ... up to timeout) without depending on interval timers firing.
 */
export function waitFor<T>(
  callback: () => T | Promise<T>,
  options: number | WaitForOptions = {},
): Promise<T> {
  const normalizedOptions =
    typeof options === 'number' ? { timeout: options } : options;
  const interval = normalizedOptions.interval ?? DEFAULT_INTERVAL_MS;
  const timeout = normalizedOptions.timeout ?? DEFAULT_TIMEOUT_MS;

  const scheduler = activeScheduler ?? defaultScheduler;
  if (scheduler?.isFakeTimers()) {
    return waitForWithFakeTimers(callback, interval, timeout, scheduler);
  }

  return new Promise<T>((resolve, reject) => {
    let lastError: unknown;
    let promiseStatus: 'idle' | 'pending' | 'resolved' | 'rejected' = 'idle';
    const timerIds: {
      timeout?: ReturnType<typeof safeSetTimeout>;
      interval?: ReturnType<typeof safeSetInterval>;
    } = {};

    const onResolve = (result: T): void => {
      if (timerIds.timeout) safeClearTimeout(timerIds.timeout);
      if (timerIds.interval) safeClearInterval(timerIds.interval);
      resolve(result);
    };

    const handleTimeout = (): void => {
      if (timerIds.interval) safeClearInterval(timerIds.interval);
      reject(lastError || new Error(WAIT_FOR_TIMEOUT_MESSAGE));
    };

    const checkCallback = (): true | undefined => {
      if (promiseStatus === 'pending') return undefined;

      try {
        const result = callback();
        if (isPromiseLike(result)) {
          promiseStatus = 'pending';
          result.then(
            (resolvedValue: T) => {
              promiseStatus = 'resolved';
              onResolve(resolvedValue);
            },
            (rejectedValue: unknown) => {
              promiseStatus = 'rejected';
              lastError = rejectedValue;
            },
          );
        } else {
          onResolve(result);
          return true;
        }
      } catch (error: unknown) {
        lastError = error;
      }
      return undefined;
    };

    if (checkCallback() === true) return;
    timerIds.timeout = safeSetTimeout(handleTimeout, timeout);
    timerIds.interval = safeSetInterval(checkCallback, interval);
  });
}

/**
 * Fake-timer polling implementation. Advances the fake clock by `interval`
 * on each attempt and checks the callback. When the callback returns a
 * Promise, the advancement stops and awaits the microtask queue to let the
 * promise settle. If the promise rejects (callback throws), the next attempt
 * fires after advancing `interval` again. If the total elapsed time reaches
 * `timeout`, the last error (or a default timeout message) is rejected.
 */
async function waitForWithFakeTimers<T>(
  callback: () => T | Promise<T>,
  interval: number,
  timeout: number,
  scheduler: WaitForScheduler = activeScheduler ?? defaultScheduler!,
): Promise<T> {
  let lastError: unknown;
  let hasPending = false;
  let pendingResolved = false;
  let pendingValue: T | undefined;
  let pendingRejected = false;

  let elapsed = 0;
  for (;;) {
    if (!hasPending) {
      // Advance before the first callback, not after it. Under fake timers
      // nothing else moves the clock, so a callback waiting on a scheduled
      // effect would observe t=0 and fail on its first attempt; this mirrors
      // the pre-existing Bun scheduler contract asserted by
      // `test-setup/stub-helpers.bun.test.ts`.
      scheduler!.advanceTimersByTime(interval);
      elapsed += interval;

      let result: T | Promise<T>;
      try {
        result = callback();
      } catch (error: unknown) {
        lastError = error;
        if (elapsed >= timeout) {
          throw lastError || new Error(WAIT_FOR_TIMEOUT_MESSAGE);
        }
        // Yield to the microtask queue before retrying. Advancing the fake
        // clock only fires the timer callbacks; the promise chains they
        // resume (e.g. a retry backoff awaiting its delay) still need a
        // microtask turn before the next assertion can observe their effect.
        await Promise.resolve();
        continue;
      }

      if (isPromiseLike(result)) {
        hasPending = true;
        pendingResolved = false;
        pendingRejected = false;
        (result as Promise<T>).then(
          (value: T) => {
            pendingResolved = true;
            pendingValue = value;
          },
          (error: unknown) => {
            pendingRejected = true;
            lastError = error;
          },
        );
        // Yield once to let already-resolved promises (e.g. Promise.resolve())
        // settle their .then handlers synchronously
        await Promise.resolve();
        if (pendingResolved) {
          return pendingValue as T;
        }
        if (pendingRejected) {
          hasPending = false;
          if (elapsed >= timeout) {
            throw lastError || new Error(WAIT_FOR_TIMEOUT_MESSAGE);
          }
        }
      } else {
        return result;
      }
    }

    if (hasPending) {
      // Advance timers while waiting for the pending promise
      scheduler!.advanceTimersByTime(interval);
      elapsed += interval;
      await Promise.resolve();
      if (pendingResolved) {
        return pendingValue as T;
      }
      if (pendingRejected) {
        hasPending = false;
        if (elapsed >= timeout) {
          throw lastError || new Error(WAIT_FOR_TIMEOUT_MESSAGE);
        }
        // The clock already advanced for this cycle; going back to the top
        // without this guard would advance a second time before the callback
        // is retried, doubling the effective interval.
        continue;
      }
    }

    if (elapsed >= timeout) {
      throw lastError || new Error(WAIT_FOR_TIMEOUT_MESSAGE);
    }
  }
}

/**
 * Type guard: returns true when value is a function carrying a `.mock`
 * property object, which is the shared marker used by both Bun and Vitest.
 */
export function isMockFunction(value: unknown): value is ((
  ...args: unknown[]
) => unknown) & {
  mock: Record<string, unknown>;
  // Both runners attach these alongside `.mock`; declaring them lets callers
  // reset a mock without asserting across otherwise non-overlapping types.
  mockClear?: () => void;
  mockReset?: () => void;
  mockRestore?: () => void;
} {
  if (typeof value !== 'function') return false;
  const mock = (value as { mock?: unknown }).mock;
  return typeof mock === 'object' && mock !== null;
}
