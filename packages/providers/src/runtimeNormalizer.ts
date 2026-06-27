/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime input normalization for stateless provider invocations.
 * Extracted from ProviderManager to keep the main file under the lint
 * line budget.
 */

import type { GenerateChatOptions, IProvider } from './IProvider.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { isContainerSandbox } from './utils/containerSandbox.js';
import { PROVIDER_CONFIG_KEYS } from './providerConfigKeys.js';
import { ProviderRuntimeNormalizationError } from './errors.js';
import { getBaseUrlFromProvider } from './baseUrlResolver.js';

const logger = new DebugLogger('llxprt:provider:manager');

const BASE_URL_OPTIONAL_PROVIDERS = new Set([
  'gemini',
  'openai',
  'openai-responses',
  'anthropic',
  'openaivercel',
  'load-balancer',
]);

interface ProviderWithWrapper {
  wrappedProvider?: IProvider;
}

const MAX_WRAPPED_PROVIDER_DEPTH = 25;

interface ProviderWithAuth {
  getAuthToken?: () => Promise<string>;
}

function isBlankish(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

/**
 * Check whether a resolved auth token value is considered present.
 */
function hasResolvedAuthToken(value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return false;
  }
  if (value === false || value === 0) {
    return false;
  }
  return !(typeof value === 'number' && Number.isNaN(value));
}

function unwrapProvider(
  provider: IProvider | undefined,
): IProvider | undefined {
  const visitedProviders = new Set<IProvider>();
  let actualProvider = provider;
  let depth = 0;
  while (
    actualProvider !== undefined &&
    'wrappedProvider' in actualProvider &&
    !visitedProviders.has(actualProvider) &&
    depth < MAX_WRAPPED_PROVIDER_DEPTH
  ) {
    visitedProviders.add(actualProvider);
    actualProvider = (actualProvider as ProviderWithWrapper).wrappedProvider;
    depth += 1;
  }

  if (actualProvider !== undefined && visitedProviders.has(actualProvider)) {
    return undefined;
  }
  if (
    actualProvider !== undefined &&
    'wrappedProvider' in actualProvider &&
    depth >= MAX_WRAPPED_PROVIDER_DEPTH
  ) {
    return undefined;
  }
  return actualProvider;
}

export interface RuntimeNormalizerDeps {
  getActiveProviderName: () => string;
  getProvider: (name: string) => IProvider | undefined;
}

/**
 * Normalize runtime inputs per call - no stored settings/config fallbacks.
 * This enforces that all runtime context is provided per-call and that
 * providers cannot rely on stored state.
 */
export function normalizeRuntimeInputs(
  rawOptions: GenerateChatOptions,
  deps: RuntimeNormalizerDeps,
  providerName?: string,
): GenerateChatOptions {
  const runtimeId = rawOptions.runtime?.runtimeId ?? 'unknown';
  const targetProvider = providerName ?? deps.getActiveProviderName();

  const { settingsService, config } = requireRuntimeContext(
    rawOptions,
    runtimeId,
  );

  const resolved = resolveFields(
    rawOptions,
    settingsService,
    config,
    targetProvider,
    runtimeId,
    deps,
  );

  validateResolvedFields(resolved, targetProvider, runtimeId, deps);

  return buildNormalizedOptions(
    rawOptions,
    settingsService,
    config,
    resolved,
    targetProvider,
    runtimeId,
  );
}

/** REQ-SP4-002: Validate and extract required settings service and config. */
function requireRuntimeContext(
  rawOptions: GenerateChatOptions,
  runtimeId: string,
): { settingsService: SettingsService; config: Config } {
  const settingsService =
    rawOptions.settings ?? rawOptions.runtime?.settingsService;
  const config = rawOptions.config ?? rawOptions.runtime?.config;

  if (!settingsService) {
    throw new ProviderRuntimeNormalizationError({
      providerKey: 'ProviderManager',
      message:
        'ProviderManager requires call-scoped settings; legacy provider state is disabled.',
      requirement: 'REQ-SP4-002',
      runtimeId,
      stage: 'normalizeRuntimeInputs',
      metadata: {
        hint: 'SettingsService must be provided in options.settings or runtime.settingsService',
      },
    });
  }

  if (!config) {
    throw new ProviderRuntimeNormalizationError({
      providerKey: 'ProviderManager',
      message:
        'ProviderManager requires call-scoped config; legacy provider state is disabled.',
      requirement: 'REQ-SP4-002',
      runtimeId,
      stage: 'normalizeRuntimeInputs',
      metadata: {
        hint: 'Config must be provided in options.config or runtime.config',
      },
    });
  }

  return { settingsService: settingsService as SettingsService, config };
}

/** REQ-SP4-003: Compose normalized.resolved with runtime helpers. */
function resolveFields(
  rawOptions: GenerateChatOptions,
  settingsService: SettingsService,
  config: Config,
  targetProvider: string,
  runtimeId: string,
  deps: RuntimeNormalizerDeps,
): Record<string, unknown> {
  const providerSettings = settingsService.getProviderSettings(targetProvider);
  const providerInstance = deps.getProvider(targetProvider);
  const shouldApplyGlobalEphemerals = computeShouldApplyGlobalEphemerals(
    settingsService,
    config,
    targetProvider,
  );

  logger.debug(() => {
    const token = rawOptions.resolved?.authToken;
    const tokenStr = typeof token === 'string' ? token : '';
    return `[normalizeRuntimeInputs] provider=${targetProvider}, incoming authToken present=${Boolean(tokenStr.trim())} length=${tokenStr.length}`;
  });

  const resolved: Record<string, unknown> = {
    model: resolveModelField(
      rawOptions,
      providerSettings,
      config,
      providerInstance,
      shouldApplyGlobalEphemerals,
    ),
    baseURL: resolveBaseURLField(rawOptions, providerSettings),
    authToken:
      rawOptions.resolved?.authToken ??
      (providerSettings['auth-key'] as string | undefined),
    telemetry: {
      ...rawOptions.resolved?.telemetry,
      runtimeId,
      normalizedAt: new Date().toISOString(),
      provider: targetProvider,
    },
  };

  applyGlobalAuthKey(
    resolved,
    rawOptions,
    config,
    shouldApplyGlobalEphemerals,
    targetProvider,
  );

  resolveBaseURL(
    resolved,
    rawOptions,
    config,
    providerSettings,
    providerInstance,
    shouldApplyGlobalEphemerals,
  );

  return resolved;
}

/** Resolve model field, treating empty/whitespace strings as absent. */
function resolveModelField(
  rawOptions: GenerateChatOptions,
  providerSettings: Record<string, unknown>,
  config: Config,
  providerInstance: IProvider | undefined,
  shouldApplyGlobalEphemerals: boolean,
): string | undefined {
  const fromResolved = rawOptions.resolved?.model;
  if (typeof fromResolved === 'string' && fromResolved.trim() !== '') {
    return fromResolved;
  }
  const fromSettings = providerSettings.model as string | undefined;
  if (typeof fromSettings === 'string' && fromSettings.trim() !== '') {
    return fromSettings;
  }
  if (shouldApplyGlobalEphemerals) {
    const fromConfig = config.getModel();
    if (typeof fromConfig === 'string' && fromConfig.trim() !== '') {
      return fromConfig;
    }
  }
  const fromDefault = providerInstance?.getDefaultModel();
  if (typeof fromDefault === 'string' && fromDefault.trim() !== '') {
    return fromDefault;
  }
  return undefined;
}

/** Resolve baseURL field, treating empty/whitespace strings as absent. */
function resolveBaseURLField(
  rawOptions: GenerateChatOptions,
  providerSettings: Record<string, unknown>,
): string | undefined {
  const fromResolved = rawOptions.resolved?.baseURL;
  if (typeof fromResolved === 'string' && fromResolved.trim() !== '') {
    return fromResolved;
  }
  const fromSettings = providerSettings['base-url'] as string | undefined;
  if (typeof fromSettings === 'string' && fromSettings.trim() !== '') {
    return fromSettings;
  }
  return undefined;
}

/** Determine whether global ephemeral settings should be applied. */
function computeShouldApplyGlobalEphemerals(
  settingsService: SettingsService,
  config: Config,
  targetProvider: string,
): boolean {
  const configSettingsService = config.getSettingsService();
  const configMatchesSettingsService =
    configSettingsService === settingsService;
  const activeProviderRaw = settingsService.get('activeProvider');
  const activeProviderName =
    typeof activeProviderRaw === 'string' ? activeProviderRaw.trim() : '';
  return (
    configMatchesSettingsService &&
    (!activeProviderName || activeProviderName === targetProvider)
  );
}

/** Apply global auth-key from ephemeral settings if no token is set. */
function applyGlobalAuthKey(
  resolved: Record<string, unknown>,
  rawOptions: GenerateChatOptions,
  config: Config,
  shouldApplyGlobalEphemerals: boolean,
  targetProvider: string,
): void {
  const effectiveConfig = rawOptions.config ?? config;

  logger.debug(() => {
    const token = resolved.authToken;
    const tokenStr = typeof token === 'string' ? token : '';
    return `[normalizeRuntimeInputs] provider=${targetProvider}, resolved authToken present=${Boolean(tokenStr.trim())} length=${tokenStr.length}`;
  });

  const configWithEphemerals = effectiveConfig as Config & {
    getEphemeralSetting?: (key: string) => unknown;
  };

  if (
    shouldApplyGlobalEphemerals &&
    typeof configWithEphemerals.getEphemeralSetting === 'function' &&
    (typeof resolved.authToken !== 'string' || resolved.authToken.trim() === '')
  ) {
    const globalAuthKey = configWithEphemerals.getEphemeralSetting(
      'auth-key',
    ) as string | undefined;

    logger.debug(() => {
      const tokenStr = typeof globalAuthKey === 'string' ? globalAuthKey : '';
      return `[normalizeRuntimeInputs] provider=${targetProvider}, global auth-key present=${Boolean(tokenStr.trim())} length=${tokenStr.length}, will use: ${globalAuthKey ? 'YES' : 'NO'}`;
    });

    if (globalAuthKey && globalAuthKey.trim() !== '') {
      resolved.authToken = globalAuthKey.trim();
    } else if (process.env.DEBUG) {
      logger.debug(
        () =>
          `[ProviderManager] Missing auth token for provider '${targetProvider}' even after checking global auth-key.`,
      );
    }
  }
}

/** Resolve base URL from config, provider, and sandbox settings. */
function resolveBaseURL(
  resolved: Record<string, unknown>,
  rawOptions: GenerateChatOptions,
  config: Config,
  providerSettings: Record<string, unknown>,
  providerInstance: IProvider | undefined,
  shouldApplyGlobalEphemerals: boolean,
): void {
  if (isBlankish(resolved.baseURL) && shouldApplyGlobalEphemerals) {
    const configBaseUrl =
      typeof config.getEphemeralSetting === 'function'
        ? (config.getEphemeralSetting('base-url') as string | undefined)
        : undefined;
    if (configBaseUrl && typeof configBaseUrl === 'string') {
      const trimmed = configBaseUrl.trim();
      if (trimmed) {
        resolved.baseURL = trimmed;
      }
    }
  }

  if (isBlankish(resolved.baseURL)) {
    const providerBaseUrl = getBaseUrlFromProvider(providerInstance);
    if (providerBaseUrl) {
      resolved.baseURL = providerBaseUrl;
    }
  }

  const hasExplicitCallBaseUrl =
    typeof rawOptions.resolved?.baseURL === 'string' &&
    rawOptions.resolved.baseURL.trim() !== '';
  if (isContainerSandbox() && !hasExplicitCallBaseUrl) {
    const sandboxBaseUrl = providerSettings['sandbox-base-url'] as
      | string
      | undefined;
    if (sandboxBaseUrl && typeof sandboxBaseUrl === 'string') {
      const trimmed = sandboxBaseUrl.trim();
      if (trimmed) {
        resolved.baseURL = trimmed;
      }
    }
  }
}

/** REQ-SP4-003: Validate required fields in resolved options. */
function validateResolvedFields(
  resolved: Record<string, unknown>,
  targetProvider: string,
  runtimeId: string,
  deps: RuntimeNormalizerDeps,
): void {
  const missingFields: string[] = [];
  if (isBlankish(resolved.model)) missingFields.push('model');
  if (
    isBlankish(resolved.baseURL) &&
    !BASE_URL_OPTIONAL_PROVIDERS.has(targetProvider)
  ) {
    missingFields.push('baseURL');
  }

  if (
    !hasResolvedAuthToken(resolved.authToken) &&
    targetProvider !== 'gemini'
  ) {
    const providerInstance = deps.getProvider(targetProvider);

    const actualProvider = unwrapProvider(providerInstance);

    const canResolveAuth =
      actualProvider !== undefined &&
      'getAuthToken' in actualProvider &&
      typeof (actualProvider as ProviderWithAuth).getAuthToken === 'function';

    if (canResolveAuth === false) {
      missingFields.push('authToken');
    }
  }

  if (missingFields.length > 0) {
    throw new ProviderRuntimeNormalizationError({
      providerKey: 'ProviderManager',
      message: `Incomplete runtime resolution (${missingFields.join(', ')}) for runtimeId=${runtimeId}`,
      requirement: 'REQ-SP4-003',
      runtimeId,
      stage: 'normalizeRuntimeInputs',
      metadata: { missingFields, provider: targetProvider },
    });
  }
}

function readConfigUserMemory(config: Config): string | undefined {
  const configWithOptionalMemory = config as { getUserMemory?: () => string };
  return configWithOptionalMemory.getUserMemory?.() ?? undefined;
}

/** REQ-SP4-005: Build final normalized options with runtime context. */
function buildNormalizedOptions(
  rawOptions: GenerateChatOptions,
  settingsService: SettingsService,
  config: Config,
  resolved: Record<string, unknown>,
  targetProvider: string,
  runtimeId: string,
): GenerateChatOptions {
  const configUserMemory = readConfigUserMemory(config);
  const userMemory = rawOptions.userMemory ?? configUserMemory;
  const metadata = {
    ...rawOptions.metadata,
    ...rawOptions.runtime?.metadata,
    _normalized: true,
    _normalizationTime: new Date().toISOString(),
    _runtimeId: runtimeId,
    _provider: targetProvider,
  };

  const normalizedRuntime: ProviderRuntimeContext = {
    ...(rawOptions.runtime ?? {}),
    settingsService,
    config,
    runtimeId,
    metadata,
  };

  const userMemorySnapshot =
    typeof userMemory === 'string' ? userMemory : configUserMemory;

  const invocation =
    rawOptions.invocation ??
    createRuntimeInvocationContext({
      runtime: normalizedRuntime,
      settings: settingsService,
      providerName: targetProvider,
      ephemeralsSnapshot: buildEphemeralsSnapshot(
        settingsService,
        targetProvider,
      ),
      telemetry: resolved.telemetry as
        | { runtimeId: string; normalizedAt: string; provider: string }
        | undefined,
      metadata,
      userMemory: userMemorySnapshot,
      fallbackRuntimeId: runtimeId,
    });

  return {
    ...rawOptions,
    settings: settingsService,
    config,
    runtime: normalizedRuntime,
    resolved: resolved as GenerateChatOptions['resolved'],
    userMemory,
    metadata,
    invocation,
  };
}

export function buildEphemeralsSnapshot(
  settingsService: SettingsService,
  providerName: string,
): Record<string, unknown> {
  const globalEphemerals = settingsService.getAllGlobalSettings();
  const providerEphemerals = settingsService.getProviderSettings(providerName);

  // @plan PLAN-20260126-SETTINGS-SEPARATION.P09
  // Filter out provider-config settings from global level
  const snapshot: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(globalEphemerals)) {
    if (!PROVIDER_CONFIG_KEYS.has(key)) {
      snapshot[key] = value;
    }
  }
  snapshot[providerName] = { ...providerEphemerals };
  return snapshot;
}
