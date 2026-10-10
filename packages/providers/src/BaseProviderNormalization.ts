/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CredentialResolutionError } from '@vybestack/llxprt-code-auth';
import {
  createRuntimeInvocationContext,
  type RuntimeInvocationContext,
} from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { MissingProviderRuntimeError } from './errors.js';
import type { GenerateChatOptions, ProviderToolset } from './IProvider.js';
import type {
  BaseProvider,
  NormalizedGenerateChatOptions,
} from './BaseProvider.js';
import type { ResolvedAuthToken } from './types/providerRuntime.js';
import { isAbortSignal } from './utils/abortSignal.js';

interface RuntimeGuardInput {
  providerKey: string;
  metadata?: Record<string, unknown>;
  resolved?: NormalizedGenerateChatOptions['resolved'];
  stage: string;
}

interface RuntimeGuardResult {
  metadata: Record<string, unknown>;
}

interface ResolvedRuntimeShape {
  model?: unknown;
  baseURL?: unknown;
  authToken?: unknown;
}

interface NormalizationDependencies {
  providerName: string;
  maybeTools?: ProviderToolset;
  authToken: ResolvedAuthToken;
  authFailure?: CredentialResolutionError;
  resolvedModel: string;
  resolvedBaseURL?: string;
  providerSettings: {
    temperature?: number;
    maxTokens?: number;
    streaming?: boolean;
  };
  ephemeralsSnapshot: Readonly<Record<string, unknown>>;
  providerDefaults: Readonly<Record<string, unknown>>;
  configuredHeaders: Readonly<Record<string, string>>;
}

function findResolvedRuntimeGaps(
  resolved: NormalizedGenerateChatOptions['resolved'] | undefined,
): string[] {
  if (resolved === undefined) {
    return ['resolved'];
  }

  const missing: string[] = [];
  const r = resolved as ResolvedRuntimeShape;
  if (
    typeof r.model !== 'string' ||
    (typeof r.model === 'string' && r.model.trim() === '')
  ) {
    missing.push('resolved.model');
  }
  if (
    r.baseURL !== undefined &&
    r.baseURL !== null &&
    typeof r.baseURL !== 'string'
  ) {
    missing.push('resolved.baseURL');
  }
  if (r.authToken === undefined || r.authToken === null) {
    missing.push('resolved.authToken');
  }
  return missing;
}

function buildRuntimeMetadata(
  input: RuntimeGuardInput,
): Record<string, unknown> {
  return {
    ...(input.metadata ?? {}),
    requirement: 'REQ-SP4-001',
    stage: input.stage,
  };
}

export function assertProviderRequestData(
  input: RuntimeGuardInput,
): RuntimeGuardResult {
  const missingFields = [...findResolvedRuntimeGaps(input.resolved)];
  if (missingFields.length > 0) {
    throw new MissingProviderRuntimeError({
      providerKey: input.providerKey,
      missingFields,
      stage: input.stage,
      metadata: {
        ...(input.metadata ?? {}),
        requirement: 'REQ-SP4-001',
      },
    });
  }

  const metadata = buildRuntimeMetadata(input);
  return { metadata };
}

function createResolvedOptions(
  providedOptions: GenerateChatOptions,
  deps: NormalizationDependencies,
): NormalizedGenerateChatOptions['resolved'] {
  const admitted = providedOptions.modelParameters?.modelParams;
  const temperature = admitted?.['temperature'];
  const maxTokens = admitted?.['maxTokens'];
  const admittedTemperature =
    typeof temperature === 'number' ? temperature : undefined;
  const admittedMaxTokens =
    typeof maxTokens === 'number' ? maxTokens : undefined;
  const temperatureDefault =
    admitted === undefined
      ? deps.providerSettings.temperature
      : admittedTemperature;
  const maxTokensDefault =
    admitted === undefined
      ? deps.providerSettings.maxTokens
      : admittedMaxTokens;
  return {
    model: providedOptions.resolved?.model ?? deps.resolvedModel,
    baseURL: providedOptions.resolved?.baseURL ?? deps.resolvedBaseURL,
    authToken: providedOptions.resolved?.authToken ?? deps.authToken,
    ...(providedOptions.resolved?.authToken === undefined &&
    deps.authFailure !== undefined
      ? { authFailure: deps.authFailure }
      : {}),
    telemetry: providedOptions.resolved?.telemetry,
    temperature: providedOptions.resolved?.temperature ?? temperatureDefault,
    maxTokens: providedOptions.resolved?.maxTokens ?? maxTokensDefault,
    streaming:
      providedOptions.resolved?.streaming ?? deps.providerSettings.streaming,
  };
}

function mergeInvocationMetadata(
  providedOptions: GenerateChatOptions,
): Record<string, unknown> {
  return {
    ...(providedOptions.metadata ?? {}),
  };
}

/**
 * Determines whether a value conforms to the RuntimeInvocationContext contract.
 * A malformed stub (e.g. { signal } or { ephemerals: {} }) created by retry
 * orchestration or legacy callers lacks the helper methods and must not be
 * trusted as a real invocation context.
 */
const INVOCATION_METHODS = [
  'getModelBehavior',
  'getCliSetting',
  'getEphemeral',
  'getModelParam',
  'getProviderOverrides',
] as const;

export function isRuntimeInvocationContext(
  value: unknown,
): value is RuntimeInvocationContext {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return INVOCATION_METHODS.every(
    (method) => typeof candidate[method] === 'function',
  );
}

/**
 * Extracts a legacy AbortSignal smuggled onto a malformed invocation stub so
 * it can be preserved when a fresh RuntimeInvocationContext is created.
 */
function extractLegacySignal(invocation: unknown): AbortSignal | undefined {
  if (invocation === null || typeof invocation !== 'object') {
    return undefined;
  }
  const signal = (invocation as { signal?: unknown }).signal;
  return isAbortSignal(signal) ? signal : undefined;
}

interface InvocationNormalizationInput {
  invocation?: RuntimeInvocationContext;
  runtimeId?: string;
  runtimeMetadata?: Record<string, unknown>;
  modelParams?: Readonly<Record<string, unknown>>;
  modelParamsProviderName?: string;
  metadataSignal?: AbortSignal;
  userMemory?: string;
  providerName: string;
  snapshot: Readonly<Record<string, unknown>>;
  providerDefaults: Readonly<Record<string, unknown>>;
  configuredHeaders: Readonly<Record<string, string>>;
  telemetry: NormalizedGenerateChatOptions['resolved']['telemetry'];
  metadata: Record<string, unknown>;
}

function createNormalizedInvocation(
  input: InvocationNormalizationInput,
): RuntimeInvocationContext {
  const providedInvocation = isRuntimeInvocationContext(input.invocation)
    ? input.invocation
    : undefined;
  const metadataSignal = input.metadataSignal;
  const legacySignal = extractLegacySignal(input.invocation) ?? metadataSignal;
  if (providedInvocation) {
    const providedSignal = extractLegacySignal(providedInvocation);
    return createRuntimeInvocationContext({
      runtimeId: providedInvocation.runtimeId,
      runtimeMetadata: input.runtimeMetadata,
      modelParams: input.modelParams,
      modelParamsProviderName: input.modelParamsProviderName,
      providerName: input.providerName,
      ephemeralsSnapshot: input.snapshot,
      providerDefaults:
        Object.keys(providedInvocation.providerDefaults).length > 0
          ? providedInvocation.providerDefaults
          : input.providerDefaults,
      configuredHeaders: {
        ...input.configuredHeaders,
        ...providedInvocation.customHeaders,
      },
      telemetry: providedInvocation.telemetry ?? input.telemetry,
      metadata: providedInvocation.metadata,
      userMemory: providedInvocation.userMemory,
      redaction: providedInvocation.redaction,
      ...((providedSignal ?? metadataSignal)
        ? { signal: providedSignal ?? metadataSignal }
        : {}),
      fallbackRuntimeId: providedInvocation.runtimeId,
    });
  }

  return createRuntimeInvocationContext({
    runtimeId: input.runtimeId,
    runtimeMetadata: input.runtimeMetadata,
    modelParams: input.modelParams,
    modelParamsProviderName: input.modelParamsProviderName,
    providerName: input.providerName,
    ephemeralsSnapshot: input.snapshot,
    providerDefaults: input.providerDefaults,
    configuredHeaders: input.configuredHeaders,
    telemetry: input.telemetry,
    metadata: input.metadata,
    userMemory: input.userMemory,
    ...(legacySignal ? { signal: legacySignal } : {}),
    fallbackRuntimeId: `${input.providerName}:normalizeGenerateChatOptions`,
  });
}

export function normalizeProviderGenerateChatOptions(
  provider: BaseProvider,
  providedOptions: GenerateChatOptions,
  deps: NormalizationDependencies,
): NormalizedGenerateChatOptions {
  const metadata = mergeInvocationMetadata(providedOptions);
  const resolved = createResolvedOptions(providedOptions, deps);
  const guard = assertProviderRequestData({
    providerKey: `BaseProvider.${deps.providerName}`,
    metadata,
    resolved,
    stage: 'normalizeGenerateChatOptions',
  });
  const invocation = createNormalizedInvocation({
    invocation: providedOptions.invocation,
    runtimeId:
      providedOptions.invocation?.runtimeId ??
      (typeof guard.metadata.runtimeId === 'string'
        ? guard.metadata.runtimeId.trim()
        : undefined),
    runtimeMetadata: guard.metadata,
    modelParams: providedOptions.modelParameters?.modelParams,
    modelParamsProviderName: providedOptions.modelParameters?.providerName,
    metadataSignal: extractLegacySignal({
      signal: providedOptions.metadata?.abortSignal,
    }),
    userMemory:
      typeof providedOptions.userMemory === 'string'
        ? providedOptions.userMemory
        : undefined,
    providerName: deps.providerName,
    snapshot: deps.ephemeralsSnapshot,
    providerDefaults: deps.providerDefaults,
    configuredHeaders: deps.configuredHeaders,
    telemetry: resolved.telemetry,
    metadata: guard.metadata,
  });

  return {
    ...providedOptions,
    contents: providedOptions.contents,
    tools: providedOptions.tools ?? deps.maybeTools,
    metadata: guard.metadata,
    resolved,
    invocation,
  };
}
