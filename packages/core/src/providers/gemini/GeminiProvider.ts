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
import {
  Config,
  AuthType,
  AuthenticationRequiredError,
  getCoreSystemPromptAsync,
  createCodeAssistContentGenerator,
} from '@vybestack/llxprt-code-core';
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

export class GeminiProvider extends BaseProvider {
  private logger: DebugLogger;
  private authMode: GeminiAuthMode = 'none';
  private geminiConfig?: Config;
  private currentModel: string = 'gemini-2.5-pro';
  private modelExplicitlySet: boolean = false;
  private baseURL?: string;
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

    super(baseConfig);

    this.logger = new DebugLogger('llxprt:gemini:provider');
    // Store Gemini-specific configuration
    this.geminiConfig = config;
    this.baseURL = baseURL;
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
            'Web search requires Gemini authentication, but no API key is set and OAuth is disabled',
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
      const authType = this.geminiConfig?.getContentGeneratorConfig()?.authType;
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
            'Web search requires Gemini authentication, but no API key is set and OAuth is disabled',
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
    this.geminiConfig = config;

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
          const url = this.baseURL
            ? `${this.baseURL.replace(/\/$/, '')}/v1beta/models?key=${apiKey}`
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
    // If no baseUrl is provided or it's an empty string, clear to undefined
    this.baseURL = baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined;
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
    if (this.geminiConfig) {
      this.geminiConfig.setModel(modelId);
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
          `invokeServerTool: geminiConfig is ${this.geminiConfig ? 'set' : 'null/undefined'}`,
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
            httpOptions: this.baseURL
              ? {
                  ...httpOptions,
                  baseUrl: this.baseURL,
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
            httpOptions: this.baseURL
              ? {
                  ...httpOptions,
                  baseUrl: this.baseURL,
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

            // If geminiConfig is not set (e.g., when using non-Gemini provider),
            // create a minimal config for OAuth
            let configForOAuth = this.geminiConfig;
            if (!configForOAuth) {
              this.logger.debug(
                () =>
                  `invokeServerTool: geminiConfig is null, creating minimal config for OAuth`,
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
            httpOptions: this.baseURL
              ? {
                  ...httpOptions,
                  baseUrl: this.baseURL,
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
            httpOptions: this.baseURL
              ? {
                  ...httpOptions,
                  baseUrl: this.baseURL,
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
            this.geminiConfig!,
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
        parameters?: unknown;
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
            let parameters = decl.parameters;
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
      const configForOAuth = this.geminiConfig || {
        getProxy: () => undefined,
      };

      const contentGenerator = await createCodeAssistContentGenerator(
        httpOptions,
        AuthType.LOGIN_WITH_GOOGLE,
        configForOAuth as Config,
        this.baseURL,
      );

      const userMemory = this.geminiConfig?.getUserMemory
        ? this.geminiConfig.getUserMemory()
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

      stream = await contentGenerator.generateContentStream(
        request,
        'oauth-session',
      );
    } else {
      // API key mode
      const genAI = new GoogleGenAI({
        apiKey: authToken,
        vertexai: this.authMode === 'vertex-ai',
        httpOptions: this.baseURL
          ? { ...httpOptions, baseUrl: this.baseURL }
          : httpOptions,
      });

      const contentGenerator = genAI.models;
      const userMemory = this.geminiConfig?.getUserMemory
        ? this.geminiConfig.getUserMemory()
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

      // Yield text if present
      if (text) {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text }],
        } as IContent;
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

        yield {
          speaker: 'ai',
          blocks,
        } as IContent;
      }
    }
  }
}
