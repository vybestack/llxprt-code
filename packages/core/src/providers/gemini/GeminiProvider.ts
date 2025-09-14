/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
import { createCodeAssistContentGenerator } from '../../code_assist/codeAssist.js';
import {
  Type,
  type Part,
  type FunctionCall,
  type Schema,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from '@google/genai';
import { BaseProvider, BaseProviderConfig } from '../BaseProvider.js';
import { OAuthManager } from '../../auth/precedence.js';
import { getSettingsService } from '../../settings/settingsServiceInstance.js';

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

export class GeminiProvider extends BaseProvider {
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

  override setApiKey(apiKey: string): void {
    // Call base provider implementation
    super.setApiKey(apiKey);

    // Set the API key as an environment variable so it can be used by the core library
    // CRITICAL FIX: When clearing the key (empty string), delete the env var instead of setting to empty
    if (apiKey && apiKey.trim() !== '') {
      process.env.GEMINI_API_KEY = apiKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }

    // Clear auth cache when API key changes
    this.clearAuthCache();
  }

  override setBaseUrl(baseUrl?: string): void {
    // Call base provider implementation which stores in ephemeral settings
    super.setBaseUrl?.(baseUrl);
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

  /**
   * Gets the current model ID
   */
  override getCurrentModel(): string {
    // Try to get from SettingsService first (source of truth)
    try {
      const settingsService = getSettingsService();
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
   * Sets the current model ID
   */
  override setModel(modelId: string): void {
    // Update SettingsService as the source of truth
    try {
      const settingsService = getSettingsService();
      settingsService.setProviderSetting(this.name, 'model', modelId);
    } catch (error) {
      this.logger.debug(
        () => `Failed to persist model to SettingsService: ${error}`,
      );
    }

    // Keep local cache for performance
    this.currentModel = modelId;
    this.modelExplicitlySet = true;

    // Always update config if available, not just in OAuth mode
    // This ensures the model is properly synchronized
    if (this.globalConfig) {
      this.globalConfig.setModel(modelId);
    }
  }

  /**
   * Sets additional model parameters to include in requests
   */
  override setModelParams(params: Record<string, unknown> | undefined): void {
    if (params === undefined) {
      this.modelParams = undefined;
    } else {
      this.modelParams = { ...this.modelParams, ...params };
    }
  }

  /**
   * Gets the current model parameters
   */
  override getModelParams(): Record<string, unknown> | undefined {
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
              await createCodeAssistContentGenerator(
                httpOptions,
                AuthType.LOGIN_WITH_GOOGLE,
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
          const oauthContentGenerator = await createCodeAssistContentGenerator(
            httpOptions,
            AuthType.LOGIN_WITH_GOOGLE,
            this.globalConfig!,
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
   * Generate chat completion with IContent interface
   * Direct implementation for Gemini API with IContent interface
   */
  async *generateChatCompletion(
    content: IContent[],
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parametersJsonSchema?: unknown;
      }>;
    }>,
    _toolFormat?: string,
  ): AsyncIterableIterator<IContent> {
    // Determine best auth method
    const authToken = await this.determineBestAuth();

    // Import necessary modules
    const { GoogleGenAI } = await import('@google/genai');

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

    // Create appropriate client and generate content
    const httpOptions = {
      headers: {
        'User-Agent': `LLxprt-Code/${process.env.CLI_VERSION || process.version} (${process.platform}; ${process.arch})`,
      },
    };

    let stream: AsyncIterable<GenerateContentResponse>;

    if (this.authMode === 'oauth') {
      // OAuth mode
      const configForOAuth = this.globalConfig || {
        getProxy: () => undefined,
        isBrowserLaunchSuppressed: () => false,
        getNoBrowser: () => false,
        getUserMemory: () => '',
      };

      const contentGenerator = await createCodeAssistContentGenerator(
        httpOptions,
        AuthType.LOGIN_WITH_GOOGLE,
        configForOAuth as Config,
        this.getBaseURL(),
      );

      const userMemory = this.globalConfig?.getUserMemory
        ? this.globalConfig.getUserMemory()
        : '';
      const systemInstruction = await getCoreSystemPromptAsync(
        userMemory,
        this.currentModel,
      );

      // For OAuth/CodeAssist mode, inject system prompt as first user message
      // This ensures the CodeAssist endpoint receives the full context
      // Similar to how AnthropicProvider handles OAuth mode
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

      const request = {
        model: this.currentModel,
        contents: contentsWithSystemPrompt,
        // Still pass systemInstruction for SDK compatibility
        systemInstruction,
        config: {
          tools: geminiTools,
          ...this.modelParams,
        },
      };

      stream = await contentGenerator.generateContentStream(
        request,
        'oauth-session',
      );
    } else {
      // API key mode
      const genAI = new GoogleGenAI({
        apiKey: authToken,
        vertexai: this.authMode === 'vertex-ai',
        httpOptions: this.getBaseURL()
          ? { ...httpOptions, baseUrl: this.getBaseURL() }
          : httpOptions,
      });

      const contentGenerator = genAI.models;
      const userMemory = this.globalConfig?.getUserMemory
        ? this.globalConfig.getUserMemory()
        : '';
      const systemInstruction = await getCoreSystemPromptAsync(
        userMemory,
        this.currentModel,
      );

      const request = {
        model: this.currentModel,
        contents,
        systemInstruction,
        config: {
          tools: geminiTools,
          ...this.modelParams,
        },
      };

      stream = await contentGenerator.generateContentStream(request);
    }

    // Stream responses as IContent
    for await (const response of stream) {
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

      // Extract usage metadata from response
      const usageMetadata = (response as GeminiResponseWithUsage).usageMetadata;

      // Yield text if present
      if (text) {
        const textContent: IContent = {
          speaker: 'ai',
          blocks: [{ type: 'text', text }],
        };

        // Add usage metadata if present
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

        yield textContent;
      }

      // Yield tool calls if present
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

        // Add usage metadata if present
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

        yield toolCallContent;
      }

      // If we have usage metadata but no content blocks, emit a metadata-only response
      if (usageMetadata && !text && functionCalls.length === 0) {
        yield {
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
        } as IContent;
      }
    }
  }
}
