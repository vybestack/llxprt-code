/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Local test helpers for the google-gemini plugin suite.
 *
 * The plugin is a release unit: its devDependencies are only the TS toolchain
 * and its tests must not import workspace test-helper packages
 * (@vybestack/llxprt-code-test-utils or @vybestack/llxprt-code-core/test-utils).
 * These helpers reproduce the narrow slice of the workspace helpers that the
 * suites in this directory actually consume. Host contracts are imported
 * type-only where possible; runtime imports come only from the peer packages
 * (@vybestack/llxprt-code-core subpaths that are not test-utils).
 */

import {
  Config,
  type ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  createRuntimeInvocationContext,
  type RuntimeInvocationContext,
} from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type {
  RuntimeGenerateChatOptions as GenerateChatOptions,
  RuntimeProviderToolset as ProviderToolset,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

export function assertInstanceOf<T>(
  value: unknown,
  ctor: new (...args: never[]) => T,
  message = `Expected an instance of ${ctor.name}`,
): asserts value is T {
  if (!(value instanceof ctor)) {
    throw new Error(message);
  }
}

/**
 * Minimal in-memory settings state backing the default service created by
 * createProviderCallOptions. It stores and returns what the tests set and
 * nothing more; suites that need real SettingsService behavior pass their own
 * instance through ProviderCallOptionsInit.settings.
 */
class LocalSettingsState {
  readonly #global = new Map<string, unknown>();
  readonly #providers = new Map<string, Map<string, unknown>>();

  get(key: string): unknown {
    return this.#global.get(key);
  }

  set(key: string, value: unknown): void {
    this.#global.set(key, value);
  }

  getProviderSettings(provider: string): Record<string, unknown> {
    return Object.fromEntries(this.#providers.get(provider) ?? []);
  }

  setProviderSetting(
    provider: string,
    key: string,
    value: unknown,
  ): void {
    let bucket = this.#providers.get(provider);
    if (!bucket) {
      bucket = new Map<string, unknown>();
      this.#providers.set(provider, bucket);
    }
    bucket.set(key, value);
  }

  getAllGlobalSettings(): Record<string, unknown> {
    return Object.fromEntries(this.#global);
  }

  clear(): void {
    this.#global.clear();
    this.#providers.clear();
  }
}

/**
 * Produces a lightweight Config stub sufficient for provider runtime tests.
 */
export function createRuntimeConfigStub(
  settingsService: SettingsService,
  overrides: Partial<Record<string, unknown>> = {},
): Config {
  const noop = () => {};
  const base = {
    getConversationLoggingEnabled: () => false,
    setConversationLoggingEnabled: noop,
    getTelemetryLogPromptsEnabled: () => false,
    setTelemetryLogPromptsEnabled: noop,
    getUsageStatisticsEnabled: () => false,
    setUsageStatisticsEnabled: noop,
    getDebugMode: () => false,
    setDebugMode: noop,
    isInteractive: () => false,
    getSessionId: () => 'test-session',
    setSessionId: noop,
    getFlashFallbackMode: () => 'off',
    setFlashFallbackMode: noop,
    getProvider: () => 'test-provider',
    setProvider: noop,
    getSettingsService: () => settingsService,
    getProviderSettings: () => ({}),
    setProviderSettings: noop,
    getProviderConfig: () => ({}),
    setProviderConfig: noop,
    resetProvider: noop,
    resetProviderSettings: noop,
    resetProviderConfig: noop,
    getActiveWorkspace: () => undefined as string | undefined,
    setActiveWorkspace: noop,
    clearActiveWorkspace: noop,
    getExtensionConfig: () => ({}),
    setExtensionConfig: noop,
    getFeatures: () => ({}),
    setFeatures: noop,
    getRedactionConfig: () => ({ replacements: [] }),
    setRuntimeProviderManager: noop,
    getProviderManager: () => undefined,
    getProviderSetting: () => undefined,
    getEphemeralSettings: () => ({ model: 'test-model' }),
    getEphemeralSetting: () => undefined,
    setEphemeralSetting: noop,
    getUserMemory: () => '',
    getJitMemoryForPath: () => Promise.resolve(''),
    setUserMemory: noop,
    getModel: () => 'test-model',
    setModel: noop,
    getQuotaErrorOccurred: () => false,
    setQuotaErrorOccurred: noop,
    getLlxprtMdFilePaths: () => [] as string[],
    getLlxprtMdFileCount: () => 0,
    getCoreMemoryFileCount: () => 0,
  };

  return Object.assign(base, overrides) as unknown as Config;
}

/**
 * Creates a fake config instance for testing. Mirrors the workspace helper
 * minus the test-agent factory wiring, which no suite in this plugin uses.
 */
export function makeFakeConfig(options?: {
  ephemeralSettings?: Record<string, unknown>;
}): Config {
  const params: ConfigParameters = {
    sessionId: 'test-session',
    targetDir: '/tmp/test',
    debugMode: false,
    cwd: '/tmp/test',
    model: 'gemini-2.0-flash-exp',
  };

  const config = new Config(params);

  config.setModel('gemini-2.0-flash-exp');

  if (options?.ephemeralSettings) {
    for (const [key, value] of Object.entries(options.ephemeralSettings)) {
      config.setEphemeralSetting(key, value);
    }
  }

  const mockContentGeneratorConfig: ContentGeneratorConfig = {
    model: 'gemini-2.0-flash-exp',
    apiKey: 'test-api-key',
  };

  Object.defineProperty(config, 'contentGeneratorConfig', {
    value: mockContentGeneratorConfig,
    writable: true,
    configurable: true,
  });

  return config;
}

const DEFAULT_RUNTIME_SOURCE = 'google-gemini-testSupport#createProviderCallOptions';

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
  systemInstruction?: string;
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

/**
 * Snapshots the settings the provider should see for one call. Unlike the
 * workspace helper, provider-config registry keys are not pre-filtered from
 * the global level: core's separateSettings (invoked inside
 * createRuntimeInvocationContext) performs the category separation from the
 * live registry, so provider-config keys still never reach the model buckets.
 */
function buildEphemeralsSnapshot(
  providerName: string,
  settings: SettingsService,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    ...settings.getAllGlobalSettings(),
  };
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
  });
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
 * Creates GenerateChatOptions with explicit settings/config/runtime bindings
 * for the suites in this plugin. Local counterpart of the workspace helper:
 * identical shape, but the default settings state is a minimal fake so this
 * module needs no runtime dependency beyond the peer core package.
 */
export function createProviderCallOptions(
  init: ProviderCallOptionsInit,
): GenerateChatOptions & {
  settings: SettingsService;
  config: Config;
  runtime: ProviderRuntimeContext;
  invocation: RuntimeInvocationContext;
} {
  if (!init.providerName) {
    throw new Error(
      'createProviderCallOptions requires a providerName to be specified.',
    );
  }

  const settings =
    init.settings ??
    (new LocalSettingsState() as unknown as SettingsService);
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
    // Providers require a non-empty systemInstruction on real chat
    // completions. Presence of the key, not its value, selects the behavior:
    // an explicit `systemInstruction: undefined` genuinely means "absent" and
    // exercises the fail-fast path, so a `??` default is deliberately avoided.
    systemInstruction:
      'systemInstruction' in init
        ? init.systemInstruction
        : 'test system prompt',
  };
}
