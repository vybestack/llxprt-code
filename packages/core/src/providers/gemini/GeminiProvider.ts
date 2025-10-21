/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { DebugLogger } from '../../debug/index.js';
import { IModel } from '../IModel.js';
import {
  IContent,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '../../services/history/IContent.js';
import { Config } from '../../config/config.js';
import { AuthType } from '../../core/contentGenerator.js';
import { AuthenticationRequiredError } from '../errors.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import {
  Type,
  type Part,
  type FunctionCall,
  type Schema,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from '@google/genai';
import {
  BaseProvider,
  BaseProviderConfig,
  NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { OAuthManager } from '../../auth/precedence.js';

type GeminiClientCacheEntry =
  | {
      kind: 'api';
      client: unknown;
      authMode: 'gemini-api-key' | 'vertex-ai';
    }
  | {
      kind: 'oauth';
      generator: CodeAssistContentGenerator;
    };

const runtimeClientCache = new Map<string, GeminiClientCacheEntry>();
const runtimeClientKeyIndex = new Map<string, Set<string>>();
const defaultRuntimeKey = 'gemini.runtime.unscoped';

function rememberClientKey(runtimeKey: string, cacheKey: string): void {
  let keys = runtimeClientKeyIndex.get(runtimeKey);
  if (!keys) {
    keys = new Set<string>();
    runtimeClientKeyIndex.set(runtimeKey, keys);
  }
  keys.add(cacheKey);
}

function forgetRuntimeKeys(runtimeKey: string): void {
  const keys = runtimeClientKeyIndex.get(runtimeKey);
  if (!keys) {
    return;
  }
  for (const key of keys) {
    runtimeClientCache.delete(key);
  }
  runtimeClientKeyIndex.delete(runtimeKey);
}

/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P12
 * @requirement REQ-003.1, REQ-003.2, REQ-003.3
 * @pseudocode lines 12-18, 21-26
 */

/**
 * Represents the default Gemini provider.
 * This provider is implicitly active when no other provider is explicitly set.
 *
 * NOTE: This provider acts as a configuration layer for the native Gemini integration.
 * It doesn't implement generateChatCompletion directly but instead configures the
 * system to use the native Gemini client with the appropriate authentication.
 */
type GeminiAuthMode = 'oauth' | 'gemini-api-key' | 'vertex-ai' | 'none';

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiResponseWithUsage {
  usageMetadata?: GeminiUsageMetadata;
}

type CodeAssistGeneratorFactory =
  (typeof import('../../code_assist/codeAssist.js'))['createCodeAssistContentGenerator'];
type CodeAssistContentGenerator = Awaited<
  ReturnType<CodeAssistGeneratorFactory>
>;

export class GeminiProvider extends BaseProvider {
  /**
   * @description Cleans a JSON Schema object to ensure it strictly conforms to the Gemini API's supported Schema definition.
   * This function acts as a whitelist, removing any properties not explicitly defined in the OpenAPI 3.03 Schema Object
   * as understood by the Gemini API. This is crucial for compatibility, as external SDKs might generate schemas
   * with unsupported keywords (e.g., `exclusiveMinimum`, `exclusiveMaximum`) which cause API errors.
   *
   * This approach aligns with how `gemini-cli` handles schema compatibility by relying on the `@google/genai` library's
   * internal cleaning mechanisms.
   *
   * @see https://ai.google.dev/api/caching#Schema
   * @param schema The JSON Schema object to clean.
   * @returns A new Schema object containing only supported properties.
   */
  private cleanGeminiSchema(schema: unknown): Schema {
    if (typeof schema !== 'object' || schema === null) {
      return schema as Schema;
    }

    const cleanedSchema: { [key: string]: unknown } = {};
    const typedSchema = schema as Record<string, unknown>;
    const supportedSchemaProperties: Array<keyof Schema> = [
      'type',
      'format',
      'title',
      'description',
      'nullable',
      'enum',
      'maxItems',
      'minItems',
      'properties',
      'required',
      'minProperties',
      'maxProperties',
      'minLength',
      'maxLength',
      'pattern',
      'example',
      'anyOf',
      'propertyOrdering',
      'default',
      'items',
      'minimum',
      'maximum',
    ];

    for (const key of supportedSchemaProperties) {
      if (Object.prototype.hasOwnProperty.call(schema, key)) {
        if (
          key === 'properties' &&
          typeof typedSchema[key] === 'object' &&
          typedSchema[key] !== null
        ) {
          // Recursively clean properties within 'properties'
          const cleanedProperties: { [key: string]: Schema } = {};
          const propertiesObject = typedSchema[key] as Record<string, unknown>;
          for (const propKey in propertiesObject) {
            cleanedProperties[propKey] = this.cleanGeminiSchema(
              propertiesObject[propKey],
            ) as Schema;
          }
          cleanedSchema[key] = cleanedProperties;
        } else if (key === 'items' && typeof typedSchema[key] === 'object') {
          // Recursively clean schema within 'items' for array types
          cleanedSchema[key] = this.cleanGeminiSchema(
            typedSchema[key],
          ) as Schema;
        } else if (key === 'anyOf' && Array.isArray(typedSchema[key])) {
          // Recursively clean schemas within 'anyOf'
          cleanedSchema[key] = (typedSchema[key] as unknown[]).map(
            (item: unknown) => this.cleanGeminiSchema(item),
          ) as Schema[];
        } else {
          cleanedSchema[key] = (schema as { [key: string]: unknown })[key];
        }
      }
    }
    return cleanedSchema as Schema;
  }

  private logger: DebugLogger;
  private authMode: GeminiAuthMode = 'none';
  private currentModel: string = 'gemini-2.5-pro';
  private modelExplicitlySet: boolean = false;
  private modelParams?: Record<string, unknown>;
  private geminiOAuthManager?: OAuthManager;

  constructor(
    apiKey?: string,
    baseURL?: string,
    config?: Config,
    oauthManager?: OAuthManager,
  ) {
    // Initialize base provider with auth configuration
    const baseConfig: BaseProviderConfig = {
      name: 'gemini',
      apiKey,
      baseURL,
      envKeyNames: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      isOAuthEnabled: false, // OAuth enablement will be checked dynamically
      oauthProvider: 'gemini',
      oauthManager, // Keep the manager for checking enablement
    };

    super(baseConfig, config, undefined);

    this.logger = new DebugLogger('llxprt:gemini:provider');
    this.geminiOAuthManager = oauthManager;

    // Do not determine auth mode on instantiation.
    // This will be done lazily when a chat completion is requested.
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P12
   * @requirement REQ-SP2-001
   * @pseudocode anthropic-gemini-stateless.md lines 1-2
   */
  private resolveRuntimeKey(options: NormalizedGenerateChatOptions): string {
    if (options.runtime?.runtimeId) {
      const runtimeId = options.runtime.runtimeId.trim();
      if (runtimeId) {
        return runtimeId;
      }
    }

    const metadataRuntimeId = options.metadata?.runtimeId;
    if (typeof metadataRuntimeId === 'string' && metadataRuntimeId.trim()) {
      return metadataRuntimeId.trim();
    }

    const callId = options.settings.get('call-id');
    if (typeof callId === 'string' && callId.trim()) {
      return `call:${callId.trim()}`;
    }

    return defaultRuntimeKey;
  }

  private normalizeBaseURL(baseURL?: string): string {
    if (!baseURL || baseURL.trim() === '') {
      return 'default-endpoint';
    }
    return baseURL.replace(/\/+$/, '');
  }

  private buildClientCacheKey(
    runtimeKey: string,
    baseURL: string | undefined,
    authToken: string,
    authMode: GeminiAuthMode,
  ): string {
    const normalizedBase = this.normalizeBaseURL(baseURL);
    const hashedToken =
      authToken && authToken.length > 0
        ? createHash('sha256').update(authToken).digest('hex')
        : 'no-auth';
    return `${runtimeKey}::${normalizedBase}::${authMode}::${hashedToken}`;
  }

  private getStreamingPreference(
    _options: NormalizedGenerateChatOptions,
  ): boolean {
    const streamingSetting =
      this.providerConfig?.getEphemeralSettings?.()?.['streaming'];
    return streamingSetting !== 'disabled';
  }

  protected async createOAuthContentGenerator(
    httpOptions: Record<string, unknown>,
    config: Config,
    baseURL?: string,
  ): Promise<CodeAssistContentGenerator> {
    const { createCodeAssistContentGenerator } = await import(
      '../../code_assist/codeAssist.js'
    );
    return createCodeAssistContentGenerator(
      httpOptions,
      AuthType.LOGIN_WITH_GOOGLE,
      config,
      baseURL,
    );
  }

  clearClientCache(runtimeKey?: string): void {
    if (runtimeKey && runtimeKey.trim()) {
      forgetRuntimeKeys(runtimeKey.trim());
      return;
    }
    runtimeClientCache.clear();
    runtimeClientKeyIndex.clear();
  }

  /**
   * Updates OAuth configuration based on current OAuth manager state
   */
  private updateOAuthState(): void {
    if (this.geminiOAuthManager) {
      const manager = this.geminiOAuthManager as OAuthManager & {
        isOAuthEnabled?(provider: string): boolean;
      };
      if (
        manager.isOAuthEnabled &&
        typeof manager.isOAuthEnabled === 'function'
      ) {
        const isEnabled = manager.isOAuthEnabled('gemini');
        // Update the OAuth configuration
        this.updateOAuthConfig(isEnabled, 'gemini', this.geminiOAuthManager);
      }
    }
  }

  /**
   * Determines the best available authentication method based on environment variables
   * and existing configuration. Now uses lazy evaluation with proper precedence chain.
   */
  private async determineBestAuth(): Promise<string> {
    // Re-check OAuth enablement state before determining auth
    this.updateOAuthState();

    // First check if we have Gemini-specific credentials
    if (this.hasVertexAICredentials()) {
      this.authMode = 'vertex-ai';
      this.setupVertexAIAuth();
      return 'USE_VERTEX_AI';
    }

    if (this.hasGeminiAPIKey()) {
      this.authMode = 'gemini-api-key';
      return process.env.GEMINI_API_KEY!;
    }

    // No Gemini-specific credentials, check OAuth availability
    try {
      const token = await this.getAuthToken();
      const authMethodName = await this.getAuthMethodName();

      // Check if OAuth is configured for Gemini
      const manager = this.geminiOAuthManager as OAuthManager & {
        isOAuthEnabled?(provider: string): boolean;
      };
      const isOAuthEnabled =
        manager?.isOAuthEnabled &&
        typeof manager.isOAuthEnabled === 'function' &&
        manager.isOAuthEnabled('gemini');

      if (
        isOAuthEnabled &&
        (authMethodName?.startsWith('oauth-') ||
          (this.geminiOAuthManager && !token))
      ) {
        this.authMode = 'oauth';
        return 'USE_LOGIN_WITH_GOOGLE';
      }

      // If we have a token but it's not for Gemini (e.g., from another provider),
      // we should still fall back to OAuth for Gemini web search - BUT ONLY IF OAUTH IS ENABLED
      if (!this.hasGeminiAPIKey() && !this.hasVertexAICredentials()) {
        if (isOAuthEnabled) {
          this.authMode = 'oauth';
          return 'USE_LOGIN_WITH_GOOGLE';
        } else {
          // OAuth is disabled and no other auth method available
          throw new AuthenticationRequiredError(
            'Web search requires Gemini authentication, but no API key is set and OAuth is disabled. Hint: call /auth gemini enable',
            'none',
            ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
          );
        }
      }

      this.authMode = 'none';
      return token || '';
    } catch (error) {
      // CRITICAL FIX: Only fall back to LOGIN_WITH_GOOGLE if OAuth is actually enabled
      // Don't use it when OAuth has been disabled
      const manager = this.geminiOAuthManager as OAuthManager & {
        isOAuthEnabled?(provider: string): boolean;
      };
      const isOAuthEnabled =
        this.geminiOAuthManager &&
        manager.isOAuthEnabled &&
        typeof manager.isOAuthEnabled === 'function' &&
        manager.isOAuthEnabled('gemini');

      if (isOAuthEnabled) {
        this.authMode = 'oauth';
        return 'USE_LOGIN_WITH_GOOGLE';
      }

      // Handle case where no auth is available
      const authType = this.globalConfig?.getContentGeneratorConfig()?.authType;
      if (authType === AuthType.USE_NONE) {
        this.authMode = 'none';
        throw new AuthenticationRequiredError(
          'Authentication is set to USE_NONE but no credentials are available',
          this.authMode,
          ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        );
      }

      // When used as serverToolsProvider without API key, fall back to OAuth ONLY if enabled
      // This handles the case where Gemini is used for server tools but not as main provider
      if (!this.hasGeminiAPIKey() && !this.hasVertexAICredentials()) {
        if (isOAuthEnabled) {
          this.authMode = 'oauth';
          return 'USE_LOGIN_WITH_GOOGLE';
        } else {
          // OAuth is disabled and no other auth method available
          throw new AuthenticationRequiredError(
            'Web search requires Gemini authentication, but no API key is set and OAuth is disabled. Hint: call /auth gemini enable',
            'none',
            ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
          );
        }
      }

      throw error;
    }
  }

  /**
   * Implementation of BaseProvider abstract method
   * Determines if this provider supports OAuth authentication
   */
  protected supportsOAuth(): boolean {
    // Check if OAuth is actually enabled for Gemini in the OAuth manager
    const manager = this.geminiOAuthManager as OAuthManager & {
      isOAuthEnabled?(provider: string): boolean;
    };

    if (
      manager?.isOAuthEnabled &&
      typeof manager.isOAuthEnabled === 'function'
    ) {
      return manager.isOAuthEnabled('gemini');
    }

    // Default to false if OAuth manager is not available
    // This ensures we don't fall back to LOGIN_WITH_GOOGLE when OAuth is disabled
    return false;
  }

  /**
   * Checks if Vertex AI credentials are available
   */
  private hasVertexAICredentials(): boolean {
    const hasProjectAndLocation =
      !!process.env.GOOGLE_CLOUD_PROJECT && !!process.env.GOOGLE_CLOUD_LOCATION;
    const hasGoogleApiKey = !!process.env.GOOGLE_API_KEY;
    return hasProjectAndLocation || hasGoogleApiKey;
  }

  /**
   * Checks if Gemini API key is available
   */
  private hasGeminiAPIKey(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }

  /**
   * Sets up environment variables for Vertex AI authentication
   */
  private setupVertexAIAuth(): void {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
    // Other Vertex AI env vars are already set, no need to duplicate
  }

  /**
   * Sets the config instance for reading OAuth credentials
   */
  override setConfig(config: Config): void {
    this.refreshCachedSettings();

    // Sync with config model if user hasn't explicitly set a model
    // This ensures consistency between config and provider state
    const configModel = config.getModel();

    if (!this.modelExplicitlySet && configModel) {
      this.currentModel = configModel;
    }

    // Update OAuth configuration based on OAuth manager state, not config authType
    // This ensures that if OAuth is disabled via /auth gemini disable, it stays disabled
    this.updateOAuthState();

    // Clear auth cache when config changes to allow re-determination
  }

  async getModels(): Promise<IModel[]> {
    // For OAuth mode, return fixed list of models
    if (this.authMode === 'oauth') {
      return [
        {
          id: 'gemini-2.5-pro',
          name: 'Gemini 2.5 Pro',
          provider: this.name,
          supportedToolFormats: [],
        },
        {
          id: 'gemini-2.5-flash',
          name: 'Gemini 2.5 Flash',
          provider: this.name,
          supportedToolFormats: [],
        },
        {
          id: 'gemini-2.5-flash-lite',
          name: 'Gemini 2.5 Flash Lite',
          provider: this.name,
          supportedToolFormats: [],
        },
      ];
    }

    // For API key modes (gemini-api-key or vertex-ai), try to fetch real models
    if (this.authMode === 'gemini-api-key' || this.authMode === 'vertex-ai') {
      const apiKey = (await this.getAuthToken()) || process.env.GEMINI_API_KEY;
      if (apiKey) {
        try {
          const baseURL = this.getBaseURL();
          const url = baseURL
            ? `${baseURL.replace(/\/$/, '')}/v1beta/models?key=${apiKey}`
            : `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          if (response.ok) {
            const data = (await response.json()) as {
              models?: Array<{
                name: string;
                displayName?: string;
                description?: string;
              }>;
            };

            if (data.models && data.models.length > 0) {
              return data.models.map((model) => ({
                id: model.name.replace('models/', ''), // Remove 'models/' prefix
                name: model.displayName || model.name,
                provider: this.name,
                supportedToolFormats: [],
              }));
            }
          }
        } catch (_error) {
          // Fall through to default models
        }
      }
    }

    // Return default models as fallback
    return [
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: this.name,
        supportedToolFormats: [],
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: this.name,
        supportedToolFormats: [],
      },
      {
        id: 'gemini-2.5-flash-exp',
        name: 'Gemini 2.5 Flash Experimental',
        provider: this.name,
        supportedToolFormats: [],
      },
    ];
  }

  /**
   * Gets the current authentication mode
   */
  getAuthMode(): GeminiAuthMode {
    return this.authMode;
  }

  /**
   * Gets the appropriate AuthType for the core library
   */
  getCoreAuthType(): AuthType {
    switch (this.authMode) {
      case 'oauth':
        return AuthType.LOGIN_WITH_GOOGLE;
      case 'gemini-api-key':
        return AuthType.USE_GEMINI;
      case 'vertex-ai':
        return AuthType.USE_VERTEX_AI;
      default:
        return AuthType.LOGIN_WITH_GOOGLE; // Default to OAuth
    }
  }

  private refreshCachedSettings(): void {
    try {
      const settingsService = this.resolveSettingsService();
      const providerSettings = settingsService.getProviderSettings(this.name);

      const modelSetting = providerSettings?.model;
      if (typeof modelSetting === 'string' && modelSetting.trim() !== '') {
        this.currentModel = modelSetting;
        this.modelExplicitlySet = true;
      } else {
        this.modelExplicitlySet = false;
      }

      const reservedKeys = new Set([
        'enabled',
        'apiKey',
        'api-key',
        'apiKeyfile',
        'api-keyfile',
        'baseUrl',
        'base-url',
        'model',
        'toolFormat',
        'tool-format',
        'toolFormatOverride',
        'tool-format-override',
        'defaultModel',
      ]);

      const params: Record<string, unknown> = {};
      if (providerSettings) {
        for (const [key, value] of Object.entries(providerSettings)) {
          if (reservedKeys.has(key) || value === undefined || value === null) {
            continue;
          }
          params[key] = value;
        }
      }

      this.modelParams = Object.keys(params).length > 0 ? params : undefined;
    } catch (error) {
      this.logger.debug(
        () =>
          `Failed to refresh Gemini provider settings from SettingsService: ${error}`,
      );
    }
  }

  /**
   * Gets the current model ID
   */
  override getCurrentModel(): string {
    this.refreshCachedSettings();

    // Try to get from SettingsService first (source of truth)
    try {
      const settingsService = this.resolveSettingsService();
      const providerSettings = settingsService.getProviderSettings(this.name);
      if (providerSettings.model) {
        return providerSettings.model as string;
      }
    } catch (error) {
      this.logger.debug(
        () => `Failed to get model from SettingsService: ${error}`,
      );
    }
    // Fall back to cached value or default
    return this.currentModel || this.getDefaultModel();
  }

  /**
   * Gets the default model for Gemini
   */
  override getDefaultModel(): string {
    return 'gemini-2.5-pro';
  }

  /**
   * Gets the current model parameters
   */
  override getModelParams(): Record<string, unknown> | undefined {
    this.refreshCachedSettings();
    return this.modelParams;
  }

  /**
   * Checks if the current auth mode requires payment
   */
  override isPaidMode(): boolean {
    return this.authMode === 'gemini-api-key' || this.authMode === 'vertex-ai';
  }

  /**
   * Clears provider state but preserves explicitly set model
   */
  override clearState(): void {
    // Clear auth-related state
    this.authMode = 'none';
    // Only reset model if it wasn't explicitly set by user
    if (!this.modelExplicitlySet) {
      this.currentModel = 'gemini-2.5-pro';
    }
    // Note: We don't clear config or apiKey as they might be needed

    // Clear auth cache
    this.clearAuthCache();
  }

  /**
   * Clear all authentication including environment variable
   */
  override clearAuth(): void {
    // Call base implementation to clear SettingsService
    super.clearAuth?.();
    // CRITICAL: Also clear the environment variable that setApiKey sets
    delete process.env.GEMINI_API_KEY;
  }

  /**
   * Forces re-determination of auth method
   */
  override clearAuthCache(): void {
    // Call the base implementation to clear the cached token
    super.clearAuthCache();
    this.clearClientCache();
    // Don't clear the auth mode itself, just allow re-determination next time
  }

  /**
   * Get the list of server tools supported by this provider
   */
  override getServerTools(): string[] {
    return ['web_search', 'web_fetch'];
  }

  /**
   * Invoke a server tool (native provider tool)
   */
  override async invokeServerTool(
    toolName: string,
    params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    if (toolName === 'web_search') {
      this.logger.debug(
        () =>
          `invokeServerTool: web_search called with params: ${JSON.stringify(params)}`,
      );
      this.logger.debug(
        () =>
          `invokeServerTool: globalConfig is ${this.globalConfig ? 'set' : 'null/undefined'}`,
      );
      this.logger.debug(
        () => `invokeServerTool: current authMode is ${this.authMode}`,
      );

      // Import the necessary modules dynamically
      const { GoogleGenAI } = await import('@google/genai');

      // Create the appropriate client based on auth mode
      const httpOptions = {
        headers: {
          'User-Agent': `LLxprt-Code/${process.env.CLI_VERSION || process.version} (${process.platform}; ${process.arch})`,
        },
      };

      let genAI: InstanceType<typeof GoogleGenAI>;

      // Get authentication token lazily
      this.logger.debug(
        () => `invokeServerTool: about to call determineBestAuth()`,
      );
      const authToken = await this.determineBestAuth();
      this.logger.debug(
        () =>
          `invokeServerTool: determineBestAuth returned, authMode is now ${this.authMode}`,
      );

      // Re-evaluate auth mode if we got a signal to use OAuth
      if (authToken === 'USE_LOGIN_WITH_GOOGLE') {
        this.authMode = 'oauth';
      }

      switch (this.authMode) {
        case 'gemini-api-key': {
          // This case should never happen if determineBestAuth worked correctly
          // but add safety check
          if (
            !authToken ||
            authToken === 'USE_LOGIN_WITH_GOOGLE' ||
            authToken === ''
          ) {
            throw new Error('No valid Gemini API key available for web search');
          }

          genAI = new GoogleGenAI({
            apiKey: authToken,
            httpOptions: this.getBaseURL()
              ? {
                  ...httpOptions,
                  baseUrl: this.getBaseURL(),
                }
              : httpOptions,
          });

          // Get the models interface (which is a ContentGenerator)
          const contentGenerator = genAI.models;

          const apiKeyRequest = {
            model: 'gemini-2.5-flash',
            contents: [
              {
                role: 'user',
                parts: [{ text: (params as { query: string }).query }],
              },
            ],
            config: {
              tools: [{ googleSearch: {} }],
            },
          };

          const apiKeyResult =
            await contentGenerator.generateContent(apiKeyRequest);
          return apiKeyResult;
        }

        case 'vertex-ai': {
          genAI = new GoogleGenAI({
            apiKey: authToken,
            vertexai: true,
            httpOptions: this.getBaseURL()
              ? {
                  ...httpOptions,
                  baseUrl: this.getBaseURL(),
                }
              : httpOptions,
          });

          // Get the models interface (which is a ContentGenerator)
          const vertexContentGenerator = genAI.models;

          const vertexRequest = {
            model: 'gemini-2.5-flash',
            contents: [
              {
                role: 'user',
                parts: [{ text: (params as { query: string }).query }],
              },
            ],
            config: {
              tools: [{ googleSearch: {} }],
            },
          };

          const vertexResult =
            await vertexContentGenerator.generateContent(vertexRequest);
          return vertexResult;
        }

        case 'oauth': {
          try {
            this.logger.debug(
              () => `invokeServerTool: OAuth case - creating content generator`,
            );

            // If globalConfig is not set (e.g., when using non-Gemini provider),
            // create a minimal config for OAuth
            let configForOAuth = this.globalConfig;
            if (!configForOAuth) {
              this.logger.debug(
                () =>
                  `invokeServerTool: globalConfig is null, creating minimal config for OAuth`,
              );
              // Use crypto for UUID generation
              const { randomUUID } = await import('crypto');
              configForOAuth = new Config({
                sessionId: randomUUID(),
                targetDir: process.cwd(),
                debugMode: false,
                cwd: process.cwd(),
                model: 'gemini-2.5-flash',
              });
              // The OAuth flow will handle authentication
            }

            // For OAuth, use the code assist content generator
            // Note: Detailed logging is now handled by DebugLogger in codeAssist.ts with namespace llxprt:code:assist
            const oauthContentGenerator =
              await this.createOAuthContentGenerator(
                httpOptions,
                configForOAuth!,
              );
            this.logger.debug(
              () =>
                `invokeServerTool: OAuth content generator created successfully`,
            );

            // For web search, always use gemini-2.5-flash regardless of the active model
            const oauthRequest: GenerateContentParameters = {
              model: 'gemini-2.5-flash',
              contents: [
                {
                  role: 'user',
                  parts: [{ text: (params as { query: string }).query }],
                },
              ],
              config: {
                tools: [{ googleSearch: {} }],
              },
            };
            this.logger.debug(
              () =>
                `invokeServerTool: making OAuth generateContent request with query: ${(params as { query: string }).query}`,
            );
            // PRIVACY FIX: Removed sessionId to prevent transmission to Google servers
            const result = await oauthContentGenerator.generateContent(
              oauthRequest,
              'web-search-oauth', // userPromptId for OAuth web search
            );
            this.logger.debug(
              () =>
                `invokeServerTool: OAuth generateContent completed successfully`,
            );
            return result;
          } catch (error) {
            this.logger.debug(
              () => `invokeServerTool: ERROR in OAuth case: ${error}`,
            );
            this.logger.debug(() => `invokeServerTool: Error details:`, error);
            throw error;
          }
        }

        default:
          throw new Error(
            `Web search not supported in auth mode: ${this.authMode}`,
          );
      }
    } else if (toolName === 'web_fetch') {
      // Import the necessary modules dynamically
      const { GoogleGenAI } = await import('@google/genai');

      // Get the prompt directly without any processing
      const prompt = (params as { prompt: string }).prompt;

      // Create the appropriate client based on auth mode
      const httpOptions = {
        headers: {
          'User-Agent': `LLxprt-Code/${process.env.CLI_VERSION || process.version} (${process.platform}; ${process.arch})`,
        },
      };

      let genAI: InstanceType<typeof GoogleGenAI>;

      // Get authentication token lazily
      const authToken = await this.determineBestAuth();

      switch (this.authMode) {
        case 'gemini-api-key': {
          genAI = new GoogleGenAI({
            apiKey: authToken,
            httpOptions: this.getBaseURL()
              ? {
                  ...httpOptions,
                  baseUrl: this.getBaseURL(),
                }
              : httpOptions,
          });

          // Get the models interface (which is a ContentGenerator)
          const contentGenerator = genAI.models;

          const apiKeyRequest = {
            model: 'gemini-2.5-flash',
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            config: {
              tools: [{ urlContext: {} }],
            },
          };

          const apiKeyResult =
            await contentGenerator.generateContent(apiKeyRequest);
          return apiKeyResult;
        }

        case 'vertex-ai': {
          genAI = new GoogleGenAI({
            apiKey: authToken,
            vertexai: true,
            httpOptions: this.getBaseURL()
              ? {
                  ...httpOptions,
                  baseUrl: this.getBaseURL(),
                }
              : httpOptions,
          });

          // Get the models interface (which is a ContentGenerator)
          const vertexContentGenerator = genAI.models;

          const vertexRequest = {
            model: 'gemini-2.5-flash',
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            config: {
              tools: [{ urlContext: {} }],
            },
          };

          const vertexResult =
            await vertexContentGenerator.generateContent(vertexRequest);
          return vertexResult;
        }

        case 'oauth': {
          // For OAuth, use the code assist content generator
          const oauthContentGenerator = await this.createOAuthContentGenerator(
            httpOptions,
            this.globalConfig!,
            this.getBaseURL(),
          );

          // For web fetch, always use gemini-2.5-flash regardless of the active model
          const oauthRequest: GenerateContentParameters = {
            model: 'gemini-2.5-flash',
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            config: {
              tools: [{ urlContext: {} }],
            },
          };
          // PRIVACY FIX: Removed sessionId to prevent transmission to Google servers
          const result = await oauthContentGenerator.generateContent(
            oauthRequest,
            'web-fetch-oauth', // userPromptId for OAuth web fetch
          );
          return result;
        }

        default:
          throw new Error(
            `Web fetch not supported in auth mode: ${this.authMode}`,
          );
      }
    } else {
      throw new Error(`Unknown server tool: ${toolName}`);
    }
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P12
   * @requirement REQ-SP2-001
   * @pseudocode anthropic-gemini-stateless.md lines 1-8
   * @plan PLAN-20250218-STATELESSPROVIDER.P04
   * @requirement REQ-SP-001
   * @pseudocode base-provider.md lines 7-15
   * @pseudocode provider-invocation.md lines 8-12
   */
  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.refreshCachedSettings();
    const runtimeKey = this.resolveRuntimeKey(options);
    const streamingEnabled = this.getStreamingPreference(options);
    const { contents: content, tools } = options;
    // Determine best auth method
    const authToken = await this.determineBestAuth();
    const currentModel = options.resolved.model;
    this.currentModel = currentModel;

    // Convert IContent directly to Gemini format
    const contents: Array<{ role: string; parts: Part[] }> = [];

    for (const c of content) {
      if (c.speaker === 'human') {
        const parts: Part[] = [];
        for (const block of c.blocks) {
          if (block.type === 'text') {
            parts.push({ text: (block as TextBlock).text });
          }
        }

        if (parts.length > 0) {
          contents.push({ role: 'user', parts });
        }
      } else if (c.speaker === 'ai') {
        const parts: Part[] = [];

        for (const block of c.blocks) {
          if (block.type === 'text') {
            parts.push({ text: (block as TextBlock).text });
          } else if (block.type === 'tool_call') {
            const tc = block as ToolCallBlock;
            parts.push({
              functionCall: {
                id: tc.id,
                name: tc.name,
                args: tc.parameters,
              },
            } as Part);
          }
        }

        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }
      } else if (c.speaker === 'tool') {
        const toolResponseBlock = c.blocks.find(
          (b) => b.type === 'tool_response',
        ) as ToolResponseBlock | undefined;
        if (!toolResponseBlock) {
          throw new Error('Tool content must have a tool_response block');
        }

        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: toolResponseBlock.callId,
                name: toolResponseBlock.toolName,
                response: {
                  output: JSON.stringify(toolResponseBlock.result),
                },
              },
            },
          ],
        });
      }
    }

    // Ensure tools have proper type: 'object' for Gemini
    const geminiTools = tools
      ? tools.map((toolGroup) => ({
          functionDeclarations: toolGroup.functionDeclarations.map((decl) => {
            let parameters = decl.parametersJsonSchema;
            // CRITICAL FIX: Clean the JSON schema to remove unsupported properties by Gemini API.
            // This ensures compatibility and prevents API errors when using tools.
            // Ref: https://ai.google.dev/api/caching#Schema
            parameters = this.cleanGeminiSchema(parameters);
            if (
              parameters &&
              typeof parameters === 'object' &&
              !('type' in (parameters as Record<string, unknown>))
            ) {
              parameters = { type: Type.OBJECT, ...parameters };
            } else if (!parameters) {
              parameters = { type: Type.OBJECT, properties: {} };
            }
            return {
              name: decl.name,
              description: decl.description,
              parameters: parameters as Schema,
            };
          }),
        }))
      : undefined;

    const serverTools = ['web_search', 'web_fetch'];
    const requestConfig: Record<string, unknown> = {
      serverTools,
      ...(this.modelParams ?? {}),
    };
    if (geminiTools) {
      requestConfig.tools = geminiTools;
    }

    // Create appropriate client and generate content
    const baseURL = options.resolved.baseURL ?? this.getBaseURL();
    const httpOptions = {
      headers: {
        'User-Agent': `LLxprt-Code/${process.env.CLI_VERSION || process.version} (${process.platform}; ${process.arch})`,
      },
    };

    const mapResponseToChunks = (
      response: GenerateContentResponse,
    ): IContent[] => {
      const chunks: IContent[] = [];
      const text =
        response.candidates?.[0]?.content?.parts
          ?.filter((part: Part) => 'text' in part)
          ?.map((part: Part) => (part as { text: string }).text)
          ?.join('') || '';

      const functionCalls =
        response.candidates?.[0]?.content?.parts
          ?.filter((part: Part) => 'functionCall' in part)
          ?.map(
            (part: Part) =>
              (part as { functionCall: FunctionCall }).functionCall,
          ) || [];

      const usageMetadata = (response as GeminiResponseWithUsage).usageMetadata;

      if (text) {
        const textContent: IContent = {
          speaker: 'ai',
          blocks: [{ type: 'text', text }],
        };

        if (usageMetadata) {
          textContent.metadata = {
            usage: {
              promptTokens: usageMetadata.promptTokenCount || 0,
              completionTokens: usageMetadata.candidatesTokenCount || 0,
              totalTokens:
                usageMetadata.totalTokenCount ||
                (usageMetadata.promptTokenCount || 0) +
                  (usageMetadata.candidatesTokenCount || 0),
            },
          };
        }

        chunks.push(textContent);
      }

      if (functionCalls.length > 0) {
        const blocks: ToolCallBlock[] = functionCalls.map(
          (call: FunctionCall) => ({
            type: 'tool_call',
            id:
              call.id ||
              `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
            name: call.name || 'unknown_function',
            parameters: call.args || {},
          }),
        );

        const toolCallContent: IContent = {
          speaker: 'ai',
          blocks,
        };

        if (usageMetadata) {
          toolCallContent.metadata = {
            usage: {
              promptTokens: usageMetadata.promptTokenCount || 0,
              completionTokens: usageMetadata.candidatesTokenCount || 0,
              totalTokens:
                usageMetadata.totalTokenCount ||
                (usageMetadata.promptTokenCount || 0) +
                  (usageMetadata.candidatesTokenCount || 0),
            },
          };
        }

        chunks.push(toolCallContent);
      }

      if (usageMetadata && !text && functionCalls.length === 0) {
        chunks.push({
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: usageMetadata.promptTokenCount || 0,
              completionTokens: usageMetadata.candidatesTokenCount || 0,
              totalTokens:
                usageMetadata.totalTokenCount ||
                (usageMetadata.promptTokenCount || 0) +
                  (usageMetadata.candidatesTokenCount || 0),
            },
          },
        } as IContent);
      }

      if (!usageMetadata && !text && functionCalls.length === 0) {
        chunks.push({
          speaker: 'ai',
          blocks: [],
        } as IContent);
      }

      return chunks;
    };

    let stream: AsyncIterable<GenerateContentResponse> | null = null;
    let emitted = false;

    if (this.authMode === 'oauth') {
      const configForOAuth = this.globalConfig || {
        getProxy: () => undefined,
        isBrowserLaunchSuppressed: () => false,
        getNoBrowser: () => false,
        getUserMemory: () => '',
      };

      const cacheKey = this.buildClientCacheKey(
        runtimeKey,
        baseURL,
        authToken,
        'oauth',
      );
      const cached = runtimeClientCache.get(cacheKey);
      let contentGenerator: CodeAssistContentGenerator | null = null;
      if (cached?.kind === 'oauth') {
        contentGenerator = cached.generator;
      }
      if (!contentGenerator) {
        contentGenerator = await this.createOAuthContentGenerator(
          httpOptions,
          configForOAuth as Config,
          baseURL,
        );
        runtimeClientCache.set(cacheKey, {
          kind: 'oauth',
          generator: contentGenerator,
        });
        rememberClientKey(runtimeKey, cacheKey);
      }

      const userMemory = this.globalConfig?.getUserMemory
        ? this.globalConfig.getUserMemory()
        : '';
      const systemInstruction = await getCoreSystemPromptAsync({
        userMemory,
        model: currentModel,
        provider: this.name,
      });

      const contentsWithSystemPrompt = [
        {
          role: 'user',
          parts: [
            {
              text: `<system>\n${systemInstruction}\n</system>\n\nUser provided conversation begins here:`,
            },
          ],
        },
        ...contents,
      ];

      const oauthConfig = { ...requestConfig };
      const oauthRequest = {
        model: currentModel,
        contents: contentsWithSystemPrompt,
        systemInstruction,
        config: oauthConfig,
      };

      const sessionId = `oauth-session:${runtimeKey}:${Math.random()
        .toString(36)
        .slice(2)}`;
      const generatorWithStream = contentGenerator as {
        generateContentStream: (
          params: GenerateContentParameters,
          sessionId?: string,
        ) =>
          | AsyncIterable<GenerateContentResponse>
          | Promise<AsyncIterable<GenerateContentResponse>>;
        generateContent?: (
          params: GenerateContentParameters,
          sessionId?: string,
        ) => Promise<GenerateContentResponse>;
      };

      if (!streamingEnabled && generatorWithStream.generateContent) {
        const response = await generatorWithStream.generateContent(
          oauthRequest,
          sessionId,
        );
        let yielded = false;
        for (const chunk of mapResponseToChunks(
          response as GenerateContentResponse,
        )) {
          yielded = true;
          yield chunk;
        }
        if (!yielded) {
          yield { speaker: 'ai', blocks: [] } as IContent;
        }
        return;
      }

      const oauthStream = await generatorWithStream.generateContentStream(
        oauthRequest,
        sessionId,
      );
      stream = oauthStream as AsyncIterable<GenerateContentResponse>;
      if (streamingEnabled) {
        emitted = true;
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            session: sessionId,
            runtime: runtimeKey,
            authMode: 'oauth',
          },
        } as IContent;
      }
    } else {
      const { GoogleGenAI } = await import('@google/genai');
      const cacheKey = this.buildClientCacheKey(
        runtimeKey,
        baseURL,
        authToken,
        this.authMode,
      );
      const cached = runtimeClientCache.get(cacheKey);
      let genAI: InstanceType<typeof GoogleGenAI> | null = null;
      if (cached?.kind === 'api') {
        genAI = cached.client as InstanceType<typeof GoogleGenAI>;
      }
      if (!genAI) {
        genAI = new GoogleGenAI({
          apiKey: authToken,
          vertexai: this.authMode === 'vertex-ai',
          httpOptions: baseURL
            ? { ...httpOptions, baseUrl: baseURL }
            : httpOptions,
        });
        runtimeClientCache.set(cacheKey, {
          kind: 'api',
          client: genAI,
          authMode: this.authMode as 'gemini-api-key' | 'vertex-ai',
        });
        rememberClientKey(runtimeKey, cacheKey);
      }

      const contentGenerator = genAI.models;
      const userMemory = this.globalConfig?.getUserMemory
        ? this.globalConfig.getUserMemory()
        : '';
      const systemInstruction = await getCoreSystemPromptAsync({
        userMemory,
        model: currentModel,
        provider: this.name,
      });

      const apiRequest = {
        model: currentModel,
        contents,
        systemInstruction,
        config: { ...requestConfig },
      };

      if (streamingEnabled) {
        stream = await contentGenerator.generateContentStream(apiRequest);
      } else {
        const response = await contentGenerator.generateContent(apiRequest);
        let yielded = false;
        for (const chunk of mapResponseToChunks(response)) {
          yielded = true;
          yield chunk;
        }
        if (!yielded) {
          yield { speaker: 'ai', blocks: [] } as IContent;
        }
        return;
      }
    }

    if (stream) {
      const iterator: AsyncIterator<GenerateContentResponse> =
        typeof (stream as AsyncIterable<GenerateContentResponse>)[
          Symbol.asyncIterator
        ] === 'function'
          ? (stream as AsyncIterable<GenerateContentResponse>)[
              Symbol.asyncIterator
            ]()
          : (stream as unknown as AsyncIterator<GenerateContentResponse>);
      while (true) {
        const { value, done } = await iterator.next();
        if (done) {
          break;
        }
        const mapped = mapResponseToChunks(value);
        if (mapped.length === 0) {
          continue;
        }
        emitted = true;
        for (const chunk of mapped) {
          yield chunk;
        }
      }
    }

    if (!emitted) {
      yield { speaker: 'ai', blocks: [] } as IContent;
    }
  }
}
