/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Base provider class with authentication precedence logic
 */

import { IProvider } from './IProvider.js';
import { IModel } from './IModel.js';
import { IContent } from '../services/history/IContent.js';
import { DebugLogger } from '../debug/index.js';
import {
  AuthPrecedenceResolver,
  AuthPrecedenceConfig,
  OAuthManager,
} from '../auth/precedence.js';
import { getSettingsService } from '../settings/settingsServiceInstance.js';
import type { Config } from '../config/config.js';
import { IProviderConfig } from './types/IProviderConfig.js';

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

  // Callback for tracking throttle wait times (set by LoggingProviderWrapper)
  protected throttleTracker?: (waitTimeMs: number) => void;

  constructor(
    config: BaseProviderConfig,
    providerConfig?: IProviderConfig,
    globalConfig?: Config,
  ) {
    this.name = config.name;
    this.baseProviderConfig = config;
    this.providerConfig = providerConfig;
    this.globalConfig = globalConfig;

    // If an initial apiKey is provided, store it in SettingsService
    // Only store non-empty API keys to ensure proper precedence fallback
    if (config.apiKey && config.apiKey.trim() !== '') {
      const settingsService = getSettingsService();
      settingsService.set('auth-key', config.apiKey);
    }

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
    );
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
   * 2. Provider config (from IProviderConfig)
   * 3. Base provider config (initial constructor value)
   * 4. undefined (use provider default)
   */
  protected getBaseURL(): string | undefined {
    const settingsService = getSettingsService();

    // 1. Check ephemeral settings first (from /baseurl command or profile)
    const ephemeralBaseUrl = settingsService.get('base-url') as
      | string
      | undefined;
    if (ephemeralBaseUrl && ephemeralBaseUrl !== 'none') {
      return ephemeralBaseUrl;
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
    const settingsService = getSettingsService();

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
   * Updates the API key (used for CLI --key argument and other sources)
   */
  setApiKey(apiKey: string): void {
    const settingsService = getSettingsService();

    // CRITICAL FIX: When clearing the key, set to undefined instead of empty string
    // This ensures the precedence chain properly skips this level
    if (!apiKey || apiKey.trim() === '') {
      settingsService.set('auth-key', undefined);
    } else {
      settingsService.set('auth-key', apiKey);
    }

    this.clearAuthCache();
  }

  /**
   * Clears authentication (used when removing keys/keyfiles)
   */
  clearAuth?(): void {
    const settingsService = getSettingsService();
    settingsService.set('auth-key', undefined);
    settingsService.set('auth-keyfile', undefined);
    this.clearAuthCache();
  }

  /**
   * Updates the base URL in ephemeral settings
   */
  setBaseUrl?(baseUrl?: string): void {
    const settingsService = getSettingsService();

    // Store in ephemeral settings as the highest priority source
    if (!baseUrl || baseUrl.trim() === '' || baseUrl === 'none') {
      // Clear the ephemeral setting
      settingsService.set('base-url', undefined);
    } else {
      settingsService.set('base-url', baseUrl);
    }

    // Clear auth cache as base URL change might affect auth
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

  abstract generateChatCompletion(
    content: IContent[],
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parameters?: unknown;
      }>;
    }>,
    signal?: AbortSignal,
  ): AsyncIterableIterator<IContent>;

  // Optional methods with default implementations
  setModel?(_modelId: string): void {}
  getCurrentModel?(): string {
    // Use the same logic as getModel() to check ephemeral settings
    return this.getModel();
  }
  getToolFormat?(): string {
    return 'default';
  }
  setToolFormatOverride?(_format: string | null): void {}
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
    _signal?: AbortSignal,
  ): Promise<unknown> {
    throw new Error(
      `Server tool '${toolName}' not supported by ${this.name} provider`,
    );
  }
  setModelParams?(_params: Record<string, unknown> | undefined): void {}
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
    const settingsService = getSettingsService();

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
    const settingsService = getSettingsService();

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
    const settingsService = getSettingsService();

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
    const settingsService = getSettingsService();

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

  /**
   * Get custom headers from provider configuration and ephemeral settings
   */
  protected getCustomHeaders(): Record<string, string> | undefined {
    const baseHeaders =
      this.providerConfig?.customHeaders &&
      typeof this.providerConfig.customHeaders === 'object'
        ? { ...this.providerConfig.customHeaders }
        : undefined;

    const ephemeralSettings = this.providerConfig?.getEphemeralSettings?.();
    const ephemeralValue =
      ephemeralSettings && typeof ephemeralSettings === 'object'
        ? (ephemeralSettings['custom-headers'] as
            | Record<string, string>
            | undefined)
        : undefined;

    const combined = {
      ...(baseHeaders ?? {}),
      ...(ephemeralValue ?? {}),
    };

    return Object.keys(combined).length > 0 ? combined : undefined;
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
