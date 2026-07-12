/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ConversationCache } from './ConversationCache.js';
import {
  resolveOpenAITransport,
  resolveExplicitTransportMode,
} from './openaiModelPolicy.js';

// Create a single logger instance for the module (following singleton pattern)
const logger = new DebugLogger('llxprt:openai:provider');

// Helper types leveraging public APIs

export type OpenAIProviderLike = {
  name: string;
  getCurrentModel?: () => string;
  getConversationCache?: () => ConversationCache;
  shouldUseResponses?: (model: string) => boolean;
  conversationCache?: ConversationCache;
  /**
   * Reports the effective base URL using the same precedence as
   * execution (runtime → global → provider). When available, this is
   * the authoritative source so UI transport matches execution.
   */
  getBaseURL?: () => string | undefined;
  /**
   * Reports the effective `openaiResponsesEnabled` value using the
   * same precedence as execution (ephemeral → authOnly → settings →
   * provider config). When available, this is the authoritative
   * source so UI transport matches execution (issue #2483).
   */
  getOpenaiResponsesEnabled?: () => boolean | undefined;
};

export interface OpenAIProviderInfo {
  provider: OpenAIProviderLike | null;
  conversationCache: ConversationCache | null;
  isResponsesAPI: boolean;
  currentModel: string | null;
  remoteTokenInfo: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

/**
 * The runtime inputs OpenAI provider info derives from. Supplied explicitly by
 * the caller (which already resolves the active runtime deterministically)
 * rather than read from ambient global state, so settings/config always belong
 * to the SAME runtime as the provider manager (issue #2300).
 */
export interface OpenAIProviderInfoRuntime {
  settingsService: ProviderInfoSettings;
  config?: ProviderInfoConfig;
}

/**
 * Retrieves OpenAI provider information from an explicit runtime.
 *
 * Accepts the minimal structural surface (`OpenAIProviderInfoSource`) the
 * function actually consumes, so callers holding the core
 * `RuntimeProviderManager` contract (rather than the concrete providers
 * `ProviderManager`) can pass it directly without a type-escape cast.
 *
 * @param runtime The active runtime's settings service and config
 * @param providerManager A structural provider-info source, or null/undefined
 * @returns OpenAI provider info if available, null values otherwise
 */
export function getOpenAIProviderInfo(
  runtime: OpenAIProviderInfoRuntime,
  providerManager?: OpenAIProviderInfoSource | null,
): OpenAIProviderInfo {
  const result: OpenAIProviderInfo = {
    provider: null,
    conversationCache: null,
    isResponsesAPI: false,
    currentModel: null,
    remoteTokenInfo: {},
  };

  try {
    const settingsService = runtime.settingsService;
    const config = runtime.config;

    const manager = resolveManager(providerManager, config);
    const activeProviderName = resolveActiveProviderName(manager, config);
    if (activeProviderName !== 'openai') {
      return result;
    }

    const openaiProvider = resolveOpenAIProvider(manager);
    result.provider = openaiProvider;
    result.conversationCache = resolveConversationCache(openaiProvider);

    result.currentModel = resolveCurrentModel(settingsService, config);
    result.isResponsesAPI = resolveResponsesApiMode(
      settingsService,
      result.currentModel,
      openaiProvider,
    );
  } catch (error) {
    logger.debug(() => `Error accessing OpenAI provider info: ${error}`);
  }

  return result;
}

export type OpenAIProviderInfoSource = {
  hasActiveProvider: () => boolean;
  getActiveProviderName: () => string | undefined;
  getActiveProvider: () => OpenAIProviderLike | undefined;
};

type ProviderInfoConfig = {
  getProviderManager?: () => OpenAIProviderInfoSource | undefined;
  getProvider?: () => string | undefined;
  getModel?: () => string | undefined;
};

type ProviderInfoSettings = {
  get: (key: string) => unknown;
  getProviderSettings: (name: string) => Record<string, unknown>;
};

function resolveManager(
  providerManager: OpenAIProviderInfoSource | null | undefined,
  config: ProviderInfoConfig | undefined,
): OpenAIProviderInfoSource | null | undefined {
  const runtimeManager =
    typeof config?.getProviderManager === 'function'
      ? config.getProviderManager()
      : undefined;
  return providerManager ?? runtimeManager ?? null;
}

function resolveActiveProviderName(
  manager: OpenAIProviderInfoSource | null | undefined,
  config: ProviderInfoConfig | undefined,
): string | undefined {
  return (
    (manager?.hasActiveProvider() === true
      ? manager.getActiveProviderName()
      : undefined) ??
    (typeof config?.getProvider === 'function'
      ? config.getProvider()
      : undefined)
  );
}

function resolveOpenAIProvider(
  manager: OpenAIProviderInfoSource | null | undefined,
): OpenAIProviderLike | null {
  if (manager?.hasActiveProvider() !== true) {
    return null;
  }
  const activeProvider = manager.getActiveProvider();
  if (activeProvider === undefined || activeProvider.name !== 'openai') {
    return null;
  }
  return activeProvider;
}

function resolveConversationCache(
  openaiProvider: OpenAIProviderLike | null,
): ConversationCache | null {
  if (!openaiProvider) {
    return null;
  }
  if (typeof openaiProvider.getConversationCache === 'function') {
    return openaiProvider.getConversationCache();
  }
  if ('conversationCache' in openaiProvider) {
    return openaiProvider.conversationCache ?? null;
  }
  return null;
}

function resolveCurrentModel(
  settingsService: ProviderInfoSettings,
  config: ProviderInfoConfig | undefined,
): string | null {
  const ephemeralModel = settingsService.get('model') as string | undefined;
  const providerSettings = settingsService.getProviderSettings('openai');
  const providerModel = providerSettings.model as string | undefined;
  const configModel =
    typeof config?.getModel === 'function' ? config.getModel() : undefined;
  const normalizedModel =
    getValidString(ephemeralModel) ??
    getValidString(providerModel) ??
    getValidString(configModel);
  return normalizedModel ?? null;
}

function resolveResponsesApiMode(
  settingsService: ProviderInfoSettings,
  currentModel: string | null,
  openaiProvider: OpenAIProviderLike | null,
): boolean {
  const providerSettings = settingsService.getProviderSettings('openai');
  const explicitMode = resolveExplicitTransportMode(
    getValidString(providerSettings.apiMode),
    getValidString(providerSettings.responsesMode),
    getValidString(settingsService.get('responses-mode')),
  );
  if (!currentModel) {
    return explicitMode === 'responses';
  }

  // Resolve the effective base URL using the same precedence as the
  // execution path: provider.getBaseURL() (which already accounts for
  // runtime → global → provider config) is authoritative. Fall back to
  // settings-based resolution only when the provider instance is
  // unavailable or does not expose getBaseURL.
  const baseURL =
    resolveEffectiveBaseURL(
      openaiProvider,
      providerSettings,
      settingsService,
    ) ?? 'https://api.openai.com/v1';

  const openaiResponsesEnabled = resolveEffectiveOpenaiResponsesEnabled(
    openaiProvider,
    settingsService,
  );

  // Use the same shared transport decision as the execution path so UI
  // truth always matches execution truth (issue #2483).
  const decision = resolveOpenAITransport({
    model: currentModel,
    baseURL,
    explicitMode,
    openaiResponsesEnabled,
  });

  if (decision.useResponses) {
    return true;
  }

  // The unified policy does not know about provider-instance state for
  // supports-but-not-requires models. Defer to the provider instance's
  // shouldUseResponses when no explicit override was set and the model
  // merely supports (but does not require) Responses.
  if (
    explicitMode === undefined &&
    decision.transport.supportsResponses &&
    !decision.transport.requiresResponses &&
    openaiProvider?.shouldUseResponses
  ) {
    return openaiProvider.shouldUseResponses(currentModel);
  }
  return false;
}

/**
 * Resolve the effective base URL mirroring the execution-time precedence:
 * 1. Provider instance's getBaseURL() (handles runtime/global/provider)
 * 2. Provider-scoped settings 'base-url'
 * 3. Global 'base-url' ephemeral setting
 */
function resolveEffectiveBaseURL(
  openaiProvider: OpenAIProviderLike | null,
  providerSettings: ReturnType<ProviderInfoSettings['getProviderSettings']>,
  settingsService: ProviderInfoSettings,
): string | undefined {
  if (
    openaiProvider !== null &&
    typeof openaiProvider.getBaseURL === 'function'
  ) {
    const providerURL = openaiProvider.getBaseURL();
    if (providerURL !== undefined && providerURL.trim() !== '') {
      return providerURL;
    }
  }
  return (
    getValidString(providerSettings['base-url']) ??
    getValidString(settingsService.get('base-url'))
  );
}

/**
 * Resolve the effective openaiResponsesEnabled mirroring the execution-time
 * precedence:
 * 1. Provider instance's getOpenaiResponsesEnabled() (handles
 *    ephemeral/authOnly/settings/provider-config — same effective value
 *    the execution path uses)
 * 2. Global 'openaiResponsesEnabled' setting (fallback)
 *
 * This ensures UI and execution always agree on the effective flag
 * (issue #2483).
 */
function resolveEffectiveOpenaiResponsesEnabled(
  openaiProvider: OpenAIProviderLike | null,
  settingsService: ProviderInfoSettings,
): boolean | undefined {
  if (
    openaiProvider !== null &&
    typeof openaiProvider.getOpenaiResponsesEnabled === 'function'
  ) {
    return openaiProvider.getOpenaiResponsesEnabled();
  }
  return getValidBoolean(settingsService.get('openaiResponsesEnabled'));
}

/**
 * Helper function to get a valid non-empty trimmed string, or undefined.
 */
function getValidString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed !== '' ? trimmed : undefined;
}

function getValidBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Example usage:
 *
 * const openAIInfo = getOpenAIProviderInfo(
 *   { settingsService, config },
 *   providerManager,
 * );
 * if (openAIInfo.provider && openAIInfo.conversationCache) {
 *   // Access conversation cache
 *   const cachedMessages = openAIInfo.conversationCache.get(conversationId, parentId);
 *
 *   // Check if using Responses API
 *   if (openAIInfo.isResponsesAPI) {
 *     console.log('Using OpenAI Responses API');
 *   }
 * }
 */
