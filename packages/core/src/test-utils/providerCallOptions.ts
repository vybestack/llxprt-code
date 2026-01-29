/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SettingsService } from '../settings/SettingsService.js';
import { PROVIDER_CONFIG_KEYS } from '../providers/providerConfigKeys.js';
import type { GenerateChatOptions } from '../providers/IProvider.js';
import type { ProviderToolset } from '../providers/IProvider.js';
import type { Config } from '../config/config.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import {
  createRuntimeInvocationContext,
  type RuntimeInvocationContext,
} from '../runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from './runtime.js';

const DEFAULT_RUNTIME_SOURCE = 'test-utils#createProviderCallOptions';

let runtimeSequence = 0;

interface SettingsOverrides {
  global?: Record<string, unknown>;
  provider?: Record<string, unknown>;
}

export interface ProviderCallOptionsInit {
  providerName: string;
  contents?: GenerateChatOptions['contents'];
  tools?: ProviderToolset;
  metadata?: Record<string, unknown>;
  userMemory?: GenerateChatOptions['userMemory'];
  resolved?: GenerateChatOptions['resolved'];
  settings?: SettingsService;
  settingsOverrides?: SettingsOverrides;
  config?: Config;
  configOverrides?: Partial<Record<string, unknown>>;
  runtime?: ProviderRuntimeContext;
  runtimeId?: string;
  runtimeMetadata?: Record<string, unknown>;
  invocation?: RuntimeInvocationContext;
  ephemerals?: Record<string, unknown>;
}

function applySettingsOverrides(
  providerName: string,
  settings: SettingsService,
  overrides?: SettingsOverrides,
): void {
  if (!overrides) {
    return;
  }

  if (overrides.global) {
    for (const [key, value] of Object.entries(overrides.global)) {
      settings.set(key, value);
    }
  }

  if (overrides.provider) {
    for (const [key, value] of Object.entries(overrides.provider)) {
      settings.setProviderSetting(providerName, key, value);
    }
  }
}

function buildEphemeralsSnapshot(
  providerName: string,
  settings: SettingsService,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  // @plan PLAN-20260126-SETTINGS-SEPARATION.P09
  // Filter out provider-config settings from global level (same as ProviderManager)
  const globalSettings = settings.getAllGlobalSettings();
  const snapshot: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(globalSettings)) {
    if (!PROVIDER_CONFIG_KEYS.has(key)) {
      snapshot[key] = value;
    }
  }
  if (overrides) {
    Object.assign(snapshot, overrides);
  }

  snapshot[providerName] = {
    ...settings.getProviderSettings(providerName),
  };

  return snapshot;
}

function ensureConfig(
  providerName: string,
  settings: SettingsService,
  explicitConfig?: Config,
  overrides?: Partial<Record<string, unknown>>,
): Config {
  if (explicitConfig) {
    return explicitConfig;
  }

  const defaultOverrides: Partial<Record<string, unknown>> = {
    getProvider: () => providerName,
    getProviderSettings: () => settings.getProviderSettings(providerName),
    getEphemeralSettings: () => ({
      ...settings.getAllGlobalSettings(),
      ...settings.getProviderSettings(providerName),
    }),
    getEphemeralSetting: (key: string) => {
      const providerSettings = settings.getProviderSettings(providerName);
      if (key in providerSettings) {
        return providerSettings[key];
      }
      return settings.get(key);
    },
    getSettingsService: () => settings,
  };

  return createRuntimeConfigStub(settings, {
    ...defaultOverrides,
    ...(overrides ?? {}),
  }) as Config;
}

function ensureRuntime(
  providerName: string,
  settings: SettingsService,
  config: Config,
  init: ProviderCallOptionsInit,
): ProviderRuntimeContext {
  const resolvedRuntimeId =
    typeof init.runtime?.runtimeId === 'string' &&
    init.runtime.runtimeId.trim().length > 0
      ? init.runtime.runtimeId
      : (init.runtimeId ?? `${providerName}.runtime.${++runtimeSequence}`);

  const runtimeMetadata = {
    source: DEFAULT_RUNTIME_SOURCE,
    ...(init.runtime?.metadata ?? {}),
    ...(init.runtimeMetadata ?? {}),
  };

  if (init.runtime) {
    return {
      ...init.runtime,
      settingsService: settings,
      config: init.runtime.config ?? config,
      runtimeId: resolvedRuntimeId,
      metadata: runtimeMetadata,
    };
  }

  return createProviderRuntimeContext({
    settingsService: settings,
    config,
    runtimeId: resolvedRuntimeId,
    metadata: runtimeMetadata,
  });
}

function ensureInvocation(
  providerName: string,
  settings: SettingsService,
  runtime: ProviderRuntimeContext,
  init: ProviderCallOptionsInit,
  metadata: Record<string, unknown>,
): RuntimeInvocationContext {
  if (init.invocation) {
    return init.invocation;
  }

  const ephemeralsSnapshot = buildEphemeralsSnapshot(
    providerName,
    settings,
    init.ephemerals,
  );

  const userMemorySnapshot =
    typeof init.userMemory === 'string' ? init.userMemory : undefined;

  const telemetry =
    init.resolved && 'telemetry' in init.resolved
      ? init.resolved.telemetry
      : undefined;

  return createRuntimeInvocationContext({
    runtime,
    settings,
    providerName,
    metadata,
    ephemeralsSnapshot,
    userMemory: userMemorySnapshot,
    telemetry,
    fallbackRuntimeId: runtime.runtimeId ?? `${providerName}.runtime`,
  });
}

/**
 * Creates GenerateChatOptions with explicit settings/config/runtime bindings.
 * Tests should prefer this helper over calling provider methods directly
 * with ad-hoc option objects to ensure fail-fast coverage remains intact.
 */
export function createProviderCallOptions(
  init: ProviderCallOptionsInit,
): GenerateChatOptions & {
  settings: SettingsService;
  config: Config;
  runtime: ProviderRuntimeContext;
  invocation: RuntimeInvocationContext;
} {
  if (!init || !init.providerName) {
    throw new Error(
      'createProviderCallOptions requires a providerName to be specified.',
    );
  }

  const settings = init.settings ?? new SettingsService();
  applySettingsOverrides(init.providerName, settings, init.settingsOverrides);

  const config = ensureConfig(
    init.providerName,
    settings,
    init.config,
    init.configOverrides,
  );

  const runtime = ensureRuntime(init.providerName, settings, config, init);

  const mergedMetadata: Record<string, unknown> = {
    ...(runtime.metadata ?? {}),
    ...(init.metadata ?? {}),
  };

  const invocation = ensureInvocation(
    init.providerName,
    settings,
    runtime,
    init,
    mergedMetadata,
  );

  return {
    contents: init.contents ?? [],
    tools: init.tools,
    metadata: mergedMetadata,
    settings,
    config,
    runtime,
    invocation,
    resolved: init.resolved,
    userMemory: init.userMemory,
  };
}
