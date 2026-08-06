/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds an automocked namespace from a real module.
 *
 * Bun's `mock.module` always requires a factory, so a test that wants "mock
 * every export of this module" has to produce that namespace itself. This
 * helper does it: functions become mock functions, classes become mock
 * constructors whose instances carry a mocked prototype, and plain objects are
 * mirrored member by member.
 *
 * Usage pairs with a real-module snapshot captured before the mock registers:
 *
 *     const realFoo = { ...(await import('./foo.js')) };
 *     vi.mock('./foo.js', () => automock(realFoo));
 */

import { mock } from 'bun:test';

function isClassFunction(value: unknown): boolean {
  return Function.prototype.toString.call(value).startsWith('class ');
}

/**
 * Copies one property onto the automocked target.
 *
 * Accessors are mirrored as accessors rather than read eagerly. Some built-in
 * prototypes (`node:fs`'s `Dirent`, for example) expose getters backed by
 * private class fields that throw on anything but a real instance; reading
 * those eagerly would abort the automock of the whole module, so the failure is
 * deferred to a caller that actually touches the property.
 */
function defineAutomockedProperty(
  target: object,
  source: object,
  key: string | symbol,
  references: Map<object, unknown>,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (!descriptor) return;
  const getter = descriptor.get;
  if (getter !== undefined) {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: () => automockValue(getter.call(source), references),
    });
    return;
  }
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: descriptor.enumerable,
    writable: true,
    value: automockValue(descriptor.value, references),
  });
}

/** Recursively mocks a value, sharing results so cycles terminate. */
function automockValue(
  value: unknown,
  references: Map<object, unknown>,
): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || !value) {
    return value;
  }
  const existing = references.get(value);
  if (existing !== undefined) return existing;

  if (Array.isArray(value)) {
    const mocked: unknown[] = [];
    references.set(value, mocked);
    return mocked;
  }

  if (typeof value === 'function') {
    if (isClassFunction(value)) {
      const state: { prototype: object | null } = { prototype: null };
      const MockedClass = function (): object {
        return Object.create(state.prototype);
      };
      const mockedConstructor = mock(MockedClass);
      references.set(value, mockedConstructor);
      const mockedPrototype = automockValue(value.prototype, references);
      state.prototype =
        mockedPrototype !== null &&
        (typeof mockedPrototype === 'object' ||
          typeof mockedPrototype === 'function')
          ? mockedPrototype
          : null;
      Object.defineProperty(mockedConstructor, 'prototype', {
        value: state.prototype,
      });
      for (const key of Reflect.ownKeys(value)) {
        if (!['length', 'name', 'prototype'].includes(String(key))) {
          defineAutomockedProperty(mockedConstructor, value, key, references);
        }
      }
      return mockedConstructor;
    }
    const mockedFunction = mock();
    references.set(value, mockedFunction);
    return mockedFunction;
  }

  const mockedObject: Record<string | symbol, unknown> = {};
  references.set(value, mockedObject);
  for (const key of Reflect.ownKeys(value)) {
    defineAutomockedProperty(mockedObject, value, key, references);
  }
  return mockedObject;
}

/** Wraps a non-object factory result so consumers still see a default export. */
function toNamespace(exports: unknown): object {
  return typeof exports === 'object' && exports !== null
    ? exports
    : { default: exports };
}

/**
 * Adds CommonJS default interop.
 *
 * Automocking replaces every export of a module, including the default a
 * CommonJS module such as `node:fs/promises` synthesises. Without this, a
 * `import fs from 'fs/promises'` would still hand back the real default even
 * though the named exports are mocked.
 */
function withDefaultInterop(namespace: object): object {
  if ('default' in namespace) return namespace;
  Object.defineProperty(namespace, 'default', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: { ...namespace },
  });
  return namespace;
}

export function automock(module: unknown): object {
  return withDefaultInterop(toNamespace(automockValue(module, new Map())));
}
