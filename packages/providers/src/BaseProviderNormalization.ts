/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  createRuntimeInvocationContext,
  type RuntimeInvocationContext,
} from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { MissingProviderRuntimeError } from './errors.js';
import type { GenerateChatOptions, ProviderToolset } from './IProvider.js';
import type {
  BaseProvider,
  NormalizedGenerateChatOptions,
  ProviderSettings,
} from './BaseProvider.js';
import type { ResolvedAuthToken } from './types/providerRuntime.js';

interface RuntimeGuardInput {
  providerKey: string;
  settings?: SettingsService | null;
  config?: Config | null;
  runtime?: ProviderRuntimeContext;
  metadata?: Record<string, unknown>;
  resolved?: NormalizedGenerateChatOptions['resolved'];
  stage: string;
}

interface RuntimeGuardResult {
  runtime: ProviderRuntimeContext;
  metadata: Record<string, unknown>;
}

interface NormalizationDependencies {
  providerName: string;
  defaultSettingsService: SettingsService;
  defaultConfig?: Config;
  maybeTools?: ProviderToolset;
  authToken: ResolvedAuthToken;
  resolvedModel: string;
  resolvedBaseURL?: string;
  providerSettings: ProviderSettings;
  buildEphemeralsSnapshot: (
    settings: SettingsService,
  ) => Record<string, unknown>;
}

function assertPresentRuntimeParts(input: RuntimeGuardInput): string[] {
  const missing: string[] = [];
  if (input.settings === undefined || input.settings === null) {
    missing.push('settings');
  }
  if (input.config === undefined || input.config === null) {
    missing.push('config');
  }
  return missing;
}

function findResolvedRuntimeGaps(
  resolved: NormalizedGenerateChatOptions['resolved'] | undefined,
): string[] {
  if (resolved === undefined) {
    return ['resolved'];
  }

  const missing: string[] = [];
  const resolvedRecord = resolved as unknown as Record<string, unknown>;
  if (
    typeof resolvedRecord['model'] !== 'string' ||
    resolved.model.trim() === ''
  ) {
    missing.push('resolved.model');
  }
  const baseURL = resolvedRecord['baseURL'];
  if (
    baseURL !== undefined &&
    baseURL !== null &&
    typeof baseURL !== 'string'
  ) {
    missing.push('resolved.baseURL');
  }
  const authToken = resolvedRecord['authToken'];
  if (authToken === undefined || authToken === null) {
    missing.push('resolved.authToken');
  }
  return missing;
}

function buildRuntimeMetadata(
  input: RuntimeGuardInput,
): Record<string, unknown> {
  return {
    ...(input.runtime?.metadata ?? {}),
    ...(input.metadata ?? {}),
    requirement: 'REQ-SP4-001',
    stage: input.stage,
  };
}

function resolveRuntimeId(
  metadata: Record<string, unknown>,
  fallback: string,
): string {
  const currentRuntimeId =
    typeof metadata.runtimeId === 'string' ? metadata.runtimeId : undefined;
  return currentRuntimeId?.trim() ? currentRuntimeId : fallback;
}

export function assertProviderRuntimeContext(
  input: RuntimeGuardInput,
): RuntimeGuardResult {
  const missingFields = [
    ...assertPresentRuntimeParts(input),
    ...findResolvedRuntimeGaps(input.resolved),
  ];
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
  const runtime = input.runtime
    ? {
        ...input.runtime,
        settingsService: input.settings!,
        config: input.runtime.config ?? input.config ?? undefined,
        metadata,
      }
    : {
        settingsService: input.settings!,
        config: input.config ?? undefined,
        runtimeId: resolveRuntimeId(
          metadata,
          `${input.providerKey}:${input.stage}`,
        ),
        metadata,
      };

  return { runtime, metadata };
}

export function resolveGenerateChatSettings(
  providedOptions: GenerateChatOptions,
  fallbackSettings: SettingsService | undefined,
  providerName: string,
): SettingsService {
  const settings = providedOptions.settings ?? fallbackSettings;
  if (settings === undefined) {
    throw new MissingProviderRuntimeError({
      providerKey: `BaseProvider.${providerName}`,
      missingFields: ['settings'],
      stage: 'normalizeGenerateChatOptions',
      metadata: {
        hint: 'ProviderManager must supply settings via GenerateChatOptions or setRuntimeSettingsService.',
        requirement: 'REQ-SP4-001',
      },
    });
  }
  return settings;
}

function createResolvedOptions(
  providedOptions: GenerateChatOptions,
  deps: NormalizationDependencies,
): NormalizedGenerateChatOptions['resolved'] {
  return {
    model: providedOptions.resolved?.model ?? deps.resolvedModel,
    baseURL: providedOptions.resolved?.baseURL ?? deps.resolvedBaseURL,
    authToken: providedOptions.resolved?.authToken ?? deps.authToken,
    telemetry: providedOptions.resolved?.telemetry,
    temperature:
      providedOptions.resolved?.temperature ??
      deps.providerSettings.temperature,
    maxTokens:
      providedOptions.resolved?.maxTokens ?? deps.providerSettings.maxTokens,
    streaming:
      providedOptions.resolved?.streaming ??
      (deps.providerSettings.streaming as boolean | undefined),
  };
}

function mergeInvocationMetadata(
  providedOptions: GenerateChatOptions,
): Record<string, unknown> {
  return {
    ...(providedOptions.runtime?.metadata ?? {}),
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

function isRuntimeInvocationContext(
  value: unknown,
): value is GenerateChatOptions['invocation'] & RuntimeInvocationContext {
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
  if (
    typeof signal === 'object' &&
    signal !== null &&
    typeof (signal as { aborted?: unknown }).aborted === 'boolean'
  ) {
    return signal as AbortSignal;
  }
  return undefined;
}

interface InvocationNormalizationInput {
  providedOptions: GenerateChatOptions;
  normalizedRuntime: ProviderRuntimeContext;
  settings: SettingsService;
  providerName: string;
  snapshot: Record<string, unknown>;
  telemetry: NormalizedGenerateChatOptions['resolved']['telemetry'];
  metadata: Record<string, unknown>;
}

function createNormalizedInvocation(
  input: InvocationNormalizationInput,
): RuntimeInvocationContext {
  const providedInvocation = isRuntimeInvocationContext(
    input.providedOptions.invocation,
  )
    ? input.providedOptions.invocation
    : undefined;
  const legacySignal = extractLegacySignal(input.providedOptions.invocation);
  if (providedInvocation) {
    const providedSignal = extractLegacySignal(providedInvocation);
    return createRuntimeInvocationContext({
      runtime: {
        ...input.normalizedRuntime,
        runtimeId: providedInvocation.runtimeId,
      },
      settings: input.settings,
      providerName: input.providerName,
      ephemeralsSnapshot: {
        ...input.snapshot,
        ...providedInvocation.ephemerals,
      },
      telemetry: providedInvocation.telemetry ?? input.telemetry,
      metadata: providedInvocation.metadata,
      userMemory: providedInvocation.userMemory,
      redaction: providedInvocation.redaction,
      ...(providedSignal ? { signal: providedSignal } : {}),
      fallbackRuntimeId: providedInvocation.runtimeId,
    });
  }

  return createRuntimeInvocationContext({
    runtime: input.normalizedRuntime,
    settings: input.settings,
    providerName: input.providerName,
    ephemeralsSnapshot: input.snapshot,
    telemetry: input.telemetry,
    metadata: input.metadata,
    userMemory:
      typeof input.providedOptions.userMemory === 'string'
        ? input.providedOptions.userMemory
        : undefined,
    ...(legacySignal ? { signal: legacySignal } : {}),
    fallbackRuntimeId: `${input.providerName}:normalizeGenerateChatOptions`,
  });
}

export function normalizeProviderGenerateChatOptions(
  provider: BaseProvider,
  providedOptions: GenerateChatOptions,
  deps: NormalizationDependencies,
): NormalizedGenerateChatOptions {
  const settings = deps.defaultSettingsService;
  const runtimeConfig = providedOptions.runtime?.config ?? null;
  const configCandidate =
    providedOptions.config ?? runtimeConfig ?? deps.defaultConfig ?? null;
  const metadata = mergeInvocationMetadata(providedOptions);
  const resolved = createResolvedOptions(providedOptions, deps);
  const guard = assertProviderRuntimeContext({
    providerKey: `BaseProvider.${deps.providerName}`,
    settings,
    config: configCandidate,
    runtime: providedOptions.runtime,
    metadata,
    resolved,
    stage: 'normalizeGenerateChatOptions',
  });
  const finalConfig = guard.runtime.config ?? configCandidate ?? undefined;
  const normalizedRuntime: ProviderRuntimeContext = {
    ...guard.runtime,
    metadata: guard.metadata,
    config: finalConfig,
  };
  const invocation = createNormalizedInvocation({
    providedOptions,
    normalizedRuntime,
    settings,
    providerName: deps.providerName,
    snapshot: deps.buildEphemeralsSnapshot(settings),
    telemetry: resolved.telemetry,
    metadata: guard.metadata,
  });

  return {
    ...providedOptions,
    contents: providedOptions.contents,
    tools: providedOptions.tools ?? deps.maybeTools,
    settings,
    config: finalConfig,
    runtime: normalizedRuntime,
    metadata: guard.metadata,
    resolved,
    invocation,
  };
}
