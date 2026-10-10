/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderRetryOperations } from '@vybestack/llxprt-code-core/runtime/contracts/ProviderRetryOperations.js';
import type { GenerateChatOptions, IProvider } from './IProvider.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { ProviderRuntimeNormalizationError } from './errors.js';
import { getBaseUrlFromProvider } from './baseUrlResolver.js';
import { isAbortSignal } from './utils/abortSignal.js';
import { safeGetDefaultModel } from './utils/safeDefaultModel.js';
import { PROVIDER_CONFIG_KEYS } from './providerConfigKeys.js';
import { isContainerSandbox } from './utils/containerSandbox.js';

export interface RuntimeNormalizerDeps {
  composeRetryOperations?: (
    providerName: string,
    profileId?: string,
  ) => ProviderRetryOperations;
  admitRequest: (
    options: GenerateChatOptions,
    providerName: string,
  ) => GenerateChatOptions;
  getActiveProviderName: () => string | undefined;
  getProvider: (name: string) => IProvider | undefined;
}

export function normalizeRuntimeInputs(
  rawOptions: GenerateChatOptions,
  deps: RuntimeNormalizerDeps,
  providerName?: string,
): GenerateChatOptions {
  const targetProvider = providerName ?? deps.getActiveProviderName();
  const runtimeId = rawOptions.invocation?.runtimeId ?? 'unknown';
  if (targetProvider === undefined) {
    throw new ProviderRuntimeNormalizationError({
      providerKey: 'ProviderManager',
      message: `No provider is active or targeted for runtimeId=${runtimeId}.`,
      requirement: 'REQ-SP4-003',
      runtimeId,
      stage: 'normalizeRuntimeInputs',
      metadata: { missingFields: ['provider'] },
    });
  }
  const admitted = deps.admitRequest(rawOptions, targetProvider);
  const invocation = admitted.invocation;
  if (invocation === undefined)
    throw new Error('Provider admission requires invocation policy');
  const provider =
    invocation.getProviderOverrides<Record<string, unknown>>(targetProvider) ??
    {};
  const global = invocation.ephemerals;
  const applyGlobal = shouldApplyGlobal(global, targetProvider);
  const instance = deps.getProvider(targetProvider);
  assertProviderChain(instance, targetProvider, runtimeId);
  const model = resolveModel(admitted, provider, global, applyGlobal, instance);
  const baseURL = resolveEndpoint(
    admitted,
    provider,
    global,
    applyGlobal,
    instance,
  );
  assertResolvedRoute(model, baseURL, targetProvider, runtimeId);
  const { metadata, signal } = captureRequestMetadata(
    admitted,
    invocation,
    runtimeId,
    targetProvider,
  );
  return {
    ...admitted,
    ...captureRecovery(deps, admitted, targetProvider, metadata),
    resolved: { ...admitted.resolved, model, baseURL },
    metadata,
    invocation: createRuntimeInvocationContext({
      runtimeId: invocation.runtimeId,
      providerName: targetProvider,
      ephemeralsSnapshot: invocation.ephemerals,
      providerDefaults: invocation.providerDefaults,
      configuredHeaders: invocation.customHeaders,
      modelParams: admitted.modelParameters?.modelParams,
      modelParamsProviderName: admitted.modelParameters?.providerName,
      metadata: invocation.metadata,
      telemetry: invocation.telemetry,
      userMemory: invocation.userMemory,
      redaction: invocation.redaction,
      signal,
    }),
  };
}

function validString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function buildEphemeralsSnapshot(
  settingsService: SettingsService,
  providerName: string,
): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      Object.entries(settingsService.getAllGlobalSettings()).filter(
        ([key]) => !PROVIDER_CONFIG_KEYS.has(key),
      ),
    ),
    [providerName]: { ...settingsService.getProviderSettings(providerName) },
  };
}

function shouldApplyGlobal(
  global: Readonly<Record<string, unknown>>,
  providerName: string,
): boolean {
  const active = validString(global['activeProvider']);
  return active === undefined || active === providerName;
}

function resolveModel(
  options: GenerateChatOptions,
  provider: Record<string, unknown>,
  global: Readonly<Record<string, unknown>>,
  applyGlobal: boolean,
  instance: IProvider | undefined,
): string | undefined {
  const configured =
    validString(options.resolved?.model) ?? validString(provider.model);
  const globalModel = applyGlobal ? validString(global.model) : undefined;
  return (
    configured ??
    globalModel ??
    (instance === undefined ? undefined : safeGetDefaultModel(instance))
  );
}

function resolveEndpoint(
  options: GenerateChatOptions,
  provider: Record<string, unknown>,
  global: Readonly<Record<string, unknown>>,
  applyGlobal: boolean,
  instance: IProvider | undefined,
): string | undefined {
  const explicit = validString(options.resolved?.baseURL);
  if (explicit !== undefined) return explicit;
  const sandbox = isContainerSandbox()
    ? validString(provider['sandbox-base-url'])
    : undefined;
  const scoped = sandbox ?? validString(provider['base-url']);
  const globalURL = applyGlobal ? validString(global['base-url']) : undefined;
  return scoped ?? globalURL ?? getBaseUrlFromProvider(instance);
}

function assertProviderChain(
  provider: IProvider | undefined,
  name: string,
  runtimeId: string,
): void {
  const seen = new Set<IProvider>();
  let current = provider;
  while (current && 'wrappedProvider' in current) {
    if (seen.has(current))
      throw new ProviderRuntimeNormalizationError({
        providerKey: 'ProviderManager',
        message: 'Cyclic provider chain cannot resolve authToken',
        requirement: 'REQ-SP4-003',
        runtimeId,
        stage: 'normalizeRuntimeInputs',
        metadata: { provider: name, missingFields: ['authToken'] },
      });
    seen.add(current);
    const wrapped: unknown = current.wrappedProvider;
    if (
      typeof wrapped !== 'object' ||
      wrapped === null ||
      !('generateChatCompletion' in wrapped) ||
      typeof wrapped.generateChatCompletion !== 'function'
    )
      return;
    current = wrapped as IProvider;
  }
}

function captureRequestMetadata(
  admitted: GenerateChatOptions,
  invocation: NonNullable<GenerateChatOptions['invocation']>,
  runtimeId: string,
  targetProvider: string,
): { metadata: Record<string, unknown>; signal: AbortSignal | undefined } {
  const metadata: Record<string, unknown> = {
    ...admitted.metadata,
    _normalized: true,
    _runtimeId: runtimeId,
    _provider: targetProvider,
  };
  const signal = isAbortSignal(metadata.abortSignal)
    ? metadata.abortSignal
    : invocation.signal;
  return { metadata, signal };
}

function captureRecovery(
  deps: RuntimeNormalizerDeps,
  admitted: GenerateChatOptions,
  providerName: string,
  metadata: Record<string, unknown>,
): ProviderRetryOperations | undefined {
  const profile =
    admitted.modelParameters?.route?.profileName ??
    (typeof metadata.profileId === 'string' ? metadata.profileId : undefined);
  return deps.composeRetryOperations?.(providerName, profile);
}

function assertResolvedRoute(
  model: string | undefined,
  baseURL: string | undefined,
  targetProvider: string,
  runtimeId: string,
): void {
  const endpointRequired = ![
    'gemini',
    'openai',
    'openai-responses',
    'anthropic',
    'openaivercel',
    'load-balancer',
  ].includes(targetProvider);
  if (!model || (endpointRequired && !baseURL))
    throw new ProviderRuntimeNormalizationError({
      providerKey: 'ProviderManager',
      message: `Incomplete runtime resolution (${!model ? 'model' : 'baseURL'}) for runtimeId=${runtimeId}`,
      requirement: 'REQ-SP4-003',
      runtimeId,
      stage: 'normalizeRuntimeInputs',
      metadata: {
        missingFields: [!model ? 'model' : 'baseURL'],
        provider: targetProvider,
      },
    });
}
