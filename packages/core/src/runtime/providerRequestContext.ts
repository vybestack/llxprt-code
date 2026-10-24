/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readInvocationPolicyRecord } from './RuntimeInvocationContext.js';
import {
  createRuntimeInvocationContext,
  type RuntimeInvocationContext,
} from './RuntimeInvocationContext.js';
import type { AdmittedModelParameters } from './admittedModelParameters.js';
import type { NetworkFetch } from '../utils/fetch.js';

export interface ProviderInvocationData {
  readonly runtimeId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly globalSettings: Readonly<Record<string, unknown>>;
  readonly providerSettings: Readonly<Record<string, unknown>>;
  readonly fetch?: NetworkFetch;
}

export function captureProviderInvocation(
  data: ProviderInvocationData,
  providerName: string,
  modelParameters?: AdmittedModelParameters,
  signal?: AbortSignal,
  sessionId?: string,
  requestFetch?: NetworkFetch,
): RuntimeInvocationContext {
  const global = data.globalSettings;
  const active = global['activeProvider'];
  const providerSettings = data.providerSettings;
  const isSelected =
    active === undefined ||
    active === null ||
    active === '' ||
    active === providerName;
  const model =
    (isSelected ? global.model : undefined) ?? providerSettings.model;
  const endpoint =
    (isSelected ? global['base-url'] : undefined) ??
    providerSettings['base-url'];
  return createRuntimeInvocationContext({
    runtimeId: data.runtimeId,
    fetch: requestFetch ?? data.fetch,
    sessionId,
    fallbackRuntimeId: `${providerName}:admission`,
    runtimeMetadata: data.metadata,
    providerName,
    modelParams: modelParameters?.modelParams,
    modelParamsProviderName: modelParameters?.providerName,
    ephemeralsSnapshot: {
      ...global,
      ...(typeof model === 'string' && model.length > 0 ? { model } : {}),
      ...(typeof endpoint === 'string' && endpoint.trim()
        ? { 'base-url': endpoint.trim() }
        : {}),
      [providerName]: {
        ...readInvocationPolicyRecord(global[providerName]),
        ...providerSettings,
      },
    },
    signal,
  });
}
