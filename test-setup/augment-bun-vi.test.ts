/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { runCleanupSteps } from './augment-bun-vi.js';

vi.mock('./import-actual-fixture.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./import-actual-fixture.js')>();
  return { ...actual, fixtureValue: 'mocked' };
});

describe('Bun vi augmentation', () => {
  it('resolves importOriginal relative to the registering test file', async () => {
    const imported = await import('./import-actual-fixture.js');

    expect(imported.fixtureValue).toBe('mocked');
  });

  it('supports factories that do not request importOriginal', async () => {
    vi.mock('./secondary-import-actual-fixture.js', () => ({
      fixtureValue: 'secondary-mocked',
    }));

    const imported = await import('./secondary-import-actual-fixture.js');
    expect(imported.fixtureValue).toBe('secondary-mocked');
  });

  it('resolves and caches importActual relative to the calling test file', async () => {
    const actual = await vi.importActual<
      typeof import('./import-actual-fixture.js')
    >('./import-actual-fixture.js');
    const repeated = await vi.importActual<
      typeof import('./import-actual-fixture.js')
    >('./import-actual-fixture.js');

    expect(actual.fixtureValue).toBe('actual');
    expect(repeated).toBe(actual);
  });

  it('loads built-in modules through importActual', async () => {
    const actual =
      await vi.importActual<typeof import('node:path')>('node:path');

    expect(actual.basename('/tmp/example.txt')).toBe('example.txt');
  });

  it('settles async timer helpers without a fixed draining delay', async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      setTimeout(() => {
        Promise.resolve().then(() => {
          settled = true;
        });
      }, 10);

      await vi.advanceTimersByTimeAsync(10);

      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drains recursively queued microtasks from advanceTimersByTimeAsync', async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      setTimeout(() => {
        order.push('timer');
        Promise.resolve()
          .then(() => {
            order.push('micro1');
            return Promise.resolve();
          })
          .then(() => {
            order.push('micro2');
            return Promise.resolve();
          })
          .then(() => {
            order.push('micro3');
          });
      }, 10);

      await vi.advanceTimersByTimeAsync(10);

      expect(order).toEqual(['timer', 'micro1', 'micro2', 'micro3']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drains recursively queued microtasks from runAllTimersAsync', async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      setTimeout(() => {
        order.push('timer');
        Promise.resolve()
          .then(() => {
            order.push('micro1');
            return Promise.resolve();
          })
          .then(() => {
            order.push('micro2');
          });
      }, 5);

      await vi.runAllTimersAsync();

      expect(order).toEqual(['timer', 'micro1', 'micro2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drains recursively queued microtasks from runOnlyPendingTimersAsync', async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      setTimeout(() => {
        order.push('timer1');
        Promise.resolve()
          .then(() => {
            order.push('micro1');
            return Promise.resolve();
          })
          .then(() => {
            order.push('micro2');
          });
      }, 5);

      await vi.runOnlyPendingTimersAsync();

      expect(order).toEqual(['timer1', 'micro1', 'micro2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not deadlock when timers queue more timers during advanceTimersByTimeAsync', async () => {
    vi.useFakeTimers();
    try {
      const results: number[] = [];
      const schedule = (depth: number): void => {
        if (depth <= 0) return;
        setTimeout(() => {
          results.push(depth);
          Promise.resolve().then(() => {
            results.push(-depth);
          });
          schedule(depth - 1);
        }, 10);
      };
      schedule(3);

      await vi.advanceTimersByTimeAsync(30);

      expect(results.length).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails fast for unsupported module isolation APIs', () => {
    expect(() => vi.resetModules()).toThrow(
      'Bun does not support resetting or unmocking modules',
    );
  });

  it('fails fast instead of returning false mock-registry results', () => {
    expect(() => Reflect.get(vi.mocks, 'fixture')).toThrow(
      'Bun does not expose its module mock registry',
    );
  });
});

describe('runCleanupSteps', () => {
  it('runs all steps when none throw', () => {
    const calls: number[] = [];
    runCleanupSteps([
      () => {
        calls.push(1);
      },
      () => {
        calls.push(2);
      },
      () => {
        calls.push(3);
      },
    ]);

    expect(calls).toEqual([1, 2, 3]);
  });

  it('rethrows the original error when exactly one step fails', () => {
    const error = new Error('single failure');
    expect(() =>
      runCleanupSteps([
        () => {},
        () => {
          throw error;
        },
        () => {},
      ]),
    ).toThrow(error);
  });

  it('runs all steps and preserves multiple failures in order', () => {
    const error1 = new Error('first');
    const error2 = new Error('second');
    const calls: number[] = [];

    let caught: unknown;
    try {
      runCleanupSteps([
        () => {
          calls.push(1);
        },
        () => {
          throw error1;
        },
        () => {
          calls.push(3);
        },
        () => {
          throw error2;
        },
      ]);
    } catch (error: unknown) {
      caught = error;
    }

    expect(calls).toEqual([1, 3]);
    expect(caught).toBeInstanceOf(AggregateError);
    const agg = caught as AggregateError;
    expect(agg.errors).toEqual([error1, error2]);
  });

  it('preserves non-Error thrown values in the AggregateError', () => {
    let caught: unknown;
    try {
      runCleanupSteps([
        () => {
          throw 'string error';
        },
        () => {
          throw 42;
        },
      ]);
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const agg = caught as AggregateError;
    expect(agg.errors).toEqual(['string error', 42]);
  });

  it('does not throw when steps array is empty', () => {
    expect(() => runCleanupSteps([])).not.toThrow();
  });
});
