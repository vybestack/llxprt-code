/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const logger = new DebugLogger('llxprt:providers:load-balancer:content-clone');

export function cloneContentsForCompression(contents: IContent[]): IContent[] {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(contents);
    } catch (error) {
      logger.debug(
        () =>
          `[content-clone] structuredClone failed, using manual compression clone: ${String(error)}`,
      );
    }
  }
  return cloneValueForCompression(contents);
}

function cloneValueForCompression<T>(
  value: T,
  seen = new WeakMap<object, unknown>(),
): T {
  if (Array.isArray(value)) {
    return cloneArrayForCompression(value, seen) as T;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as T;
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0) as T;
  }
  if (ArrayBuffer.isView(value)) {
    return cloneArrayBufferView(value) as T;
  }
  if (value instanceof Map) {
    return cloneMapForCompression(value, seen) as T;
  }
  if (value instanceof Set) {
    return cloneSetForCompression(value, seen) as T;
  }
  if (typeof value === 'object' && value !== null) {
    return cloneObjectForCompression(value, seen) as T;
  }
  if (typeof value === 'function') {
    logger.debug(
      () => '[content-clone] Function value encountered, sharing by reference',
    );
    return value;
  }
  return value;
}
function cloneArrayBufferView(value: ArrayBufferView): ArrayBufferView {
  let clonedBuffer: ArrayBuffer;
  try {
    clonedBuffer = value.buffer.slice(0);
  } catch (error) {
    logger.warn(
      () =>
        '[content-clone] Failed to clone ArrayBufferView, re-throwing to caller',
      error,
    );
    throw error;
  }
  if (value instanceof DataView) {
    return new DataView(
      clonedBuffer,
      clonedBuffer.byteLength === 0 ? 0 : value.byteOffset,
      clonedBuffer.byteLength === 0 ? 0 : value.byteLength,
    );
  }
  const ctor = value.constructor as {
    new (
      buffer: ArrayBufferLike,
      byteOffset: number,
      length: number,
    ): ArrayBufferView;
  };
  const length =
    clonedBuffer.byteLength === 0
      ? 0
      : (value as unknown as { length: number }).length;
  return new ctor(
    clonedBuffer,
    clonedBuffer.byteLength === 0 ? 0 : value.byteOffset,
    length,
  );
}

function cloneArrayForCompression(
  value: unknown[],
  seen: WeakMap<object, unknown>,
): unknown[] {
  if (seen.has(value)) {
    return seen.get(value) as unknown[];
  }
  const clone: unknown[] = [];
  seen.set(value, clone);
  for (const entry of value) {
    clone.push(cloneValueForCompression(entry, seen));
  }
  return clone;
}

function cloneMapForCompression(
  value: Map<unknown, unknown>,
  seen: WeakMap<object, unknown>,
): Map<unknown, unknown> {
  if (seen.has(value)) {
    return seen.get(value) as Map<unknown, unknown>;
  }
  const clone = new Map<unknown, unknown>();
  seen.set(value, clone);
  for (const [key, entry] of value) {
    clone.set(
      cloneValueForCompression(key, seen),
      cloneValueForCompression(entry, seen),
    );
  }
  return clone;
}

function cloneSetForCompression(
  value: Set<unknown>,
  seen: WeakMap<object, unknown>,
): Set<unknown> {
  if (seen.has(value)) {
    return seen.get(value) as Set<unknown>;
  }
  const clone = new Set<unknown>();
  seen.set(value, clone);
  for (const entry of value) {
    clone.add(cloneValueForCompression(entry, seen));
  }
  return clone;
}

function cloneObjectForCompression<T extends object>(
  value: T,
  seen: WeakMap<object, unknown>,
): T {
  if (seen.has(value)) {
    return seen.get(value) as T;
  }
  const clone = Object.create(Object.getPrototypeOf(value)) as T;
  seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && 'value' in descriptor) {
      Object.defineProperty(clone, key, {
        ...descriptor,
        value: cloneValueForCompression(descriptor.value, seen),
      });
    } else if (descriptor?.get) {
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: descriptor.enumerable,
        writable: true,
        value: cloneValueForCompression(descriptor.get.call(value), seen),
      });
    } else if (descriptor?.set) {
      logger.debug(
        () =>
          `[content-clone] Skipping setter-only accessor property "${String(key)}" because no value can be materialized`,
      );
    } else if (descriptor !== undefined) {
      logger.debug(
        () =>
          `[content-clone] Property "${String(key)}" has an empty descriptor, skipping`,
      );
    }
  }
  return clone;
}
