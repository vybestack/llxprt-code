/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural coverage for `automock`.
 *
 * Bun's `vi.mock` requires a factory, so a suite that only wants "replace every
 * export with a mock" needs one built for it. `automock` does that, and 91
 * suites depend on the exact shape it produces. These cases pin that shape.
 */

import { describe, expect, it } from 'bun:test';
import { automock } from './automock.js';

describe('automock', () => {
  it('replaces a function export with a recording mock', () => {
    const mocked = automock({ greet: (name: string) => `hello ${name}` }) as {
      greet: ((name: string) => string) & { mock: { calls: unknown[][] } };
    };

    expect(mocked.greet('world')).toBeUndefined();
    expect(mocked.greet.mock.calls).toEqual([['world']]);
  });

  it('keeps every own export, so a partial namespace cannot silently appear', () => {
    const mocked = automock({ a: () => 1, b: () => 2, c: 3 });

    // `default` is synthesised for CommonJS interop, covered separately.
    expect(Object.keys(mocked).sort()).toEqual(['a', 'b', 'c', 'default']);
  });

  it('mocks a class so instances expose mocked prototype methods', () => {
    class Service {
      run(): string {
        return 'real';
      }
    }
    const mocked = automock({ Service }) as {
      Service: new () => { run: () => unknown };
    };

    const instance = new mocked.Service();
    expect(instance.run()).toBeUndefined();
  });

  it('mocks values nested inside an exported object', () => {
    const mocked = automock({ nested: { inner: () => 'real' } }) as {
      nested: { inner: () => unknown };
    };

    expect(mocked.nested.inner()).toBeUndefined();
  });

  it('terminates on a cyclic export graph', () => {
    const cyclic: Record<string, unknown> = { name: () => 'x' };
    cyclic['self'] = cyclic;

    const mocked = automock({ cyclic }) as { cyclic: Record<string, unknown> };

    expect(mocked.cyclic['self']).toBe(mocked.cyclic);
  });

  it('empties arrays rather than preserving their real elements', () => {
    const mocked = automock({ items: [1, 2, 3] }) as { items: unknown[] };

    expect(mocked.items).toEqual([]);
  });

  it('synthesises a default export for CommonJS interop', () => {
    const mocked = automock({ helper: () => 'real' }) as {
      default?: Record<string, unknown>;
    };

    expect(mocked.default).toBeDefined();
    expect(Object.keys(mocked.default ?? {})).toContain('helper');
  });

  it('mirrors an accessor lazily instead of reading it while building', () => {
    // Some built-in prototypes expose getters backed by private fields that
    // throw unless invoked on a real instance; reading one while building the
    // mock would abort the whole module. A namespace that already carries a
    // `default` skips the interop copy below, isolating this contract.
    let reads = 0;
    const source = {
      default: {},
      get lazy(): string {
        reads += 1;
        return 'real';
      },
    };

    const mocked = automock(source) as { lazy: unknown };

    expect(reads).toBe(0);
    void mocked.lazy;
    expect(reads).toBe(1);
  });

  it('reads accessors when synthesising the CommonJS default', () => {
    // Documented consequence of the interop copy: it spreads the namespace, so
    // a getter is invoked once at build time. Matches the behaviour the
    // compatibility layer had.
    let reads = 0;
    const mocked = automock({
      get eager(): string {
        reads += 1;
        return 'real';
      },
    });

    expect(mocked).toBeDefined();
    expect(reads).toBe(1);
  });
});
