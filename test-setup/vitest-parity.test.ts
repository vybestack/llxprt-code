/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural coverage for the Vitest-compatibility guarantees the Bun shim
 * provides. Each case here corresponds to a place where Bun's built-in
 * behaviour diverges from Vitest and a repository test depended on the Vitest
 * semantics.
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { fixtureValue } from './import-actual-fixture.js';

vi.mock('./import-actual-fixture.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./import-actual-fixture.js')>();
  return { ...actual, fixtureValue: 'mocked-by-async-factory' };
});

describe('async vi.mock factories', () => {
  it('are applied before the test module body continues', () => {
    // A static import evaluated after the vi.mock call must observe the mock.
    // Deferring registration to a microtask would leave the real value here.
    expect(fixtureValue).toBe('mocked-by-async-factory');
  });
});

describe('vi.restoreAllMocks over a module mock', () => {
  it('leaves the module mocked and clears its call history', () => {
    // Vitest's restoreAllMocks only restores spies; Bun's also reverts module
    // mocks. The shim re-registers them afterwards, so a module mocked with
    // vi.mock must still be a mock function here — with its calls cleared.
    const mocked = fixtureValue;
    expect(mocked).toBe('mocked-by-async-factory');

    vi.restoreAllMocks();

    expect(fixtureValue).toBe('mocked-by-async-factory');
  });
});

describe('vi.spyOn over an existing mock', () => {
  it('starts with an empty call history, as Vitest does', () => {
    const target = { method: vi.fn(() => 'real') };

    target.method();
    expect(target.method).toHaveBeenCalledTimes(1);

    const spy = vi.spyOn(target, 'method');
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it('calls through to the implementation it replaced', () => {
    const target = { method: vi.fn(() => 'real') };
    const spy = vi.spyOn(target, 'method');

    expect(spy()).toBe('real');
  });
});

// NOTE: `vi.fn()` restore semantics are deliberately NOT normalised. Vitest's
// restoreAllMocks/mockRestore return a mock to the implementation it was
// constructed with; Bun's leave it cleared. Wrapping `vi.fn` to hide that
// difference broke mock-as-constructor (`new someMock()` stopped producing the
// object its implementation returns), so tests that need a specific
// implementation after a restore must set it explicitly.

describe('module mocks and restoreAllMocks', () => {
  it('keeps a vi.mock module mocked after restoreAllMocks', async () => {
    vi.restoreAllMocks();

    const imported = await import('./import-actual-fixture.js');
    expect(imported.fixtureValue).toBe('mocked-by-async-factory');
  });

  it('clears recorded calls on a mocked export, so counts do not leak between tests', async () => {
    const { fixtureValue } = await import(
      './secondary-import-actual-fixture.js'
    );
    expect(vi.isMockFunction(fixtureValue)).toBe(true);

    const mocked = fixtureValue as unknown as ReturnType<typeof vi.fn>;
    mocked();
    expect(mocked).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();

    expect(mocked).toHaveBeenCalledTimes(0);
  });
});

describe('vi.unmock', () => {
  it('restores the genuine exports of a mocked module', async () => {
    const actual = await vi.importActual<
      typeof import('./import-actual-fixture.js')
    >('./import-actual-fixture.js');

    vi.unmock('./import-actual-fixture.js');
    const restored = await import('./import-actual-fixture.js');
    expect(restored.fixtureValue).toBe(actual.fixtureValue);
  });
});

vi.mock('./secondary-import-actual-fixture.js', () => ({
  fixtureValue: vi.fn(),
}));

describe('fake timers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs already-due timers when advancing by zero', async () => {
    vi.useFakeTimers();
    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 0);

    await vi.advanceTimersByTimeAsync(0);

    expect(fired).toBe(true);
  });

  it('runs timers scheduled inside an earlier timer callback', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    setTimeout(() => {
      order.push('first');
      setTimeout(() => order.push('second'), 10);
    }, 10);

    await vi.advanceTimersByTimeAsync(20);

    expect(order).toEqual(['first', 'second']);
  });
});

describe('nested module mock cleanup', () => {
  it('clears call history on mocks nested inside an export', async () => {
    const nested = vi.fn(() => 'mocked');
    vi.mock('./nested-mock-fixture.js', () => ({
      default: { nested },
    }));

    const mod = await import('./nested-mock-fixture.js');
    mod.default.nested();
    expect(nested).toHaveBeenCalledTimes(1);

    // Vitest clears every mock function reachable from the module, not just
    // the direct exports; a nested one must not carry history into the next
    // test.
    vi.restoreAllMocks();
    expect(nested).toHaveBeenCalledTimes(0);
  });
});
