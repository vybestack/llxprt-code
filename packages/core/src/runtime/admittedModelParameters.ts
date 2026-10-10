/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeProvider } from '../index.js';

export interface AdmittedProviderRoute {
  readonly provider: RuntimeProvider;
  readonly model: string;
  readonly profileName: string | null;
  readonly baseURL?: string;
  readonly hasInlineKey: boolean;
  readonly assertCurrent?: () => void;
  readonly members?: ReadonlyArray<{
    readonly providerName: string;
    readonly provider: RuntimeProvider;
    readonly baseURL?: string;
    readonly hasInlineKey: boolean;
  }>;
}

export interface AdmittedModelParameters {
  readonly providerName: string;
  readonly modelParams: Readonly<Record<string, unknown>>;
  readonly route?: AdmittedProviderRoute;
  readonly genericMaxOutputTokens?: number;
  readonly loadBalancer?: {
    readonly selectionRevision: symbol;
    readonly members: ReadonlyArray<{
      readonly identity: symbol;
      readonly parameters: AdmittedModelParameters;
      readonly baseURL?: string;
      readonly hasInlineKey?: boolean;
    }>;
  };
}

function ownArray(
  value: unknown[],
  path: string,
  ancestors: Set<object>,
): readonly unknown[] {
  const copy: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const childPath = `${path}[${index}]`;
    if (!Object.prototype.hasOwnProperty.call(value, index))
      throw new TypeError(`Sparse wire parameter at ${childPath}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor))
      throw new TypeError(`Invalid wire parameter at ${childPath}`);
    copy.push(ownWireValue(descriptor.value, childPath, ancestors));
  }
  if (
    Reflect.ownKeys(value).some(
      (key) =>
        key !== 'length' &&
        (typeof key !== 'string' ||
          !/^(0|[1-9]\d*)$/.test(key) ||
          Number(key) >= value.length),
    )
  ) {
    throw new TypeError(`Invalid wire parameter at ${path}`);
  }
  return Object.freeze(copy);
}

function ownRecord(
  value: object,
  path: string,
  ancestors: Set<object>,
): Readonly<Record<string, unknown>> {
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const childPath = `${path}.${String(key)}`;
    if (
      typeof key !== 'string' ||
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype'
    )
      throw new TypeError(`Invalid wire parameter at ${childPath}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor))
      throw new TypeError(`Invalid wire parameter at ${childPath}`);
    copy[key] = ownWireValue(descriptor.value, childPath, ancestors);
  }
  return Object.freeze(copy);
}

function ownWireValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object')
    throw new TypeError(`Invalid wire parameter at ${path}`);
  if (ancestors.has(value))
    throw new TypeError(`Cyclic wire parameter at ${path}`);
  const array = Array.isArray(value);
  if (
    !array &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new TypeError(`Invalid wire parameter at ${path}`);
  ancestors.add(value);
  try {
    return array
      ? ownArray(value, path, ancestors)
      : ownRecord(value, path, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

export function ownModelParameters(
  values: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  return ownWireValue(values, 'modelParams', new Set<object>()) as Readonly<
    Record<string, unknown>
  >;
}
