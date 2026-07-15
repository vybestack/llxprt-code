/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { StubRegistry, waitFor } from './stub-helpers.js';

afterEach(() => {
  if (vi.isFakeTimers()) {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});

describe('waitFor under Bun', () => {
  it('invokes a successful callback synchronously', async () => {
    let invoked = false;
    const result = waitFor(() => {
      invoked = true;
      return 42;
    });

    expect(invoked).toBe(true);
    await expect(result).resolves.toBe(42);
  });

  it('supports the numeric timeout overload', async () => {
    await expect(
      waitFor(() => {
        throw new Error('numeric timeout');
      }, 20),
    ).rejects.toThrow('numeric timeout');
  });

  it('retries on fixed intervals with real timers', async () => {
    let attempts = 0;
    const result = await waitFor(
      () => {
        attempts++;
        if (attempts < 3) throw new Error('not ready');
        return 'done';
      },
      { interval: 5, timeout: 200 },
    );

    expect(result).toBe('done');
    expect(attempts).toBe(3);
  });

  it('advances fake timers synchronously before the initial callback', async () => {
    vi.useFakeTimers({ now: 0 });
    let callbackTime = -1;

    await expect(
      waitFor(
        () => {
          callbackTime = Date.now();
          return 'done';
        },
        { interval: 50, timeout: 200 },
      ),
    ).resolves.toBe('done');

    expect(callbackTime).toBe(50);
  });

  it('accepts raw zero, negative, NaN, and infinity options on synchronous success', async () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        waitFor(() => value, { interval: value, timeout: value }),
      ).resolves.toBe(value);
    }
  });
});

describe('StubRegistry under Bun', () => {
  it('restores existing and absent properties', () => {
    const target: Record<string, unknown> = { existing: 'original' };
    const registry = new StubRegistry(target);

    registry.stub('existing', 'stubbed');
    registry.stub('added', true);
    registry.restoreAll();

    expect(target.existing).toBe('original');
    expect(Object.hasOwn(target, 'added')).toBe(false);
  });

  it('rejects non-configurable accessors without mutating them', () => {
    let backing = 2;
    const target: Record<string, unknown> = {};
    Object.defineProperty(target, 'scaled', {
      configurable: false,
      get: () => backing,
      set: (value: unknown) => {
        backing = Number(value) * 2;
      },
    });
    const registry = new StubRegistry(target);

    expect(() => registry.stub('scaled', 5)).toThrow(TypeError);
    expect(target.scaled).toBe(2);
  });
});
