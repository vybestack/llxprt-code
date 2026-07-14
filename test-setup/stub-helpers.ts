/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

interface StubRecord {
  descriptor?: PropertyDescriptor;
}

interface WaitForOptions {
  interval?: number;
  timeout?: number;
}

const DEFAULT_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 1000;
const MIN_INTERVAL_MS = 1;
const MIN_TIMEOUT_MS = 0;

/**
 * Snapshots and restores properties on a target object (e.g. process.env or
 * globalThis) so that stubs can be automatically rolled back after each test.
 */
export class StubRegistry {
  private readonly target: Record<string | symbol, unknown>;
  private readonly snapshots = new Map<string | symbol, StubRecord>();

  constructor(target: Record<string | symbol, unknown>) {
    this.target = target;
  }

  stub(key: string | symbol, value: unknown): void {
    if (!this.snapshots.has(key)) {
      this.snapshots.set(key, {
        descriptor: Object.getOwnPropertyDescriptor(this.target, key),
      });
    }
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
  }

  restoreAll(): void {
    const errors: unknown[] = [];
    for (const [key, record] of this.snapshots) {
      try {
        if (record.descriptor) {
          Object.defineProperty(this.target, key, record.descriptor);
        } else {
          Reflect.deleteProperty(this.target, key);
        }
      } catch (error: unknown) {
        errors.push(error);
      }
    }
    this.snapshots.clear();
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        'Failed to restore all stubbed properties',
      );
    }
  }
}

/**
 * Poll-async helper that repeatedly invokes callback until it stops throwing,
 * mirroring Vitest's vi.waitFor. Supports both sync and async callbacks.
 */
export function waitFor<T>(
  callback: () => T | Promise<T>,
  options?: WaitForOptions,
): Promise<T> {
  const interval = Math.max(
    options?.interval ?? DEFAULT_INTERVAL_MS,
    MIN_INTERVAL_MS,
  );
  const timeout = Math.max(
    options?.timeout ?? DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
  );

  if (!Number.isFinite(interval) || !Number.isFinite(timeout)) {
    throw new TypeError('waitFor: interval and timeout must be finite numbers');
  }

  return waitForImpl(callback, interval, timeout);
}

async function waitForImpl<T>(
  callback: () => T | Promise<T>,
  interval: number,
  timeout: number,
): Promise<T> {
  const deadline = performance.now() + timeout;
  let lastError: unknown;

  for (;;) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      throw lastError ?? new Error('waitFor timed out');
    }

    try {
      return await invokeBeforeDeadline(callback, remaining);
    } catch (error: unknown) {
      lastError = error;
      if (performance.now() >= deadline) {
        throw lastError;
      }
    }
    const delay = Math.min(interval, deadline - performance.now());
    if (delay > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function invokeBeforeDeadline<T>(
  callback: () => T | Promise<T>,
  remaining: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(callback),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('waitFor timed out')),
          remaining,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
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
} {
  return (
    typeof value === 'function' &&
    typeof (value as { mock?: unknown }).mock === 'object' &&
    (value as { mock?: unknown }).mock !== null
  );
}
