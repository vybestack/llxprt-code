/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002
// createHash import removed - no longer needed without client caching
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
import { resolveUserMemory } from '../utils/userMemory.js';

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP4-002
 * @pseudocode lines 10-14
 *
 * Removed module-level client cache to ensure stateless behavior.
 * All runtime caches and cache-related types eliminated per REQ-SP4-002.
 */

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
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * @pseudocode lines 10-14
   *
   * Removed cached state variables to ensure stateless behavior.
   * Provider now resolves model, auth, and parameters per call.
   * No instance state: authMode, model overrides, modelExplicitlySet, currentModel removed.
   * @requirement:REQ-SP4-003: Auth/model/params come from NormalizedGenerateChatOptions
   */
  private readonly geminiOAuthManager?: OAuthManager;

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002, REQ-SP4-003
   * @pseudocode lines 10-14
   *
   * Simplified constructor that only stores readonly OAuth manager.
   * All other state is now resolved per call from NormalizedGenerateChatOptions.
   * No loggers cached - created on demand like AnthropicProvider.
   */
  constructor(
    apiKey?: string,
    baseURL?: string,
    config?: Config,
    oauthManager?: OAuthManager,
  ) {
    const baseConfig: BaseProviderConfig = {
      name: 'gemini',
      apiKey,
      baseURL,
      envKeyNames: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      isOAuthEnabled: !!oauthManager,
      oauthProvider: oauthManager ? 'gemini' : undefined,
      oauthManager,
    };

    super(baseConfig, config);
    this.geminiOAuthManager = oauthManager;
  }

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

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Create loggers on-demand to avoid instance state, like AnthropicProvider
   */
  private getLogger(): DebugLogger {
    return new DebugLogger('llxprt:gemini:provider');
  }

  private getToolsLogger(): DebugLogger {
    return new DebugLogger('llxprt:gemini:tools');
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P12
   * @requirement REQ-SP2-001
   * @pseudocode anthropic-gemini-stateless.md lines 1-2
   */
  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Determine streaming preference from config settings per call
   */
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

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * No operation - stateless provider has no cache to clear
   */
  clearClientCache(_runtimeKey?: string): void {
    this.getLogger().debug(
      () => 'Cache clear called on stateless provider - no operation',
    );
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
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002, REQ-SP4-003
   * Determines the best available authentication method per call without storing state.
   * Returns both authMode and token - caller must handle both values.
   */
  private async determineBestAuth(): Promise<{
    authMode: GeminiAuthMode;
    token: string;
  }> {
    this.updateOAuthState();

    // 1. CHECK STANDARD AUTH FIRST (via AuthResolver)
    //    This checks in order:
    //    - SettingsService auth-key
    //    - SettingsService auth-keyfile
    //    - Constructor apiKey
    //    - Environment variables (GEMINI_API_KEY, GOOGLE_API_KEY)
    const standardAuth = await this.authResolver.resolveAuthentication({
      settingsService: this.resolveSettingsService(),
      includeOAuth: false, // Just checking, not triggering OAuth
    });

    if (standardAuth) {
      return { authMode: 'gemini-api-key', token: standardAuth };
    }

    // 2. CHECK PROVIDER-SPECIFIC AUTH (Vertex AI)
    if (this.hasVertexAICredentials()) {
      this.setupVertexAIAuth();
      return { authMode: 'vertex-ai', token: 'USE_VERTEX_AI' };
    }

    // 3. CHECK IF OAUTH IS ENABLED (for compatibility with downstream code)
    //    Use the EXACT pattern from current GeminiProvider.ts lines 305-320:
    const manager = this.geminiOAuthManager as OAuthManager & {
      isOAuthEnabled?(provider: string): boolean;
    };
    const isOAuthEnabled =
      manager?.isOAuthEnabled &&
      typeof manager.isOAuthEnabled === 'function' &&
      manager.isOAuthEnabled('gemini');

    if (isOAuthEnabled) {
      return { authMode: 'oauth', token: 'USE_LOGIN_WITH_GOOGLE' };
    }

    // 4. NO AUTH AVAILABLE - throw error (don't return 'none')
    throw new Error(
      'No Gemini authentication configured. ' +
        'Set GEMINI_API_KEY environment variable, use --keyfile, or configure Vertex AI credentials.',
    );
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
    // eslint-disable-next-line no-restricted-syntax -- Legacy existence check, to be refactored to use authResolver
    const hasGoogleApiKey = !!process.env.GOOGLE_API_KEY;
    const hasApplicationCredentials =
      // eslint-disable-next-line no-restricted-syntax -- Legacy existence check, to be refactored to use authResolver
      !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
    return (
      hasProjectAndLocation || hasGoogleApiKey || hasApplicationCredentials
    );
  }

  /**
   * Sets up environment variables for Vertex AI authentication
   */
  private setupVertexAIAuth(): void {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
    // Other Vertex AI env vars are already set, no need to duplicate
  }

  private createHttpOptions(): { headers: Record<string, string> } {
    const customHeaders = this.getCustomHeaders();
    return {
      headers: {
        'User-Agent': `LLxprt-Code/${process.env.CLI_VERSION || process.version} (${process.platform}; ${process.arch})`,
        ...(customHeaders ?? {}),
      },
    };
  }

  /**
   * Sets the config instance for reading OAuth credentials
   */
  override setConfig(config: Config): void {
    // Call base provider implementation
    super.setConfig?.(config);
    this.refreshCachedSettings();
    // Sync with config model if user hasn't explicitly set a model
    // This ensures consistency between config and provider state
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002
    // Removed model caching in stateless implementation
    // const configModel = config.getModel();
    // if (!this.modelExplicitlySet && configModel) {
    //   this.currentModel = configModel;
    // }

    // Update OAuth configuration based on OAuth manager state, not config authType
    // This ensures that if OAuth is disabled via /auth gemini disable, it stays disabled
    this.updateOAuthState();

    // Clear auth cache when config changes to allow re-determination
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Determine auth mode per call instead of using cached state
   */
  async getModels(): Promise<IModel[]> {
    // Determine auth mode for this call
    const { authMode } = await this.determineBestAuth();

    // For OAuth mode, return fixed list of models
    if (authMode === 'oauth') {
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
    if (authMode === 'gemini-api-key' || authMode === 'vertex-ai') {
      // eslint-disable-next-line no-restricted-syntax -- Legacy fallback, to be refactored to use authResolver
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
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Gets the current authentication mode per call without caching
   */
  async getAuthMode(): Promise<GeminiAuthMode> {
    const { authMode } = await this.determineBestAuth();
    return authMode;
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Gets the appropriate AuthType for the core library per call
   */
  async getCoreAuthType(): Promise<AuthType> {
    const { authMode } = await this.determineBestAuth();
    switch (authMode) {
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

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * No caching - this method is now a no-op. Settings read on demand.
   */
  private refreshCachedSettings(): void {
    // No operation - stateless provider doesn't cache settings
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Gets the current model ID from SettingsService per call
   */
  override getCurrentModel(): string {
    // Try to get from SettingsService first (source of truth)
    try {
      const settingsService = this.resolveSettingsService();
      const providerSettings = settingsService.getProviderSettings(this.name);
      if (providerSettings.model) {
        return providerSettings.model as string;
      }
    } catch (error) {
      this.getLogger().debug(
        () => `Failed to get model from SettingsService: ${error}`,
      );
    }
    // In stateless mode, always return default since model should come from options
    return this.getDefaultModel();
  }

  /**
   * Gets the default model for Gemini
   */
  override getDefaultModel(): string {
    return 'gemini-2.5-pro';
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Gets model parameters from SettingsService per call
   */
  override getModelParams(): Record<string, unknown> | undefined {
    try {
      const settingsService = this.resolveSettingsService();
      const providerSettings = settingsService.getProviderSettings(this.name);

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

      return Object.keys(params).length > 0 ? params : undefined;
    } catch (error) {
      this.getLogger().debug(
        () =>
          `Failed to get Gemini provider settings from SettingsService: ${error}`,
      );
      return undefined;
    }
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Checks if using paid mode synchronously via env vars (stateless check)
   */
  override isPaidMode(): boolean {
    // Synchronous check based on environment variables only
    // Note: This doesn't check SettingsService to maintain synchronous behavior
    // eslint-disable-next-line no-restricted-syntax -- Legacy existence check, to be refactored to use authResolver
    return !!process.env.GEMINI_API_KEY || this.hasVertexAICredentials();
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * No state to clear in stateless implementation
   */
  override clearState(): void {
    // No operation - stateless provider has no state to clear
    this.clearAuthCache();
  }

  /**
   * Clear all authentication including environment variable
   */
  override clearAuth(): void {
    // Call base implementation to clear SettingsService
    super.clearAuth?.();
    // CRITICAL: Also clear the environment variable that setApiKey sets
    // eslint-disable-next-line no-restricted-syntax -- Legacy cleanup, required for setApiKey compatibility
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
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Invoke a server tool using per-call auth resolution
   */
  override async invokeServerTool(
    toolName: string,
    params: unknown,
    _config?: unknown,
    _signal?: AbortSignal,
  ): Promise<unknown> {
    if (toolName === 'web_search') {
      const logger = this.getToolsLogger();
      logger.debug(
        () =>
          `invokeServerTool: web_search called with params: ${JSON.stringify(params)}`,
      );
      logger.debug(
        () =>
          `invokeServerTool: globalConfig is ${this.globalConfig ? 'set' : 'null/undefined'}`,
      );

      // Check for abort before auth determination
      if (_signal?.aborted) {
        const error = new Error('Operation was aborted');
        error.name = 'AbortError';
        throw error;
      }

      // Import the necessary modules dynamically
      const { GoogleGenAI } = await import('@google/genai');

      // Create the appropriate client based on auth mode
      const httpOptions = this.createHttpOptions();

      let genAI: InstanceType<typeof GoogleGenAI>;

      // Get authentication token and mode lazily per call
      logger.debug(() => `invokeServerTool: about to call determineBestAuth()`);
      const { authMode, token: authToken } = await this.determineBestAuth();

      // Check for abort after auth determination
      if (_signal?.aborted) {
        const error = new Error('Operation was aborted');
        error.name = 'AbortError';
        throw error;
      }
      logger.debug(
        () =>
          `invokeServerTool: determineBestAuth returned authMode=${authMode}`,
      );

      switch (authMode) {
        case 'gemini-api-key': {
          // Validate auth token
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
            logger.debug(
              () => `invokeServerTool: OAuth case - creating content generator`,
            );

            // If globalConfig is not set (e.g., when using non-Gemini provider),
            // create a minimal config for OAuth
            let configForOAuth = this.globalConfig;
            if (!configForOAuth) {
              logger.debug(
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
            logger.debug(
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
            logger.debug(
              () =>
                `invokeServerTool: making OAuth generateContent request with query: ${(params as { query: string }).query}`,
            );
            // PRIVACY FIX: Removed sessionId to prevent transmission to Google servers
            const result = await oauthContentGenerator.generateContent(
              oauthRequest,
              'web-search-oauth', // userPromptId for OAuth web search
            );
            logger.debug(
              () =>
                `invokeServerTool: OAuth generateContent completed successfully`,
            );
            return result;
          } catch (error) {
            logger.debug(
              () => `invokeServerTool: ERROR in OAuth case: ${error}`,
            );
            logger.debug(() => `invokeServerTool: Error details:`, error);
            throw error;
          }
        }

        default:
          throw new Error(`Web search not supported in auth mode: ${authMode}`);
      }
    } else if (toolName === 'web_fetch') {
      // Check for abort before auth determination
      if (_signal?.aborted) {
        const error = new Error('Operation was aborted');
        error.name = 'AbortError';
        throw error;
      }

      // Import the necessary modules dynamically
      const { GoogleGenAI } = await import('@google/genai');

      // Get the prompt directly without any processing
      const prompt = (params as { prompt: string }).prompt;

      // Create the appropriate client based on auth mode
      const httpOptions = this.createHttpOptions();

      let genAI: InstanceType<typeof GoogleGenAI>;

      // Get authentication token and mode lazily per call
      const { authMode, token: authToken } = await this.determineBestAuth();

      // Check for abort after auth determination
      if (_signal?.aborted) {
        const error = new Error('Operation was aborted');
        error.name = 'AbortError';
        throw error;
      }

      switch (authMode) {
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
          throw new Error(`Web fetch not supported in auth mode: ${authMode}`);
      }
    } else {
      throw new Error(`Unknown server tool: ${toolName}`);
    }
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002, REQ-SP4-003
   * Generate chat completion using per-call resolution of auth, model, and params
   * All state comes from NormalizedGenerateChatOptions, no instance caching
   */
  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const streamingEnabled = this.getStreamingPreference(options);
    const { contents: content, tools } = options;

    // Determine best auth method per call - no state storage
    const { authMode, token: authToken } = await this.determineBestAuth();

    // Model is resolved from options.resolved.model - no instance caching
    const currentModel = options.resolved.model;

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

    const toolNamesForPrompt =
      tools === undefined
        ? undefined
        : Array.from(
            new Set(
              tools.flatMap((group) =>
                group.functionDeclarations
                  .map((decl) => decl.name)
                  .filter((name): name is string => Boolean(name)),
              ),
            ),
          );

    const serverTools = ['web_search', 'web_fetch'];
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-003
    // Get model params per call from ephemeral settings, not cached instance state
    const requestOverrides = options.invocation?.ephemerals ?? {};
    const requestConfig: Record<string, unknown> = {
      serverTools,
      ...(requestOverrides ?? {}),
    };
    if (geminiTools) {
      requestConfig.tools = geminiTools;
    }

    // Create appropriate client and generate content
    const baseURL = options.resolved.baseURL ?? this.getBaseURL();
    const httpOptions = this.createHttpOptions();

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

    // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002
    // No caching - create client per call based on resolved authMode
    if (authMode === 'oauth') {
      const configForOAuth = this.globalConfig || {
        getProxy: () => undefined,
        isBrowserLaunchSuppressed: () => false,
        getNoBrowser: () => false,
        getUserMemory: () => '',
      };

      // Create OAuth content generator per call - no caching
      const contentGenerator = await this.createOAuthContentGenerator(
        httpOptions,
        configForOAuth as Config,
        baseURL,
      );

      // @plan PLAN-20251023-STATELESS-HARDENING.P08: Get userMemory from normalized runtime context
      const userMemory = await resolveUserMemory(
        options.userMemory,
        () => options.invocation?.userMemory,
      );
      const systemInstruction = await getCoreSystemPromptAsync(
        userMemory,
        currentModel,
        toolNamesForPrompt,
      );

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

      // Use runtime metadata from options for session ID
      const runtimeId = options.runtime?.runtimeId || 'default';
      const sessionId = `oauth-session:${runtimeId}:${Math.random()
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
            runtime: runtimeId,
            authMode: 'oauth',
          },
        } as IContent;
      }
    } else {
      // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002
      // Create Google GenAI client per call - no caching
      const { GoogleGenAI } = await import('@google/genai');

      const genAI = new GoogleGenAI({
        apiKey: authToken,
        vertexai: authMode === 'vertex-ai',
        httpOptions: baseURL
          ? { ...httpOptions, baseUrl: baseURL }
          : httpOptions,
      });

      const contentGenerator = genAI.models;
      // @plan PLAN-20251023-STATELESS-HARDENING.P08: Get userMemory from normalized runtime context
      const userMemory = await resolveUserMemory(
        options.userMemory,
        () => options.invocation?.userMemory,
      );
      const systemInstruction = await getCoreSystemPromptAsync(
        userMemory,
        currentModel,
        toolNamesForPrompt,
      );

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
