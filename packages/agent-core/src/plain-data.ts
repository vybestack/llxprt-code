/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { JsonValue } from './types.js';

export function isPlainData(
  value: unknown,
  active = new Set<object>(),
  allowUndefined = false,
): boolean {
  if (value === undefined) return allowUndefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  return isPlainContainer(value, active, allowUndefined);
}

function isPlainContainer(
  value: object,
  active: Set<object>,
  allowUndefined: boolean,
): boolean {
  if (active.has(value)) return false;
  const arrayLength = Array.isArray(value) ? value.length : undefined;
  const prototype = Object.getPrototypeOf(value);
  if (
    arrayLength !== undefined
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  )
    return false;
  active.add(value);
  const valid =
    hasPlainOwnProperties(value, arrayLength, active, allowUndefined) &&
    (arrayLength === undefined || isDenseArray(value));
  active.delete(value);
  return valid;
}

function hasPlainOwnProperties(
  value: object,
  arrayLength: number | undefined,
  active: Set<object>,
  allowUndefined: boolean,
): boolean {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return false;
    if (arrayLength !== undefined && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !hasPlainValue(descriptor)) return false;
    if (arrayLength !== undefined && !isArrayIndex(key, arrayLength))
      return false;
    if (!isPlainData(descriptor.value, active, allowUndefined)) return false;
  }
  return true;
}

function hasPlainValue(descriptor: PropertyDescriptor): boolean {
  return descriptor.enumerable === true && Object.hasOwn(descriptor, 'value');
}

function isArrayIndex(key: string, length: number): boolean {
  return /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length;
}

function isDenseArray(value: object): boolean {
  if (!Array.isArray(value)) return false;
  return Reflect.ownKeys(value).length - 1 === value.length;
}

function isUint8ArrayIndex(value: Uint8Array, key: PropertyKey): key is string {
  if (typeof key !== 'string') return false;
  const index = Number(key);
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < value.length &&
    String(index) === key
  );
}

function hasSafeUint8ArrayDescriptors(value: Uint8Array): boolean {
  for (const key of Reflect.ownKeys(value)) {
    if (!isUint8ArrayIndex(value, key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    )
      return false;
  }
  return true;
}

export function isJsonValue(value: unknown): value is JsonValue {
  return value !== undefined && isPlainData(value);
}

export function hasSafeDescriptors(
  value: unknown,
  active = new Set<object>(),
): boolean {
  if (value === null || typeof value !== 'object')
    return typeof value !== 'function';
  if (value instanceof Uint8Array) return hasSafeUint8ArrayDescriptors(value);
  if (active.has(value)) return false;
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    array
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  )
    return false;
  active.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return false;
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value') ||
      !hasSafeDescriptors(descriptor.value, active)
    )
      return false;
  }
  active.delete(value);
  return true;
}

export function cloneDataDescriptors(
  value: unknown,
  active = new Set<object>(),
): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (active.has(value)) return undefined;
  active.add(value);
  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length - 1 !== value.length) {
      active.delete(value);
      return [];
    }
    const copy: unknown[] = [];
    for (const key of ownKeys) {
      if (key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor !== undefined &&
        Object.hasOwn(descriptor, 'value') &&
        descriptor.enumerable === true
      ) {
        copy[Number(key)] = cloneDataDescriptors(descriptor.value, active);
      }
    }
    active.delete(value);
    return copy;
  }
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor !== undefined &&
      Object.hasOwn(descriptor, 'value') &&
      descriptor.enumerable === true
    ) {
      copy[key] = cloneDataDescriptors(descriptor.value, active);
    }
  }
  active.delete(value);
  return copy;
}
