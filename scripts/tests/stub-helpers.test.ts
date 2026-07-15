/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { StubRegistry, isMockFunction } from '../../test-setup/stub-helpers.js';

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

  // -------------------------------------------------------------------------
  // Non-configurable accessor rejection contract
  // -------------------------------------------------------------------------
  // StubRegistry rejects non-configurable accessor properties because
  // restoration via the setter is unsound: a transforming setter stores a
  // value derived from (not identical to) its input, so passing the getter's
  // observed output back through the setter may not reproduce the original
  // state. This prevents silent leaks/corruption while preserving normal data
  // property and configurable-accessor behavior.

  it('rejects stubbing a non-configurable accessor with a setter (identity setter)', () => {
    let current = 'original';
    const target: Record<string, unknown> = {};
    Object.defineProperty(target, 'value', {
      configurable: false,
      enumerable: true,
      get: () => current,
      set: (value: unknown) => {
        current = value as string;
      },
    });
    const registry = new StubRegistry(target);

    expect(() => registry.stub('value', 'stubbed')).toThrow(TypeError);
  });

  it('rejects stubbing a non-configurable accessor with a transforming setter and does not mutate the value', () => {
    // A transforming setter: stored value differs from input.
    let backing = 0;
    const target: Record<string, unknown> = {};
    Object.defineProperty(target, 'scaled', {
      configurable: false,
      enumerable: true,
      get: () => backing,
      set: (value: unknown) => {
        backing = Number(value) * 2;
      },
    });
    const registry = new StubRegistry(target);

    const originalValue = target.scaled;
    expect(() => registry.stub('scaled', 5)).toThrow(TypeError);

    // The target was NOT mutated — the rejection prevented the stub.
    expect(target.scaled).toBe(originalValue);
  });

  it('rejects stubbing a non-configurable accessor whose getter throws', () => {
    const target: Record<string, unknown> = {};
    Object.defineProperty(target, 'failget', {
      configurable: false,
      enumerable: true,
      // The getter genuinely throws on every read. The StubRegistry rejection
      // must happen at descriptor-snapshot time (via getOwnPropertyDescriptor)
      // without ever invoking the getter.
      get: () => {
        throw new Error('getter explosion');
      },
      set: () => {
        // no-op; included only to make this an accessor
      },
    });
    const registry = new StubRegistry(target);

    expect(() => registry.stub('failget', 'stubbed')).toThrow(TypeError);

    // Reading the property still throws — the target was not mutated and the
    // getter is still the original throwing getter.
    expect(() => target.failget).toThrow('getter explosion');
  });

  it('does not leave a stale snapshot after rejecting a non-configurable accessor', () => {
    let current = 'original';
    const target: Record<string | symbol, unknown> = {};
    Object.defineProperty(target, 'accessor', {
      configurable: false,
      enumerable: true,
      get: () => current,
      set: (value: unknown) => {
        current = value as string;
      },
    });
    target.safe = 'old';
    const registry = new StubRegistry(target);

    // The accessor rejection must not prevent stubbing other safe keys.
    expect(() => registry.stub('accessor', 'stubbed')).toThrow(TypeError);

    // A normal data property on the same target works fine.
    registry.stub('safe', 'new');
    expect(target.safe).toBe('new');

    registry.restoreAll();
    expect(target.safe).toBe('old');
    expect(target.accessor).toBe('original');
  });

  it('allows stubbing a configurable accessor property and restores it exactly', () => {
    let current = 'original';
    const target: Record<string, unknown> = {};
    Object.defineProperty(target, 'value', {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (value: unknown) => {
        current = value as string;
      },
    });
    const registry = new StubRegistry(target);

    registry.stub('value', 'stubbed');
    expect(target.value).toBe('stubbed');

    registry.restoreAll();
    // Restoration via defineProperty restores the original get/set descriptor.
    const descriptor = Object.getOwnPropertyDescriptor(target, 'value');
    expect(descriptor?.configurable).toBe(true);
    expect(target.value).toBe('original');
  });

  it('rejects when a property transitions from configurable to non-configurable between stubs', () => {
    // First stub succeeds because the accessor is configurable.
    let current = 'original';
    const target: Record<string, unknown> = {};
    Object.defineProperty(target, 'value', {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (value: unknown) => {
        current = value as string;
      },
    });
    const registry = new StubRegistry(target);

    registry.stub('value', 'first');
    expect(target.value).toBe('first');

    // Now redefine the property as non-configurable (simulating an external
    // mutation between stubs). The next stub call must detect this.
    Object.defineProperty(target, 'value', {
      configurable: false,
      enumerable: true,
      get: () => current,
      set: (value: unknown) => {
        current = value as string;
      },
    });

    expect(() => registry.stub('value', 'second')).toThrow(TypeError);

    // Once externally locked to non-configurable, the original snapshot
    // (configurable: true) cannot be restored via defineProperty — the
    // external mutation is unrecoverable. restoreAll throws and retains
    // the snapshot. The restub rejection was the honest signal; the caller
    // is responsible for the external mutation.
    expect(() => registry.restoreAll()).toThrow(AggregateError);
    // The external redefine replaced the data-property stub ('first') with a
    // non-configurable accessor reading `current`, which is still 'original'
    // (stub replaced the property with a data property and never invoked the
    // setter). The restore cannot change configurable back to true.
    expect(target.value).toBe('original');
  });

  it('restores remaining keys and retains failed snapshots for retry after one restore fails', () => {
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

    // First restoreAll: safe succeeds (removed), blocked fails (retained)
    expect(() => registry.restoreAll()).toThrow('Failed to restore all');
    expect(target.safe).toBe('old');
    expect(target.blocked).toBe('new');

    // Disabling the failure allows the retained blocked snapshot to retry
    rejectBlockedRestore = false;
    expect(() => registry.restoreAll()).not.toThrow();
    expect(target.blocked).toBe('old');
  });

  it('reports a failed deletion when restoring an originally absent key, then retries successfully', () => {
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

    // First restoreAll fails: snapshot retained, property still stubbed
    expect(() => registry.restoreAll()).toThrow('Failed to restore all');
    expect(target.temporary).toBe('value');

    // Allowing deletion: retained snapshot retries successfully
    rejectDeletion = false;
    expect(() => registry.restoreAll()).not.toThrow();
    expect(Object.prototype.hasOwnProperty.call(target, 'temporary')).toBe(
      false,
    );
  });

  it('resnapshots current state after a failed first defineProperty stub', () => {
    const backing: Record<string, unknown> = {};
    let rejectDefine = true;
    const target = new Proxy(backing, {
      defineProperty(object, key, descriptor) {
        if (rejectDefine) {
          throw new Error('blocked defineProperty');
        }
        return Reflect.defineProperty(object, key, descriptor);
      },
    });
    const registry = new StubRegistry(target);

    expect(() => registry.stub('newKey', 'failed')).toThrow(
      'blocked defineProperty',
    );

    rejectDefine = false;
    backing.newKey = 'intervening';
    registry.stub('newKey', 'stubbed');
    expect(target.newKey).toBe('stubbed');

    registry.restoreAll();
    expect(target.newKey).toBe('intervening');
  });

  it('resnapshots current state after a failed first assignment stub', () => {
    const backing: Record<string, unknown> = {};
    Object.defineProperty(backing, 'value', {
      configurable: false,
      enumerable: true,
      writable: true,
      value: 'original',
    });
    let rejectAssignment = true;
    const target = new Proxy(backing, {
      set(object, key, value) {
        if (rejectAssignment) {
          throw new Error('blocked assignment');
        }
        return Reflect.set(object, key, value);
      },
    });
    const registry = new StubRegistry(target);

    expect(() => registry.stub('value', 'failed')).toThrow(
      'blocked assignment',
    );

    rejectAssignment = false;
    backing.value = 'intervening';
    registry.stub('value', 'stubbed');
    expect(target.value).toBe('stubbed');

    registry.restoreAll();
    expect(target.value).toBe('intervening');
  });

  it('rolls back only the inserted snapshot when the first stub mutation fails, preserving other stubs', () => {
    const backing: Record<string, unknown> = { safe: 'old' };
    let rejectDefine = false;
    const target = new Proxy(backing, {
      defineProperty(object, key, descriptor) {
        if (rejectDefine && key === 'blocked') {
          throw new Error('blocked defineProperty');
        }
        return Reflect.defineProperty(object, key, descriptor);
      },
    });
    const registry = new StubRegistry(target);

    registry.stub('safe', 'new');
    rejectDefine = true;
    expect(() => registry.stub('blocked', 'temp')).toThrow(
      'blocked defineProperty',
    );
    rejectDefine = false;

    expect(target.safe).toBe('new');
    registry.restoreAll();
    expect(target.safe).toBe('old');
    expect(Object.prototype.hasOwnProperty.call(target, 'blocked')).toBe(false);
  });

  it('preserves the original snapshot when a later restub mutation fails', () => {
    const backing: Record<string, unknown> = { x: 'original' };
    let rejectDefine = false;
    const target = new Proxy(backing, {
      defineProperty(object, key, descriptor) {
        if (rejectDefine) {
          throw new Error('blocked restub');
        }
        return Reflect.defineProperty(object, key, descriptor);
      },
    });
    const registry = new StubRegistry(target);

    registry.stub('x', 'first');
    expect(target.x).toBe('first');

    rejectDefine = true;
    expect(() => registry.stub('x', 'second')).toThrow('blocked restub');
    rejectDefine = false;

    expect(target.x).toBe('first');

    registry.restoreAll();
    expect(target.x).toBe('original');
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
