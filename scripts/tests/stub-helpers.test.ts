/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  StubRegistry,
  waitFor,
  isMockFunction,
} from '../../test-setup/stub-helpers.js';

describe('StubRegistry', () => {
  it('restores a key that existed to its original value', () => {
    const target: Record<string, unknown> = { color: 'red' };
    const registry = new StubRegistry(target);

    registry.stub('color', 'blue');
    expect(target.color).toBe('blue');

    registry.restoreAll();
    expect(target.color).toBe('red');
  });

  it('deletes a key that was originally absent on restore', () => {
    const target: Record<string, unknown> = { existing: true };
    const registry = new StubRegistry(target);

    registry.stub('newKey', 'temp');
    expect(target.newKey).toBe('temp');

    registry.restoreAll();
    expect(Object.prototype.hasOwnProperty.call(target, 'newKey')).toBe(false);
    expect(target.existing).toBe(true);
  });

  it('restores a key whose original value was undefined but existed', () => {
    const target: Record<string, unknown> = { blank: undefined };
    const registry = new StubRegistry(target);

    registry.stub('blank', 'set');
    expect(target.blank).toBe('set');

    registry.restoreAll();
    expect(Object.prototype.hasOwnProperty.call(target, 'blank')).toBe(true);
    expect(target.blank).toBeUndefined();
  });

  it('restores multiple stubbed keys at once', () => {
    const target: Record<string, unknown> = { a: 1, b: 2 };
    const registry = new StubRegistry(target);

    registry.stub('a', 10);
    registry.stub('b', 20);
    registry.stub('c', 30);

    registry.restoreAll();
    expect(target.a).toBe(1);
    expect(target.b).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(target, 'c')).toBe(false);
  });

  it('only snapshots the first original value when the same key is stubbed twice', () => {
    const target: Record<string, unknown> = { x: 'original' };
    const registry = new StubRegistry(target);

    registry.stub('x', 'first');
    registry.stub('x', 'second');
    expect(target.x).toBe('second');

    registry.restoreAll();
    expect(target.x).toBe('original');
  });

  it('is safe to call restoreAll multiple times', () => {
    const target: Record<string, unknown> = { a: 1 };
    const registry = new StubRegistry(target);

    registry.stub('a', 99);
    registry.restoreAll();
    registry.restoreAll();

    expect(target.a).toBe(1);
  });

  it('stubs a non-configurable accessor with a setter', () => {
    let current = 'original';
    const target: Record<string, unknown> = {};
    Object.defineProperty(target, 'value', {
      configurable: false,
      enumerable: true,

      get: () => current,
      set: (value: unknown) => {
        current = String(value);
      },
    });
    const registry = new StubRegistry(target);

    registry.stub('value', 'stubbed');

    expect(target.value).toBe('stubbed');
  });

  it('restores remaining keys and clears snapshots after one restore fails', () => {
    const backing: Record<string, unknown> = { blocked: 'old', safe: 'old' };
    let rejectBlockedRestore = false;
    const target = new Proxy(backing, {
      defineProperty(object, key, descriptor) {
        if (rejectBlockedRestore && key === 'blocked') {
          throw new Error('blocked restore');
        }
        return Reflect.defineProperty(object, key, descriptor);
      },
    });
    const registry = new StubRegistry(target);

    registry.stub('blocked', 'new');
    registry.stub('safe', 'new');
    rejectBlockedRestore = true;

    expect(() => registry.restoreAll()).toThrow('Failed to restore all');
    expect(target.safe).toBe('old');
    expect(() => registry.restoreAll()).not.toThrow();
  });

  it('reports a failed deletion when restoring an originally absent key', () => {
    const backing: Record<string, unknown> = {};
    let rejectDeletion = false;
    const target = new Proxy(backing, {
      deleteProperty(object, key) {
        return rejectDeletion ? false : Reflect.deleteProperty(object, key);
      },
    });
    const registry = new StubRegistry(target);

    registry.stub('temporary', 'value');
    rejectDeletion = true;

    expect(() => registry.restoreAll()).toThrow('Failed to restore all');
    expect(target.temporary).toBe('value');
    expect(() => registry.restoreAll()).not.toThrow();
  });
});

describe('waitFor', () => {
  it('throws on non-finite interval or timeout', () => {
    expect(() => waitFor(() => 1, { interval: NaN })).toThrow(TypeError);
    expect(() => waitFor(() => 1, { timeout: Infinity })).toThrow(TypeError);
    expect(() => waitFor(() => 1, { interval: -Infinity })).toThrow(TypeError);
    expect(() => waitFor(() => 1, { timeout: -Infinity })).toThrow(TypeError);
  });

  it('resolves immediately when the callback succeeds on the first try', async () => {
    const result = await waitFor(() => 42);
    expect(result).toBe(42);
  });

  it('retries until the callback succeeds', async () => {
    let attempts = 0;
    const result = await waitFor(
      () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('not ready');
        }
        return 'done';
      },
      { interval: 10, timeout: 1000 },
    );

    expect(result).toBe('done');
    expect(attempts).toBe(3);
  });

  it('rejects with the last error after timeout', async () => {
    await expect(
      waitFor(
        () => {
          throw new Error('always fails');
        },
        { interval: 10, timeout: 50 },
      ),
    ).rejects.toThrow('always fails');
  });

  it('respects custom interval and timeout options', async () => {
    const start = Date.now();
    await expect(
      waitFor(
        () => {
          throw new Error('nope');
        },
        { interval: 20, timeout: 60 },
      ),
    ).rejects.toThrow('nope');

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(elapsed).toBeLessThan(150);
  });

  it('caps the polling delay at the remaining timeout', async () => {
    const start = Date.now();
    await expect(
      waitFor(
        () => {
          throw new Error('still waiting');
        },
        { interval: 100, timeout: 30 },
      ),
    ).rejects.toThrow('still waiting');

    expect(Date.now() - start).toBeLessThan(90);
  });

  it('times out when an async callback never settles', async () => {
    await expect(
      waitFor(() => new Promise<never>(() => {}), {
        interval: 10,
        timeout: 30,
      }),
    ).rejects.toThrow('waitFor timed out');
  });

  it('rejects with the most recent callback error at the deadline', async () => {
    let attempt = 0;
    let thrown: unknown;
    try {
      await waitFor(
        () => {
          attempt++;
          throw new Error(`attempt ${attempt}`);
        },
        { interval: 10, timeout: 30 },
      );
    } catch (error: unknown) {
      thrown = error;
    }

    expect(attempt).toBeGreaterThan(1);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(`attempt ${attempt}`);
  });

  it('supports async callbacks that reject and retries them', async () => {
    let attempts = 0;
    const result = await waitFor(
      async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('async not ready');
        }
        return 'async-done';
      },
      { interval: 10, timeout: 1000 },
    );

    expect(result).toBe('async-done');
    expect(attempts).toBe(2);
  });

  it('rejects when an async callback consistently rejects', async () => {
    await expect(
      waitFor(
        async () => {
          throw new Error('async always fails');
        },
        { interval: 10, timeout: 50 },
      ),
    ).rejects.toThrow('async always fails');
  });
});

describe('isMockFunction', () => {
  it('returns true for a function with a .mock object property', () => {
    const fn = (): void => {};
    fn.mock = { calls: [] };
    expect(isMockFunction(fn)).toBe(true);
  });

  it('returns false for a regular function without .mock', () => {
    const fn = (): void => {};
    expect(isMockFunction(fn)).toBe(false);
  });

  it('returns false for non-function values', () => {
    expect(isMockFunction(undefined)).toBe(false);
    expect(isMockFunction(null)).toBe(false);
    expect(isMockFunction(42)).toBe(false);
    expect(isMockFunction('string')).toBe(false);
    expect(isMockFunction({ mock: {} })).toBe(false);
  });
});
