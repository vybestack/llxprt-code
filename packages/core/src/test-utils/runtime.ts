/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import type { IProvider } from '../providers/IProvider.js';
import type { ProviderManager } from '../providers/ProviderManager.js';
import {
  createProviderRuntimeContext,
  peekActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import { SettingsService } from '../settings/SettingsService.js';

interface ProviderRuntimeOptions {
  settingsService?: SettingsService;
  config?: Config;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
}

type SpyFn = ((...args: unknown[]) => unknown) & {
  calls: unknown[][];
  mockImplementation: (fn: (...args: unknown[]) => unknown) => SpyFn;
  mockReturnValue: (value: unknown) => SpyFn;
  mockReturnValueOnce: (value: unknown) => SpyFn;
  mockClear: () => SpyFn;
};

function createSpy(impl?: (...args: unknown[]) => unknown): SpyFn {
  const calls: unknown[][] = [];
  let implementation = impl ?? (() => undefined);

  const spy = ((...args: unknown[]) => {
    calls.push(args);
    return implementation(...args);
  }) as SpyFn;

  spy.calls = calls;
  spy.mockImplementation = (fn: (...fnArgs: unknown[]) => unknown) => {
    implementation = fn;
    return spy;
  };
  spy.mockReturnValue = (value: unknown) => {
    implementation = () => value;
    return spy;
  };
  spy.mockReturnValueOnce = (value: unknown) => {
    let called = false;
    implementation = (..._fnArgs: unknown[]) => {
      if (called) {
        return value;
      }
      called = true;
      return value;
    };
    return spy;
  };
  spy.mockClear = () => {
    calls.length = 0;
    implementation = impl ?? (() => undefined);
    return spy;
  };

  return spy;
}

interface ProviderWithRuntimeResult<P> {
  provider: P;
  runtime: ProviderRuntimeContext;
  settingsService: SettingsService;
}

/**
 * Creates a provider instance while binding it to a fresh runtime context.
 * The runtime is only active during instantiation so the provider captures
 * the injected settings service without polluting global state.
 */
export function createProviderWithRuntime<P>(
  factory: (context: {
    runtime: ProviderRuntimeContext;
    settingsService: SettingsService;
  }) => P,
  options: ProviderRuntimeOptions = {},
): ProviderWithRuntimeResult<P> {
  const previousContext = peekActiveProviderRuntimeContext();
  const settingsService = options.settingsService ?? new SettingsService();
  const runtime = createProviderRuntimeContext({
    settingsService,
    config: options.config,
    runtimeId: options.runtimeId ?? 'test.provider.runtime',
    metadata: {
      source: 'test-utils#createProviderWithRuntime',
      ...(options.metadata ?? {}),
    },
  });

  setActiveProviderRuntimeContext(runtime);
  try {
    const provider = factory({ runtime, settingsService });
    return { provider, runtime, settingsService };
  } finally {
    setActiveProviderRuntimeContext(previousContext ?? null);
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
    setProviderManager: noop,
    getProviderManager: () => undefined as ProviderManager | undefined,
    getProviderSetting: () => undefined,
    getEphemeralSettings: () => ({ model: 'test-model' }),
    getEphemeralSetting: () => undefined,
    setEphemeralSetting: noop,
    getUserMemory: () => '',
    setUserMemory: noop,
    getModel: () => 'test-model',
    setModel: noop,
    getQuotaErrorOccurred: () => false,
    setQuotaErrorOccurred: noop,
  };

  return Object.assign(base, overrides) as unknown as Config;
}

interface TestRuntimeInitOptions {
  runtimeId?: string;
  metadata?: Record<string, unknown>;
  configOverrides?: Partial<Record<string, unknown>>;
}

/**
 * Initializes a lightweight provider runtime context for test environments.
 * Returns the created settings service, config stub, and runtime context.
 */
export function initializeTestProviderRuntime(
  options: TestRuntimeInitOptions = {},
): {
  settingsService: SettingsService;
  config: Config;
  runtime: ProviderRuntimeContext;
} {
  const settingsService = new SettingsService();
  const config = createRuntimeConfigStub(settingsService, {
    ...(options.configOverrides ?? {}),
  });
  const runtime = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId:
      options.runtimeId ??
      `test.provider.runtime.${Math.random().toString(36).slice(2, 10)}`,
    metadata: {
      source: 'test-utils#initializeTestProviderRuntime',
      ...(options.metadata ?? {}),
    },
  });

  setActiveProviderRuntimeContext(runtime);
  return { settingsService, config, runtime };
}

function requireVi() {
  const viGlobal = (globalThis as { vi?: (typeof import('vitest'))['vi'] }).vi;
  if (viGlobal) {
    return viGlobal;
  }

  return {
    fn: (impl?: (...args: unknown[]) => unknown) => createSpy(impl),
  } as unknown as (typeof import('vitest'))['vi'];
}

interface GeminiChatConfigShape {
  getSessionId: () => string;
  getTelemetryLogPromptsEnabled: () => boolean;
  getUsageStatisticsEnabled: () => boolean;
  getDebugMode: () => boolean;
  getContentGeneratorConfig: () => {
    authType?: string;
    model?: string;
  };
  getModel: ReturnType<ReturnType<typeof requireVi>['fn']>;
  setModel: ReturnType<ReturnType<typeof requireVi>['fn']>;
  getQuotaErrorOccurred: ReturnType<ReturnType<typeof requireVi>['fn']>;
  setQuotaErrorOccurred: ReturnType<ReturnType<typeof requireVi>['fn']>;
  flashFallbackHandler?: unknown;
  getEphemeralSettings: ReturnType<ReturnType<typeof requireVi>['fn']>;
  getEphemeralSetting: ReturnType<ReturnType<typeof requireVi>['fn']>;
  getProvider: ReturnType<ReturnType<typeof requireVi>['fn']>;
  setProvider: ReturnType<ReturnType<typeof requireVi>['fn']>;
  getProviderManager: ReturnType<ReturnType<typeof requireVi>['fn']>;
  getSettingsService: ReturnType<ReturnType<typeof requireVi>['fn']>;
}

interface GeminiChatRuntimeOptions {
  provider?: IProvider;
  providerManager?: Pick<ProviderManager, 'getActiveProvider'>;
  settingsService?: SettingsService;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
  configOverrides?: Partial<GeminiChatConfigShape>;
}

interface GeminiChatRuntimeResult {
  config: Config;
  provider: IProvider;
  providerManager: Pick<ProviderManager, 'getActiveProvider'>;
  settingsService: SettingsService;
  runtime: ProviderRuntimeContext;
}

function createDefaultProvider(): IProvider {
  const vi = requireVi();
  return {
    name: 'test-provider',
    isDefault: true,
    getModels: vi.fn(async () => []),
    getDefaultModel: () => 'test-model',
    generateChatCompletion: vi.fn(async function* () {
      yield { speaker: 'ai' as const, blocks: [] };
    }),
    getServerTools: () => [],
    invokeServerTool: vi.fn(),
  };
}

/**
 * Creates a Config stub and associated runtime wiring for GeminiChat tests.
 * The returned config exposes the minimal surface required by the class while
 * guaranteeing that runtime-aware helpers (e.g. getSettingsService) exist.
 */
export function createGeminiChatRuntime(
  options: GeminiChatRuntimeOptions = {},
): GeminiChatRuntimeResult {
  const vi = requireVi();
  const settingsService = options.settingsService ?? new SettingsService();
  const runtime = createProviderRuntimeContext({
    settingsService,
    runtimeId: options.runtimeId ?? 'test.geminiChat.runtime',
    metadata: {
      source: 'test-utils#createGeminiChatRuntime',
      ...(options.metadata ?? {}),
    },
  });

  const provider = options.provider ?? createDefaultProvider();

  const providerManager =
    options.providerManager ??
    ({
      getActiveProvider: vi.fn().mockReturnValue(provider),
    } as Pick<ProviderManager, 'getActiveProvider'>);
  let currentProviderName = provider.name;
  const getProviderSpy = vi.fn().mockImplementation(() => currentProviderName);
  const setProviderSpy = vi.fn().mockImplementation((next: unknown) => {
    if (typeof next === 'string') {
      currentProviderName = next;
    }
  });

  const baseConfig: GeminiChatConfigShape = {
    getSessionId: () => 'test-session-id',
    getTelemetryLogPromptsEnabled: () => true,
    getUsageStatisticsEnabled: () => true,
    getDebugMode: () => false,
    getContentGeneratorConfig: () => ({
      authType: 'oauth-personal',
      model: 'test-model',
    }),
    getModel: vi.fn().mockReturnValue('gemini-pro'),
    setModel: vi.fn(),
    getQuotaErrorOccurred: vi.fn().mockReturnValue(false),
    setQuotaErrorOccurred: vi.fn(),
    flashFallbackHandler: undefined,
    getEphemeralSettings: vi.fn().mockReturnValue({}),
    getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    getProvider: getProviderSpy,
    setProvider: setProviderSpy,
    getProviderManager: vi.fn().mockReturnValue(providerManager),
    getSettingsService: vi.fn().mockReturnValue(settingsService),
  };

  const config = {
    ...baseConfig,
    ...(options.configOverrides ?? {}),
  } as GeminiChatConfigShape;

  Object.assign(runtime, { config: config as unknown as Config });

  return {
    config: config as unknown as Config,
    provider,
    providerManager,
    settingsService,
    runtime,
  };
}
