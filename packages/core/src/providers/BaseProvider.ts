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
import { ITool } from './ITool.js';
import { IMessage } from './IMessage.js';
import {
  AuthPrecedenceResolver,
  AuthPrecedenceConfig,
  OAuthManager,
} from '../auth/precedence.js';

export interface BaseProviderConfig {
  // Basic provider config
  name: string;
  apiKey?: string;
  baseURL?: string;

  // Authentication precedence config
  commandKey?: string;
  commandKeyfile?: string;
  cliKey?: string;
  cliKeyfile?: string;
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
  private cachedAuthToken?: string;
  private authCacheTimestamp?: number;
  private readonly AUTH_CACHE_DURATION = 60000; // 1 minute in milliseconds

  constructor(config: BaseProviderConfig) {
    this.name = config.name;
    this.baseProviderConfig = config;

    // Initialize auth precedence resolver
    // OAuth enablement will be checked dynamically through the manager
    const precedenceConfig: AuthPrecedenceConfig = {
      commandKey: config.commandKey,
      commandKeyfile: config.commandKeyfile,
      cliKey: config.cliKey,
      cliKeyfile: config.cliKeyfile,
      envKeyNames: config.envKeyNames || [],
      isOAuthEnabled: true, // Always true if manager exists, manager will check settings
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
        throw new Error(
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
    // OAuth is enabled if we have a manager AND it's enabled in settings
    return !!this.baseProviderConfig.oauthManager;
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
   * Updates the API key (used for CLI --key argument)
   */
  setApiKey?(apiKey: string): void {
    this.baseProviderConfig.cliKey = apiKey;
    this.authResolver.updateConfig({ cliKey: apiKey });
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
  protected clearAuthCache(): void {
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

  // Abstract methods that must be implemented by concrete providers
  abstract getModels(): Promise<IModel[]>;
  abstract generateChatCompletion(
    messages: IMessage[],
    tools?: ITool[],
    toolFormat?: string,
  ): AsyncIterableIterator<unknown>;

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
  setConfig?(_config: unknown): void {}
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
}
