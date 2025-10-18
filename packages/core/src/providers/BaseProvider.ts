/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Base provider class with authentication precedence logic
 */

import {
  IProvider,
  GenerateChatOptions,
  ProviderToolset,
} from './IProvider.js';
import { IModel } from './IModel.js';
import { IContent } from '../services/history/IContent.js';
import { DebugLogger } from '../debug/index.js';
import {
  AuthPrecedenceResolver,
  AuthPrecedenceConfig,
  OAuthManager,
} from '../auth/precedence.js';
import type { Config } from '../config/config.js';
import { IProviderConfig } from './types/IProviderConfig.js';
import {
  peekActiveProviderRuntimeContext,
  getActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import type { ProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import type { SettingsService } from '../settings/SettingsService.js';

export interface BaseProviderConfig {
  // Basic provider config
  name: string;
  apiKey?: string;
  baseURL?: string;

  // Environment variable names to check
  envKeyNames?: string[];

  // OAuth config
  isOAuthEnabled?: boolean;
  oauthProvider?: string;
  oauthManager?: OAuthManager;
}

export interface NormalizedGenerateChatOptions extends GenerateChatOptions {
  settings: SettingsService;
  config?: Config;
  runtime?: ProviderRuntimeContext;
  tools?: ProviderToolset;
}

/**
 * Abstract base provider class that implements authentication precedence logic
 * This class provides lazy OAuth triggering and proper authentication precedence
 */
export abstract class BaseProvider implements IProvider {
  readonly name: string;
  protected authResolver: AuthPrecedenceResolver;
  protected baseProviderConfig: BaseProviderConfig;
  protected providerConfig?: IProviderConfig;
  protected globalConfig?: Config;
  protected cachedAuthToken?: string;
  protected authCacheTimestamp?: number;
  protected readonly AUTH_CACHE_DURATION = 60000; // 1 minute in milliseconds
  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P05
   * @requirement REQ-SP-001
   * @pseudocode provider-invocation.md lines 8-15
   */
  private baseSettingsService: SettingsService;
  private activeSettingsOverride?: SettingsService;

  // Callback for tracking throttle wait times (set by LoggingProviderWrapper)
  protected throttleTracker?: (waitTimeMs: number) => void;

  constructor(
    config: BaseProviderConfig,
    providerConfig?: IProviderConfig,
    globalConfig?: Config,
    settingsService?: SettingsService,
  ) {
    this.name = config.name;
    this.baseProviderConfig = config;
    this.providerConfig = providerConfig;
    this.globalConfig = globalConfig;
    const defaultRuntime =
      peekActiveProviderRuntimeContext() ?? getActiveProviderRuntimeContext();
    this.baseSettingsService =
      settingsService ?? defaultRuntime.settingsService;
    this.activeSettingsOverride = undefined;

    // Initialize auth precedence resolver
    // OAuth enablement will be checked dynamically through the manager
    const precedenceConfig: AuthPrecedenceConfig = {
      envKeyNames: config.envKeyNames || [],
      isOAuthEnabled: config.isOAuthEnabled ?? false, // Use the config value, which can be updated
      supportsOAuth: this.supportsOAuth(),
      oauthProvider: config.oauthProvider,
    };

    this.authResolver = new AuthPrecedenceResolver(
      precedenceConfig,
      config.oauthManager,
      this.baseSettingsService,
    );
  }

  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P05
   * @requirement REQ-SP-001
   * @pseudocode provider-invocation.md lines 8-15
   */
  setRuntimeSettingsService(
    settingsService: SettingsService | null | undefined,
  ): void {
    if (!settingsService) {
      return;
    }
    this.baseSettingsService = settingsService;
    if (!this.activeSettingsOverride) {
      this.authResolver.setSettingsService(this.baseSettingsService);
    }
  }

  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P05
   * @requirement REQ-SP-001
   * @pseudocode provider-invocation.md lines 8-15
   */
  protected resolveSettingsService(): SettingsService {
    return this.activeSettingsOverride ?? this.baseSettingsService;
  }

  /**
   * Set throttle tracking callback (used by LoggingProviderWrapper)
   */
  setThrottleTracker(tracker: (waitTimeMs: number) => void): void {
    this.throttleTracker = tracker;
    // Debug logging to verify tracker is being set
    const logger = new DebugLogger('llxprt:provider:base');
    logger.debug(() => `Throttle tracker set for provider`);
  }

  /**
   * Gets the base URL with proper precedence:
   * 1. Ephemeral settings (highest priority - from /baseurl or profile)
   * 2. Provider-specific settings in SettingsService
   * 3. Provider config (from IProviderConfig)
   * 4. Base provider config (initial constructor value)
   * 5. undefined (use provider default)
   */
  protected getBaseURL(): string | undefined {
    const settingsService = this.resolveSettingsService();

    // 1. Check ephemeral settings first (from /baseurl command or profile)
    const ephemeralBaseUrl = settingsService.get('base-url') as
      | string
      | undefined;
    if (ephemeralBaseUrl && ephemeralBaseUrl !== 'none') {
      return ephemeralBaseUrl;
    }

    // 2. Check provider-specific settings
    const providerSettings = settingsService.getProviderSettings(this.name);
    const providerBaseUrl = providerSettings?.baseUrl as string | undefined;
    if (providerBaseUrl && providerBaseUrl !== 'none') {
      return providerBaseUrl;
    }

    // 2. Check provider config (from IProviderConfig)
    if (this.providerConfig?.baseUrl) {
      return this.providerConfig.baseUrl;
    }

    // 3. Check base provider config (constructor value)
    if (this.baseProviderConfig.baseURL) {
      return this.baseProviderConfig.baseURL;
    }

    // 4. Return undefined to use provider's default
    return undefined;
  }

  /**
   * Gets the current model with proper precedence:
   * 1. Ephemeral settings (highest priority)
   * 2. Provider-specific settings in SettingsService
   * 3. Provider config
   * 4. Default model
   */
  protected getModel(): string {
    const settingsService = this.resolveSettingsService();

    // 1. Check ephemeral settings first
    const ephemeralModel = settingsService.get('model') as string | undefined;
    if (ephemeralModel) {
      return ephemeralModel;
    }

    // 2. Check provider-specific settings
    const providerSettings = settingsService.getProviderSettings(this.name);
    const providerModel = providerSettings?.model as string | undefined;
    if (providerModel) {
      return providerModel;
    }

    // 3. Check provider config
    if (this.providerConfig?.defaultModel) {
      return this.providerConfig.defaultModel;
    }

    // 4. Return default
    return this.getDefaultModel();
  }

  /**
   * Gets authentication token using the precedence chain
   * This method implements lazy OAuth triggering - only triggers OAuth when actually making API calls
   * Returns empty string if no auth is available (for local/self-hosted endpoints)
   */
  protected async getAuthToken(): Promise<string> {
    // Check cache first (short-lived cache to avoid repeated OAuth calls)
    if (
      this.cachedAuthToken &&
      this.authCacheTimestamp &&
      Date.now() - this.authCacheTimestamp < this.AUTH_CACHE_DURATION
    ) {
      return this.cachedAuthToken;
    }

    // Clear stale cache
    this.cachedAuthToken = undefined;
    this.authCacheTimestamp = undefined;

    // Resolve authentication using precedence chain
    const token = await this.authResolver.resolveAuthentication();

    if (!token) {
      // Return empty string for local/self-hosted endpoints that don't require auth
      // Individual providers can decide how to handle this
      return '';
    }

    // Cache the token briefly
    this.cachedAuthToken = token;
    this.authCacheTimestamp = Date.now();

    if (process.env.DEBUG) {
      const authMethod = await this.authResolver.getAuthMethodName();
      console.log(
        `[${this.name}] Authentication resolved using: ${authMethod}`,
      );
    }

    return token;
  }

  /**
   * Checks if OAuth is enabled for this provider
   */
  protected isOAuthEnabled(): boolean {
    // OAuth is enabled if we have a manager AND it's enabled for this provider
    if (this.baseProviderConfig.oauthManager) {
      // First check the manager's state (which reads from settings)
      const manager = this.baseProviderConfig.oauthManager as OAuthManager & {
        isOAuthEnabled?(provider: string): boolean;
      };
      if (
        manager.isOAuthEnabled &&
        typeof manager.isOAuthEnabled === 'function'
      ) {
        const oauthProvider =
          this.baseProviderConfig.oauthProvider || this.name;
        return manager.isOAuthEnabled(oauthProvider);
      }
      // Fall back to local config
      return this.baseProviderConfig.isOAuthEnabled === true;
    }
    return false;
  }

  /**
   * Abstract method to determine if this provider supports OAuth
   * Must be implemented by concrete providers
   */
  protected abstract supportsOAuth(): boolean;

  /**
   * Checks if authentication is available without triggering OAuth
   */
  async hasNonOAuthAuthentication(): Promise<boolean> {
    return this.authResolver.hasNonOAuthAuthentication();
  }

  /**
   * Checks if OAuth is the only available authentication method
   */
  async isOAuthOnlyAvailable(): Promise<boolean> {
    return this.authResolver.isOAuthOnlyAvailable();
  }

  /**
   * Gets the current authentication method name for debugging
   */
  async getAuthMethodName(): Promise<string | null> {
    return this.authResolver.getAuthMethodName();
  }

  /**
   * Clears authentication (used when removing keys/keyfiles)
   */
  clearAuth?(): void {
    const settingsService = this.resolveSettingsService();
    settingsService.set('auth-key', undefined);
    settingsService.set('auth-keyfile', undefined);
    this.clearAuthCache();
  }

  /**
   * Updates OAuth configuration
   */
  protected updateOAuthConfig(
    isEnabled: boolean,
    provider?: string,
    manager?: OAuthManager,
  ): void {
    this.baseProviderConfig.isOAuthEnabled = isEnabled;
    this.baseProviderConfig.oauthProvider = provider;
    this.baseProviderConfig.oauthManager = manager;

    this.authResolver.updateConfig({
      isOAuthEnabled: isEnabled,
      supportsOAuth: this.supportsOAuth(),
      oauthProvider: provider,
    });

    if (manager) {
      this.authResolver.updateOAuthManager(manager);
    }

    this.clearAuthCache();
  }

  /**
   * Clears the authentication token cache
   */
  clearAuthCache(): void {
    this.cachedAuthToken = undefined;
    this.authCacheTimestamp = undefined;
  }

  /**
   * Checks if the provider is authenticated using any available method
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const token = await this.authResolver.resolveAuthentication();
      return token !== null;
    } catch {
      return false;
    }
  }

  abstract getModels(): Promise<IModel[]>;
  abstract getDefaultModel(): string;

  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P04
   * @requirement REQ-SP-001
   * @pseudocode base-provider.md lines 4-15
   */
  generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(
    contents: IContent[],
    tools?: ProviderToolset,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(
    contentsOrOptions: IContent[] | GenerateChatOptions,
    maybeTools?: ProviderToolset,
  ): AsyncIterableIterator<IContent> {
    const normalized = this.normalizeGenerateChatOptions(
      contentsOrOptions,
      maybeTools,
    );
    /**
     * @plan PLAN-20250218-STATELESSPROVIDER.P05
     * @requirement REQ-SP-001
     * @pseudocode provider-invocation.md lines 8-15
     */
    const previousSettingsOverride = this.activeSettingsOverride;
    this.activeSettingsOverride = normalized.settings;
    this.authResolver.setSettingsService(normalized.settings);

    const previousContext = peekActiveProviderRuntimeContext();
    const configBeforeCall = this.globalConfig;

    const needsContextSwap =
      !previousContext ||
      previousContext.settingsService !== normalized.settings ||
      (normalized.config && previousContext.config !== normalized.config);

    const runtimeContext: ProviderRuntimeContext = normalized.runtime
      ? {
          ...normalized.runtime,
          settingsService: normalized.settings,
          config: normalized.config ?? normalized.runtime.config,
        }
      : {
          settingsService: normalized.settings,
          config: normalized.config ?? previousContext?.config,
          runtimeId:
            previousContext?.runtimeId ?? 'base-provider.normalized-call',
          metadata: {
            ...(previousContext?.metadata ?? {}),
            source: 'BaseProvider.generateChatCompletion',
          },
        };

    const invoke = async function* (
      this: BaseProvider,
    ): AsyncIterableIterator<IContent> {
      if (needsContextSwap) {
        setActiveProviderRuntimeContext(runtimeContext);
      }

      if (normalized.config) {
        this.globalConfig = normalized.config;
      }

      try {
        const iterator = this.generateChatCompletionWithOptions(normalized);
        for await (const chunk of iterator) {
          yield chunk;
        }
      } finally {
        this.globalConfig = configBeforeCall;
        this.activeSettingsOverride = previousSettingsOverride;
        const resolverReset =
          previousSettingsOverride ?? this.baseSettingsService;
        this.authResolver.setSettingsService(resolverReset);
        if (needsContextSwap) {
          setActiveProviderRuntimeContext(previousContext ?? null);
        }
      }
    };

    return invoke.call(this);
  }

  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P04
   * @requirement REQ-SP-001
   * @pseudocode base-provider.md lines 7-15
   */
  protected abstract generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent>;

  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P05
   * @requirement REQ-SP-001
   * @pseudocode provider-invocation.md lines 8-15
   */
  private normalizeGenerateChatOptions(
    contentsOrOptions: IContent[] | GenerateChatOptions,
    maybeTools?: ProviderToolset,
  ): NormalizedGenerateChatOptions {
    const providedOptions: GenerateChatOptions = Array.isArray(
      contentsOrOptions,
    )
      ? { contents: contentsOrOptions, tools: maybeTools }
      : contentsOrOptions;

    const runtimeCandidate =
      providedOptions.runtime ??
      peekActiveProviderRuntimeContext() ??
      undefined;

    const settings =
      providedOptions.settings ??
      runtimeCandidate?.settingsService ??
      this.baseSettingsService;

    const config =
      providedOptions.config ?? runtimeCandidate?.config ?? this.globalConfig;

    const runtime: ProviderRuntimeContext | undefined = providedOptions.runtime
      ? {
          ...providedOptions.runtime,
          settingsService: settings,
          config: config ?? providedOptions.runtime.config,
        }
      : runtimeCandidate
        ? {
            ...runtimeCandidate,
            settingsService: settings,
            config: config ?? runtimeCandidate.config,
          }
        : undefined;

    return {
      ...providedOptions,
      contents: providedOptions.contents,
      tools: providedOptions.tools ?? maybeTools,
      settings,
      config,
      runtime,
    };
  }

  // Optional methods with default implementations
  getCurrentModel?(): string {
    // Use the same logic as getModel() to check ephemeral settings
    return this.getModel();
  }
  getToolFormat?(): string {
    return 'default';
  }
  isPaidMode?(): boolean {
    return false;
  }
  clearState?(): void {
    this.clearAuthCache();
  }
  setConfig?(config: unknown): void {
    if (!config || typeof config !== 'object') {
      return;
    }

    const maybeConfig = config as {
      getUserMemory?: () => string;
      getModel?: () => string;
    };

    if (
      typeof maybeConfig.getUserMemory === 'function' &&
      typeof maybeConfig.getModel === 'function'
    ) {
      this.globalConfig = config as Config;
      return;
    }

    this.providerConfig = config as IProviderConfig;
  }
  getServerTools(): string[] {
    return [];
  }
  async invokeServerTool(
    toolName: string,
    _params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    throw new Error(
      `Server tool '${toolName}' not supported by ${this.name} provider`,
    );
  }
  getModelParams?(): Record<string, unknown> | undefined {
    return undefined;
  }

  /**
   * Get setting value from SettingsService
   */
  protected async getProviderSetting<T>(
    key: keyof ProviderSettings,
    fallback?: T,
  ): Promise<T | undefined> {
    const settingsService = this.resolveSettingsService();

    try {
      const settings = await settingsService.getSettings(this.name);
      return (settings[key] as T) || fallback;
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(
          `Failed to get ${key} from SettingsService for ${this.name}:`,
          error,
        );
      }
      return fallback;
    }
  }

  /**
   * Set setting value in SettingsService
   */
  protected async setProviderSetting<T>(
    key: keyof ProviderSettings,
    value: T,
  ): Promise<void> {
    const settingsService = this.resolveSettingsService();

    try {
      await settingsService.updateSettings(this.name, {
        [key]: value,
      });
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(
          `Failed to set ${key} in SettingsService for ${this.name}:`,
          error,
        );
      }
    }
  }

  /**
   * Get API key from SettingsService if available
   */
  protected async getApiKeyFromSettings(): Promise<string | undefined> {
    return this.getProviderSetting('apiKey');
  }

  /**
   * Set API key in SettingsService if available
   */
  protected async setApiKeyInSettings(apiKey: string): Promise<void> {
    await this.setProviderSetting('apiKey', apiKey);
  }

  /**
   * Get model from SettingsService if available
   */
  protected async getModelFromSettings(): Promise<string | undefined> {
    return this.getProviderSetting('model');
  }

  /**
   * Set model in SettingsService if available
   */
  protected async setModelInSettings(model: string): Promise<void> {
    await this.setProviderSetting('model', model);
  }

  /**
   * Get base URL from SettingsService if available
   */
  protected async getBaseUrlFromSettings(): Promise<string | undefined> {
    return this.getProviderSetting('baseUrl');
  }

  /**
   * Set base URL in SettingsService if available
   */
  protected async setBaseUrlInSettings(baseUrl?: string): Promise<void> {
    await this.setProviderSetting('baseUrl', baseUrl);
  }

  /**
   * Get model parameters from SettingsService
   */
  protected async getModelParamsFromSettings(): Promise<
    Record<string, unknown> | undefined
  > {
    const settingsService = this.resolveSettingsService();

    try {
      const settings = await settingsService.getSettings(this.name);

      // Extract model parameters from settings, excluding standard fields
      const {
        enabled: _enabled,
        apiKey: _apiKey,
        baseUrl: _baseUrl,
        model: _model,
        maxTokens,
        temperature,
        ...modelParams
      } = settings;

      // Include temperature and maxTokens as model params if they exist
      const params: Record<string, unknown> = {};
      if (temperature !== undefined) params.temperature = temperature;
      if (maxTokens !== undefined) params.max_tokens = maxTokens;

      return Object.keys(params).length > 0 ||
        Object.keys(modelParams).length > 0
        ? { ...params, ...modelParams }
        : undefined;
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(
          `Failed to get model params from SettingsService for ${this.name}:`,
          error,
        );
      }
      return undefined;
    }
  }

  /**
   * Set model parameters in SettingsService
   */
  protected async setModelParamsInSettings(
    params: Record<string, unknown> | undefined,
  ): Promise<void> {
    const settingsService = this.resolveSettingsService();

    try {
      if (params === undefined) {
        // Clear model parameters by setting them to undefined
        await settingsService.updateSettings(this.name, {
          temperature: undefined,
          maxTokens: undefined,
        });
        return;
      }

      // Convert standard model params to settings format
      const updates: Record<string, unknown> = {};
      if ('temperature' in params) updates.temperature = params.temperature;
      if ('max_tokens' in params) updates.maxTokens = params.max_tokens;
      if ('maxTokens' in params) updates.maxTokens = params.maxTokens;

      // Store other parameters as custom fields
      for (const [key, value] of Object.entries(params)) {
        if (!['temperature', 'max_tokens', 'maxTokens'].includes(key)) {
          updates[key] = value;
        }
      }

      if (Object.keys(updates).length > 0) {
        await settingsService.updateSettings(this.name, updates);
      }
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(
          `Failed to set model params in SettingsService for ${this.name}:`,
          error,
        );
      }
    }
  }
}

// Import ProviderSettings type to avoid circular dependency
interface ProviderSettings {
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  [key: string]: unknown;
}
