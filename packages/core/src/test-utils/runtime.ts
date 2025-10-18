/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
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

interface GeminiChatConfigShape {
  getSessionId: () => string;
  getTelemetryLogPromptsEnabled: () => boolean;
  getUsageStatisticsEnabled: () => boolean;
  getDebugMode: () => boolean;
  getContentGeneratorConfig: () => {
    authType?: string;
    model?: string;
  };
  getModel: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  getQuotaErrorOccurred: ReturnType<typeof vi.fn>;
  setQuotaErrorOccurred: ReturnType<typeof vi.fn>;
  flashFallbackHandler?: unknown;
  getEphemeralSettings: ReturnType<typeof vi.fn>;
  getEphemeralSetting: ReturnType<typeof vi.fn>;
  getProviderManager: ReturnType<typeof vi.fn>;
  getSettingsService: ReturnType<typeof vi.fn>;
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
    getProviderManager: vi.fn().mockReturnValue(providerManager),
    getSettingsService: vi.fn().mockReturnValue(settingsService),
  };

  const config = {
    ...baseConfig,
    ...(options.configOverrides ?? {}),
  } as GeminiChatConfigShape;

  return {
    config: config as unknown as Config,
    provider,
    providerManager,
    settingsService,
    runtime,
  };
}
