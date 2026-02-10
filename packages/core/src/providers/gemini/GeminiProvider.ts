/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002
// createHash import removed - no longer needed without client caching
import { DebugLogger } from '../../debug/index.js';
import { type IModel } from '../IModel.js';
import {
  type IContent,
  type TextBlock,
  type ToolCallBlock,
  type ToolResponseBlock,
  type ThinkingBlock,
} from '../../services/history/IContent.js';
import { Config } from '../../config/config.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import { shouldIncludeSubagentDelegation } from '../../prompt-config/subagent-delegation.js';
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
  type BaseProviderConfig,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { type OAuthManager } from '../../auth/precedence.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { buildToolResponsePayload } from '../utils/toolResponsePayload.js';
import {
  ensureActiveLoopHasThoughtSignatures,
  stripThoughtsFromHistory,
} from './thoughtSignatures.js';
import {
  shouldDumpSDKContext,
  dumpSDKContext,
} from '../utils/dumpSDKContext.js';
import type { DumpMode } from '../utils/dumpContext.js';
import {
  retryWithBackoff,
  getErrorStatus,
  isNetworkTransientError,
} from '../../utils/retry.js';
import { ApiError } from '@google/genai';
// ThinkingLevel is not directly exported, use string literals

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
   * @plan PLAN-20251215-issue813
   * @requirement REQ-RETRY-001: GeminiProvider must use retryWithBackoff for all SDK calls
   *
   * Determines if an error should trigger a retry.
   * - 429 (rate limit) errors are retried
   * - 5xx server errors are retried
   * - 400 (bad request) errors are NOT retried
   * - Network transient errors are retried
   */
  private shouldRetryOnError(error: Error | unknown): boolean {
    // Priority check for ApiError
    if (error instanceof ApiError) {
      // Explicitly do not retry 400 (Bad Request)
      if (error.status === 400) return false;
      // Retry on rate limit and server errors
      return (
        error.status === 429 || (error.status >= 500 && error.status < 600)
      );
    }

    // Check for status using helper (handles other error shapes)
    const status = getErrorStatus(error);
    if (status !== undefined) {
      if (status === 400) return false;
      return status === 429 || (status >= 500 && status < 600);
    }

    // Check for network transient errors
    if (isNetworkTransientError(error)) {
      return true;
    }

    return false;
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
    return createCodeAssistContentGenerator(httpOptions, config, baseURL);
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

    // Update OAuth configuration based on OAuth manager state, not legacy auth selection
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
    // Full model list including OAuth-only models (gemini-3-*-preview)
    // Used as fallback when no auth yet, and for OAuth mode
    const oauthModels: IModel[] = [
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
      {
        id: 'gemini-3-pro-preview',
        name: 'Gemini 3 Pro Preview',
        provider: this.name,
        supportedToolFormats: [],
      },
      {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash Preview',
        provider: this.name,
        supportedToolFormats: [],
      },
    ];

    // Determine auth mode for this call (graceful when no auth yet)
    let authMode: GeminiAuthMode;
    try {
      const result = await this.determineBestAuth();
      authMode = result.authMode;
    } catch (_e) {
      // No auth configured yet (pre-onboarding) - return full model list
      // including OAuth models so user can see all options when selecting
      return oauthModels;
    }

    // For OAuth mode, return fixed list of models (including 3-*-preview)
    if (authMode === 'oauth') {
      return oauthModels;
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

    // Return default models as fallback (use same list as OAuth for consistency)
    return oauthModels;
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
        'baseURL',
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

          // @plan PLAN-20251215-issue813: Wrap with retryWithBackoff for 429/5xx handling
          const apiKeyResult = await retryWithBackoff(
            () => contentGenerator.generateContent(apiKeyRequest),
            {
              shouldRetryOnError: this.shouldRetryOnError.bind(this),
            },
          );
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

          // @plan PLAN-20251215-issue813: Wrap with retryWithBackoff for 429/5xx handling
          const vertexResult = await retryWithBackoff(
            () => vertexContentGenerator.generateContent(vertexRequest),
            {
              shouldRetryOnError: this.shouldRetryOnError.bind(this),
            },
          );
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
            // @plan PLAN-20251215-issue813: Wrap with retryWithBackoff for 429/5xx handling
            // PRIVACY FIX: Removed sessionId to prevent transmission to Google servers
            const result = await retryWithBackoff(
              () =>
                oauthContentGenerator.generateContent(
                  oauthRequest,
                  'google-web-search-oauth', // userPromptId for OAuth web search
                ),
              {
                shouldRetryOnError: this.shouldRetryOnError.bind(this),
              },
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

          // @plan PLAN-20251215-issue813: Wrap with retryWithBackoff for 429/5xx handling
          const apiKeyResult = await retryWithBackoff(
            () => contentGenerator.generateContent(apiKeyRequest),
            {
              shouldRetryOnError: this.shouldRetryOnError.bind(this),
            },
          );
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

          // @plan PLAN-20251215-issue813: Wrap with retryWithBackoff for 429/5xx handling
          const vertexResult = await retryWithBackoff(
            () => vertexContentGenerator.generateContent(vertexRequest),
            {
              shouldRetryOnError: this.shouldRetryOnError.bind(this),
            },
          );
          return vertexResult;
        }

        case 'oauth': {
          // For OAuth, use the code assist content generator
          const oauthContentGenerator = await this.createOAuthContentGenerator(
            httpOptions,
            this.globalConfig!,
            undefined,
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
          // @plan PLAN-20251215-issue813: Wrap with retryWithBackoff for 429/5xx handling
          // PRIVACY FIX: Removed sessionId to prevent transmission to Google servers
          const result = await retryWithBackoff(
            () =>
              oauthContentGenerator.generateContent(
                oauthRequest,
                'google-web-fetch-oauth', // userPromptId for OAuth web fetch
              ),
            {
              shouldRetryOnError: this.shouldRetryOnError.bind(this),
            },
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
    const configForMessages =
      options.config ?? options.runtime?.config ?? this.globalConfig;

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

        const payload = buildToolResponsePayload(
          toolResponseBlock,
          configForMessages,
        );
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: toolResponseBlock.callId,
                name: toolResponseBlock.toolName,
                response: {
                  status: payload.status,
                  result: payload.result,
                  error: payload.error,
                  truncated: payload.truncated,
                  originalLength: payload.originalLength,
                  limitMessage: payload.limitMessage,
                },
              },
            },
          ],
        });
      }
    }

    // Extract reasoning ephemerals for Gemini 3.x thinking support
    // @plan PLAN-20251202-THINKING.P03b @requirement REQ-THINK-006
    const earlyEphemerals = options.invocation?.ephemerals ?? {};

    // Get dump mode from ephemeral settings
    const dumpMode = earlyEphemerals.dumpcontext as DumpMode | undefined;
    const shouldDumpSuccess = shouldDumpSDKContext(dumpMode, false);
    const shouldDumpError = shouldDumpSDKContext(dumpMode, true);

    // @plan PLAN-20260126-SETTINGS-SEPARATION.P09
    // Read reasoning settings from invocation.modelBehavior first, fallback to earlyEphemerals
    const reasoningObj = (earlyEphemerals as Record<string, unknown>)[
      'reasoning'
    ] as Record<string, unknown> | undefined;
    const reasoningEnabled =
      (options.invocation?.getModelBehavior('reasoning.enabled') as
        | boolean
        | undefined) ??
      ((earlyEphemerals as Record<string, unknown>)['reasoning.enabled'] ===
        true ||
        reasoningObj?.enabled === true);
    const reasoningIncludeInResponse =
      (options.invocation?.getCliSetting('reasoning.includeInResponse') as
        | boolean
        | undefined) ??
      ((earlyEphemerals as Record<string, unknown>)[
        'reasoning.includeInResponse'
      ] !== false &&
        reasoningObj?.includeInResponse !== false);
    const reasoningStripFromContext =
      (options.invocation?.getCliSetting('reasoning.stripFromContext') as
        | 'all'
        | 'allButLast'
        | 'none'
        | undefined) ??
      ((earlyEphemerals as Record<string, unknown>)[
        'reasoning.stripFromContext'
      ] as 'all' | 'allButLast' | 'none') ??
      (reasoningObj?.stripFromContext as 'all' | 'allButLast' | 'none') ??
      'all';
    const reasoningEffort =
      (options.invocation?.getModelBehavior('reasoning.effort') as
        | 'minimal'
        | 'low'
        | 'medium'
        | 'high'
        | 'xhigh'
        | undefined) ??
      ((earlyEphemerals as Record<string, unknown>)['reasoning.effort'] as
        | 'minimal'
        | 'low'
        | 'medium'
        | 'high'
        | 'xhigh'
        | undefined) ??
      (reasoningObj?.effort as
        | 'minimal'
        | 'low'
        | 'medium'
        | 'high'
        | 'xhigh'
        | undefined);
    void reasoningEffort;
    const reasoningMaxTokens =
      (options.invocation?.getModelBehavior('reasoning.maxTokens') as
        | number
        | undefined) ??
      ((earlyEphemerals as Record<string, unknown>)['reasoning.maxTokens'] as
        | number
        | undefined) ??
      (reasoningObj?.maxTokens as number | undefined);

    // Strip thought content from history before sending to API
    // This prevents sending previous thinking back which can cause issues
    const contentsWithThoughtsStripped = stripThoughtsFromHistory(
      contents,
      reasoningStripFromContext,
    );

    // Gemini 3.x requires thoughtSignature on functionCall parts in the "active loop"
    // (from the last user text message to end of history). Apply synthetic signatures
    // where missing to bypass validation. See: https://ai.google.dev/gemini-api/docs/thought-signatures
    const contentsWithSignatures = ensureActiveLoopHasThoughtSignatures(
      contentsWithThoughtsStripped,
    );

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

    const directOverridesRaw = (
      options.metadata as { geminiDirectOverrides?: unknown }
    )?.geminiDirectOverrides;
    const directOverrides =
      directOverridesRaw && typeof directOverridesRaw === 'object'
        ? (directOverridesRaw as Record<string, unknown>)
        : undefined;

    const serverToolsOverride =
      directOverrides && 'serverTools' in directOverrides
        ? directOverrides.serverTools
        : options.config &&
            typeof (options.config as { serverTools?: unknown }).serverTools !==
              'undefined'
          ? (options.config as { serverTools?: unknown }).serverTools
          : undefined;
    const serverTools = Array.isArray(serverToolsOverride)
      ? serverToolsOverride
      : ['web_search', 'web_fetch'];

    const toolConfigOverride =
      directOverrides && 'toolConfig' in directOverrides
        ? directOverrides.toolConfig
        : undefined;
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-003
    // @plan PLAN-20260126-SETTINGS-SEPARATION.P09
    // Get pre-separated model params from invocation context
    const modelParams = options.invocation?.modelParams ?? {};
    const requestConfig: Record<string, unknown> = {
      ...modelParams,
    };

    // Translate generic maxOutputTokens ephemeral to Gemini's maxOutputTokens
    const rawMaxOutput = options.settings?.get('maxOutputTokens');
    const genericMaxOutput =
      typeof rawMaxOutput === 'number' &&
      Number.isFinite(rawMaxOutput) &&
      rawMaxOutput > 0
        ? rawMaxOutput
        : undefined;
    if (
      genericMaxOutput !== undefined &&
      requestConfig['maxOutputTokens'] === undefined
    ) {
      requestConfig['maxOutputTokens'] = genericMaxOutput;
    }
    requestConfig.serverTools = serverTools;
    if (geminiTools) {
      requestConfig.tools = geminiTools;
    }
    if (toolConfigOverride) {
      requestConfig.toolConfig = toolConfigOverride;
    }

    // Configure thinkingConfig for Gemini models when reasoning is enabled
    // @plan PLAN-20251202-THINKING.P03b @requirement REQ-THINK-006
    // ThinkingConfig uses:
    //   - includeThoughts: boolean - whether to include thoughts in response
    //   - thinkingBudget: number - token budget (0=DISABLED, -1=AUTOMATIC, or specific number)
    if (reasoningEnabled) {
      requestConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: reasoningMaxTokens ?? -1, // -1 = AUTOMATIC
      };
    }

    const requestLogger = new DebugLogger('llxprt:provider:gemini:logging');
    requestLogger.log(() => '[GeminiProvider] request config overrides', {
      hasDirectOverrides: !!directOverrides,
      serverTools,
      toolConfigOverride: toolConfigOverride ? 'present' : 'absent',
    });

    // Debug: Log thinking configuration
    const thinkingConfigLogger = new DebugLogger(
      'llxprt:provider:gemini:thinking',
    );
    thinkingConfigLogger.log(() => '[GeminiProvider] Thinking configuration', {
      reasoningEnabled,
      reasoningIncludeInResponse,
      reasoningStripFromContext,
      model: currentModel,
      thinkingConfig: requestConfig.thinkingConfig,
    });

    // Create appropriate client and generate content
    const baseURL = options.resolved.baseURL ?? this.getBaseURL();
    const httpOptions = this.createHttpOptions();

    const thinkingLogger = new DebugLogger('llxprt:provider:gemini:thinking');
    const mapResponseToChunks = (
      response: GenerateContentResponse,
      includeThoughts = true,
    ): IContent[] => {
      const chunks: IContent[] = [];
      const parts = response.candidates?.[0]?.content?.parts || [];

      // Debug: Log all parts with their thought property for debugging
      thinkingLogger.log(
        () => '[GeminiProvider] Response parts received',
        parts.map((p: Part) => ({
          hasText: 'text' in p,
          thought: (p as Part & { thought?: boolean }).thought,
          hasThoughtSignature: !!(p as Part & { thoughtSignature?: string })
            .thoughtSignature,
          hasFunctionCall: 'functionCall' in p,
          textPreview:
            'text' in p
              ? (p as { text: string }).text.substring(0, 100)
              : undefined,
        })),
      );

      // Separate thought parts from non-thought text parts
      // Gemini returns thought content with `thought: true` on parts
      const thoughtParts = parts.filter(
        (part: Part) =>
          'text' in part && (part as Part & { thought?: boolean }).thought,
      );
      const nonThoughtTextParts = parts.filter(
        (part: Part) =>
          'text' in part && !(part as Part & { thought?: boolean }).thought,
      );

      // Extract thoughtSignature from the first part that has one (for Gemini 3.x)
      const firstPartWithSig = parts.find(
        (part: Part) =>
          (part as Part & { thoughtSignature?: string }).thoughtSignature,
      );
      const thoughtSignature = firstPartWithSig
        ? (firstPartWithSig as Part & { thoughtSignature?: string })
            .thoughtSignature
        : undefined;

      const text = nonThoughtTextParts
        .map((part: Part) => (part as { text: string }).text)
        .join('');

      const thoughtText = thoughtParts
        .map((part: Part) => (part as { text: string }).text)
        .join('');

      // Debug: Log thought extraction results
      thinkingLogger.log(() => '[GeminiProvider] Thought extraction results', {
        thoughtPartsCount: thoughtParts.length,
        nonThoughtTextPartsCount: nonThoughtTextParts.length,
        thoughtTextLength: thoughtText.length,
        thoughtTextPreview: thoughtText.substring(0, 200),
        includeThoughts,
        willYieldThinkingBlock: !!(thoughtText && includeThoughts),
      });

      const functionCalls =
        parts
          ?.filter((part: Part) => 'functionCall' in part)
          ?.map(
            (part: Part) =>
              (part as { functionCall: FunctionCall }).functionCall,
          ) || [];

      const usageMetadata = (response as GeminiResponseWithUsage).usageMetadata;

      // Yield ThinkingBlock first if there's thought content and includeThoughts is true
      if (thoughtText && includeThoughts) {
        const thinkingBlock: ThinkingBlock = {
          type: 'thinking',
          thought: thoughtText,
          sourceField: 'thought', // Gemini uses `thought: true` on parts
          isHidden: false, // Not hidden since includeThoughts is true
        };
        if (thoughtSignature) {
          thinkingBlock.signature = thoughtSignature;
        }
        const thinkingContent: IContent = {
          speaker: 'ai',
          blocks: [thinkingBlock],
        };
        chunks.push(thinkingContent);
      }

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
      // Code Assist uses its own endpoint; ignore provider base URLs.
      const contentGenerator = await this.createOAuthContentGenerator(
        httpOptions,
        configForOAuth as Config,
        undefined,
      );

      // @plan PLAN-20251023-STATELESS-HARDENING.P08: Get userMemory from normalized runtime context
      const userMemory = await resolveUserMemory(
        options.userMemory,
        () => options.invocation?.userMemory,
      );
      const subagentConfig =
        options.config ?? options.runtime?.config ?? this.globalConfig;
      const includeSubagentDelegation = await shouldIncludeSubagentDelegation(
        toolNamesForPrompt ?? [],
        () => subagentConfig?.getSubagentManager?.(),
      );
      const systemInstruction = await getCoreSystemPromptAsync({
        userMemory,
        model: currentModel,
        tools: toolNamesForPrompt,
        includeSubagentDelegation,
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
        ...contentsWithSignatures,
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
        try {
          // @plan PLAN-20251215-issue813: Wrap with retryWithBackoff for 429/5xx handling
          const response = await retryWithBackoff(
            () => generatorWithStream.generateContent!(oauthRequest, sessionId),
            {
              shouldRetryOnError: this.shouldRetryOnError.bind(this),
            },
          );

          // Dump successful non-streaming request if enabled
          if (shouldDumpSuccess) {
            await dumpSDKContext(
              'gemini',
              '/v1/models/generateContent',
              oauthRequest,
              response,
              false,
              baseURL || 'https://generativelanguage.googleapis.com',
            );
          }

          let yielded = false;
          for (const chunk of mapResponseToChunks(
            response as GenerateContentResponse,
            reasoningIncludeInResponse,
          )) {
            yielded = true;
            yield chunk;
          }
          if (!yielded) {
            yield { speaker: 'ai', blocks: [] } as IContent;
          }
          return;
        } catch (error) {
          // Dump error if enabled
          if (shouldDumpError) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            await dumpSDKContext(
              'gemini',
              '/v1/models/generateContent',
              oauthRequest,
              { error: errorMessage },
              true,
              baseURL || 'https://generativelanguage.googleapis.com',
            );
          }
          throw error;
        }
      }

      try {
        // @plan PLAN-20251215-issue813: Wrap with retryWithBackoff for 429/5xx handling
        // Use Promise.resolve to handle both sync and async return types from generateContentStream
        const oauthStream = await retryWithBackoff(
          () =>
            Promise.resolve(
              generatorWithStream.generateContentStream(
                oauthRequest,
                sessionId,
              ),
            ),
          {
            shouldRetryOnError: this.shouldRetryOnError.bind(this),
          },
        );

        // Dump successful streaming request if enabled
        if (shouldDumpSuccess) {
          await dumpSDKContext(
            'gemini',
            '/v1/models/streamGenerateContent',
            oauthRequest,
            { streaming: true },
            false,
            baseURL || 'https://generativelanguage.googleapis.com',
          );
        }

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
      } catch (error) {
        // Dump error if enabled
        if (shouldDumpError) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          await dumpSDKContext(
            'gemini',
            '/v1/models/streamGenerateContent',
            oauthRequest,
            { error: errorMessage },
            true,
            baseURL || 'https://generativelanguage.googleapis.com',
          );
        }
        throw error;
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
      const subagentConfig =
        options.config ?? options.runtime?.config ?? this.globalConfig;
      const includeSubagentDelegation = await shouldIncludeSubagentDelegation(
        toolNamesForPrompt ?? [],
        () => subagentConfig?.getSubagentManager?.(),
      );
      const systemInstruction = await getCoreSystemPromptAsync({
        userMemory,
        model: currentModel,
        tools: toolNamesForPrompt,
        includeSubagentDelegation,
      });

      const apiRequest = {
        model: currentModel,
        contents: contentsWithSignatures,
        systemInstruction,
        config: { ...requestConfig },
      };

      if (streamingEnabled) {
        try {
          // @plan PLAN-20251215-issue813: Wrap with retryWithBackoff for 429/5xx handling
          stream = await retryWithBackoff(
            () => contentGenerator.generateContentStream(apiRequest),
            {
              shouldRetryOnError: this.shouldRetryOnError.bind(this),
            },
          );

          // Dump successful streaming request if enabled
          if (shouldDumpSuccess) {
            await dumpSDKContext(
              'gemini',
              '/v1/models/streamGenerateContent',
              apiRequest,
              { streaming: true },
              false,
              baseURL || 'https://generativelanguage.googleapis.com',
            );
          }
        } catch (error) {
          // Dump error if enabled
          if (shouldDumpError) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            await dumpSDKContext(
              'gemini',
              '/v1/models/streamGenerateContent',
              apiRequest,
              { error: errorMessage },
              true,
              baseURL || 'https://generativelanguage.googleapis.com',
            );
          }
          throw error;
        }
      } else {
        try {
          // @plan PLAN-20251215-issue813: Wrap with retryWithBackoff for 429/5xx handling
          const response = await retryWithBackoff(
            () => contentGenerator.generateContent(apiRequest),
            {
              shouldRetryOnError: this.shouldRetryOnError.bind(this),
            },
          );

          // Dump successful non-streaming request if enabled
          if (shouldDumpSuccess) {
            await dumpSDKContext(
              'gemini',
              '/v1/models/generateContent',
              apiRequest,
              response,
              false,
              baseURL || 'https://generativelanguage.googleapis.com',
            );
          }

          let yielded = false;
          for (const chunk of mapResponseToChunks(
            response,
            reasoningIncludeInResponse,
          )) {
            yielded = true;
            yield chunk;
          }
          if (!yielded) {
            yield { speaker: 'ai', blocks: [] } as IContent;
          }
          return;
        } catch (error) {
          // Dump error if enabled
          if (shouldDumpError) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            await dumpSDKContext(
              'gemini',
              '/v1/models/generateContent',
              apiRequest,
              { error: errorMessage },
              true,
              baseURL || 'https://generativelanguage.googleapis.com',
            );
          }
          throw error;
        }
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
        const mapped = mapResponseToChunks(value, reasoningIncludeInResponse);
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
