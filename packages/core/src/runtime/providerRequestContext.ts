/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readInvocationPolicyRecord } from './RuntimeInvocationContext.js';
import type { ProviderRuntimeContext } from './providerRuntimeContext.js';
import {
  createRuntimeInvocationContext,
  type RuntimeInvocationContext,
} from './RuntimeInvocationContext.js';
import type { AdmittedModelParameters } from './admittedModelParameters.js';

export function captureProviderInvocation(
  owner: ProviderRuntimeContext,
  providerName: string,
  modelParameters?: AdmittedModelParameters,
  signal?: AbortSignal,
): RuntimeInvocationContext {
  const global = owner.settingsService.getAllGlobalSettings();
  const active = global['activeProvider'];
  const providerSettings =
    owner.settingsService.getProviderSettings(providerName);
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
    runtimeId: owner.runtimeId,
    fallbackRuntimeId: `${providerName}:admission`,
    runtimeMetadata: owner.metadata,
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
