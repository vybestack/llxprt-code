/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

interface StubRecord {
  existed: boolean;
  value: unknown;
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
        existed: Object.prototype.hasOwnProperty.call(this.target, key),
        value: this.target[key],
      });
    }
    this.target[key] = value;
  }

  restoreAll(): void {
    for (const [key, record] of this.snapshots) {
      if (record.existed) {
        this.target[key] = record.value;
      } else {
        delete this.target[key];
      }
    }
    this.snapshots.clear();
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
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  for (;;) {
    try {
      return await callback();
    } catch (error: unknown) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      throw lastError;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Type guard: returns true when value is a function carrying a `.mock`
 * property object, which is the shared marker used by both Bun and Vitest.
 */
export function isMockFunction(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    typeof (value as { mock?: unknown }).mock === 'object' &&
    (value as { mock?: unknown }).mock !== null
  );
}
