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
import {
  AuthPrecedenceResolver,
  AuthPrecedenceConfig,
  OAuthManager,
} from '../auth/precedence.js';
import { getSettingsService } from '../settings/settingsServiceInstance.js';
import { UnauthorizedError } from '../utils/errors.js';
import { Config } from '../config/config.js';
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
  private cachedAuthToken?: string;
  private authCacheTimestamp?: number;
  private readonly AUTH_CACHE_DURATION = 60000; // 1 minute in milliseconds

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
    if (config.apiKey) {
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
   * Gets authentication token using the precedence chain
   * This method implements lazy OAuth triggering - only triggers OAuth when actually making API calls
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
      const isOAuthOnly = await this.authResolver.isOAuthOnlyAvailable();

      if (isOAuthOnly) {
        // Special message for Qwen explaining the OAuth limitation
        if (this.baseProviderConfig.oauthProvider === 'qwen') {
          throw new Error(
            `Qwen OAuth (chat.qwen.ai) doesn't provide API access to DashScope. ` +
              `You need a DashScope API key from https://dashscope.console.aliyun.com/ ` +
              `Use /key <your-api-key> to set it.`,
          );
        }
        throw new UnauthorizedError(
          `No API key found and OAuth is available but not authenticated for ${this.name} provider. ` +
            `Please authenticate using OAuth or provide an API key.`,
        );
      } else {
        throw new Error(
          `No authentication method available for ${this.name} provider`,
        );
      }
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
   * Updates the base URL
   */
  setBaseUrl?(baseUrl?: string): void {
    this.baseProviderConfig.baseURL = baseUrl;
    // Providers may override to implement endpoint-specific OAuth logic
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
  ): AsyncIterableIterator<IContent>;

  // Optional methods with default implementations
  setModel?(_modelId: string): void {}
  getCurrentModel?(): string {
    return 'default';
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
  setConfig?(config: IProviderConfig): void {
    this.providerConfig = config;
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
