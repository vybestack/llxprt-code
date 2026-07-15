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

export function setWaitForScheduler(scheduler: WaitForScheduler | null): void {
  activeScheduler = scheduler;
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
 */
export function waitFor<T>(
  callback: () => T | Promise<T>,
  options: number | WaitForOptions = {},
): Promise<T> {
  const normalizedOptions =
    typeof options === 'number' ? { timeout: options } : options;
  const interval = normalizedOptions.interval ?? DEFAULT_INTERVAL_MS;
  const timeout = normalizedOptions.timeout ?? DEFAULT_TIMEOUT_MS;

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
      if (activeScheduler?.isFakeTimers()) {
        activeScheduler.advanceTimersByTime(interval);
      }
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
 * Type guard: returns true when value is a function carrying a `.mock`
 * property object, which is the shared marker used by both Bun and Vitest.
 */
export function isMockFunction(value: unknown): value is ((
  ...args: unknown[]
) => unknown) & {
  mock: Record<string, unknown>;
} {
  if (typeof value !== 'function') return false;
  const mock = (value as { mock?: unknown }).mock;
  return typeof mock === 'object' && mock !== null;
}
