/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function hasFunction<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, (...args: never[]) => unknown> {
  return isRecord(value) && typeof value[key] === 'function';
}

export function hasObject<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, Record<string, unknown>> {
  return isRecord(value) && isRecord(value[key]);
}

export function getOptionalString(
  value: unknown,
  key: string,
): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}
